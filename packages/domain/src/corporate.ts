import { DomainError } from './domain-error';
import { compareFen, parseFen, type Fen } from './money';

export const contractStatuses = ['draft', 'active', 'closed'] as const;
export type ContractStatus = (typeof contractStatuses)[number];

export const installmentStatuses = ['pending', 'partial', 'paid'] as const;
export type InstallmentStatus = (typeof installmentStatuses)[number];

export function transitionContract(from: ContractStatus, action: 'activate' | 'close'): ContractStatus {
  if (from === 'draft' && action === 'activate') {
    return 'active';
  }
  if (from === 'active' && action === 'close') {
    return 'closed';
  }
  throw new DomainError('INVALID_TRANSITION', `合同不能从 ${from} 执行 ${action}`);
}

export function applyInstallmentPayment(
  due: Fen,
  paid: Fen,
  payment: Fen,
): { paid: Fen; status: InstallmentStatus } {
  if (compareFen(payment, parseFen('0')) <= 0) {
    throw new DomainError('INSTALLMENT_EXCEEDED', '分期付款必须大于 0');
  }
  if (compareFen(paid, due) > 0 || compareFen(paid, parseFen('0')) < 0) {
    throw new DomainError('INSTALLMENT_EXCEEDED', '分期已付金额不合法');
  }
  const next = (paid + payment) as Fen;
  if (compareFen(next, due) > 0) {
    throw new DomainError('INSTALLMENT_EXCEEDED', '分期付款不能超过本期应付');
  }
  const status: InstallmentStatus = compareFen(next, due) === 0 ? 'paid' : compareFen(next, parseFen('0')) === 0 ? 'pending' : 'partial';
  return { paid: next, status };
}

export function contractCanClose(installments: readonly { status: InstallmentStatus }[]): boolean {
  return installments.length > 0 && installments.every((item) => item.status === 'paid');
}
