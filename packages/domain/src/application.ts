import { DomainError } from './domain-error';
import { compareFen, parseFen, type Fen } from './money';

export const applicationStatuses = [
  'draft',
  'submitted',
  'approving',
  'approved',
  'rejected',
  'withdrawn',
  'closed',
] as const;

export type ApplicationStatus = (typeof applicationStatuses)[number];

export const applicationActions = ['submit', 'start_approval', 'approve', 'reject', 'withdraw', 'revise', 'close'] as const;

export type ApplicationAction = (typeof applicationActions)[number];

type Transition = { from: ApplicationStatus; action: ApplicationAction; to: ApplicationStatus };

/** 事前申请：提交后占用额度，报销不得超过剩余额度。关闭只在批准之后。 */
export const applicationTransitions: readonly Transition[] = [
  { from: 'draft', action: 'submit', to: 'submitted' },
  { from: 'submitted', action: 'start_approval', to: 'approving' },
  { from: 'submitted', action: 'withdraw', to: 'withdrawn' },
  { from: 'approving', action: 'approve', to: 'approved' },
  { from: 'approving', action: 'reject', to: 'rejected' },
  { from: 'approving', action: 'withdraw', to: 'withdrawn' },
  { from: 'rejected', action: 'revise', to: 'draft' },
  { from: 'withdrawn', action: 'revise', to: 'draft' },
  { from: 'approved', action: 'close', to: 'closed' },
];

export function transitionApplication(from: ApplicationStatus, action: ApplicationAction): ApplicationStatus {
  const found = applicationTransitions.find((item) => item.from === from && item.action === action);
  if (!found) {
    throw new DomainError('INVALID_TRANSITION', `申请单不能从 ${from} 执行 ${action}`);
  }
  return found.to;
}

export function remainingQuota(limit: Fen, consumed: Fen): Fen {
  if (compareFen(consumed, parseFen('0')) < 0 || compareFen(limit, consumed) < 0) {
    throw new DomainError('QUOTA_EXCEEDED', '申请已占用超过额度');
  }
  return (limit - consumed) as Fen;
}

/** 占用后的已用额度。超过剩余额度时拒绝，调用方应回滚事务。 */
export function occupyQuota(limit: Fen, consumed: Fen, amount: Fen): Fen {
  if (compareFen(amount, parseFen('0')) <= 0) {
    throw new DomainError('QUOTA_EXCEEDED', '占用额度必须大于 0');
  }
  const next = (consumed + amount) as Fen;
  if (compareFen(next, limit) > 0) {
    throw new DomainError('QUOTA_EXCEEDED', '报销金额超过申请剩余额度');
  }
  return next;
}

export function releaseQuota(consumed: Fen, amount: Fen): Fen {
  if (compareFen(amount, parseFen('0')) < 0 || compareFen(consumed, amount) < 0) {
    throw new DomainError('QUOTA_EXCEEDED', '释放额度超过已占用');
  }
  return (consumed - amount) as Fen;
}
