// 重试和导出队列来自 bullmq。本文件只投递任务，不保存付款状态。
import { DomainError } from '@frs/domain';

export type TaskName = 'verify-invoice' | 'ledger-export';

export type TaskData = {
  idempotencyKey: string;
  invoiceId?: string;
  exportId?: string;
};

type QueueLike = {
  add: (name: string, data: TaskData, options: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number } }) => Promise<unknown>;
};

function connectionFromUrl(redisUrl: string): { host: string; port: number; password?: string; maxRetriesPerRequest: null } {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

export class BullTaskQueue {
  private queue: QueueLike | null = null;

  constructor(private readonly redisUrl: string) {}

  async enqueue(name: TaskName, data: TaskData): Promise<void> {
    if (!this.redisUrl) {
      throw new DomainError('QUEUE_UNAVAILABLE', '没有配置 Redis，不能把任务放进队列');
    }
    const queue = await this.load();
    try {
      await queue.add(name, data, {
        jobId: `${name}:${data.idempotencyKey}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.toLowerCase().includes('exist')) {
        return;
      }
      throw new DomainError('QUEUE_UNAVAILABLE', '任务队列暂时不能接收');
    }
  }

  private async load(): Promise<QueueLike> {
    if (this.queue) {
      return this.queue;
    }
    const loaded = (await import('bullmq')) as { Queue?: new (name: string, options: object) => QueueLike };
    if (!loaded.Queue) {
      throw new DomainError('QUEUE_UNAVAILABLE', '任务队列没有加载成功');
    }
    this.queue = new loaded.Queue('frs-tasks', { connection: connectionFromUrl(this.redisUrl) });
    return this.queue;
  }
}

export function createTaskQueueFromEnv(): BullTaskQueue {
  return new BullTaskQueue(process.env.REDIS_URL ?? '');
}
