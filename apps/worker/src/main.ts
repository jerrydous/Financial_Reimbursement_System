// 耐久连接来自 @temporalio/worker。本进程只连上任务队列并暴露健康检查。
import http from 'node:http';
import path from 'node:path';
import { NativeConnection, Worker } from '@temporalio/worker';

const port = Number(process.env.WORKER_PORT ?? 3001);
const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';

let ready = false;

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(ready ? 200 : 503, { 'content-type': 'text/plain' });
    response.end(ready ? 'ok' : 'starting');
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(port);

async function run(): Promise<void> {
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: 'expense',
    workflowsPath: path.join(__dirname, 'workflows.js'),
  });
  ready = true;
  const shutdown = () => {
    ready = false;
    worker.shutdown();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await worker.run();
  server.close();
  await connection.close();
}

void run().catch((error: unknown) => {
  ready = false;
  console.error(error instanceof Error ? error.message : 'worker failed');
  process.exit(1);
});
