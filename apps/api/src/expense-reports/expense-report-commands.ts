import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import type { ExpenseDecisionSignal } from '@frs/adapters';
import { enforceDocumentPolicy } from '@frs/adapters';
import type { ExpenseReportDetail } from '@frs/contracts';
import {
  ExpenseReportError,
  actorForAction,
  applyFinanceAdjustment,
  assertActor,
  assertReadyToAttach,
  assertReportMatchesLines,
  assertSingleRoleAssignee,
  assertVerificationUnverified,
  buildAuditDraft,
  decideObjectKey,
  expenseWorkflowId,
  nextActorAfter,
  normalizeIdempotencyKey,
  parseFen,
  stepForStatus,
  sumFen,
  transitionExpenseReport,
  type ExpenseReportAction,
  type ExpenseReportStatus,
  type Fen,
  type RecognitionStatus,
} from '@frs/domain';
import { logger } from '../logging';
import { PrismaService } from '../prisma.service';
import { isUniqueViolation } from './http-error';
import { asReportStatus, loadReport } from './report-view';

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

  async createDraft(employeeId: string, invoiceIds: readonly string[], idempotencyKey: string | undefined): Promise<ExpenseReportDetail> {
    const key = normalizeIdempotencyKey(idempotencyKey);
    try {
      return await this.createDraftOnce(employeeId, invoiceIds, key);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const target = JSON.stringify(error.meta ?? {});
      if (target.includes('idempotency')) {
        return this.createDraftOnce(employeeId, invoiceIds, key);
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
    try {
      await this.workflows.signalDecision(reportId, { action: 'withdraw', actorId: employeeId });
    } catch (error) {
      logger.error({
        documentId: reportId,
        actorId: employeeId,
        workflowId: detail.id,
        message: error instanceof Error ? error.message : 'withdraw signal failed',
      });
    }
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
    const report = await this.prisma.expenseReport.findUnique({ where: { id: reportId } });
    if (!report) {
      throw new ExpenseReportError('REPORT_NOT_FOUND', '报销单不存在');
    }
    const status = asReportStatus(report.status);
    const step = stepForStatus(status);
    if (!step || !report.currentActorId) {
      throw new ExpenseReportError('ACTOR_UNASSIGNED', '当前步骤没有操作者');
    }
    const policies = await this.prisma.documentAccess.findMany({
      where: { documentId: reportId, revokedAt: null },
    });
    const allowed = await enforceDocumentPolicy(
      employeeId,
      decideObjectKey(reportId, step),
      'decide',
      policies.map((policy) => ({ actorId: policy.actorId, objectKey: policy.objectKey, action: policy.action })),
    );
    if (!allowed) {
      throw new ExpenseReportError('ACTOR_FORBIDDEN', '当前员工不能执行这个动作');
    }
    if (action === 'pay_success' || action === 'pay_fail') {
      normalizeIdempotencyKey(extra.idempotencyKey);
    }
    try {
      await this.workflows.signalDecision(reportId, {
        action,
        actorId: employeeId,
        transferToEmployeeId: extra.transferToEmployeeId ?? null,
        idempotencyKey: extra.idempotencyKey ?? null,
      });
    } catch (error) {
      logger.error({
        documentId: reportId,
        actorId: employeeId,
        workflowId: report.workflowId,
        message: error instanceof Error ? error.message : 'workflow signal failed',
      });
      throw new ExpenseReportError('WORKFLOW_UNAVAILABLE', '审批流程暂时不能接收这个动作');
    }
    return { accepted: true };
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
    const policies = await this.prisma.documentAccess.findMany({
      where: { documentId: reportId, revokedAt: null, action: 'read' },
    });
    const allowed = await enforceDocumentPolicy(
      actorId,
      reportId,
      'read',
      policies.map((policy) => ({ actorId: policy.actorId, objectKey: policy.objectKey, action: policy.action })),
    );
    if (!allowed) {
      throw new ExpenseReportError('ACTOR_FORBIDDEN', '不能查看这张报销单');
    }
    return this.prisma.$transaction((tx) => loadReport(tx, reportId));
  }

  private async createDraftOnce(
    employeeId: string,
    invoiceIds: readonly string[],
    key: string,
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
        assertVerificationUnverified(invoice.verificationStatus);
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
      const total = sumFen(amounts);
      assertReportMatchesLines(total, amounts);
      const reportId = uuidv7();
      await tx.expenseReport.create({
        data: {
          id: reportId,
          employeeId,
          status: 'draft',
          amountFen: total,
          currency: 'CNY',
          workflowId: expenseWorkflowId(reportId),
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
      include: { employee: true, lines: { include: { invoice: true } } },
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
    const finance = await tx.employee.findMany({ where: { role: 'finance' } });
    const cashiers = await tx.employee.findMany({ where: { role: 'cashier' } });
    assertSingleRoleAssignee('finance', finance.length);
    assertSingleRoleAssignee('cashier', cashiers.length);
    const lineAmounts = report.lines.map((line) => parseFen(line.amountFen.toString()));
    assertReportMatchesLines(parseFen(report.amountFen.toString()), lineAmounts);
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
        return loadReport(tx, existing.documentId);
      }
    }
    await tx.$queryRaw`SELECT id FROM expense_reports WHERE id = ${input.reportId} FOR UPDATE`;
    const report = await tx.expenseReport.findUnique({
      where: { id: input.reportId },
      include: { employee: true },
    });
    if (!report) {
      throw new ExpenseReportError('REPORT_NOT_FOUND', '报销单不存在');
    }
    const status = asReportStatus(report.status);
    if (progressed[input.action]?.includes(status)) {
      return loadReport(tx, report.id);
    }
    const expected = actorForAction(status, input.action, {
      ownerId: report.employeeId,
      currentActorId: report.currentActorId,
    });
    assertActor(expected, input.actorId);
    const finance = await tx.employee.findMany({ where: { role: 'finance' } });
    const cashiers = await tx.employee.findMany({ where: { role: 'cashier' } });
    if (input.action === 'approve' || input.action === 'finance_approve' || input.action === 'start_approval') {
      assertSingleRoleAssignee('finance', finance.length);
      assertSingleRoleAssignee('cashier', cashiers.length);
    }
    if (input.action === 'start_approval' && !report.employee.managerId) {
      throw new ExpenseReportError('MANAGER_NOT_ASSIGNED', '员工没有主管，不能提交');
    }
    let transferTo: string | null = null;
    if (input.action === 'transfer') {
      const target = await tx.employee.findUnique({ where: { id: input.transferToEmployeeId ?? '' } });
      if (!target) {
        throw new ExpenseReportError('TRANSFER_TARGET_INVALID', '转交对象必须是另一名员工');
      }
      transferTo = target.id;
    }
    const next = transitionExpenseReport(status, input.action);
    const approved = report.approvedAmountFen === null ? null : parseFen(report.approvedAmountFen.toString());
    let nextApproved = approved;
    let nextAmount = parseFen(report.amountFen.toString());
    if (input.action === 'finance_adjust') {
      if (!approved) {
        throw new ExpenseReportError('AMOUNT_MISMATCH', '还没有可调整的批准金额');
      }
      nextApproved = applyFinanceAdjustment(status, approved, parseFen(input.approvedAmountFen ?? ''));
      nextAmount = nextApproved;
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
    const nextActor = nextActorAfter(input.action, report.currentActorId, {
      managerId,
      financeId: finance[0]?.id ?? '',
      cashierId: cashiers[0]?.id ?? '',
      transferToEmployeeId: transferTo,
    });
    if (input.action === 'pay_success') {
      if (!approved || nextAmount.toString() !== approved.toString()) {
        throw new ExpenseReportError('AMOUNT_MISMATCH', '付款金额必须等于批准金额');
      }
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
      action: input.action,
      actorId: input.actorId,
      fromStatus: status,
      toStatus: next,
      workflowId: input.workflowId ?? report.workflowId,
      beforeAmountFen: input.action === 'finance_adjust' ? approved : null,
      afterAmountFen: input.action === 'finance_adjust' ? nextApproved : null,
    });
    if (input.action === 'reject' || input.action === 'withdraw') {
      await tx.invoice.updateMany({
        where: { expenseReportId: report.id, binding: 'active' },
        data: { binding: 'released', expenseReportId: null },
      });
    }
    if (input.action === 'start_approval' && report.employee.managerId) {
      await this.grant(tx, report.employee.managerId, report.id, 'decide', decideObjectKey(report.id, 'manager'));
    }
    if (input.action === 'approve' && finance[0]) {
      await this.revokeDecide(tx, report.id);
      await this.grant(tx, finance[0].id, report.id, 'read', report.id);
      await this.grant(tx, finance[0].id, report.id, 'decide', decideObjectKey(report.id, 'finance'));
    }
    if (input.action === 'finance_approve' && cashiers[0]) {
      await this.revokeDecide(tx, report.id);
      await this.grant(tx, cashiers[0].id, report.id, 'read', report.id);
      await this.grant(tx, cashiers[0].id, report.id, 'decide', decideObjectKey(report.id, 'cashier'));
    }
    if (input.action === 'transfer' && nextActor) {
      const step = stepForStatus(status);
      if (!step) {
        throw new ExpenseReportError('INVALID_TRANSITION', '当前状态不能转交');
      }
      await this.revokeDecide(tx, report.id);
      await this.grant(tx, nextActor, report.id, 'read', report.id);
      await this.grant(tx, nextActor, report.id, 'decide', decideObjectKey(report.id, step));
    }
    if (input.action === 'pay_success' || input.action === 'pay_fail') {
      const key = normalizeIdempotencyKey(input.idempotencyKey ?? undefined);
      await tx.payment.create({
        data: {
          id: uuidv7(),
          reportId: report.id,
          amountFen: approved ?? nextAmount,
          status: input.action === 'pay_success' ? 'succeeded' : 'failed',
          idempotencyKey: key,
        },
      });
      await tx.idempotencyKey.create({
        data: {
          id: uuidv7(),
          operation: input.action === 'pay_success' ? 'confirm_payment' : 'fail_payment',
          key,
          documentId: report.id,
        },
      });
      if (input.action === 'pay_success') {
        await this.revokeDecide(tx, report.id);
      }
    }
    return loadReport(tx, report.id);
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
