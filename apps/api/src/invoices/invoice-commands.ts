import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { currencyCodeSchema, pageOffset, type InvoiceList, type InvoiceView } from '@frs/contracts';
import {
  ExpenseReportError,
  assertLedgerOpen,
  assertVerificationStatus,
  confirmRecognition,
  compareFen,
  draftFromVatPairs,
  fenToYuanText,
  normalizeIdempotencyKey,
  parseFen,
  verificationFromOfficial,
  type LedgerBucket,
  type OcrDraft,
  type RecognitionStatus,
  type VerificationDecision,
} from '@frs/domain';
import { VerificationNotConfigured, VerificationTimeout } from '@frs/adapters';
import { logger } from '../logging';
import { PrismaService } from '../prisma.service';
import { isUniqueViolation } from '../expense-reports/http-error';
import { todayInShanghai } from '../calendar';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

export interface InvoiceFileStore {
  putObject(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void>;
  presignRead(objectKey: string, file?: { contentType: string; fileName: string }): Promise<string>;
  getObject(objectKey: string): Promise<Uint8Array>;
}

export interface InvoiceOcrPort {
  recognize(file: { body: Buffer; contentType: string }): Promise<{ pairs: { name: string; value: string }[]; requestId: string } | null>;
}

@Injectable()
export class InvoiceCommands {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: InvoiceFileStore,
    private readonly ocr: InvoiceOcrPort = { recognize: async () => null },
    private readonly verifier: {
      verify(input: {
        invoiceCode: string;
        invoiceNumber: string;
        invoiceDate: string;
        amountYuan?: string;
      }): Promise<VerificationDecision>;
    } = {
      async verify() {
        throw new VerificationNotConfigured();
      },
    },
    private readonly queue: { enqueue(invoiceId: string, idempotencyKey: string): Promise<void> } = {
      async enqueue() {
        return undefined;
      },
    },
  ) {}

  async upload(ownerEmployeeId: string, file: { body: Buffer; contentType: string }): Promise<InvoiceView> {
    if (!ALLOWED_TYPES.has(file.contentType) || !matchesDeclaredType(file.body, file.contentType)) {
      throw new ExpenseReportError('FILE_TYPE_UNSUPPORTED', '只接受 jpg、png 或 pdf');
    }
    const fileSha256 = createHash('sha256').update(file.body).digest('hex');
    const existing = await this.prisma.invoice.findFirst({
      where: { tenantId: 'default', ownerEmployeeId, fileSha256 },
      orderBy: { createdAt: 'desc' },
    });
    if (existing?.recognitionStatus === 'pending_confirmation' && existing.binding === 'released') {
      const recognized = await this.recognizeDraft(file);
      const updated = await this.prisma.invoice.update({
        where: { id: existing.id },
        data: {
          invoiceCode: recognized.draft.invoiceCode || existing.invoiceCode,
          invoiceNumber: recognized.draft.invoiceNumber || existing.invoiceNumber,
          amountFen: recognized.draft.amountFen === null ? existing.amountFen : BigInt(recognized.draft.amountFen),
          sellerName: recognized.draft.sellerName || existing.sellerName,
          buyerName: recognized.draft.buyerName || existing.buyerName,
          buyerTaxId: recognized.draft.buyerTaxId || existing.buyerTaxId,
          invoiceDate: recognized.draft.invoiceDate || existing.invoiceDate,
          ocrStatus: recognized.status,
          ocrMessage: recognized.message,
          ocrRequestId: recognized.requestId,
        },
      });
      return toInvoiceView(updated);
    }
    if (existing) {
      return { ...toInvoiceView(existing), reused: true };
    }
    const id = uuidv7();
    const objectKey = `invoices/default/${id}`;
    await this.storage.putObject({ objectKey, body: file.body, contentType: file.contentType });
    const recognized = await this.recognizeDraft(file);
    try {
      const created = await this.prisma.invoice.create({
        data: {
          id,
          ownerEmployeeId,
          objectKey,
          fileSha256,
          contentType: file.contentType,
          invoiceCode: recognized.draft.invoiceCode,
          invoiceNumber: recognized.draft.invoiceNumber,
          amountFen: recognized.draft.amountFen === null ? null : BigInt(recognized.draft.amountFen),
          currency: 'CNY',
          sellerName: recognized.draft.sellerName,
          buyerName: recognized.draft.buyerName,
          buyerTaxId: recognized.draft.buyerTaxId,
          invoiceDate: recognized.draft.invoiceDate,
          ocrStatus: recognized.status,
          ocrMessage: recognized.message,
          ocrRequestId: recognized.requestId,
          recognitionStatus: 'pending_confirmation',
          verificationStatus: 'unverified',
          binding: 'released',
          ledgerStatus: 'open',
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
    const currency = currencyCodeSchema.safeParse(input.currency ?? 'CNY');
    if (!currency.success) {
      throw new ExpenseReportError('CURRENCY_MISMATCH', '币种不支持');
    }
    const amount = parseFen(input.amountFen);
    if (compareFen(amount, parseFen('0')) < 0) {
      throw new ExpenseReportError('AMOUNT_NEGATIVE', '金额不能为负');
    }
    const code = input.invoiceCode.trim();
    const number = input.invoiceNumber.trim();
    if (!number) {
      throw new ExpenseReportError('INVOICE_NUMBER_REQUIRED', '发票号码不能为空');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const lockKey = `invoice-number:default:${code}:${number}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
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
      if (invoice.verificationStatus !== 'unverified' && invoice.verificationStatus !== 'verified' && invoice.verificationStatus !== 'failed') {
        throw new ExpenseReportError('VERIFICATION_NOT_ALLOWED', '发票验真状态不合法');
      }
      const sameIdentity =
        invoice.invoiceCode === code &&
        invoice.invoiceNumber === number &&
        invoice.amountFen?.toString() === amount.toString() &&
        invoice.currency === currency.data;
      if (invoice.verificationStatus === 'failed' && sameIdentity) {
        throw new ExpenseReportError('VERIFICATION_NOT_ALLOWED', '验真未通过，请改正发票信息后再确认');
      }
      const duplicate = await tx.invoice.findFirst({
        where: {
          tenantId: invoice.tenantId,
          invoiceCode: code,
          invoiceNumber: number,
          id: { not: invoice.id },
          ledgerStatus: { not: 'removed' },
          OR: [{ binding: 'active' }, { recognitionStatus: 'confirmed' }],
        },
      });
      if (duplicate) {
        throw new ExpenseReportError('INVOICE_ALREADY_BOUND', '这个发票号码已经确认过');
      }
      return tx.invoice.update({
        where: { id: invoiceId },
        data: {
          invoiceCode: code,
          invoiceNumber: number,
          amountFen: amount,
          currency: currency.data,
          recognitionStatus: confirmRecognition(invoice.recognitionStatus as RecognitionStatus),
          verificationStatus: invoice.verificationStatus === 'verified' && sameIdentity ? 'verified' : 'unverified',
        },
      });
    });
    logger.info({ documentId: invoiceId, actorId: ownerEmployeeId, workflowId: null, action: 'confirm_invoice' });
    return toInvoiceView(updated);
  }

  async verify(ownerEmployeeId: string, invoiceId: string, idempotencyKey: string | undefined): Promise<InvoiceView> {
    const key = normalizeIdempotencyKey(idempotencyKey);
    const existing = await this.prisma.invoiceVerificationAttempt.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: 'default', idempotencyKey: key } },
    });
    if (existing && existing.status !== 'pending') {
      const stored = await this.prisma.invoice.findUnique({ where: { id: existing.invoiceId } });
      if (!stored || stored.ownerEmployeeId !== ownerEmployeeId) {
        throw new ExpenseReportError('ACTOR_FORBIDDEN', '不能查看这次查验');
      }
      return toInvoiceView(stored);
    }
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new ExpenseReportError('INVOICE_NOT_FOUND', '发票不存在');
    }
    if (invoice.ownerEmployeeId !== ownerEmployeeId) {
      throw new ExpenseReportError('ACTOR_FORBIDDEN', '不能查验别人的发票');
    }
    if (invoice.recognitionStatus !== 'confirmed' || !invoice.invoiceNumber) {
      throw new ExpenseReportError('INVOICE_NOT_CONFIRMED', '发票还没经人工确认');
    }
    const beforeCount = await this.prisma.invoice.count({ where: { ownerEmployeeId } });
    let decision: VerificationDecision;
    try {
      decision = await this.verifier.verify({
        invoiceCode: invoice.invoiceCode,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        amountYuan: invoice.amountFen === null ? undefined : fenToYuanText(parseFen(invoice.amountFen.toString())),
      });
    } catch (error) {
      if (error instanceof VerificationNotConfigured || (error instanceof Error && error.name === 'VerificationNotConfigured')) {
        throw new ExpenseReportError('VERIFICATION_NOT_CONFIGURED', '未配置查验服务，发票保持未验真');
      }
      if (error instanceof VerificationTimeout || (error instanceof Error && error.name === 'VerificationTimeout')) {
        await this.saveAttempt(invoice.id, key, 'pending', '查验超时');
        await this.queue.enqueue(invoice.id, key).catch(() => undefined);
        throw new ExpenseReportError('VERIFICATION_TIMEOUT', '查验超时，已安排重试，发票仍是未验真');
      }
      throw error;
    }
    const confirmed = verificationFromOfficial(
      decision.status === 'verified'
        ? { invoiceNumber: invoice.invoiceNumber, buyerName: decision.buyerName, buyerTaxId: decision.buyerTaxId }
        : null,
      invoice.invoiceNumber,
    );
    const updated = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        verificationStatus: confirmed.status,
        buyerName: confirmed.buyerName || invoice.buyerName,
        buyerTaxId: confirmed.buyerTaxId || invoice.buyerTaxId,
      },
    });
    await this.saveAttempt(invoice.id, key, confirmed.status, confirmed.message);
    if ((await this.prisma.invoice.count({ where: { ownerEmployeeId } })) !== beforeCount) {
      throw new ExpenseReportError('INVOICE_ALREADY_BOUND', '查验不能新增发票');
    }
    return toInvoiceView(updated);
  }

  private async saveAttempt(invoiceId: string, idempotencyKey: string, status: string, message: string): Promise<void> {
    await this.prisma.invoiceVerificationAttempt.upsert({
      where: { tenantId_idempotencyKey: { tenantId: 'default', idempotencyKey } },
      create: { id: uuidv7(), invoiceId, idempotencyKey, status, message },
      update: { status, message },
    });
  }

  async listOwn(ownerEmployeeId: string, page: number, pageSize: number, bucket: LedgerBucket = 'unreimbursed'): Promise<InvoiceList> {
    const skip = pageOffset(page, pageSize);
    const where = ledgerWhere(ownerEmployeeId, bucket);
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
    const invoice = await this.readableInvoice(actorId, invoiceId);
    const fileName = invoiceFileName(invoice.contentType);
    return {
      url: await this.storage.presignRead(invoice.objectKey, { contentType: invoice.contentType, fileName }),
      expiresInSeconds: 60,
    };
  }

  async readContent(actorId: string, invoiceId: string): Promise<{ body: Uint8Array; contentType: string; fileName: string }> {
    const invoice = await this.readableInvoice(actorId, invoiceId);
    return {
      body: await this.storage.getObject(invoice.objectKey),
      contentType: invoice.contentType,
      fileName: invoiceFileName(invoice.contentType),
    };
  }

  /** 代理到期后，不能再凭当时写下的授权看当前审批人的影像。 */
  private async expiredProxyOfCurrentActor(actorId: string, reportIds: string[]): Promise<boolean> {
    if (reportIds.length === 0) {
      return false;
    }
    const reports = await this.prisma.expenseReport.findMany({
      where: { id: { in: reportIds } },
      select: { currentActorId: true },
    });
    const principals = [...new Set(reports.flatMap((report) => (report.currentActorId ? [report.currentActorId] : [])))];
    if (principals.length === 0) {
      return false;
    }
    const today = todayInShanghai();
    const proxies = await this.prisma.approvalProxy.findMany({
      where: { agentId: actorId, principalId: { in: principals }, enabled: true },
    });
    return proxies.length > 0 && proxies.every((proxy) => proxy.startsOn > today || proxy.endsOn < today);
  }

  /** 驳回、撤回会清掉发票上的报销单号，影像仍挂在单据明细上。能看单据的人要能看影像。 */
  private async readableInvoice(actorId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new ExpenseReportError('INVOICE_NOT_FOUND', '发票不存在');
    }
    if (invoice.ownerEmployeeId === actorId) {
      return invoice;
    }
    const lines = await this.prisma.expenseLine.findMany({
      where: { invoiceId: invoice.id },
      select: { reportId: true },
    });
    const reportIds = [...new Set(lines.map((line) => line.reportId))];
    if (invoice.expenseReportId && !reportIds.includes(invoice.expenseReportId)) {
      reportIds.push(invoice.expenseReportId);
    }
    const readable =
      reportIds.length === 0
        ? null
        : await this.prisma.documentAccess.findFirst({
            where: {
              actorId,
              action: 'read',
              revokedAt: null,
              OR: reportIds.map((reportId) => ({ documentId: reportId, objectKey: reportId })),
            },
          });
    if (await this.expiredProxyOfCurrentActor(actorId, reportIds)) {
      throw new ExpenseReportError('ACTOR_FORBIDDEN', '不能查看别人的发票影像');
    }
    if (!readable) {
      const reports =
        reportIds.length === 0
          ? []
          : await this.prisma.expenseReport.findMany({
              where: { id: { in: reportIds } },
              select: { currentActorId: true },
            });
      const principalIds = reports.flatMap((report) => (report.currentActorId ? [report.currentActorId] : []));
      const today = todayInShanghai();
      const proxy =
        principalIds.length === 0
          ? null
          : await this.prisma.approvalProxy.findFirst({
              where: {
                agentId: actorId,
                principalId: { in: principalIds },
                enabled: true,
                startsOn: { lte: today },
                endsOn: { gte: today },
              },
            });
      if (!proxy) {
        throw new ExpenseReportError('ACTOR_FORBIDDEN', '不能查看别人的发票影像');
      }
    }
    return invoice;
  }

  async classify(ownerEmployeeId: string, invoiceId: string, next: 'exempt' | 'removed'): Promise<InvoiceView> {
    const invoice = await this.editableInvoice(ownerEmployeeId, invoiceId);
    const updated = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { ledgerStatus: next },
    });
    logger.info({ documentId: invoice.id, actorId: ownerEmployeeId, workflowId: null, action: next === 'exempt' ? 'exempt_invoice' : 'remove_invoice' });
    return toInvoiceView(updated);
  }

  async transfer(ownerEmployeeId: string, invoiceId: string, toEmployeeId: string): Promise<InvoiceView> {
    if (toEmployeeId === ownerEmployeeId) {
      throw new ExpenseReportError('TRANSFER_TARGET_INVALID', '不能把发票转交给自己');
    }
    const target = await this.prisma.employee.findUnique({ where: { id: toEmployeeId } });
    const source = await this.editableInvoice(ownerEmployeeId, invoiceId);
    if (!target || target.companyId !== (await this.prisma.employee.findUnique({ where: { id: ownerEmployeeId } }))?.companyId) {
      throw new ExpenseReportError('TRANSFER_TARGET_INVALID', '转交对象必须是同一公司的同事');
    }
    const copyId = uuidv7();
    await this.prisma.$transaction([
      this.prisma.invoice.update({
        where: { id: source.id },
        data: { ledgerStatus: 'transferred', transferredToId: toEmployeeId },
      }),
      this.prisma.invoice.create({
        data: {
          id: copyId,
          ownerEmployeeId: toEmployeeId,
          objectKey: source.objectKey,
          fileSha256: source.fileSha256,
          contentType: source.contentType,
          invoiceCode: source.invoiceCode,
          invoiceNumber: source.invoiceNumber,
          amountFen: source.amountFen,
          currency: source.currency,
          sellerName: source.sellerName,
          buyerName: source.buyerName,
          buyerTaxId: source.buyerTaxId,
          invoiceDate: source.invoiceDate,
          ocrStatus: source.ocrStatus,
          ocrMessage: source.ocrMessage,
          ocrRequestId: source.ocrRequestId,
          recognitionStatus: source.recognitionStatus,
          verificationStatus: 'unverified',
          binding: 'released',
          ledgerStatus: 'open',
        },
      }),
    ]);
    logger.info({ documentId: source.id, actorId: ownerEmployeeId, workflowId: null, action: 'transfer_invoice' });
    const updated = await this.prisma.invoice.findUniqueOrThrow({ where: { id: source.id } });
    return toInvoiceView(updated);
  }

  private async editableInvoice(ownerEmployeeId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new ExpenseReportError('INVOICE_NOT_FOUND', '发票不存在');
    }
    if (invoice.ownerEmployeeId !== ownerEmployeeId) {
      throw new ExpenseReportError('ACTOR_FORBIDDEN', '不能分类别人的发票');
    }
    if (invoice.binding === 'active') {
      throw new ExpenseReportError('INVOICE_ALREADY_BOUND', '已经进入报销单的发票不能再改分类');
    }
    assertLedgerOpen(invoice.ledgerStatus);
    return invoice;
  }

  private async recognizeDraft(file: { body: Buffer; contentType: string }): Promise<{
    draft: OcrDraft;
    status: 'skipped' | 'recognized' | 'failed';
    message: string;
    requestId: string;
  }> {
    const empty: OcrDraft = {
      invoiceCode: '',
      invoiceNumber: '',
      amountFen: null,
      sellerName: '',
      buyerName: '',
      buyerTaxId: '',
      invoiceDate: '',
    };
    try {
      const recognized = await this.ocr.recognize(file);
      if (!recognized) {
        return { draft: empty, status: 'skipped', message: '未配置识票服务，请手工填写', requestId: '' };
      }
      const draft = draftFromVatPairs(recognized.pairs);
      if (!draft.invoiceNumber && !draft.amountFen) {
        return { draft, status: 'failed', message: '没有识别出发票号码或金额，请手工填写', requestId: recognized.requestId };
      }
      return { draft, status: 'recognized', message: '', requestId: recognized.requestId };
    } catch (error) {
      return {
        draft: empty,
        status: 'failed',
        message: error instanceof Error ? error.message : '识票失败，请手工填写',
        requestId: '',
      };
    }
  }
}

function ledgerWhere(ownerEmployeeId: string, bucket: LedgerBucket) {
  if (bucket === 'reimbursed') {
    return { ownerEmployeeId, binding: 'active' };
  }
  if (bucket === 'unreimbursed') {
    return { ownerEmployeeId, binding: 'released', ledgerStatus: 'open' };
  }
  return { ownerEmployeeId, binding: 'released', ledgerStatus: bucket };
}

function matchesDeclaredType(body: Buffer, contentType: string): boolean {
  if (contentType === 'image/jpeg') {
    return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (contentType === 'application/pdf') {
    return body.length === 0 || body.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  return false;
}

function invoiceFileName(contentType: string): string {
  if (contentType === 'application/pdf') {
    return 'invoice.pdf';
  }
  if (contentType === 'image/png') {
    return 'invoice.png';
  }
  return 'invoice.jpg';
}

function toInvoiceView(invoice: {
  id: string;
  invoiceCode: string;
  invoiceNumber: string;
  amountFen: bigint | null;
  currency: string;
  sellerName: string;
  invoiceDate: string;
  buyerName: string;
  buyerTaxId: string;
  invoiceType: string;
  ledgerStatus: string;
  ocrStatus: string;
  ocrMessage: string;
  recognitionStatus: string;
  verificationStatus: string;
  binding: string;
}): InvoiceView {
  const verificationStatus = assertVerificationStatus(invoice.verificationStatus);
  return {
    id: invoice.id,
    invoiceCode: invoice.invoiceCode,
    invoiceNumber: invoice.invoiceNumber,
    amountFen: invoice.amountFen?.toString() ?? null,
    currency: currencyCodeSchema.parse(invoice.currency),
    sellerName: invoice.sellerName,
    invoiceDate: invoice.invoiceDate,
    ledgerStatus: invoice.ledgerStatus as InvoiceView['ledgerStatus'],
    ocrStatus: invoice.ocrStatus as InvoiceView['ocrStatus'],
    ocrMessage: invoice.ocrMessage,
    recognitionStatus: invoice.recognitionStatus as InvoiceView['recognitionStatus'],
    verificationStatus,
    buyerName: invoice.buyerName,
    buyerTaxId: invoice.buyerTaxId,
    invoiceType: invoice.invoiceType,
    binding: invoice.binding as InvoiceView['binding'],
  };
}
