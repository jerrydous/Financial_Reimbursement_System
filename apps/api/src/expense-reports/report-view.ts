import type { Prisma } from '@prisma/client';
import { currencyCodeSchema, expenseCategorySchema, expenseReportDetailSchema, type ExpenseReportDetail } from '@frs/contracts';
import {
  assertVerificationStatus,
  ExpenseReportError,
  expenseReportStatuses,
  type ExpenseReportStatus,
} from '@frs/domain';

export type ReportTx = Prisma.TransactionClient;

const reportInclude = {
  lines: { include: { invoice: true } },
  auditEvents: { orderBy: { createdAt: 'asc' as const } },
  warnings: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ExpenseReportInclude;

export async function loadReport(tx: ReportTx, reportId: string): Promise<ExpenseReportDetail> {
  const report = await tx.expenseReport.findUnique({
    where: { id: reportId },
    include: reportInclude,
  });
  if (!report) {
    throw new ExpenseReportError('REPORT_NOT_FOUND', '报销单不存在');
  }
  const actorIds = [...new Set(report.auditEvents.map((event) => event.actorId))].filter((actorId) => actorId !== 'system');
  const actors = actorIds.length
    ? await tx.employee.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.name]));
  return expenseReportDetailSchema.parse({
    id: report.id,
    employeeId: report.employeeId,
    status: report.status,
    amountFen: report.amountFen.toString(),
    submittedAmountFen: report.submittedAmountFen?.toString() ?? null,
    approvedAmountFen: report.approvedAmountFen?.toString() ?? null,
    currency: report.currency,
    version: report.version,
    currentStep: report.currentStep,
    currentActorId: report.currentActorId,
    approvalMode: report.approvalMode,
    subsidyFen: report.subsidyFen.toString(),
    createdAt: report.createdAt.toISOString(),
    invoices: report.lines.map((line) => {
      const verificationStatus = assertVerificationStatus(line.invoice.verificationStatus);
      return {
        id: line.invoice.id,
        invoiceCode: line.invoice.invoiceCode,
        invoiceNumber: line.invoice.invoiceNumber,
        amountFen: line.invoice.amountFen?.toString() ?? null,
        currency: currencyCodeSchema.parse(line.invoice.currency),
        category: expenseCategorySchema.safeParse(line.invoice.category).data ?? null,
        merchant: line.invoice.merchant?.trim() ? line.invoice.merchant.trim() : null,
        sellerName: line.invoice.sellerName,
        invoiceDate: line.invoice.invoiceDate,
        ledgerStatus: line.invoice.ledgerStatus,
        ocrStatus: line.invoice.ocrStatus,
        ocrMessage: line.invoice.ocrMessage,
        recognitionStatus: line.invoice.recognitionStatus,
        verificationStatus,
        buyerName: line.invoice.buyerName,
        buyerTaxId: line.invoice.buyerTaxId,
        invoiceType: line.invoice.invoiceType,
        binding: line.invoice.binding,
      };
    }),
    audits: report.auditEvents.map((event) => ({
      action: event.action,
      actorId: event.actorId,
      actorName: event.actorId === 'system' ? '系统' : (actorNames.get(event.actorId) ?? '未知'),
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      beforeAmountFen: event.beforeAmountFen?.toString() ?? null,
      afterAmountFen: event.afterAmountFen?.toString() ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
    warnings: report.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
  });
}

export function asReportStatus(status: string): ExpenseReportStatus {
  if (!(expenseReportStatuses as readonly string[]).includes(status)) {
    throw new ExpenseReportError('INVALID_TRANSITION', '单据状态不合法');
  }
  return status as ExpenseReportStatus;
}
