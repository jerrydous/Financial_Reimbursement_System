// 任务消费来自 bullmq。本进程只把队列里的查验和导出交回 API。
import { Worker } from 'bullmq';

function connectionFromUrl(redisUrl: string): { host: string; port: number; password?: string; maxRetriesPerRequest: null } {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

export function startTaskWorker(): void {
  const redisUrl = process.env.REDIS_URL ?? '';
  if (!redisUrl) {
    return;
  }
  const worker = new Worker(
    'frs-tasks',
    async (job) => {
      const data = job.data as { invoiceId?: string; exportId?: string; idempotencyKey?: string };
      if (job.name === 'verify-invoice' && data.invoiceId && data.idempotencyKey) {
        await postInternal(`/internal/invoices/${data.invoiceId}/verify`, { idempotencyKey: data.idempotencyKey });
      }
      if (job.name === 'ledger-export' && data.exportId) {
        await postInternal(`/internal/invoice-ledger/exports/${data.exportId}/run`, {});
      }
    },
    { connection: connectionFromUrl(redisUrl) },
  );
  worker.on('error', () => undefined);
}

async function postInternal(path: string, body: unknown): Promise<void> {
  const baseUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3000';
  const token = process.env.INTERNAL_TOKEN ?? '';
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok && response.status >= 500) {
    throw new Error(await response.text());
  }
}
