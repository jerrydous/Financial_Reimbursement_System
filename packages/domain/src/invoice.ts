import { ExpenseReportError } from './expense-report';
import { yuanTextToFen, type Fen } from './money';

export const recognitionStatuses = ['pending_confirmation', 'confirmed'] as const;
export type RecognitionStatus = (typeof recognitionStatuses)[number];

export const ledgerStatuses = ['open', 'exempt', 'removed', 'transferred'] as const;
export type LedgerStatus = (typeof ledgerStatuses)[number];

export const ledgerBuckets = ['unreimbursed', 'reimbursed', 'exempt', 'removed', 'transferred'] as const;
export type LedgerBucket = (typeof ledgerBuckets)[number];

export function ledgerBucket(input: { ledgerStatus: string; binding: string }): LedgerBucket {
  if (input.binding === 'active') {
    return 'reimbursed';
  }
  if (input.ledgerStatus === 'exempt' || input.ledgerStatus === 'removed' || input.ledgerStatus === 'transferred') {
    return input.ledgerStatus;
  }
  return 'unreimbursed';
}

export function assertLedgerOpen(ledgerStatus: string): void {
  if (ledgerStatus !== 'open') {
    throw new ExpenseReportError('LEDGER_LOCKED', '这张发票已经不在未报销里');
  }
}

export const invoiceVerificationStatuses = ['unverified', 'verified', 'failed'] as const;
export type InvoiceVerificationStatus = (typeof invoiceVerificationStatuses)[number];

export const invoiceVerificationStatus = 'unverified' as const;

export function assertVerificationStatus(status: string): InvoiceVerificationStatus {
  if (!(invoiceVerificationStatuses as readonly string[]).includes(status)) {
    throw new ExpenseReportError('VERIFICATION_NOT_ALLOWED', '发票验真状态不合法');
  }
  return status as InvoiceVerificationStatus;
}

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

export type VatInvoicePair = { name: string; value: string };

export type OcrDraft = {
  invoiceCode: string;
  invoiceNumber: string;
  amountFen: string | null;
  sellerName: string;
  invoiceDate: string;
};

const VAT_NAME: Record<string, keyof OcrDraft | 'amountWithTax'> = {
  发票代码: 'invoiceCode',
  发票号码: 'invoiceNumber',
  销售方名称: 'sellerName',
  开票日期: 'invoiceDate',
  '价税合计(小写)': 'amountWithTax',
  价税合计: 'amountWithTax',
  小写金额: 'amountWithTax',
};

/** 把第三方增值税发票识别结果整理成可人工确认的草稿。识别失败的金额留空，不自动入账。 */
export function draftFromVatPairs(pairs: readonly VatInvoicePair[]): OcrDraft {
  const picked: Partial<Record<keyof OcrDraft | 'amountWithTax', string>> = {};
  for (const pair of pairs) {
    const key = VAT_NAME[pair.name.trim()];
    const value = pair.value.trim();
    if (!key || !value || picked[key]) {
      continue;
    }
    picked[key] = value;
  }
  let amountFen: string | null = null;
  if (picked.amountWithTax) {
    try {
      amountFen = yuanTextToFen(normalizeYuan(picked.amountWithTax)).toString();
    } catch {
      amountFen = null;
    }
  }
  return {
    invoiceCode: picked.invoiceCode ?? '',
    invoiceNumber: picked.invoiceNumber ?? '',
    amountFen,
    sellerName: picked.sellerName ?? '',
    invoiceDate: normalizeInvoiceDate(picked.invoiceDate ?? ''),
  };
}

function normalizeYuan(input: string): string {
  const cleaned = input.replace(/[¥￥,\s]/g, '');
  if (/^\d+\.\d$/.test(cleaned)) {
    return `${cleaned}0`;
  }
  if (/^\d+$/.test(cleaned)) {
    return `${cleaned}.00`;
  }
  return cleaned;
}

function normalizeInvoiceDate(input: string): string {
  const matched = input.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!matched) {
    return input;
  }
  const month = matched[2]?.padStart(2, '0');
  const day = matched[3]?.padStart(2, '0');
  return `${matched[1]}-${month}-${day}`;
}

export function bindingAfterReportAction(action: 'submit' | 'reject' | 'withdraw' | 'revise'): 'active' | 'released' {
  if (action === 'reject' || action === 'withdraw') {
    return 'released';
  }
  return 'active';
}
