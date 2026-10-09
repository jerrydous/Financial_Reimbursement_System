import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { logger } from './logging';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const code =
        typeof body === 'object' && body !== null && 'code' in body
          ? String((body as { code: unknown }).code)
          : 'HTTP_ERROR';
      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: unknown }).message)
          : exception.message;
      response.status(exception.getStatus()).json({ code, message });
      return;
    }
    logger.error({
      message: exception instanceof Error ? exception.message : 'unknown error',
    });
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL',
      message: '服务器错误',
    });
  }
}
