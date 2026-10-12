import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, Headers, HttpException, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { DocumentCommands } from '../documents/document-commands';
import { rethrowAsHttp } from '../expense-reports/http-error';
import { InvoiceCommands } from '../invoices/invoice-commands';
import { PrismaService } from '../prisma.service';

function tokenMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function readFields(body: unknown, keys: string[]): Record<string, string> | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const record = body as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }
    result[key] = value;
  }
  return result;
}

function assertInternal(token: string | undefined): void {
  const expected = process.env.INTERNAL_TOKEN ?? '';
  if (!expected || !token || !tokenMatches(token, expected)) {
    throw new HttpException({ code: 'AUTH_REQUIRED', message: '需要内部凭证' }, HttpStatus.UNAUTHORIZED);
  }
}

@Controller()
export class InternalJobsController {
  constructor(
    @Inject(DocumentCommands) private readonly documents: DocumentCommands,
    @Inject(InvoiceCommands) private readonly invoices: InvoiceCommands,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post('internal/expense-reports/:id/reminders')
  async remindExpense(@Param('id') id: string, @Headers('x-internal-token') token: string | undefined) {
    assertInternal(token);
    await this.documents.remindDocument(id, 'expense');
    return { accepted: true };
  }

  @Post('internal/reminders')
  async remind(@Headers('x-internal-token') token: string | undefined, @Body() body: unknown) {
    assertInternal(token);
    const parsed = readFields(body, ['documentId', 'kind']);
    if (!parsed) {
      throw new HttpException({ code: 'REQUEST_INVALID', message: '提醒不合法' }, HttpStatus.BAD_REQUEST);
    }
    await this.documents.remindDocument(parsed.documentId ?? '', parsed.kind ?? '');
    return { accepted: true };
  }

  @Post('internal/invoice-ledger/exports/:id/run')
  async runExport(@Param('id') id: string, @Headers('x-internal-token') token: string | undefined) {
    assertInternal(token);
    try {
      await this.documents.runExport(id);
      return { accepted: true };
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('internal/invoices/:id/verify')
  async verify(@Param('id') id: string, @Headers('x-internal-token') token: string | undefined, @Body() body: unknown) {
    assertInternal(token);
    const parsed = readFields(body, ['idempotencyKey']);
    if (!parsed?.idempotencyKey) {
      throw new HttpException({ code: 'REQUEST_INVALID', message: '查验不合法' }, HttpStatus.BAD_REQUEST);
    }
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      throw new HttpException({ code: 'INVOICE_NOT_FOUND', message: '发票不存在' }, HttpStatus.NOT_FOUND);
    }
    try {
      return await this.invoices.verify(invoice.ownerEmployeeId, id, parsed.idempotencyKey);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }
}
