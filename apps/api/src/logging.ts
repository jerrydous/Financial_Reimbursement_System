// 请求日志来自 pino。这里只记路径和状态，不记令牌、影像或证件号。
import pino from 'pino';
import type { NextFunction, Request, Response } from 'express';

export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export function requestLog(request: Request, response: Response, next: NextFunction): void {
  const started = Date.now();
  response.on('finish', () => {
    logger.info({
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Date.now() - started,
    });
  });
  next();
}
