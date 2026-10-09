import type { Prisma } from '@prisma/client';
import { expenseReportDetailSchema, type ExpenseReportDetail } from '@frs/contracts';
import {
  assertVerificationUnverified,
  ExpenseReportError,
  expenseReportStatuses,
  type ExpenseReportStatus,
} from '@frs/domain';

export type ReportTx = Prisma.TransactionClient;

const reportInclude = {
  lines: { include: { invoice: true } },
  auditEvents: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ExpenseReportInclude;

export async function loadReport(tx: ReportTx, reportId: string): Promise<ExpenseReportDetail> {
  const report = await tx.expenseReport.findUnique({
    where: { id: reportId },
    include: reportInclude,
  });
  if (!report) {
    throw new ExpenseReportError('REPORT_NOT_FOUND', '报销单不存在');
  }
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
    createdAt: report.createdAt.toISOString(),
    invoices: report.lines.map((line) => {
      assertVerificationUnverified(line.invoice.verificationStatus);
      return {
        id: line.invoice.id,
        invoiceCode: line.invoice.invoiceCode,
        invoiceNumber: line.invoice.invoiceNumber,
        amountFen: line.invoice.amountFen?.toString() ?? null,
        recognitionStatus: line.invoice.recognitionStatus,
        verificationStatus: line.invoice.verificationStatus,
        binding: line.invoice.binding,
      };
    }),
    audits: report.auditEvents.map((event) => ({
      action: event.action,
      actorId: event.actorId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}

export function asReportStatus(status: string): ExpenseReportStatus {
  if (!(expenseReportStatuses as readonly string[]).includes(status)) {
    throw new ExpenseReportError('INVALID_TRANSITION', '单据状态不合法');
  }
  return status as ExpenseReportStatus;
}
