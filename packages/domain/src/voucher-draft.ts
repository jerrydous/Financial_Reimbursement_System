import { DomainError } from './domain-error';
import { minorToAmountText, parseFen, type Fen } from './money';

export type VoucherLine = {
  explanation: string;
  debitYuan: string;
  creditYuan: string;
};

export type VoucherDraft = {
  formId: 'GL_VOUCHER';
  reportId: string;
  date: string;
  lines: VoucherLine[];
};

/** 付款凭证只在已支付单据上生成。借贷金额用元的十进制文本，不经过 number。 */
export function voucherFromPaidReport(input: {
  reportId: string;
  status: string;
  paidOn: string;
  amount: Fen;
  currency?: string;
  explanation: string;
}): VoucherDraft {
  if (input.status !== 'paid') {
    throw new DomainError('VOUCHER_NOT_READY', '只有已支付单据可以导出凭证');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) {
    throw new DomainError('REQUEST_INVALID', '凭证日期不合法');
  }
  const yuan = minorToAmountText(input.amount, input.currency ?? 'CNY');
  parseFen(input.amount.toString());
  return {
    formId: 'GL_VOUCHER',
    reportId: input.reportId,
    date: input.paidOn,
    lines: [
      { explanation: input.explanation, debitYuan: yuan, creditYuan: '0.00' },
      { explanation: input.explanation, debitYuan: '0.00', creditYuan: yuan },
    ],
  };
}
