import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './http-exception.filter';
import { requestLog } from './logging';

async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  app.use(requestLog);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  });
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
}

void main();
