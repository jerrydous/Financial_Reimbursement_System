import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import {
  buildLedgerWorkbook,
  createVoucherExportFromEnv,
  mapTravelOrder,
  type LedgerRow,
} from '@frs/adapters';
import { pageOffset, type BudgetLineView, type DocumentList, type ExportJob, type ProxyView } from '@frs/contracts';
import {
  DomainError,
  ExpenseReportError,
  applyInstallmentPayment,
  assertDelegate,
  assertSingleRoleAssignee,
  contractCanClose,
  loanStatusAfterBalance,
  normalizeIdempotencyKey,
  parseFen,
  subsidyAmount,
  sumFen,
  timeoutNotice,
  transitionApplication,
  transitionContract,
  transitionExpenseReport,
  transitionLoan,
  voucherFromPaidReport,
  writeOffLoan,
} from '@frs/domain';
import { todayInShanghai } from '../calendar';
import { PrismaService } from '../prisma.service';
import { isUniqueViolation } from '../expense-reports/http-error';
import {
  consumeCorporateBudget,
  releaseCorporateBudget,
  reserveCorporateBudget,
} from '../expense-reports/report-controls';

export interface ReminderPort {
  startReminder(documentId: string, kind: string): Promise<void>;
  stopReminder(documentId: string, kind: string): Promise<void>;
}

export interface ExportStore {
  putObject(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void>;
  presignRead(objectKey: string): Promise<string>;
}

const noopReminder: ReminderPort = {
  async startReminder() {
    return undefined;
  },
  async stopReminder() {
    return undefined;
  },
};

@Injectable()
export class DocumentCommands {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: ReminderPort = noopReminder,
    private readonly storage: ExportStore = {
      async putObject() {
        return undefined;
      },
      async presignRead() {
        return '';
      },
    },
  ) {}

  async listApplications(employeeId: string, page: number, pageSize: number, inbox = false): Promise<DocumentList> {
    if (inbox) {
      return this.listForManagers('application', employeeId, page, pageSize);
    }
    return this.listOwned('application', employeeId, page, pageSize);
  }

  async createApplication(employeeId: string, purpose: string, amountFen: string, idempotencyKey: string | undefined) {
    const key = normalizeIdempotencyKey(idempotencyKey);
    const amount = parseFen(amountFen);
    return this.once('create_application', key, async () => {
      const id = uuidv7();
      await this.prisma.application.create({
        data: { id, employeeId, purpose, amountFen: amount, consumedFen: 0, status: 'draft' },
      });
      return id;
    });
  }

  async submitApplication(employeeId: string, id: string): Promise<{ id: string; status: string }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockApplication(tx, id);
      this.owned(row.employeeId, employeeId);
      if (!row.employee.managerId) {
        throw new ExpenseReportError('MANAGER_NOT_ASSIGNED', '员工没有主管，不能提交');
      }
      const submitted = transitionApplication(asApplication(row.status), 'submit');
      const approving = transitionApplication(submitted, 'start_approval');
      await tx.application.update({ where: { id }, data: { status: approving, version: { increment: 1 } } });
      return { id, status: approving, managerId: row.employee.managerId };
    });
    await this.remind(id, 'application', result.managerId ?? '');
    return { id: result.id, status: result.status };
  }

  async decideApplication(actorId: string, id: string, action: 'approve' | 'reject' | 'withdraw' | 'revise' | 'close') {
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockApplication(tx, id);
      const status = asApplication(row.status);
      if (action === 'approve' || action === 'reject') {
        await this.assertManager(tx, row.employee.managerId, actorId);
      } else {
        this.owned(row.employeeId, actorId);
      }
      const next = transitionApplication(status, action);
      await tx.application.update({ where: { id }, data: { status: next, version: { increment: 1 } } });
      return { id, status: next };
    });
    await this.stopRemind(id, 'application');
    return updated;
  }

  async listLoans(employeeId: string, page: number, pageSize: number, inbox = false): Promise<DocumentList> {
    if (inbox) {
      return this.listForManagers('loan', employeeId, page, pageSize);
    }
    return this.listOwned('loan', employeeId, page, pageSize);
  }

  async createLoan(employeeId: string, amountFen: string, dueOn: string, idempotencyKey: string | undefined) {
    const key = normalizeIdempotencyKey(idempotencyKey);
    const amount = parseFen(amountFen);
    return this.once('create_loan', key, async () => {
      const id = uuidv7();
      await this.prisma.loan.create({
        data: { id, employeeId, amountFen: amount, balanceFen: amount, status: 'draft', dueOn },
      });
      return id;
    });
  }

  async submitLoan(employeeId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockLoan(tx, id);
      this.owned(row.employeeId, employeeId);
      const next = transitionLoan(asLoan(row.status), 'submit');
      await tx.loan.update({ where: { id }, data: { status: next, version: { increment: 1 } } });
      return { id, status: next };
    });
  }

  async decideLoan(actorId: string, id: string, action: 'approve' | 'reject') {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lockLoan(tx, id);
      await this.assertManager(tx, row.employee.managerId, actorId);
      const next = transitionLoan(asLoan(row.status), action);
      await tx.loan.update({
        where: { id },
        data: { status: next, balanceFen: action === 'approve' ? row.amountFen : row.balanceFen, version: { increment: 1 } },
      });
      return { id, status: next };
    });
  }

  async repay(employeeId: string, loanId: string, amountFen: string, idempotencyKey: string | undefined) {
    const key = normalizeIdempotencyKey(idempotencyKey);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.idempotencyKey.findUnique({
          where: { tenantId_operation_key: { tenantId: 'default', operation: 'repay_loan', key } },
        });
        if (existing) {
          if (existing.documentId !== loanId) {
            throw new DomainError('IDEMPOTENCY_PAYLOAD_MISMATCH', '这个还款编号已经用于另一笔借款');
          }
          const loan = await tx.loan.findUnique({ where: { id: loanId } });
          return { id: loanId, status: loan?.status ?? 'outstanding', balanceFen: loan?.balanceFen.toString() ?? '0' };
        }
        await tx.$queryRaw`SELECT id FROM loans WHERE id = ${loanId} FOR UPDATE`;
        const loan = await tx.loan.findUnique({ where: { id: loanId } });
        if (!loan || loan.employeeId !== employeeId) {
          throw new DomainError('DOCUMENT_NOT_FOUND', '借款单不存在');
        }
        if (loan.status !== 'outstanding') {
          throw new DomainError('INVALID_TRANSITION', '只有未结清的借款可以还款');
        }
        const balance = writeOffLoan(parseFen(loan.balanceFen.toString()), parseFen(amountFen));
        const status = loanStatusAfterBalance(balance) === 'settled' ? transitionLoan('outstanding', 'settle') : 'outstanding';
        await tx.loan.update({
          where: { id: loanId },
          data: { balanceFen: balance, status, version: { increment: 1 } },
        });
        await tx.repayment.create({
          data: { id: uuidv7(), loanId, employeeId, amountFen: parseFen(amountFen), idempotencyKey: key },
        });
        await tx.idempotencyKey.create({
          data: { id: uuidv7(), operation: 'repay_loan', key, documentId: loanId },
        });
        return { id: loanId, status, balanceFen: balance.toString() };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const existing = await this.prisma.idempotencyKey.findUnique({
        where: { tenantId_operation_key: { tenantId: 'default', operation: 'repay_loan', key } },
      });
      if (!existing || existing.documentId !== loanId) {
        throw new DomainError('IDEMPOTENCY_PAYLOAD_MISMATCH', '这个还款编号已经用于另一笔借款');
      }
      const loan = await this.prisma.loan.findUnique({ where: { id: loanId } });
      return { id: loanId, status: loan?.status ?? 'outstanding', balanceFen: loan?.balanceFen.toString() ?? '0' };
    }
  }

  async listRepayments(employeeId: string, page: number, pageSize: number): Promise<DocumentList> {
    const skip = pageOffset(page, pageSize);
    const where = { employeeId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.repayment.count({ where }),
      this.prisma.repayment.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: 'paid',
        amountFen: row.amountFen.toString(),
        title: '还款',
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  async listBudgets(): Promise<{ items: BudgetLineView[] }> {
    const rows = await this.prisma.budgetLine.findMany({
      include: { department: true, project: true, subject: true },
      orderBy: { period: 'desc' },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        period: row.period,
        amountFen: row.amountFen.toString(),
        reservedFen: row.reservedFen.toString(),
        consumedFen: row.consumedFen.toString(),
        departmentName: row.department.name,
        projectName: row.project.name,
        subjectName: row.subject.name,
      })),
    };
  }

  async createBudget(actorId: string, input: { departmentId: string; projectId: string; subjectId: string; period: string; amountFen: string }) {
    await this.assertFinanceRole(actorId);
    const amount = parseFen(input.amountFen);
    const id = uuidv7();
    await this.prisma.budgetLine.create({
      data: {
        id,
        departmentId: input.departmentId,
        projectId: input.projectId,
        subjectId: input.subjectId,
        period: input.period,
        amountFen: amount,
      },
    });
    return { id };
  }

  async listMaster() {
    const [departments, projects, subjects, costCenters, vendors, expenseTypes] = await Promise.all([
      this.prisma.department.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
      this.prisma.project.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
      this.prisma.budgetSubject.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.costCenter.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
      this.prisma.vendor.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
      this.prisma.expenseType.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } }),
    ]);
    const option = (row: { id: string; name: string }) => ({ id: row.id, name: row.name });
    return {
      departments: departments.map(option),
      projects: projects.map(option),
      subjects: subjects.map(option),
      costCenters: costCenters.map(option),
      vendors: vendors.map(option),
      expenseTypes: expenseTypes.map(option),
    };
  }

  async previewSubsidy(employeeId: string, city: string, days: number) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee?.rankId) {
      throw new DomainError('SUBSIDY_INVALID', '员工没有职级，不能计算补贴');
    }
    const rate = await this.prisma.subsidyRate.findUnique({
      where: { tenantId_city_rankId: { tenantId: 'default', city, rankId: employee.rankId } },
    });
    if (!rate || !rate.enabled) {
      throw new DomainError('SUBSIDY_INVALID', '没有这张城市和职级的补贴标准');
    }
    return { amountFen: subsidyAmount(parseFen(rate.dailyFen.toString()), days).toString() };
  }

  async listProxies(employeeId: string): Promise<{ items: ProxyView[] }> {
    const rows = await this.prisma.approvalProxy.findMany({
      where: { principalId: employeeId },
      include: { agent: true },
      orderBy: { startsOn: 'desc' },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        principalId: row.principalId,
        agentId: row.agentId,
        agentName: row.agent.name,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        enabled: row.enabled,
      })),
    };
  }

  async createProxy(principalId: string, agentId: string, startsOn: string, endsOn: string) {
    if (principalId === agentId || startsOn > endsOn) {
      throw new DomainError('REQUEST_INVALID', '代理期间和代理人不合法');
    }
    const agent = await this.prisma.employee.findUnique({ where: { id: agentId } });
    if (!agent) {
      throw new DomainError('TRANSFER_TARGET_INVALID', '代理人必须是员工');
    }
    const id = uuidv7();
    await this.prisma.approvalProxy.create({
      data: { id, principalId, agentId, startsOn, endsOn, enabled: true },
    });
    return { id };
  }

  async disableProxy(principalId: string, id: string) {
    const row = await this.prisma.approvalProxy.findUnique({ where: { id } });
    if (!row || row.principalId !== principalId) {
      throw new DomainError('DOCUMENT_NOT_FOUND', '代理不存在');
    }
    await this.prisma.approvalProxy.update({ where: { id }, data: { enabled: false } });
    return { id, enabled: false };
  }

  async listContracts(employeeId: string, page: number, pageSize: number): Promise<DocumentList> {
    return this.listOwned('contract', employeeId, page, pageSize);
  }

  async createContract(
    employeeId: string,
    input: { vendorId: string; title: string; installments: { dueOn: string; amountFen: string }[] },
    idempotencyKey: string | undefined,
  ) {
    const key = normalizeIdempotencyKey(idempotencyKey);
    const amounts = input.installments.map((item) => parseFen(item.amountFen));
    const total = sumFen(amounts);
    return this.once('create_contract', key, async () => {
      const id = uuidv7();
      await this.prisma.contract.create({
        data: {
          id,
          employeeId,
          vendorId: input.vendorId,
          title: input.title,
          amountFen: total,
          status: 'draft',
          installments: {
            create: input.installments.map((item, index) => ({
              id: uuidv7(),
              sequence: index + 1,
              dueOn: item.dueOn,
              amountFen: amounts[index] ?? parseFen('0'),
            })),
          },
        },
      });
      return id;
    });
  }

  async activateContract(employeeId: string, id: string) {
    const row = await this.prisma.contract.findUnique({ where: { id } });
    if (!row || row.employeeId !== employeeId) {
      throw new DomainError('DOCUMENT_NOT_FOUND', '合同不存在');
    }
    const next = transitionContract(asContract(row.status), 'activate');
    await this.prisma.contract.update({ where: { id }, data: { status: next, version: { increment: 1 } } });
    return { id, status: next };
  }

  async listInstallments(employeeId: string, page: number, pageSize: number): Promise<DocumentList> {
    const skip = pageOffset(page, pageSize);
    const where = { contract: { employeeId } };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.installment.count({ where }),
      this.prisma.installment.findMany({ where, orderBy: { dueOn: 'asc' }, skip, take: pageSize }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        amountFen: row.amountFen.toString(),
        title: `第 ${row.sequence} 期`,
        createdAt: new Date(`${row.dueOn}T00:00:00.000Z`).toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  async payInstallment(employeeId: string, id: string, amountFen: string, idempotencyKey: string | undefined) {
    const key = normalizeIdempotencyKey(idempotencyKey);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.idempotencyKey.findUnique({
        where: { tenantId_operation_key: { tenantId: 'default', operation: 'pay_installment', key } },
      });
      if (existing) {
        return { id };
      }
      await tx.$queryRaw`SELECT id FROM installments WHERE id = ${id} FOR UPDATE`;
      const row = await tx.installment.findUnique({ where: { id }, include: { contract: true } });
      if (!row || row.contract.employeeId !== employeeId) {
        throw new DomainError('DOCUMENT_NOT_FOUND', '分期不存在');
      }
      if (row.contract.status !== 'active') {
        throw new DomainError('INVALID_TRANSITION', '合同还没生效');
      }
      const paid = applyInstallmentPayment(parseFen(row.amountFen.toString()), parseFen(row.paidFen.toString()), parseFen(amountFen));
      await tx.installment.update({ where: { id }, data: { paidFen: paid.paid, status: paid.status } });
      const siblings = await tx.installment.findMany({ where: { contractId: row.contractId } });
      const statuses = siblings.map((item) => ({ status: (item.id === id ? paid.status : item.status) as 'pending' | 'partial' | 'paid' }));
      if (contractCanClose(statuses)) {
        await tx.contract.update({ where: { id: row.contractId }, data: { status: 'closed', version: { increment: 1 } } });
      }
      await tx.idempotencyKey.create({ data: { id: uuidv7(), operation: 'pay_installment', key, documentId: id } });
      return { id, status: paid.status };
    });
  }

  async listCorporate(employeeId: string, page: number, pageSize: number, inbox = false): Promise<DocumentList> {
    if (inbox) {
      return this.listCorporateInbox(employeeId, page, pageSize);
    }
    return this.listOwned('corporateBill', employeeId, page, pageSize);
  }

  async createCorporate(
    employeeId: string,
    input: { vendorId: string; contractId?: string | null; invoiceNumber: string; amountFen: string; budgetLineId?: string | null },
    idempotencyKey: string | undefined,
  ) {
    const key = normalizeIdempotencyKey(idempotencyKey);
    const amount = parseFen(input.amountFen);
    return this.once('create_corporate_bill', key, async () => {
      const id = uuidv7();
      await this.prisma.corporateBill.create({
        data: {
          id,
          employeeId,
          vendorId: input.vendorId,
          contractId: input.contractId ?? null,
          invoiceNumber: input.invoiceNumber,
          amountFen: amount,
          status: 'draft',
          budgetLineId: input.budgetLineId ?? null,
        },
      });
      return id;
    });
  }

  async submitCorporate(employeeId: string, id: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockBill(tx, id);
      this.owned(row.employeeId, employeeId);
      if (!row.employee.managerId) {
        throw new ExpenseReportError('MANAGER_NOT_ASSIGNED', '员工没有主管，不能提交');
      }
      if (row.budgetLineId) {
        await reserveCorporateBudget(tx, id, row.budgetLineId, parseFen(row.amountFen.toString()));
      }
      const submitted = transitionExpenseReport(asReport(row.status), 'submit');
      const approving = transitionExpenseReport(submitted, 'start_approval');
      await tx.corporateBill.update({
        where: { id },
        data: { status: approving, currentActorId: row.employee.managerId, version: { increment: 1 } },
      });
      return { id, status: approving, managerId: row.employee.managerId };
    });
    await this.remind(id, 'corporate', result.managerId ?? '');
    return { id: result.id, status: result.status };
  }

  async decideCorporate(
    actorId: string,
    id: string,
    action: 'approve' | 'reject' | 'withdraw' | 'finance_approve' | 'pay_success',
    idempotencyKey?: string,
  ) {
    if (action === 'pay_success') {
      const key = normalizeIdempotencyKey(idempotencyKey);
      const existing = await this.prisma.idempotencyKey.findUnique({
        where: { tenantId_operation_key: { tenantId: 'default', operation: 'confirm_corporate_payment', key } },
      });
      if (existing) {
        if (existing.documentId !== id) {
          throw new DomainError('IDEMPOTENCY_PAYLOAD_MISMATCH', '这个支付编号已经用于另一张单据');
        }
        const bill = await this.prisma.corporateBill.findUnique({ where: { id } });
        return { id, status: bill?.status ?? 'paid' };
      }
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await this.lockBill(tx, id);
      const status = asReport(row.status);
      if (action === 'withdraw') {
        this.owned(row.employeeId, actorId);
      } else if (action === 'approve' || action === 'reject') {
        await this.assertManager(tx, row.currentActorId, actorId);
      } else if (action === 'finance_approve') {
        await this.assertFinance(actorId, row.employee.companyId);
      } else {
        await this.assertCashier(actorId, row.employee.companyId);
      }
      const next = transitionExpenseReport(status, action);
      if (action === 'reject' || action === 'withdraw') {
        await releaseCorporateBudget(tx, id);
      }
      if (action === 'pay_success') {
        await consumeCorporateBudget(tx, id);
      }
      const companyId = row.employee.companyId;
      const finance =
        action === 'approve' ? await tx.employee.findMany({ where: { role: 'finance', companyId }, select: { id: true } }) : [];
      const cashiers =
        action === 'finance_approve'
          ? await tx.employee.findMany({ where: { role: 'cashier', companyId }, select: { id: true } })
          : [];
      if (action === 'approve') {
        assertSingleRoleAssignee('finance', finance.length);
      }
      if (action === 'finance_approve') {
        assertSingleRoleAssignee('cashier', cashiers.length);
      }
      await tx.corporateBill.update({
        where: { id },
        data: {
          status: next,
          currentActorId: finance[0]?.id ?? cashiers[0]?.id ?? null,
          version: { increment: 1 },
        },
      });
      if (action === 'pay_success') {
        await tx.idempotencyKey.create({
          data: { id: uuidv7(), operation: 'confirm_corporate_payment', key: normalizeIdempotencyKey(idempotencyKey), documentId: id },
        });
      }
      return { id, status: next };
    });
    await this.stopRemind(id, 'corporate');
    return updated;
  }

  async listPayments(employeeId: string, seeAll: boolean, page: number, pageSize: number): Promise<DocumentList> {
    const skip = pageOffset(page, pageSize);
    const where = seeAll ? {} : { report: { employeeId } };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        amountFen: row.amountFen.toString(),
        title: '报销付款',
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  async importTravel(employeeId: string, provider: 'ctrip' | 'didi', payload: unknown) {
    const draft = mapTravelOrder(provider, payload);
    try {
      const id = uuidv7();
      await this.prisma.travelOrder.create({
        data: {
          id,
          employeeId,
          provider,
          externalId: draft.externalId,
          amountFen: parseFen(draft.amountFen),
          occurredOn: draft.occurredOn,
          summary: draft.summary,
        },
      });
      return { id, ...draft, reused: false };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      throw new DomainError('TRAVEL_DUPLICATE', '这张商旅订单已经导入');
    }
  }

  async listTravel(employeeId: string, page: number, pageSize: number): Promise<DocumentList> {
    return this.listOwned('travelOrder', employeeId, page, pageSize);
  }

  private async financeOrCashier(actorId: string): Promise<{ companyId: string }> {
    const employee = await this.prisma.employee.findUnique({ where: { id: actorId } });
    if (!employee || (employee.role !== 'finance' && employee.role !== 'cashier')) {
      throw new DomainError('ACTOR_FORBIDDEN', '只有财务或出纳可以导出');
    }
    return employee;
  }

  async exportVoucher(actorId: string, reportId: string) {
    const actor = await this.financeOrCashier(actorId);
    const report = await this.prisma.expenseReport.findUnique({
      where: { id: reportId },
      include: { employee: { select: { companyId: true } } },
    });
    if (!report || report.employee.companyId !== actor.companyId) {
      throw new ExpenseReportError('REPORT_NOT_FOUND', '报销单不存在');
    }
    const paidOn = todayInShanghai();
    const amount = parseFen(report.amountFen.toString());
    const payload = voucherFromPaidReport({
      reportId,
      status: report.status,
      paidOn,
      amount,
      currency: report.currency,
      explanation: '对私报销',
    });
    const posted = await createVoucherExportFromEnv().exportPaid({
      reportId,
      status: report.status,
      paidOn,
      amount,
      currency: report.currency,
      explanation: '对私报销',
    });
    return { posted: posted.posted, message: posted.message, payload };
  }

  async createExport(actorId: string, idempotencyKey: string | undefined): Promise<ExportJob> {
    await this.financeOrCashier(actorId);
    const key = normalizeIdempotencyKey(idempotencyKey);
    const existing = await this.prisma.exportJob.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: 'default', idempotencyKey: key } },
    });
    if (existing) {
      return this.exportView(existing);
    }
    const id = uuidv7();
    await this.prisma.exportJob.create({
      data: { id, actorId, status: 'pending', idempotencyKey: key },
    });
    await this.runExport(id);
    return this.exportView(await this.prisma.exportJob.findUniqueOrThrow({ where: { id } }));
  }

  async getExport(actorId: string, id: string): Promise<ExportJob> {
    const job = await this.prisma.exportJob.findUnique({ where: { id } });
    if (!job || job.actorId !== actorId) {
      throw new DomainError('DOCUMENT_NOT_FOUND', '导出任务不存在');
    }
    return this.exportView(job);
  }

  async runExport(id: string): Promise<void> {
    const job = await this.prisma.exportJob.findUnique({ where: { id } });
    if (!job || job.status === 'succeeded') {
      return;
    }
    const actor = job ? await this.prisma.employee.findUnique({ where: { id: job.actorId } }) : null;
    const colleagues = actor
      ? await this.prisma.employee.findMany({ where: { companyId: actor.companyId }, select: { id: true } })
      : [];
    const rows = await this.prisma.invoice.findMany({
      where: { ownerEmployeeId: { in: colleagues.map((person) => person.id) } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const ledger: LedgerRow[] = rows.map((row) => ({
      invoiceCode: row.invoiceCode,
      invoiceNumber: row.invoiceNumber,
      amountFen: row.amountFen?.toString() ?? null,
      currency: row.currency,
      sellerName: row.sellerName,
      invoiceDate: row.invoiceDate,
      verificationStatus: row.verificationStatus,
      ledgerStatus: row.ledgerStatus,
      reportId: row.expenseReportId ?? '',
    }));
    const body = await buildLedgerWorkbook(ledger);
    const objectKey = `exports/default/${id}.xlsx`;
    await this.storage.putObject({
      objectKey,
      body,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await this.prisma.exportJob.update({ where: { id }, data: { status: 'succeeded', objectKey, message: '' } });
  }

  async publishPolicy(actorId: string, input: { name: string; rules: Record<string, unknown>[]; skipManagerBelowFen?: string | null }) {
    await this.assertFinanceRole(actorId);
    const latest = await this.prisma.policyVersion.findFirst({
      where: { tenantId: 'default', name: input.name },
      orderBy: { version: 'desc' },
    });
    await this.prisma.policyVersion.updateMany({
      where: { tenantId: 'default', name: input.name, status: 'published' },
      data: { status: 'retired' },
    });
    const id = uuidv7();
    await this.prisma.policyVersion.create({
      data: {
        id,
        name: input.name,
        version: (latest?.version ?? 0) + 1,
        status: 'published',
        rulesJson: input.rules as Prisma.InputJsonValue,
        skipManagerBelowFen: input.skipManagerBelowFen ? parseFen(input.skipManagerBelowFen) : null,
      },
    });
    return { id };
  }

  async remindDocument(documentId: string, kind: string): Promise<void> {
    let recipientId = '';
    if (kind === 'expense') {
      const report = await this.prisma.expenseReport.findUnique({ where: { id: documentId } });
      recipientId = report?.currentActorId ?? '';
    } else if (kind === 'application') {
      const row = await this.prisma.application.findUnique({ where: { id: documentId }, include: { employee: true } });
      recipientId = row?.employee.managerId ?? '';
    } else if (kind === 'corporate') {
      const row = await this.prisma.corporateBill.findUnique({ where: { id: documentId } });
      recipientId = row?.currentActorId ?? '';
    }
    if (!recipientId) {
      return;
    }
    const notice = timeoutNotice({ documentId, actorId: recipientId, waitingSince: new Date().toISOString() });
    try {
      await this.prisma.notification.create({
        data: {
          id: uuidv7(),
          kind,
          recipientId,
          documentId,
          template: notice.template,
          paramsJson: notice.params,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  private async actingIds(actorId: string): Promise<string[]> {
    const today = todayInShanghai();
    const proxies = await this.prisma.approvalProxy.findMany({
      where: { agentId: actorId, enabled: true, startsOn: { lte: today }, endsOn: { gte: today } },
      select: { principalId: true },
    });
    return [...new Set([actorId, ...proxies.map((proxy) => proxy.principalId)])];
  }

  private async listForManagers(
    kind: 'application' | 'loan',
    actorId: string,
    page: number,
    pageSize: number,
  ): Promise<DocumentList> {
    const ids = await this.actingIds(actorId);
    const skip = pageOffset(page, pageSize);
    const where = { status: 'approving', employee: { managerId: { in: ids } } };
    if (kind === 'application') {
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.application.count({ where }),
        this.prisma.application.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      ]);
      return this.page(
        rows.map((row) => ({ id: row.id, status: row.status, amountFen: row.amountFen, title: row.purpose, createdAt: row.createdAt })),
        page,
        pageSize,
        total,
      );
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.loan.count({ where }),
      this.prisma.loan.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    return this.page(
      rows.map((row) => ({ id: row.id, status: row.status, amountFen: row.balanceFen, title: `到期 ${row.dueOn}`, createdAt: row.createdAt })),
      page,
      pageSize,
      total,
    );
  }

  private async listCorporateInbox(actorId: string, page: number, pageSize: number): Promise<DocumentList> {
    const ids = await this.actingIds(actorId);
    const people = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: { role: true, companyId: true },
    });
    const financeCompanies = [...new Set(people.filter((person) => person.role === 'finance').map((person) => person.companyId))];
    const cashierCompanies = [...new Set(people.filter((person) => person.role === 'cashier').map((person) => person.companyId))];
    const skip = pageOffset(page, pageSize);
    const where = {
      OR: [
        { status: 'approving', currentActorId: { in: ids } },
        ...(financeCompanies.length === 0 ? [] : [{ status: 'finance_review', employee: { companyId: { in: financeCompanies } } }]),
        ...(cashierCompanies.length === 0 ? [] : [{ status: 'paying', employee: { companyId: { in: cashierCompanies } } }]),
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.corporateBill.count({ where }),
      this.prisma.corporateBill.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    return this.page(
      rows.map((row) => ({ id: row.id, status: row.status, amountFen: row.amountFen, title: row.invoiceNumber || '对公付款', createdAt: row.createdAt })),
      page,
      pageSize,
      total,
    );
  }

  private async listOwned(kind: 'application' | 'loan' | 'contract' | 'corporateBill' | 'travelOrder', employeeId: string, page: number, pageSize: number): Promise<DocumentList> {
    const skip = pageOffset(page, pageSize);
    if (kind === 'application') {
      const where = { employeeId };
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.application.count({ where }),
        this.prisma.application.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      ]);
      return this.page(rows.map((row) => ({ id: row.id, status: row.status, amountFen: row.amountFen, title: row.purpose, createdAt: row.createdAt })), page, pageSize, total);
    }
    if (kind === 'loan') {
      const where = { employeeId };
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.loan.count({ where }),
        this.prisma.loan.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      ]);
      return this.page(rows.map((row) => ({ id: row.id, status: row.status, amountFen: row.balanceFen, title: `到期 ${row.dueOn}`, createdAt: row.createdAt })), page, pageSize, total);
    }
    if (kind === 'contract') {
      const where = { employeeId };
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.contract.count({ where }),
        this.prisma.contract.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      ]);
      return this.page(rows.map((row) => ({ id: row.id, status: row.status, amountFen: row.amountFen, title: row.title, createdAt: row.createdAt })), page, pageSize, total);
    }
    if (kind === 'corporateBill') {
      const where = { employeeId };
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.corporateBill.count({ where }),
        this.prisma.corporateBill.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      ]);
      return this.page(rows.map((row) => ({ id: row.id, status: row.status, amountFen: row.amountFen, title: row.invoiceNumber || '对公付款', createdAt: row.createdAt })), page, pageSize, total);
    }
    const where = { employeeId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.travelOrder.count({ where }),
      this.prisma.travelOrder.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    ]);
    return this.page(
      rows.map((row) => ({ id: row.id, status: row.provider, amountFen: row.amountFen, title: row.summary, createdAt: row.createdAt })),
      page,
      pageSize,
      total,
    );
  }

  private page(
    rows: { id: string; status: string; amountFen: bigint; title: string; createdAt: Date }[],
    page: number,
    pageSize: number,
    total: number,
  ): DocumentList {
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        amountFen: row.amountFen.toString(),
        title: row.title,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  private async once(operation: string, key: string, create: () => Promise<string>) {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { tenantId_operation_key: { tenantId: 'default', operation, key } },
    });
    if (existing) {
      return { id: existing.documentId };
    }
    try {
      const id = await create();
      await this.prisma.idempotencyKey.create({ data: { id: uuidv7(), operation, key, documentId: id } });
      return { id };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const winner = await this.prisma.idempotencyKey.findUnique({
        where: { tenantId_operation_key: { tenantId: 'default', operation, key } },
      });
      if (!winner) {
        throw error;
      }
      return { id: winner.documentId };
    }
  }

  private async lockApplication(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM applications WHERE id = ${id} FOR UPDATE`;
    const row = await tx.application.findUnique({ where: { id }, include: { employee: true } });
    if (!row) {
      throw new DomainError('DOCUMENT_NOT_FOUND', '申请单不存在');
    }
    return row;
  }

  private async lockLoan(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM loans WHERE id = ${id} FOR UPDATE`;
    const row = await tx.loan.findUnique({ where: { id }, include: { employee: true } });
    if (!row) {
      throw new DomainError('DOCUMENT_NOT_FOUND', '借款单不存在');
    }
    return row;
  }

  private async lockBill(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM corporate_bills WHERE id = ${id} FOR UPDATE`;
    const row = await tx.corporateBill.findUnique({ where: { id }, include: { employee: true } });
    if (!row) {
      throw new DomainError('DOCUMENT_NOT_FOUND', '对公付款单不存在');
    }
    return row;
  }

  private owned(ownerId: string, actorId: string): void {
    if (ownerId !== actorId) {
      throw new DomainError('ACTOR_FORBIDDEN', '不能操作别人的单据');
    }
  }

  private async assertManager(tx: Prisma.TransactionClient, principalId: string | null, actorId: string): Promise<void> {
    if (!principalId) {
      throw new ExpenseReportError('ACTOR_UNASSIGNED', '当前步骤没有操作者');
    }
    const today = todayInShanghai();
    const proxy = await tx.approvalProxy.findFirst({
      where: { principalId, enabled: true, startsOn: { lte: today }, endsOn: { gte: today } },
    });
    assertDelegate(principalId, actorId, proxy ? { agentId: proxy.agentId, active: true } : null);
  }

  private async assertFinanceRole(actorId: string): Promise<void> {
    const actor = await this.prisma.employee.findUnique({ where: { id: actorId } });
    if (!actor || actor.role !== 'finance') {
      throw new DomainError('ACTOR_FORBIDDEN', '只有财务可以执行');
    }
  }

  private async assertFinance(actorId: string, companyId: string): Promise<void> {
    const actor = await this.prisma.employee.findUnique({ where: { id: actorId } });
    if (!actor || actor.role !== 'finance' || actor.companyId !== companyId) {
      throw new DomainError('ACTOR_FORBIDDEN', '只有本公司财务可以执行');
    }
  }

  private async assertCashier(actorId: string, companyId: string): Promise<void> {
    const actor = await this.prisma.employee.findUnique({ where: { id: actorId } });
    if (!actor || actor.role !== 'cashier' || actor.companyId !== companyId) {
      throw new DomainError('ACTOR_FORBIDDEN', '只有本公司出纳可以执行');
    }
  }

  private async remind(documentId: string, kind: string, recipientId: string): Promise<void> {
    try {
      await this.reminders.startReminder(documentId, kind);
    } catch {
      if (recipientId) {
        await this.remindDocument(documentId, kind).catch(() => undefined);
      }
    }
  }

  private async stopRemind(documentId: string, kind: string): Promise<void> {
    try {
      await this.reminders.stopReminder(documentId, kind);
    } catch {
      return undefined;
    }
  }

  private async exportView(job: { id: string; status: string; message: string; objectKey: string }): Promise<ExportJob> {
    const downloadPath = job.status === 'succeeded' && job.objectKey ? await this.storage.presignRead(job.objectKey) : '';
    return {
      id: job.id,
      status: job.status === 'failed' ? 'failed' : job.status === 'succeeded' ? 'succeeded' : 'pending',
      message: job.message,
      downloadPath,
    };
  }
}

function asApplication(status: string) {
  if (status !== 'draft' && status !== 'submitted' && status !== 'approving' && status !== 'approved' && status !== 'rejected' && status !== 'withdrawn' && status !== 'closed') {
    throw new DomainError('INVALID_TRANSITION', '申请单状态不合法');
  }
  return status;
}

function asLoan(status: string) {
  if (status !== 'draft' && status !== 'approving' && status !== 'outstanding' && status !== 'settled') {
    throw new DomainError('INVALID_TRANSITION', '借款单状态不合法');
  }
  return status;
}

function asContract(status: string) {
  if (status !== 'draft' && status !== 'active' && status !== 'closed') {
    throw new DomainError('INVALID_TRANSITION', '合同状态不合法');
  }
  return status;
}

function asReport(status: string) {
  if (
    status !== 'draft' &&
    status !== 'submitted' &&
    status !== 'approving' &&
    status !== 'finance_review' &&
    status !== 'paying' &&
    status !== 'paid' &&
    status !== 'rejected' &&
    status !== 'withdrawn'
  ) {
    throw new DomainError('INVALID_TRANSITION', '对公付款状态不合法');
  }
  return status;
}

