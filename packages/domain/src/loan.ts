import { DomainError } from './domain-error';
import { compareFen, parseFen, type Fen } from './money';

export const loanStatuses = ['draft', 'approving', 'outstanding', 'settled'] as const;
export type LoanStatus = (typeof loanStatuses)[number];

export const loanActions = ['submit', 'approve', 'reject', 'settle'] as const;
export type LoanAction = (typeof loanActions)[number];

type Transition = { from: LoanStatus; action: LoanAction; to: LoanStatus };

/** 借款主路径：草稿 → 审批 → 未还清 → 已结清。驳回退回草稿，不另设终态。 */
export const loanTransitions: readonly Transition[] = [
  { from: 'draft', action: 'submit', to: 'approving' },
  { from: 'approving', action: 'approve', to: 'outstanding' },
  { from: 'approving', action: 'reject', to: 'draft' },
  { from: 'outstanding', action: 'settle', to: 'settled' },
];

export function transitionLoan(from: LoanStatus, action: LoanAction): LoanStatus {
  const found = loanTransitions.find((item) => item.from === from && item.action === action);
  if (!found) {
    throw new DomainError('INVALID_TRANSITION', `借款单不能从 ${from} 执行 ${action}`);
  }
  return found.to;
}

export function assertWriteOffWithinReport(reportAmount: Fen, writeOffs: readonly Fen[]): void {
  let total = parseFen('0');
  for (const amount of writeOffs) {
    if (compareFen(amount, parseFen('0')) <= 0) {
      throw new DomainError('WRITE_OFF_EXCEEDS_BALANCE', '冲销金额必须大于 0');
    }
    total = (total + amount) as Fen;
  }
  if (compareFen(total, reportAmount) > 0) {
    throw new DomainError('WRITE_OFF_EXCEEDS_BALANCE', '冲销金额不能超过本次报销');
  }
}

export function writeOffLoan(balance: Fen, amount: Fen): Fen {
  if (compareFen(amount, parseFen('0')) <= 0) {
    throw new DomainError('WRITE_OFF_EXCEEDS_BALANCE', '冲销金额必须大于 0');
  }
  if (compareFen(balance, amount) < 0) {
    throw new DomainError('WRITE_OFF_EXCEEDS_BALANCE', '冲销不能超过借款余额');
  }
  return (balance - amount) as Fen;
}

export function assertNoOverdue(
  loans: readonly { status: LoanStatus; dueOn: string; balance: Fen }[],
  today: string,
): void {
  const overdue = loans.some(
    (loan) => loan.status === 'outstanding' && compareFen(loan.balance, parseFen('0')) > 0 && loan.dueOn < today,
  );
  if (overdue) {
    throw new DomainError('LOAN_OVERDUE', '有逾期未还的借款，不能提交报销');
  }
}

export function loanStatusAfterBalance(balance: Fen): 'outstanding' | 'settled' {
  return compareFen(balance, parseFen('0')) === 0 ? 'settled' : 'outstanding';
}
