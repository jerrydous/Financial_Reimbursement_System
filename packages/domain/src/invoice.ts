import type { Fen } from './money';
import { ExpenseReportError } from './expense-report';

export const recognitionStatuses = ['pending_confirmation', 'confirmed'] as const;
export type RecognitionStatus = (typeof recognitionStatuses)[number];

export const invoiceVerificationStatus = 'unverified' as const;

export function assertVerificationUnverified(status: string): void {
  if (status !== invoiceVerificationStatus) {
    throw new ExpenseReportError('VERIFICATION_NOT_ALLOWED', '未接通查验时，发票只能是未验真');
  }
}

/** 人工确认之前不得入账。有没有识别结果都一样，不能自动过账。 */
export function assertReadyToAttach(status: RecognitionStatus, amount: Fen | null): Fen {
  if (status !== 'confirmed' || amount === null) {
    throw new ExpenseReportError('INVOICE_NOT_CONFIRMED', '发票还没经人工确认');
  }
  return amount;
}

export function confirmRecognition(status: RecognitionStatus): RecognitionStatus {
  if (status === 'confirmed') {
    return 'confirmed';
  }
  return 'confirmed';
}

export type InvoiceIdentity = {
  tenantId: string;
  invoiceCode: string;
  invoiceNumber: string;
  fileSha256: string;
};

export function sameActiveInvoiceNumber(left: InvoiceIdentity, right: InvoiceIdentity): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.invoiceCode === right.invoiceCode &&
    left.invoiceNumber === right.invoiceNumber &&
    left.invoiceNumber !== ''
  );
}

export function bindingAfterReportAction(action: 'submit' | 'reject' | 'withdraw' | 'revise'): 'active' | 'released' {
  if (action === 'reject' || action === 'withdraw') {
    return 'released';
  }
  return 'active';
}
