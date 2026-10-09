import { compareFen, parseFen, type Fen } from './money';

export class ExpenseReportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExpenseReportError';
    this.code = code;
  }
}

export const expenseReportStatuses = [
  'draft',
  'submitted',
  'approving',
  'finance_review',
  'paying',
  'paid',
  'rejected',
  'withdrawn',
] as const;

export type ExpenseReportStatus = (typeof expenseReportStatuses)[number];

export const expenseReportActions = [
  'submit',
  'start_approval',
  'approve',
  'reject',
  'withdraw',
  'transfer',
  'finance_adjust',
  'finance_approve',
  'pay_success',
  'pay_fail',
  'revise',
] as const;

export type ExpenseReportAction = (typeof expenseReportActions)[number];

export type ExpenseReportStep = 'manager' | 'finance' | 'cashier';

type Transition = {
  from: ExpenseReportStatus;
  action: ExpenseReportAction;
  to: ExpenseReportStatus;
};

/**
 * 报销单状态只从这张表迁移。
 * 单线是：主管审批 → 财务审核 → 出纳支付。
 * 转交不新增层级，只替换当前步骤的操作者。规格只写了「转交」这个动作，没有写挑选规则，这里按该假设执行。
 */
export const expenseReportTransitions: readonly Transition[] = [
  { from: 'draft', action: 'submit', to: 'submitted' },
  { from: 'submitted', action: 'start_approval', to: 'approving' },
  { from: 'submitted', action: 'withdraw', to: 'withdrawn' },
  { from: 'approving', action: 'approve', to: 'finance_review' },
  { from: 'approving', action: 'reject', to: 'rejected' },
  { from: 'approving', action: 'withdraw', to: 'withdrawn' },
  { from: 'approving', action: 'transfer', to: 'approving' },
  { from: 'finance_review', action: 'finance_adjust', to: 'finance_review' },
  { from: 'finance_review', action: 'finance_approve', to: 'paying' },
  { from: 'finance_review', action: 'reject', to: 'rejected' },
  { from: 'finance_review', action: 'transfer', to: 'finance_review' },
  { from: 'paying', action: 'pay_success', to: 'paid' },
  { from: 'paying', action: 'pay_fail', to: 'paying' },
  { from: 'paying', action: 'transfer', to: 'paying' },
  { from: 'rejected', action: 'revise', to: 'draft' },
  { from: 'withdrawn', action: 'revise', to: 'draft' },
];

const terminalStatuses = new Set<ExpenseReportStatus>(['paid', 'rejected', 'withdrawn']);

export function transitionExpenseReport(
  from: ExpenseReportStatus,
  action: ExpenseReportAction,
): ExpenseReportStatus {
  const found = expenseReportTransitions.find((item) => item.from === from && item.action === action);
  if (!found) {
    throw new ExpenseReportError('INVALID_TRANSITION', `不能从 ${from} 执行 ${action}`);
  }
  return found.to;
}

export function stepForStatus(status: ExpenseReportStatus): ExpenseReportStep | null {
  if (status === 'submitted' || status === 'approving') {
    return 'manager';
  }
  if (status === 'finance_review') {
    return 'finance';
  }
  if (status === 'paying') {
    return 'cashier';
  }
  return null;
}

export function expenseWorkflowId(reportId: string): string {
  return `expense-approval-${reportId}`;
}

export function isTerminalStatus(status: ExpenseReportStatus): boolean {
  return terminalStatuses.has(status);
}

export type ReportAssignment = {
  ownerId: string;
  currentActorId: string | null;
};

export function actorForAction(
  status: ExpenseReportStatus,
  action: ExpenseReportAction,
  assignment: ReportAssignment,
): string {
  if (action === 'submit' || action === 'revise' || action === 'withdraw') {
    return assignment.ownerId;
  }
  if (action === 'start_approval') {
    return 'system';
  }
  if (!assignment.currentActorId) {
    throw new ExpenseReportError('ACTOR_UNASSIGNED', '当前步骤没有操作者');
  }
  if (
    action === 'approve' ||
    action === 'finance_adjust' ||
    action === 'finance_approve' ||
    action === 'pay_success' ||
    action === 'pay_fail' ||
    action === 'transfer' ||
    action === 'reject'
  ) {
    return assignment.currentActorId;
  }
  throw new ExpenseReportError('INVALID_TRANSITION', `不能从 ${status} 执行 ${action}`);
}

export function assertActor(expectedActorId: string, actualActorId: string): void {
  if (expectedActorId !== actualActorId) {
    throw new ExpenseReportError('ACTOR_FORBIDDEN', '当前员工不能执行这个动作');
  }
}

export function nextActorAfter(
  action: ExpenseReportAction,
  currentActorId: string | null,
  targets: { managerId: string; financeId: string; cashierId: string; transferToEmployeeId: string | null },
): string | null {
  if (action === 'start_approval') {
    return targets.managerId;
  }
  if (action === 'approve') {
    return targets.financeId;
  }
  if (action === 'finance_approve') {
    return targets.cashierId;
  }
  if (action === 'transfer') {
    if (!targets.transferToEmployeeId || targets.transferToEmployeeId === currentActorId) {
      throw new ExpenseReportError('TRANSFER_TARGET_INVALID', '转交对象必须是另一名员工');
    }
    return targets.transferToEmployeeId;
  }
  if (action === 'reject' || action === 'withdraw' || action === 'pay_success' || action === 'revise' || action === 'submit') {
    return null;
  }
  return currentActorId;
}

export function assertSingleRoleAssignee(role: 'finance' | 'cashier', count: number): void {
  if (count !== 1) {
    throw new ExpenseReportError('ROLE_ASSIGNEE_AMBIGUOUS', `${role === 'finance' ? '财务' : '出纳'}岗必须且只能有一名员工`);
  }
}

export function applyFinanceAdjustment(status: ExpenseReportStatus, current: Fen, next: Fen): Fen {
  transitionExpenseReport(status, 'finance_adjust');
  if (compareFen(next, parseFen('0')) < 0) {
    throw new ExpenseReportError('AMOUNT_NEGATIVE', '批准金额不能为负');
  }
  return next;
}

export function assertPaidAmountStable(status: ExpenseReportStatus, before: Fen, after: Fen): void {
  if (status === 'paid' && compareFen(before, after) !== 0) {
    throw new ExpenseReportError('AMOUNT_LOCKED', '支付成功后不能修改金额');
  }
}

export function assertReportMatchesLines(reportAmount: Fen, lineAmounts: readonly Fen[]): void {
  let total = 0n;
  for (const amount of lineAmounts) {
    total += amount;
  }
  if (compareFen(reportAmount, total as Fen) !== 0) {
    throw new ExpenseReportError('AMOUNT_MISMATCH', '报销单金额必须等于费用行合计');
  }
}

export function normalizeIdempotencyKey(key: string | undefined): string {
  if (typeof key !== 'string') {
    throw new ExpenseReportError('IDEMPOTENCY_KEY_REQUIRED', '缺少 Idempotency-Key');
  }
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 200) {
    throw new ExpenseReportError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key 不合法');
  }
  return trimmed;
}

export type AuditDraft = {
  documentId: string;
  action: ExpenseReportAction;
  actorId: string;
  fromStatus: ExpenseReportStatus;
  toStatus: ExpenseReportStatus;
  workflowId: string | null;
  beforeAmountFen: Fen | null;
  afterAmountFen: Fen | null;
};

export function buildAuditDraft(input: AuditDraft): AuditDraft {
  return input;
}

export function decideObjectKey(reportId: string, step: ExpenseReportStep): string {
  return `${reportId}:${step}`;
}
