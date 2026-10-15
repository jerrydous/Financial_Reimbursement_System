import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { WorkflowNotRunning, enforceDocumentPolicy, type ExpenseDecisionSignal } from '@frs/adapters';
import { currencyCodeSchema, type ExpenseReportDetail } from '@frs/contracts';
import {
  DomainError,
  ExpenseReportError,
  actorForAction,
  allocateByWeights,
  applyFinanceAdjustment,
  assertActor,
  assertDelegate,
  assertReadyToAttach,
  assertReportMatchesLines,
  assertSingleRoleAssignee,
  assertLedgerOpen,
  assertVerificationAllowsExpense,
  buildAuditDraft,
  decideObjectKey,
  expenseWorkflowId,
  foldVotes,
  mayVote,
  occupyQuota,
  releaseQuota,
  nextActorAfter,
  normalizeIdempotencyKey,
  parseFen,
  stepForStatus,
  subsidyAmount,
  sumFen,
  transitionExpenseReport,
  type ApprovalMode,
  type ExpenseReportAction,
  type ExpenseReportStatus,
  type Fen,
  type RecognitionStatus,
  type VoteDecision,
} from '@frs/domain';
import { logger } from '../logging';
import { PrismaService } from '../prisma.service';
import { todayInShanghai } from '../calendar';
import { isUniqueViolation } from './http-error';
import {
  consumeReportBudget,
  deskForAmount,
  enforceSubmitControls,
  releaseExcessWriteOff,
  releaseReportControls,
  retargetReportBudget,
} from './report-controls';
import { asReportStatus, loadReport } from './report-view';

export type DraftExtras = {
  applicationId?: string | null;
  budgetLineId?: string | null;
  approvalMode?: ApprovalMode;
  approverIds?: string[];
  writeOffs?: { loanId: string; amountFen: string }[];
  subsidy?: { city: string; days: number } | null;
  allocations?: { departmentId: string; projectId: string; costCenterId: string; weight: string }[];
};

export interface ExpenseWorkflowPort {
  startApproval(reportId: string): Promise<void>;
  signalDecision(reportId: string, decision: ExpenseDecisionSignal): Promise<void>;
}

const progressed: Partial<Record<ExpenseReportAction, readonly ExpenseReportStatus[]>> = {
  start_approval: ['approving', 'finance_review', 'paying', 'paid', 'rejected', 'withdrawn'],
  approve: ['finance_review', 'paying', 'paid'],
  finance_approve: ['paying', 'paid'],
  pay_success: ['paid'],
  reject: ['rejected'],
  withdraw: ['withdrawn'],
  revise: ['draft'],
  submit: ['submitted', 'approving', 'finance_review', 'paying', 'paid'],
};

@Injectable()
export class ExpenseReportCommands {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: ExpenseWorkflowPort,
  ) {}

  async createDraft(
    employeeId: string,
    invoiceIds: readonly string[],
    idempotencyKey: string | undefined,
    extras: DraftExtras = {},
  ): Promise<ExpenseReportDetail> {
    const key = normalizeIdempotencyKey(idempotencyKey);
    try {
      return await this.createDraftOnce(employeeId, invoiceIds, key, extras);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const target = JSON.stringify(error.meta ?? {});
      if (target.includes('idempotency')) {
        return this.createDraftOnce(employeeId, invoiceIds, key, extras);
      }
      throw new ExpenseReportError('INVOICE_ALREADY_BOUND', '这张发票已经在另一张有效报销单里');
    }
  }

  async withdraw(employeeId: string, reportId: string): Promise<ExpenseReportDetail> {
    const detail = await this.apply({
      reportId,
      action: 'withdraw',
      actorId: employeeId,
      workflowId: null,
    });
    await this.notifyWorkflow(reportId, employeeId, {
      action: 'withdraw',
      actorId: employeeId,
      alreadyApplied: true,
      status: detail.status,
    });
    return detail;
  }

  async submit(employeeId: string, reportId: string, idempotencyKey: string | undefined): Promise<ExpenseReportDetail> {
    const key = normalizeIdempotencyKey(idempotencyKey);
    const detail = await this.prisma.$transaction((tx) => this.submitOnce(tx, employeeId, reportId, key));
    if (detail.status === 'submitted') {
      try {
        await this.workflows.startApproval(reportId);
      } catch (error) {
        logger.error({
          documentId: reportId,
          actorId: employeeId,
          workflowId: expenseWorkflowId(reportId),
          message: error instanceof Error ? error.message : 'workflow start failed',
        });
        throw new ExpenseReportError('WORKFLOW_UNAVAILABLE', '审批流程暂时不能启动，请用同一个 Idempotency-Key 重试');
      }
    }
    return detail;
  }

  async signal(
    employeeId: string,
    reportId: string,
    action: ExpenseReportAction,
    extra: { transferToEmployeeId?: string; idempotencyKey?: string },
  ): Promise<{ accepted: true }> {
    const detail = await this.apply({
      reportId,
      action,
      actorId: employeeId,
      workflowId: null,
      transferToEmployeeId: extra.transferToEmployeeId ?? null,
      idempotencyKey: extra.idempotencyKey ?? null,
    });
    await this.notifyWorkflow(reportId, employeeId, {
      action,
      actorId: employeeId,
      transferToEmployeeId: extra.transferToEmployeeId ?? null,
      idempotencyKey: extra.idempotencyKey ?? null,
      alreadyApplied: true,
      status: detail.status,
    });
    return { accepted: true };
  }

  private async notifyWorkflow(reportId: string, actorId: string, decision: ExpenseDecisionSignal): Promise<void> {
    try {
      await this.workflows.signalDecision(reportId, decision);
    } catch (error) {
      if (error instanceof WorkflowNotRunning) {
        return;
      }
      logger.error({
        documentId: reportId,
        actorId,
        workflowId: expenseWorkflowId(reportId),
        message: error instanceof Error ? error.message : 'workflow signal failed',
      });
    }
  }

  async adjust(employeeId: string, reportId: string, approvedAmountFen: string): Promise<ExpenseReportDetail> {
    return this.apply({
      reportId,
      action: 'finance_adjust',
      actorId: employeeId,
      workflowId: null,
      approvedAmountFen,
    });
  }

  async apply(input: {
    reportId: string;
    action: ExpenseReportAction;
    actorId: string;
    workflowId: string | null;
    approvedAmountFen?: string;
    transferToEmployeeId?: string | null;
    idempotencyKey?: string | null;
  }): Promise<ExpenseReportDetail> {
    const detail = await this.prisma.$transaction((tx) => this.applyOnce(tx, input));
    logger.info({
      documentId: input.reportId,
      actorId: input.actorId,
      workflowId: input.workflowId,
      action: input.action,
    });
    return detail;
  }

  async getVisible(actorId: string, reportId: string): Promise<ExpenseReportDetail> {
    const owned = await this.prisma.expenseReport.findUnique({
      where: { id: reportId },
      select: { employeeId: true, currentActorId: true },
    });
    if (!owned) {
      throw new ExpenseReportError('REPORT_NOT_FOUND', '报销单不存在');
    }
    if (owned.employeeId === actorId) {
      return this.withAct(actorId, reportId);
    }
    const policies = await this.prisma.documentAccess.findMany({
      where: { documentId: reportId, revokedAt: null, action: 'read' },
    });
    const allowed = await enforceDocumentPolicy(
      actorId,
      reportId,
      'read',
      policies.map((policy) => ({ actorId: policy.actorId, objectKey: policy.objectKey, action: policy.action })),
    );
    if (!allowed && !(await this.proxiesCurrentActor(actorId, owned.currentActorId)) && !(await this.viewerCanAct(actorId, reportId))) {
      throw new ExpenseReportError('ACTOR_FORBIDDEN', '不能查看这张报销单');
    }
    return this.withAct(actorId, reportId);
  }

  private async withAct(actorId: string, reportId: string): Promise<ExpenseReportDetail> {
    const detail = await this.prisma.$transaction((tx) => loadReport(tx, reportId));
    return { ...detail, canAct: await this.viewerCanAct(actorId, reportId) };
  }

  private async viewerCanAct(actorId: string, reportId: string): Promise<boolean> {
    const report = await this.prisma.expenseReport.findUnique({
      where: { id: reportId },
      include: { votes: true },
    });
    if (!report?.currentStep) {
      return false;
    }
    const today = todayInShanghai();
    const proxies = await this.prisma.approvalProxy.findMany({
      where: { agentId: actorId, enabled: true, startsOn: { lte: today }, endsOn: { gte: today } },
      select: { principalId: true },
    });
    const principals = new Set(proxies.map((proxy) => proxy.principalId));
    if (report.approvalMode !== 'single' && report.status === 'approving') {
      const pending = report.votes.filter((vote) => vote.decision === 'pending').map((vote) => vote.actorId);
      if (pending.includes(actorId) || pending.some((principalId) => principals.has(principalId))) {
        return true;
      }
    }
    const viewers = await this.prisma.employee.findMany({
      where: { id: { in: [actorId, ...principals] } },
      select: { role: true, companyId: true },
    });
    const owner = await this.prisma.employee.findUnique({ where: { id: report.employeeId }, select: { companyId: true } });
    if (owner && viewers.some((person) => person.companyId === owner.companyId && person.role === 'finance' && report.status === 'finance_review')) {
      return true;
    }
    if (owner && viewers.some((person) => person.companyId === owner.companyId && person.role === 'cashier' && report.status === 'paying')) {
      return true;
    }
    return report.currentActorId === actorId || (report.currentActorId !== null && principals.has(report.currentActorId));
  }

  private async proxiesCurrentActor(agentId: string, principalId: string | null): Promise<boolean> {
    if (!principalId || principalId === agentId) {
      return false;
    }
    const today = todayInShanghai();
    const proxy = await this.prisma.approvalProxy.findFirst({
      where: { agentId, principalId, enabled: true, startsOn: { lte: today }, endsOn: { gte: today } },
    });
    return proxy !== null;
  }

  private async createDraftOnce(
    employeeId: string,
    invoiceIds: readonly string[],
    key: string,
    extras: DraftExtras,
  ): Promise<ExpenseReportDetail> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.idempotencyKey.findUnique({
        where: { tenantId_operation_key: { tenantId: 'default', operation: 'create_expense_report', key } },
      });
      if (existing) {
        const previous = await loadReport(tx, existing.documentId);
        if (previous.employeeId !== employeeId) {
          throw new ExpenseReportError('ACTOR_FORBIDDEN', '这个 Idempotency-Key 已经属于另一名员工');
        }
        const previousIds = previous.invoices.map((invoice) => invoice.id).sort().join(',');
        const requestedIds = [...new Set(invoiceIds)].sort().join(',');
        if (previousIds !== requestedIds) {
          throw new ExpenseReportError('IDEMPOTENCY_PAYLOAD_MISMATCH', '这个提交编号已经用于另一组发票，请重新提交');
        }
        return previous;
      }
      const ids = [...new Set(invoiceIds)].sort();
      if (ids.length === 0) {
        throw new ExpenseReportError('INVOICE_REQUIRED', '至少要有一张已确认发票');
      }
      await tx.$queryRaw`SELECT id FROM invoices WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
      const invoices = await tx.invoice.findMany({ where: { id: { in: ids } } });
      if (invoices.length !== ids.length) {
        throw new ExpenseReportError('INVOICE_NOT_FOUND', '发票不存在');
      }
      const amounts: Fen[] = [];
      for (const invoice of invoices) {
        if (invoice.ownerEmployeeId !== employeeId) {
          throw new ExpenseReportError('ACTOR_FORBIDDEN', '不能使用别人的发票');
        }
        assertVerificationAllowsExpense(invoice.verificationStatus);
        assertLedgerOpen(invoice.ledgerStatus);
        if (invoice.binding !== 'released') {
          throw new ExpenseReportError('INVOICE_ALREADY_BOUND', '这张发票已经在另一张有效报销单里');
        }
        amounts.push(
          assertReadyToAttach(
            invoice.recognitionStatus as RecognitionStatus,
            invoice.amountFen === null ? null : parseFen(invoice.amountFen.toString()),
          ),
        );
      }
      const seenNumbers = new Set<string>();
      for (const invoice of invoices) {
        if (!invoice.invoiceNumber) {
          continue;
        }
        const identity = `${invoice.invoiceCode}\0${invoice.invoiceNumber}`;
        if (seenNumbers.has(identity)) {
          throw new ExpenseReportError('INVOICE_ALREADY_BOUND', '这个发票号码已经确认过');
        }
        seenNumbers.add(identity);
        const duplicate = await tx.invoice.findFirst({
          where: {
            tenantId: 'default',
            invoiceCode: invoice.invoiceCode,
            invoiceNumber: invoice.invoiceNumber,
            id: { notIn: ids },
            ledgerStatus: { not: 'removed' },
            OR: [{ binding: 'active' }, { recognitionStatus: 'confirmed' }],
          },
        });
        if (duplicate) {
          throw new ExpenseReportError('INVOICE_ALREADY_BOUND', '这个发票号码已经确认过');
        }
      }
      const currencies = [...new Set(invoices.map((invoice) => invoice.currency))];
      const parsedCurrency = currencyCodeSchema.safeParse(currencies[0]);
      if (currencies.length !== 1 || !parsedCurrency.success) {
        throw new ExpenseReportError('CURRENCY_MISMATCH', '一张报销单只能使用同一种币种，系统不会自动换汇');
      }
      const currency = parsedCurrency.data;
      if (currency !== 'CNY' && (extras.subsidy || extras.budgetLineId || extras.applicationId || (extras.writeOffs?.length ?? 0) > 0)) {
        throw new ExpenseReportError('CURRENCY_MISMATCH', '外币发票暂不和人民币补贴、预算、申请或借款冲销混在一张单里');
      }
      const invoiceTotal = sumFen(amounts);
      const employee = await tx.employee.findUnique({ where: { id: employeeId }, include: { company: true } });
      if (!employee) {
        throw new ExpenseReportError('ACTOR_FORBIDDEN', '不能使用别人的发票');
      }
      let subsidy = parseFen('0');
      if (extras.subsidy) {
        if (!employee.rankId) {
          throw new DomainError('SUBSIDY_INVALID', '员工没有职级，不能计算补贴');
        }
        const rate = await tx.subsidyRate.findUnique({
          where: { tenantId_city_rankId: { tenantId: 'default', city: extras.subsidy.city, rankId: employee.rankId } },
        });
        if (!rate || !rate.enabled) {
          throw new DomainError('SUBSIDY_INVALID', '没有这张城市和职级的补贴标准');
        }
        subsidy = subsidyAmount(parseFen(rate.dailyFen.toString()), extras.subsidy.days);
      }
      const total = sumFen([invoiceTotal, subsidy]);
      assertReportMatchesLines(total, [...amounts, subsidy]);
      const mode = extras.approvalMode ?? 'single';
      const approvers = [...new Set(extras.approverIds ?? [])];
      if (mode === 'all' && approvers.length < 2) {
        throw new DomainError('APPROVAL_ACTORS_REQUIRED', '会签至少要有两名审批人');
      }
      if (mode === 'any' && approvers.length < 1) {
        throw new DomainError('APPROVAL_ACTORS_REQUIRED', '或签至少要有一名审批人');
      }
      if (extras.applicationId) {
        const application = await tx.application.findUnique({ where: { id: extras.applicationId } });
        if (!application || application.employeeId !== employeeId) {
          throw new DomainError('QUOTA_EXCEEDED', '只能占用自己已批准的申请');
        }
      }
      if (extras.budgetLineId) {
        const budget = await tx.budgetLine.findUnique({ where: { id: extras.budgetLineId } });
        if (!budget) {
          throw new DomainError('BUDGET_EXCEEDED', '预算行不存在');
        }
      }
      const reportId = uuidv7();
      await tx.expenseReport.create({
        data: {
          id: reportId,
          employeeId,
          status: 'draft',
          amountFen: total,
          currency,
          workflowId: expenseWorkflowId(reportId),
          approvalMode: mode,
          applicationId: extras.applicationId ?? null,
          budgetLineId: extras.budgetLineId ?? null,
          subsidyFen: subsidy,
        },
      });
      await tx.expenseLine.createMany({
        data: invoices.map((invoice, index) => ({
          id: uuidv7(),
          reportId,
          invoiceId: invoice.id,
          amountFen: amounts[index] ?? parseFen('0'),
        })),
      });
      if (mode !== 'single') {
        await tx.approvalAssignment.createMany({
          data: approvers.map((actorId) => ({ id: uuidv7(), reportId, actorId })),
        });
      }
      for (const item of extras.writeOffs ?? []) {
        await tx.loanWriteOff.create({
          data: { id: uuidv7(), loanId: item.loanId, reportId, amountFen: parseFen(item.amountFen), status: 'planned' },
        });
      }
      const weights = (extras.allocations ?? []).map((item) => parseFen(item.weight));
      if (weights.length > 0) {
        const shares = allocateByWeights(total, weights);
        await tx.allocationLine.createMany({
          data: (extras.allocations ?? []).map((item, index) => ({
            id: uuidv7(),
            reportId,
            departmentId: item.departmentId,
            projectId: item.projectId,
            costCenterId: item.costCenterId,
            amountFen: shares[index] ?? parseFen('0'),
          })),
        });
      }
      await tx.invoice.updateMany({
        where: { id: { in: ids } },
        data: { binding: 'active', expenseReportId: reportId },
      });
      await tx.documentAccess.create({
        data: { id: uuidv7(), actorId: employeeId, documentId: reportId, objectKey: reportId, action: 'read' },
      });
      await tx.idempotencyKey.create({
        data: { id: uuidv7(), operation: 'create_expense_report', key, documentId: reportId },
      });
      return loadReport(tx, reportId);
    });
  }

  private async submitOnce(
    tx: Prisma.TransactionClient,
    employeeId: string,
    reportId: string,
    key: string,
  ): Promise<ExpenseReportDetail> {
    const existing = await tx.idempotencyKey.findUnique({
      where: { tenantId_operation_key: { tenantId: 'default', operation: 'submit_expense_report', key } },
    });
    if (existing) {
      const previous = await loadReport(tx, existing.documentId);
      if (previous.employeeId !== employeeId) {
        throw new ExpenseReportError('ACTOR_FORBIDDEN', '这个 Idempotency-Key 已经属于另一名员工');
      }
      return previous;
    }
    await tx.$queryRaw`SELECT id FROM expense_reports WHERE id = ${reportId} FOR UPDATE`;
    const report = await tx.expenseReport.findUnique({
      where: { id: reportId },
      include: { employee: { include: { company: true } }, lines: { include: { invoice: true } } },
    });
    if (!report) {
      throw new ExpenseReportError('REPORT_NOT_FOUND', '报销单不存在');
    }
    const status = asReportStatus(report.status);
    if (progressed.submit?.includes(status)) {
      assertActor(report.employeeId, employeeId);
      return loadReport(tx, reportId);
    }
    assertActor(actorForAction(status, 'submit', { ownerId: report.employeeId, currentActorId: report.currentActorId }), employeeId);
    if (!report.employee.managerId) {
      throw new ExpenseReportError('MANAGER_NOT_ASSIGNED', '员工没有主管，不能提交');
    }
    const manager = await tx.employee.findUnique({ where: { id: report.employee.managerId } });
    if (!manager || manager.role !== 'manager') {
      throw new ExpenseReportError('MANAGER_NOT_ASSIGNED', '员工没有主管，不能提交');
    }
    await this.requireCompanyRole(tx, 'finance', report.employee.companyId);
    await this.requireCompanyRole(tx, 'cashier', report.employee.companyId);
    const lineAmounts = report.lines.map((line) => parseFen(line.amountFen.toString()));
    const subsidy = parseFen(report.subsidyFen.toString());
    assertReportMatchesLines(parseFen(report.amountFen.toString()), [...lineAmounts, subsidy]);
    const warnings = await enforceSubmitControls(tx, {
      reportId,
      employeeId,
      company: { name: report.employee.company.name, taxId: report.employee.company.taxId },
      amount: parseFen(report.amountFen.toString()),
      currency: report.currency,
      applicationId: report.applicationId,
      budgetLineId: report.budgetLineId,
      invoices: report.lines.map((line) => ({
        lineAmountFen: line.amountFen,
        amountFen: line.invoice.amountFen,
        buyerName: line.invoice.buyerName,
        buyerTaxId: line.invoice.buyerTaxId,
        invoiceDate: line.invoice.invoiceDate,
      })),
      today: todayInShanghai(),
    });
    if (warnings.length > 0) {
      await tx.controlWarning.createMany({
        data: warnings.map((warning) => ({
          id: uuidv7(),
          reportId,
          code: warning.code,
          message: warning.message,
        })),
      });
    }
    const invoiceIds = report.lines.map((line) => line.invoiceId).sort();
    await tx.$queryRaw`SELECT id FROM invoices WHERE id IN (${Prisma.join(invoiceIds)}) ORDER BY id FOR UPDATE`;
    await tx.invoice.updateMany({
      where: { id: { in: invoiceIds }, OR: [{ binding: 'released' }, { expenseReportId: reportId }] },
      data: { binding: 'active', expenseReportId: reportId },
    });
    const next = transitionExpenseReport(status, 'submit');
    const updated = await tx.expenseReport.updateMany({
      where: { id: reportId, version: report.version },
      data: {
        status: next,
        version: { increment: 1 },
        submittedAmountFen: report.amountFen,
        approvedAmountFen: report.amountFen,
        currentStep: 'manager',
        workflowId: expenseWorkflowId(reportId),
      },
    });
    if (updated.count !== 1) {
      throw new ExpenseReportError('VERSION_CONFLICT', '单据已被其他人更新');
    }
    await this.audit(tx, {
      documentId: reportId,
      action: 'submit',
      actorId: employeeId,
      fromStatus: status,
      toStatus: next,
      workflowId: expenseWorkflowId(reportId),
      beforeAmountFen: null,
      afterAmountFen: parseFen(report.amountFen.toString()),
    });
    await this.grant(tx, manager.id, reportId, 'read', reportId);
    await tx.idempotencyKey.create({
      data: { id: uuidv7(), operation: 'submit_expense_report', key, documentId: reportId },
    });
    return loadReport(tx, reportId);
  }

  private async applyOnce(
    tx: Prisma.TransactionClient,
    input: {
      reportId: string;
      action: ExpenseReportAction;
      actorId: string;
      workflowId: string | null;
      approvedAmountFen?: string;
      transferToEmployeeId?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<ExpenseReportDetail> {
    if (input.action === 'pay_success' || input.action === 'pay_fail') {
      const key = normalizeIdempotencyKey(input.idempotencyKey ?? undefined);
      const operation = input.action === 'pay_success' ? 'confirm_payment' : 'fail_payment';
      const existing = await tx.idempotencyKey.findUnique({
        where: { tenantId_operation_key: { tenantId: 'default', operation, key } },
      });
      if (existing) {
        if (existing.documentId !== input.reportId) {
          throw new ExpenseReportError('IDEMPOTENCY_PAYLOAD_MISMATCH', '这个支付编号已经用于另一张单据');
        }
        return loadReport(tx, existing.documentId);
      }
    }
    await tx.$queryRaw`SELECT id FROM expense_reports WHERE id = ${input.reportId} FOR UPDATE`;
    const report = await tx.expenseReport.findUnique({
      where: { id: input.reportId },
      include: { employee: true, votes: true, assignments: true },
    });
    if (!report) {
      throw new ExpenseReportError('REPORT_NOT_FOUND', '报销单不存在');
    }
    const status = asReportStatus(report.status);
    if (progressed[input.action]?.includes(status)) {
      return loadReport(tx, report.id);
    }
    let action: ExpenseReportAction = input.action;
    if ((input.action === 'approve' || input.action === 'reject') && report.approvalMode !== 'single') {
      const folded = await this.foldGroupVote(tx, report, input.action, input.actorId);
      if (!folded) {
        await this.audit(tx, {
          documentId: report.id,
          action: input.action,
          actorId: input.actorId,
          fromStatus: status,
          toStatus: status,
          workflowId: input.workflowId ?? report.workflowId,
          beforeAmountFen: null,
          afterAmountFen: null,
        });
        return loadReport(tx, report.id);
      }
      action = folded;
    } else if (this.isSharedDesk(status, input.action)) {
      if (report.currentActorId !== input.actorId) {
        await this.assertDeskColleague(tx, status === 'paying' ? 'cashier' : 'finance', report.employee.companyId, input.actorId);
      }
    } else {
      if (
        input.action === 'withdraw' &&
        (status === 'finance_review' ||
          status === 'paying' ||
          status === 'paid' ||
          report.votes.some((vote) => vote.decision === 'approved'))
      ) {
        throw new DomainError('WITHDRAW_TOO_LATE', '已有人通过，不能撤回');
      }
      const expected = actorForAction(status, input.action, {
        ownerId: report.employeeId,
        currentActorId: report.currentActorId,
      });
      await this.assertExpectedActor(tx, expected, input.actorId);
    }
    if (action === 'start_approval') {
      const desk = await deskForAmount(tx, parseFen(report.amountFen.toString()), report.currency);
      if (desk === 'finance') {
        action = 'skip_to_finance';
      }
    }
    let finance: { id: string }[] = [];
    let cashiers: { id: string }[] = [];
    if (action === 'approve' || action === 'finance_approve' || action === 'start_approval' || action === 'skip_to_finance') {
      finance = await this.requireCompanyRole(tx, 'finance', report.employee.companyId);
      cashiers = await this.requireCompanyRole(tx, 'cashier', report.employee.companyId);
    }
    if (action === 'start_approval' && report.approvalMode === 'single' && !report.employee.managerId) {
      throw new ExpenseReportError('MANAGER_NOT_ASSIGNED', '员工没有主管，不能提交');
    }
    let transferTo: string | null = null;
    if (action === 'transfer') {
      if (input.transferToEmployeeId === input.actorId) {
        throw new ExpenseReportError('TRANSFER_TARGET_INVALID', '不能转交给自己');
      }
      const target = await tx.employee.findUnique({ where: { id: input.transferToEmployeeId ?? '' } });
      const step = stepForStatus(status);
      if (!target || target.companyId !== report.employee.companyId) {
        throw new ExpenseReportError('TRANSFER_TARGET_INVALID', '转交对象必须是同一公司的员工');
      }
      if (target.id === report.employeeId) {
        throw new ExpenseReportError('TRANSFER_TARGET_INVALID', '不能转交给报销人本人');
      }
      if (!step) {
        throw new ExpenseReportError('INVALID_TRANSITION', '当前状态不能转交');
      }
      transferTo = target.id;
    }
    const next = transitionExpenseReport(status, action);
    const approved = report.approvedAmountFen === null ? null : parseFen(report.approvedAmountFen.toString());
    let nextApproved = approved;
    let nextAmount = parseFen(report.amountFen.toString());
    if (action === 'finance_adjust') {
      if (!approved) {
        throw new ExpenseReportError('AMOUNT_MISMATCH', '还没有可调整的批准金额');
      }
      nextApproved = applyFinanceAdjustment(status, approved, parseFen(input.approvedAmountFen ?? ''));
      nextAmount = nextApproved;
      await releaseExcessWriteOff(tx, report.id, nextApproved);
      await retargetReportBudget(tx, report.id, approved, nextApproved);
      if (report.applicationId) {
        await this.retargetApplication(tx, report.applicationId, approved, nextApproved);
      }
      await tx.amountAdjustment.create({
        data: {
          id: uuidv7(),
          reportId: report.id,
          actorId: input.actorId,
          beforeAmountFen: approved,
          afterAmountFen: nextApproved,
        },
      });
    }
    const managerId = report.employee.managerId ?? '';
    let nextActor = nextActorAfter(action, report.currentActorId, {
      managerId,
      financeId: finance[0]?.id ?? '',
      cashierId: cashiers[0]?.id ?? '',
      transferToEmployeeId: transferTo,
    });
    if (action === 'start_approval' && report.approvalMode !== 'single') {
      nextActor = report.assignments[0]?.actorId ?? nextActor;
    }
    if (action === 'pay_success') {
      if (!approved || nextAmount.toString() !== approved.toString()) {
        throw new ExpenseReportError('AMOUNT_MISMATCH', '付款金额必须等于批准金额');
      }
      await consumeReportBudget(tx, report.id);
    }
    const updated = await tx.expenseReport.updateMany({
      where: { id: report.id, version: report.version },
      data: {
        status: next,
        version: { increment: 1 },
        amountFen: nextAmount,
        approvedAmountFen: nextApproved,
        currentStep: stepForStatus(next),
        currentActorId: nextActor,
      },
    });
    if (updated.count !== 1) {
      throw new ExpenseReportError('VERSION_CONFLICT', '单据已被其他人更新');
    }
    await this.audit(tx, {
      documentId: report.id,
      action,
      actorId: input.actorId,
      fromStatus: status,
      toStatus: next,
      workflowId: input.workflowId ?? report.workflowId,
      beforeAmountFen: action === 'finance_adjust' ? approved : null,
      afterAmountFen: action === 'finance_adjust' ? nextApproved : null,
    });
    if (action === 'reject' || action === 'withdraw') {
      await tx.invoice.updateMany({
        where: { expenseReportId: report.id, binding: 'active' },
        data: { binding: 'released', expenseReportId: null },
      });
      await releaseReportControls(tx, report.id);
    }
    if (action === 'start_approval') {
      await this.openManagerStep(tx, report);
    }
    if ((action === 'skip_to_finance' || action === 'approve') && finance.length > 0) {
      await this.revokeDecide(tx, report.id);
      for (const person of finance) {
        await this.grant(tx, person.id, report.id, 'read', report.id);
        await this.grant(tx, person.id, report.id, 'decide', decideObjectKey(report.id, 'finance'));
      }
    }
    if (action === 'finance_approve' && cashiers.length > 0) {
      await this.revokeDecide(tx, report.id);
      for (const person of cashiers) {
        await this.grant(tx, person.id, report.id, 'read', report.id);
        await this.grant(tx, person.id, report.id, 'decide', decideObjectKey(report.id, 'cashier'));
      }
    }
    if (action === 'transfer' && nextActor) {
      const step = stepForStatus(status);
      if (!step) {
        throw new ExpenseReportError('INVALID_TRANSITION', '当前状态不能转交');
      }
      await this.revokeDecide(tx, report.id);
      await this.grant(tx, nextActor, report.id, 'read', report.id);
      await this.grant(tx, nextActor, report.id, 'decide', decideObjectKey(report.id, step));
    }
    if (action === 'pay_success' || action === 'pay_fail') {
      const key = normalizeIdempotencyKey(input.idempotencyKey ?? undefined);
      await tx.payment.create({
        data: {
          id: uuidv7(),
          reportId: report.id,
          amountFen: approved ?? nextAmount,
          status: action === 'pay_success' ? 'succeeded' : 'failed',
          idempotencyKey: key,
        },
      });
      await tx.idempotencyKey.create({
        data: {
          id: uuidv7(),
          operation: action === 'pay_success' ? 'confirm_payment' : 'fail_payment',
          key,
          documentId: report.id,
        },
      });
      if (action === 'pay_success') {
        await this.revokeDecide(tx, report.id);
      }
    }
    return loadReport(tx, report.id);
  }

  private async foldGroupVote(
    tx: Prisma.TransactionClient,
    report: { id: string; approvalMode: string; votes: { id: string; actorId: string; decision: string }[]; assignments: { actorId: string }[] },
    action: 'approve' | 'reject',
    actorId: string,
  ): Promise<'approve' | 'reject' | null> {
    const principals = report.assignments.map((item) => item.actorId);
    const today = todayInShanghai();
    const proxies = await tx.approvalProxy.findMany({ where: { enabled: true, principalId: { in: principals } } });
    const active = proxies
      .filter((proxy) => proxy.startsOn <= today && proxy.endsOn >= today)
      .map((proxy) => ({ principalId: proxy.principalId, agentId: proxy.agentId }));
    const mode = report.approvalMode === 'all' ? 'all' : 'any';
    const principalId = mayVote({ mode, actorId, principals, proxies: active });
    const vote = report.votes.find((item) => item.actorId === principalId);
    const decision = action === 'approve' ? 'approved' : 'rejected';
    if (vote?.decision === decision) {
      const decisions = report.votes.map((item) => item.decision) as VoteDecision[];
      const folded = foldVotes(mode, decisions);
      if (folded === 'pending') {
        return null;
      }
      return folded === 'approved' ? 'approve' : 'reject';
    }
    if (!vote || vote.decision !== 'pending') {
      throw new DomainError('ACTOR_FORBIDDEN', '当前员工不能执行这个动作');
    }
    await tx.approvalVote.update({ where: { id: vote.id }, data: { decision, decidedAt: new Date() } });
    const decisions = report.votes.map((item) => (item.actorId === principalId ? decision : item.decision)) as VoteDecision[];
    const folded = foldVotes(mode, decisions);
    if (folded === 'pending') {
      return null;
    }
    return folded === 'approved' ? 'approve' : 'reject';
  }

  private async assertExpectedActor(tx: Prisma.TransactionClient, expected: string, actorId: string): Promise<void> {
    if (expected === 'system') {
      assertActor(expected, actorId);
      return;
    }
    const today = todayInShanghai();
    const proxy = await tx.approvalProxy.findFirst({
      where: { principalId: expected, enabled: true, startsOn: { lte: today }, endsOn: { gte: today } },
    });
    assertDelegate(expected, actorId, proxy ? { agentId: proxy.agentId, active: true } : null);
  }

  private async openManagerStep(
    tx: Prisma.TransactionClient,
    report: { id: string; approvalMode: string; employee: { managerId: string | null }; assignments: { actorId: string }[] },
  ): Promise<void> {
    const today = todayInShanghai();
    if (report.approvalMode === 'single') {
      if (!report.employee.managerId) {
        throw new ExpenseReportError('MANAGER_NOT_ASSIGNED', '员工没有主管，不能提交');
      }
      await this.grant(tx, report.employee.managerId, report.id, 'decide', decideObjectKey(report.id, 'manager'));
      const proxy = await tx.approvalProxy.findFirst({
        where: { principalId: report.employee.managerId, enabled: true, startsOn: { lte: today }, endsOn: { gte: today } },
      });
      if (proxy) {
        await this.grant(tx, proxy.agentId, report.id, 'read', report.id);
        await this.grant(tx, proxy.agentId, report.id, 'decide', decideObjectKey(report.id, 'manager'));
      }
      return;
    }
    await tx.approvalVote.createMany({
      data: report.assignments.map((item) => ({
        id: uuidv7(),
        reportId: report.id,
        actorId: item.actorId,
        decision: 'pending',
      })),
    });
    for (const item of report.assignments) {
      await this.grant(tx, item.actorId, report.id, 'read', report.id);
      await this.grant(tx, item.actorId, report.id, 'decide', decideObjectKey(report.id, 'manager'));
      const proxies = await tx.approvalProxy.findMany({
        where: { principalId: item.actorId, enabled: true, startsOn: { lte: today }, endsOn: { gte: today } },
      });
      for (const proxy of proxies) {
        await this.grant(tx, proxy.agentId, report.id, 'read', report.id);
        await this.grant(tx, proxy.agentId, report.id, 'decide', decideObjectKey(report.id, 'manager'));
      }
    }
  }

  private isSharedDesk(status: string, action: ExpenseReportAction): boolean {
    if (status === 'finance_review' && (action === 'finance_approve' || action === 'finance_adjust' || action === 'reject' || action === 'transfer')) {
      return true;
    }
    return status === 'paying' && (action === 'pay_success' || action === 'pay_fail' || action === 'transfer');
  }

  private async assertDeskColleague(
    tx: Prisma.TransactionClient,
    role: 'finance' | 'cashier',
    companyId: string,
    actorId: string,
  ): Promise<void> {
    const actor = await tx.employee.findUnique({ where: { id: actorId } });
    if (actor && actor.role === role && actor.companyId === companyId) {
      return;
    }
    const today = todayInShanghai();
    const proxies = await tx.approvalProxy.findMany({
      where: { agentId: actorId, enabled: true, startsOn: { lte: today }, endsOn: { gte: today } },
      select: { principalId: true },
    });
    if (proxies.length > 0) {
      const principal = await tx.employee.findFirst({
        where: { id: { in: proxies.map((proxy) => proxy.principalId) }, role, companyId },
        select: { id: true },
      });
      if (principal) {
        return;
      }
    }
    throw new ExpenseReportError('ACTOR_FORBIDDEN', '当前员工不能执行这个动作');
  }

  private async requireCompanyRole(
    tx: Prisma.TransactionClient,
    role: 'finance' | 'cashier',
    companyId: string,
  ): Promise<{ id: string }[]> {
    const rows = await tx.employee.findMany({ where: { role, companyId }, select: { id: true } });
    assertSingleRoleAssignee(role, rows.length);
    return rows;
  }

  private async retargetApplication(tx: Prisma.TransactionClient, applicationId: string, from: Fen, to: Fen): Promise<void> {
    if (from === to) {
      return;
    }
    await tx.$queryRaw`SELECT id FROM applications WHERE id = ${applicationId} FOR UPDATE`;
    const application = await tx.application.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw new DomainError('QUOTA_EXCEEDED', '申请单不存在');
    }
    const released = releaseQuota(parseFen(application.consumedFen.toString()), from);
    const consumed = occupyQuota(parseFen(application.amountFen.toString()), released, to);
    await tx.application.update({
      where: { id: application.id },
      data: { consumedFen: consumed, version: { increment: 1 } },
    });
  }

  private async grant(
    tx: Prisma.TransactionClient,
    actorId: string,
    documentId: string,
    action: string,
    objectKey: string,
  ): Promise<void> {
    const existing = await tx.documentAccess.findFirst({
      where: { actorId, documentId, action, objectKey, revokedAt: null },
    });
    if (existing) {
      return;
    }
    await tx.documentAccess.create({
      data: { id: uuidv7(), actorId, documentId, action, objectKey },
    });
  }

  private async revokeDecide(tx: Prisma.TransactionClient, documentId: string): Promise<void> {
    await tx.documentAccess.updateMany({
      where: { documentId, action: 'decide', revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async audit(tx: Prisma.TransactionClient, draft: ReturnType<typeof buildAuditDraft>): Promise<void> {
    const event = buildAuditDraft(draft);
    await tx.auditEvent.create({
      data: {
        id: uuidv7(),
        documentId: event.documentId,
        action: event.action,
        actorId: event.actorId,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        workflowId: event.workflowId,
        beforeAmountFen: event.beforeAmountFen,
        afterAmountFen: event.afterAmountFen,
      },
    });
  }
}
