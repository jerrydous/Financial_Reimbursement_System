// 审批等待来自 @temporalio/client。本文件只启动流程和发送信号，不自己实现流程引擎。
import { Client, Connection } from '@temporalio/client';
import { expenseWorkflowId } from '@frs/domain';

export type ExpenseDecisionSignal = {
  action: string;
  actorId: string;
  approvedAmountFen?: string;
  transferToEmployeeId?: string | null;
  idempotencyKey?: string | null;
};

const TIMEOUT_MS = 10_000;

async function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('TEMPORAL_TIMEOUT')), TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export class TemporalExpenseWorkflow {
  private clientPromise: Promise<Client> | null = null;

  constructor(
    private readonly options: {
      address: string;
      namespace: string;
    },
  ) {}

  private client(): Promise<Client> {
    if (this.clientPromise) {
      return this.clientPromise;
    }
    const pending = Connection.connect({
      address: this.options.address,
      connectTimeout: '5 seconds',
    })
      .then((connection) => new Client({ connection, namespace: this.options.namespace }))
      .catch((error: unknown) => {
        this.clientPromise = null;
        throw error;
      });
    this.clientPromise = pending;
    return pending;
  }

  async startApproval(reportId: string): Promise<void> {
    const client = await this.client();
    await withDeadline(
      client.workflow.start('expenseApproval', {
        taskQueue: 'expense',
        workflowId: expenseWorkflowId(reportId),
        args: [{ reportId }],
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
        workflowIdConflictPolicy: 'USE_EXISTING',
      }),
    );
  }

  async signalDecision(reportId: string, decision: ExpenseDecisionSignal): Promise<void> {
    const client = await this.client();
    const handle = client.workflow.getHandle(expenseWorkflowId(reportId));
    await withDeadline(handle.signal('expenseDecision', decision));
  }
}
