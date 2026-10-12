import { DomainError } from './domain-error';
import { compareFen, type Fen } from './money';

export type FindingLevel = 'pass' | 'warn' | 'block';

export type Finding = {
  level: FindingLevel;
  code: string;
  message: string;
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function resolveFindings(findings: readonly Finding[]): { blocked: boolean; warnings: Finding[] } {
  const warnings = findings.filter((item) => item.level === 'warn');
  return { blocked: findings.some((item) => item.level === 'block'), warnings };
}

export function assertFindingsAllowSubmit(findings: readonly Finding[]): Finding[] {
  const result = resolveFindings(findings);
  if (result.blocked) {
    const first = findings.find((item) => item.level === 'block');
    throw new DomainError('STANDARD_BLOCKED', first?.message ?? '强控规则阻断了提交');
  }
  return result.warnings;
}

/** 抬头或税号为空时不比对。两边都有值且不一致则阻断。 */
export function matchBuyer(
  company: { name: string; taxId: string },
  invoice: { buyerName: string; buyerTaxId: string },
): Finding | null {
  const buyerName = invoice.buyerName.trim();
  const buyerTaxId = invoice.buyerTaxId.trim();
  if (!buyerName && !buyerTaxId) {
    return null;
  }
  const nameOk = !buyerName || buyerName === company.name.trim();
  const taxOk = !buyerTaxId || buyerTaxId === company.taxId.trim();
  if (nameOk && taxOk) {
    return { level: 'pass', code: 'BUYER_MATCH', message: '抬头和税号一致' };
  }
  return { level: 'block', code: 'BUYER_MISMATCH', message: '发票抬头或税号与公司不一致' };
}

export function matchInvoiceAmount(expense: Fen, invoice: Fen): Finding {
  if (compareFen(expense, invoice) === 0) {
    return { level: 'pass', code: 'AMOUNT_MATCH', message: '发票价税合计与费用一致' };
  }
  return { level: 'block', code: 'AMOUNT_MISMATCH', message: '发票价税合计与费用不一致' };
}

export function invoiceAgeDays(invoiceDate: string, today: string): number {
  const from = parseDate(invoiceDate);
  const to = parseDate(today);
  if (!from || !to) {
    return -1;
  }
  const milliseconds = Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day);
  return Math.floor(milliseconds / 86_400_000);
}

export function crossesYear(invoiceDate: string, today: string): boolean {
  const from = parseDate(invoiceDate);
  const to = parseDate(today);
  if (!from || !to) {
    return false;
  }
  return from.year !== to.year;
}

function parseDate(value: string): { year: number; month: number; day: number } | null {
  const matched = DATE.exec(value);
  if (!matched) {
    return null;
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { year, month, day };
}
