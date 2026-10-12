import { DomainError } from './domain-error';
import { compareFen, parseFen, type Fen } from './money';

export type BudgetSnapshot = {
  amount: Fen;
  reserved: Fen;
  consumed: Fen;
};

export const budgetHoldStatuses = ['reserved', 'consumed', 'released'] as const;
export type BudgetHoldStatus = (typeof budgetHoldStatuses)[number];

function assertHold(hold: Fen): void {
  if (compareFen(hold, parseFen('0')) <= 0) {
    throw new DomainError('BUDGET_EXCEEDED', '预算占用必须大于 0');
  }
}

function assertNonNegative(snapshot: BudgetSnapshot): void {
  if (
    compareFen(snapshot.reserved, parseFen('0')) < 0 ||
    compareFen(snapshot.consumed, parseFen('0')) < 0 ||
    compareFen(snapshot.amount, parseFen('0')) < 0
  ) {
    throw new DomainError('BUDGET_EXCEEDED', '预算不能为负');
  }
  if (compareFen((snapshot.reserved + snapshot.consumed) as Fen, snapshot.amount) > 0) {
    throw new DomainError('BUDGET_EXCEEDED', '预算占用超过可用金额');
  }
}

export function reserveBudget(snapshot: BudgetSnapshot, hold: Fen): BudgetSnapshot {
  assertHold(hold);
  assertNonNegative(snapshot);
  const next: BudgetSnapshot = {
    amount: snapshot.amount,
    reserved: (snapshot.reserved + hold) as Fen,
    consumed: snapshot.consumed,
  };
  assertNonNegative(next);
  return next;
}

export function releaseBudget(snapshot: BudgetSnapshot, hold: Fen): BudgetSnapshot {
  assertHold(hold);
  if (compareFen(snapshot.reserved, hold) < 0) {
    throw new DomainError('BUDGET_EXCEEDED', '释放金额超过已冻结');
  }
  return {
    amount: snapshot.amount,
    reserved: (snapshot.reserved - hold) as Fen,
    consumed: snapshot.consumed,
  };
}

/** 支付成功时把冻结转为消耗，不重复占用可用余额。 */
export function consumeBudget(snapshot: BudgetSnapshot, hold: Fen): BudgetSnapshot {
  assertHold(hold);
  if (compareFen(snapshot.reserved, hold) < 0) {
    throw new DomainError('BUDGET_EXCEEDED', '消耗金额超过已冻结');
  }
  const next: BudgetSnapshot = {
    amount: snapshot.amount,
    reserved: (snapshot.reserved - hold) as Fen,
    consumed: (snapshot.consumed + hold) as Fen,
  };
  assertNonNegative(next);
  return next;
}

export function retargetReservation(snapshot: BudgetSnapshot, from: Fen, to: Fen): BudgetSnapshot {
  return reserveBudget(releaseBudget(snapshot, from), to);
}
