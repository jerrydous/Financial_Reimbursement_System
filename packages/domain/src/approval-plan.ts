import { DomainError } from './domain-error';
import { compareFen, parseFen, type Fen } from './money';

export const approvalModes = ['single', 'any', 'all'] as const;
export type ApprovalMode = (typeof approvalModes)[number];

export type VoteDecision = 'pending' | 'approved' | 'rejected';

export type ApprovalProxy = {
  agentId: string;
  active: boolean;
};

/**
 * 或签：一人通过即前进，全部驳回才结束。
 * 会签：一人驳回即结束，必须全员通过才前进。
 */
export function foldVotes(mode: 'any' | 'all', votes: readonly VoteDecision[]): 'pending' | 'approved' | 'rejected' {
  if (votes.length === 0) {
    throw new DomainError('APPROVAL_ACTORS_REQUIRED', '会签或或签至少要有一名审批人');
  }
  if (mode === 'any') {
    if (votes.some((vote) => vote === 'approved')) {
      return 'approved';
    }
    if (votes.every((vote) => vote === 'rejected')) {
      return 'rejected';
    }
    return 'pending';
  }
  if (votes.some((vote) => vote === 'rejected')) {
    return 'rejected';
  }
  if (votes.every((vote) => vote === 'approved')) {
    return 'approved';
  }
  return 'pending';
}

export function assertWithdrawBeforeApproval(approvedCount: number): void {
  if (approvedCount > 0) {
    throw new DomainError('WITHDRAW_TOO_LATE', '已有人通过，不能撤回');
  }
}

/** 代理期间由代理人决定，原审批人不能同时操作。 */
export function assertDelegate(principalId: string, actorId: string, proxy: ApprovalProxy | null): void {
  if (proxy?.active) {
    if (actorId === proxy.agentId) {
      return;
    }
    if (actorId === principalId) {
      throw new DomainError('PROXY_EXCLUSIVE', '代理期间原审批人不能操作');
    }
    throw new DomainError('ACTOR_FORBIDDEN', '当前员工不能执行这个动作');
  }
  if (actorId !== principalId) {
    throw new DomainError('ACTOR_FORBIDDEN', '当前员工不能执行这个动作');
  }
}

export function mayVote(input: {
  mode: ApprovalMode;
  actorId: string;
  principals: readonly string[];
  proxies: readonly { principalId: string; agentId: string }[];
}): string {
  if (input.principals.includes(input.actorId)) {
    const covered = input.proxies.find((proxy) => proxy.principalId === input.actorId);
    if (covered) {
      throw new DomainError('PROXY_EXCLUSIVE', '代理期间原审批人不能操作');
    }
    return input.actorId;
  }
  const asAgent = input.proxies.find((proxy) => proxy.agentId === input.actorId && input.principals.includes(proxy.principalId));
  if (!asAgent) {
    throw new DomainError('ACTOR_FORBIDDEN', '当前员工不能执行这个动作');
  }
  return asAgent.principalId;
}

/** 金额不超过阈值时跳过主管，直接进入财务。未配置阈值时仍走主管。 */
export function nextDesk(amount: Fen, skipManagerBelowFen: Fen | null): 'manager' | 'finance' {
  if (skipManagerBelowFen === null) {
    return 'manager';
  }
  if (compareFen(skipManagerBelowFen, parseFen('0')) < 0) {
    throw new DomainError('POLICY_INVALID', '免审阈值不能为负');
  }
  return compareFen(amount, skipManagerBelowFen) <= 0 ? 'finance' : 'manager';
}

export function timeoutNotice(input: { documentId: string; actorId: string; waitingSince: string }): {
  template: 'approval_timeout';
  params: { documentId: string; actorId: string; waitingSince: string };
} {
  if (!input.documentId || !input.actorId || !input.waitingSince) {
    throw new DomainError('REQUEST_INVALID', '超时提醒缺少单据或审批人');
  }
  return {
    template: 'approval_timeout',
    params: { documentId: input.documentId, actorId: input.actorId, waitingSince: input.waitingSince },
  };
}
