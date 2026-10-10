import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { internalDecisionSchema } from '@frs/contracts';
import { ExpenseReportCommands } from './expense-report-commands';
import { rethrowAsHttp } from './http-error';

function tokenMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

@Controller()
export class InternalDecisionController {
  constructor(private readonly commands: ExpenseReportCommands) {}

  @Post('internal/expense-reports/:id/decisions')
  async decide(
    @Param('id') id: string,
    @Headers('x-internal-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = process.env.INTERNAL_TOKEN ?? '';
    if (!expected || !token || !tokenMatches(token, expected)) {
      throw new HttpException({ code: 'AUTH_REQUIRED', message: '需要内部凭证' }, HttpStatus.UNAUTHORIZED);
    }
    const parsed = internalDecisionSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException({ code: 'REQUEST_INVALID', message: '动作不合法' }, HttpStatus.BAD_REQUEST);
    }
    try {
      return await this.commands.apply({
        reportId: id,
        action: parsed.data.action,
        actorId: parsed.data.actorId,
        workflowId: parsed.data.workflowId ?? null,
        approvedAmountFen: parsed.data.approvedAmountFen ?? undefined,
        transferToEmployeeId: parsed.data.transferToEmployeeId ?? null,
        idempotencyKey: parsed.data.idempotencyKey ?? null,
      });
    } catch (error) {
      rethrowAsHttp(error);
    }
  }
}
