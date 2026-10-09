import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { pageOffset, type InvoiceList, type InvoiceView } from '@frs/contracts';
import {
  ExpenseReportError,
  assertVerificationUnverified,
  confirmRecognition,
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
      return toInvoiceView(existing);
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
      return toInvoiceView(winner);
    }
  }

  async confirm(
    ownerEmployeeId: string,
    invoiceId: string,
    input: { invoiceCode: string; invoiceNumber: string; amountFen: string },
  ): Promise<InvoiceView> {
    const amount = parseFen(input.amountFen);
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
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new ExpenseReportError('INVOICE_NOT_FOUND', '发票不存在');
    }
    if (invoice.ownerEmployeeId !== actorId) {
      const readable = invoice.expenseReportId
        ? await this.prisma.documentAccess.findFirst({
            where: {
              actorId,
              documentId: invoice.expenseReportId,
              action: 'read',
              revokedAt: null,
            },
          })
        : null;
      if (!readable) {
        throw new ExpenseReportError('ACTOR_FORBIDDEN', '不能查看别人的发票影像');
      }
    }
    return { url: await this.storage.presignRead(invoice.objectKey), expiresInSeconds: 60 };
  }
}

function toInvoiceView(invoice: {
  id: string;
  invoiceCode: string;
  invoiceNumber: string;
  amountFen: bigint | null;
  recognitionStatus: string;
  verificationStatus: string;
  binding: string;
}): InvoiceView {
  assertVerificationUnverified(invoice.verificationStatus);
  return {
    id: invoice.id,
    invoiceCode: invoice.invoiceCode,
    invoiceNumber: invoice.invoiceNumber,
    amountFen: invoice.amountFen?.toString() ?? null,
    recognitionStatus: invoice.recognitionStatus as InvoiceView['recognitionStatus'],
    verificationStatus: 'unverified',
    binding: invoice.binding as InvoiceView['binding'],
  };
}
