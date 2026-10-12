import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { currencyCodeSchema, pageOffset, type InvoiceList, type InvoiceView } from '@frs/contracts';
import {
  ExpenseReportError,
  assertVerificationUnverified,
  canReadDocument,
  confirmRecognition,
  isReviewRecordAction,
  parseFen,
  type RecognitionStatus,
} from '@frs/domain';
import { logger } from '../logging';
import { PrismaService } from '../prisma.service';
import { isUniqueViolation } from '../expense-reports/http-error';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

export interface InvoiceFileStore {
  putObject(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void>;
  presignRead(objectKey: string): Promise<string>;
  getObject(objectKey: string): Promise<{ body: Uint8Array; contentType: string }>;
}

@Injectable()
export class InvoiceCommands {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: InvoiceFileStore,
  ) {}

  async upload(ownerEmployeeId: string, file: { body: Buffer; contentType: string }): Promise<InvoiceView> {
    if (!ALLOWED_TYPES.has(file.contentType)) {
      throw new ExpenseReportError('FILE_TYPE_UNSUPPORTED', '只接受 jpg、png 或 pdf');
    }
    const fileSha256 = createHash('sha256').update(file.body).digest('hex');
    const existing = await this.prisma.invoice.findFirst({
      where: { tenantId: 'default', ownerEmployeeId, fileSha256 },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      return { ...toInvoiceView(existing), reused: true };
    }
    const id = uuidv7();
    const objectKey = `invoices/default/${id}`;
    await this.storage.putObject({ objectKey, body: file.body, contentType: file.contentType });
    try {
      const created = await this.prisma.invoice.create({
        data: {
          id,
          ownerEmployeeId,
          objectKey,
          fileSha256,
          contentType: file.contentType,
          recognitionStatus: 'pending_confirmation',
          verificationStatus: 'unverified',
          binding: 'released',
        },
      });
      logger.info({ documentId: id, actorId: ownerEmployeeId, workflowId: null, action: 'upload_invoice' });
      return toInvoiceView(created);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const winner = await this.prisma.invoice.findFirst({
        where: { tenantId: 'default', fileSha256, binding: 'active' },
      });
      if (!winner || winner.ownerEmployeeId !== ownerEmployeeId) {
        throw new ExpenseReportError('INVOICE_ALREADY_BOUND', '这张发票影像已经在另一张有效报销单里');
      }
      return { ...toInvoiceView(winner), reused: true };
    }
  }

  async confirm(
    ownerEmployeeId: string,
    invoiceId: string,
    input: { invoiceCode: string; invoiceNumber: string; amountFen: string; currency?: string },
  ): Promise<InvoiceView> {
    const amount = parseFen(input.amountFen);
    const currency = currencyCodeSchema.safeParse(input.currency ?? 'CNY');
    if (!currency.success) {
      throw new ExpenseReportError('REQUEST_INVALID', '币种不受支持');
    }
    assertVerificationUnverified('unverified');
    if (!input.invoiceNumber.trim()) {
      throw new ExpenseReportError('INVOICE_NUMBER_REQUIRED', '发票号码不能为空');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) {
        throw new ExpenseReportError('INVOICE_NOT_FOUND', '发票不存在');
      }
      if (invoice.ownerEmployeeId !== ownerEmployeeId) {
        throw new ExpenseReportError('ACTOR_FORBIDDEN', '不能确认别人的发票');
      }
      if (invoice.binding === 'active') {
        throw new ExpenseReportError('INVOICE_ALREADY_BOUND', '发票已经进入报销单，不能再改号码');
      }
      assertVerificationUnverified(invoice.verificationStatus);
      return tx.invoice.update({
        where: { id: invoiceId },
        data: {
          invoiceCode: input.invoiceCode.trim(),
          invoiceNumber: input.invoiceNumber.trim(),
          amountFen: amount,
          currency: currency.data,
          recognitionStatus: confirmRecognition(invoice.recognitionStatus as RecognitionStatus),
          verificationStatus: 'unverified',
        },
      });
    });
    logger.info({ documentId: invoiceId, actorId: ownerEmployeeId, workflowId: null, action: 'confirm_invoice' });
    return toInvoiceView(updated);
  }

  async listOwn(ownerEmployeeId: string, page: number, pageSize: number): Promise<InvoiceList> {
    const skip = pageOffset(page, pageSize);
    const where = { ownerEmployeeId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map(toInvoiceView),
      page,
      pageSize,
      total,
    };
  }

  async presign(actorId: string, invoiceId: string): Promise<{ url: string; expiresInSeconds: number }> {
    const invoice = await this.requireReadable(actorId, invoiceId);
    return { url: await this.storage.presignRead(invoice.objectKey), expiresInSeconds: 60 };
  }

  async readContent(
    actorId: string,
    invoiceId: string,
  ): Promise<{ body: Uint8Array; contentType: string; filename: string }> {
    const invoice = await this.requireReadable(actorId, invoiceId);
    let stored: { body: Uint8Array; contentType: string };
    try {
      stored = await this.storage.getObject(invoice.objectKey);
    } catch {
      logger.info({ documentId: invoiceId, actorId, workflowId: null, action: 'read_invoice_failed' });
      throw new ExpenseReportError('FILE_UNAVAILABLE', '发票影像暂时读不出来，请稍后再试');
    }
    const filename = (invoice.invoiceNumber || invoice.id).replace(/[^\w.-]+/g, '_');
    return {
      body: stored.body,
      contentType: invoice.contentType || stored.contentType || 'application/octet-stream',
      filename,
    };
  }

  private async requireReadable(actorId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new ExpenseReportError('INVOICE_NOT_FOUND', '发票不存在');
    }
    if (invoice.ownerEmployeeId === actorId) {
      return invoice;
    }
    const lines = await this.prisma.expenseLine.findMany({
      where: { invoiceId },
      select: { reportId: true },
    });
    const reportIds = [...new Set([invoice.expenseReportId, ...lines.map((line) => line.reportId)].filter((id) => id !== null))];
    const reports = reportIds.length === 0
      ? []
      : await this.prisma.expenseReport.findMany({
          where: { id: { in: reportIds } },
          select: {
            employeeId: true,
            accesses: { where: { actorId }, select: { actorId: true, action: true, revokedAt: true } },
            auditEvents: { where: { actorId }, select: { action: true } },
          },
        });
    const allowed = reports.some((report) =>
      canReadDocument({
        actorId,
        ownerId: report.employeeId,
        grants: report.accesses.map((grant) => ({
          actorId: grant.actorId,
          action: grant.action,
          revokedAt: grant.revokedAt?.toISOString() ?? null,
        })),
        actedReview: report.auditEvents.some((event) => isReviewRecordAction(event.action)),
      }),
    );
    if (!allowed) {
      throw new ExpenseReportError('ACTOR_FORBIDDEN', '不能查看别人的发票影像');
    }
    return invoice;
  }
}

function toInvoiceView(invoice: {
  id: string;
  invoiceCode: string;
  invoiceNumber: string;
  amountFen: bigint | null;
  currency: string;
  recognitionStatus: string;
  verificationStatus: string;
  binding: string;
}): InvoiceView {
  assertVerificationUnverified(invoice.verificationStatus);
  const currency = currencyCodeSchema.safeParse(invoice.currency);
  if (!currency.success) {
    throw new ExpenseReportError('REQUEST_INVALID', '币种不受支持');
  }
  return {
    id: invoice.id,
    invoiceCode: invoice.invoiceCode,
    invoiceNumber: invoice.invoiceNumber,
    amountFen: invoice.amountFen?.toString() ?? null,
    currency: currency.data,
    recognitionStatus: invoice.recognitionStatus as InvoiceView['recognitionStatus'],
    verificationStatus: 'unverified',
    binding: invoice.binding as InvoiceView['binding'],
  };
}
