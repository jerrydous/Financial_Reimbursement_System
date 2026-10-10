// 活动调用 API 上的同一条状态迁移。事务在 API 里，不在 Worker 里再写一套。
import { ApplicationFailure } from '@temporalio/activity';

export type ExpenseDecisionInput = {
  reportId: string;
  action: string;
  actorId: string;
  workflowId: string | null;
  approvedAmountFen: string | null;
  transferToEmployeeId: string | null;
  idempotencyKey: string | null;
};

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function applyExpenseDecision(input: ExpenseDecisionInput): Promise<{ status: string }> {
  const jitter = Math.floor(Math.random() * 150);
  await pause(jitter);
  const baseUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3000';
  const token = process.env.INTERNAL_TOKEN ?? '';
  const response = await fetch(`${baseUrl}/internal/expense-reports/${input.reportId}/decisions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': token,
    },
    body: JSON.stringify({
      action: input.action,
      actorId: input.actorId,
      workflowId: input.workflowId,
      approvedAmountFen: input.approvedAmountFen ?? undefined,
      transferToEmployeeId: input.transferToEmployeeId,
      idempotencyKey: input.idempotencyKey,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const text = await response.text();
    if (response.status >= 400 && response.status < 500) {
      throw ApplicationFailure.nonRetryable(text, 'DECISION_REJECTED');
    }
    throw ApplicationFailure.create({ message: text, nonRetryable: false });
  }
  const body = (await response.json()) as { status?: string };
  return { status: body.status ?? '' };
}
