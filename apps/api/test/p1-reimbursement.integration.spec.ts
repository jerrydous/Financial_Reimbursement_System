import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VerificationTimeout } from '@frs/adapters';
import { ExpenseReportError } from '@frs/domain';
import { ExpenseReportCommands } from '../src/expense-reports/expense-report-commands';
import { InvoiceCommands } from '../src/invoices/invoice-commands';
import type { PrismaService } from '../src/prisma.service';
import { migrateDatabase } from './migrate';

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!dockerAvailable())('P1 对私闭环在真实 PostgreSQL 上保持金额和发票约束', () => {
  let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
  let prisma: PrismaClient;
  let reports: ExpenseReportCommands;
  let invoices: InvoiceCommands;
  const companyId = uuidv7();
  const ownerId = uuidv7();
  const managerId = uuidv7();
  const financeId = uuidv7();
  const cashierId = uuidv7();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = container.getConnectionUri();
    migrateDatabase(databaseUrl);
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const workflows = {
      startApproval: async () => undefined,
      signalDecision: async () => undefined,
    };
    reports = new ExpenseReportCommands(prisma as unknown as PrismaService, workflows);
    invoices = new InvoiceCommands(prisma as unknown as PrismaService, {
      putObject: async () => undefined,
      presignRead: async () => 'http://127.0.0.1/invoice',
      getObject: async () => new Uint8Array(),
    });
    await prisma.company.create({ data: { id: companyId, name: '示例公司', taxId: '91330100EXAMPLE001' } });
    await prisma.employee.create({
      data: { id: managerId, username: 'manager', name: '主管', email: 'manager@example.com', companyId, role: 'manager' },
    });
    await prisma.employee.createMany({
      data: [
        { id: financeId, username: 'finance', name: '财务', email: 'finance@example.com', companyId, role: 'finance' },
        { id: cashierId, username: 'cashier', name: '出纳', email: 'cashier@example.com', companyId, role: 'cashier' },
      ],
    });
    await prisma.employee.create({
      data: {
        id: ownerId,
        username: 'owner',
        name: '员工',
        email: 'owner@example.com',
        companyId,
        role: 'employee',
        managerId,
      },
    });
  }, 180000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  async function confirmedInvoice(bytes: string, number: string): Promise<string> {
    const uploaded = await invoices.upload(ownerId, { body: Buffer.from(bytes), contentType: 'application/pdf' });
    const confirmed = await invoices.confirm(ownerId, uploaded.id, {
      invoiceCode: '011',
      invoiceNumber: number,
      amountFen: '3000',
      category: 'meal',
      merchant: '示例商家',
    });
    expect(confirmed.verificationStatus).toBe('unverified');
    return confirmed.id;
  }

  it('重复提交不产生第二张单，同一发票不能进入另一张有效单', async () => {
    const invoiceId = await confirmedInvoice('invoice-a', '10001');
    const first = await reports.createDraft(ownerId, [invoiceId], 'create-1');
    const second = await reports.createDraft(ownerId, [invoiceId], 'create-1');
    expect(second.id).toBe(first.id);
    expect(await prisma.expenseReport.count({ where: { employeeId: ownerId } })).toBe(1);

    const other = await confirmedInvoice('invoice-b', '10001');
    await expect(reports.createDraft(ownerId, [other], 'create-2')).rejects.toBeInstanceOf(ExpenseReportError);
  });

  it('财务并发改批准金额时，后一笔能看见前一笔，支付成功后不能再改', async () => {
    const invoiceId = await confirmedInvoice('invoice-c', '10002');
    const draft = await reports.createDraft(ownerId, [invoiceId], 'create-3');
    const submitted = await reports.submit(ownerId, draft.id, 'submit-3');
    expect(submitted.status).toBe('submitted');
    await reports.apply({ reportId: draft.id, action: 'start_approval', actorId: 'system', workflowId: submitted.id });
    await reports.apply({ reportId: draft.id, action: 'approve', actorId: managerId, workflowId: null });

    await Promise.all([
      reports.adjust(financeId, draft.id, '2000'),
      reports.adjust(financeId, draft.id, '2500'),
    ]);
    const adjustments = await prisma.amountAdjustment.findMany({ where: { reportId: draft.id } });
    expect(adjustments).toHaveLength(2);
    const befores = new Set(adjustments.map((row) => row.beforeAmountFen.toString()));
    expect(befores.size).toBe(2);

    await reports.apply({ reportId: draft.id, action: 'finance_approve', actorId: financeId, workflowId: null });
    const paid = await reports.apply({
      reportId: draft.id,
      action: 'pay_success',
      actorId: cashierId,
      workflowId: null,
      idempotencyKey: 'pay-3',
    });
    const replay = await reports.apply({
      reportId: draft.id,
      action: 'pay_success',
      actorId: cashierId,
      workflowId: null,
      idempotencyKey: 'pay-3',
    });
    expect(replay.id).toBe(paid.id);
    expect(replay.status).toBe('paid');
    expect(await prisma.payment.count({ where: { reportId: draft.id, status: 'succeeded' } })).toBe(1);
    await expect(reports.adjust(financeId, draft.id, '1000')).rejects.toThrow(/不能从已支付/);

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { documentId: draft.id } });
    await expect(
      prisma.auditEvent.update({ where: { id: audit.id }, data: { action: 'tamper' } }),
    ).rejects.toThrow(/DOCUMENT_APPEND_ONLY/);
  });

  it('查验超时保持未验真，重试成功后仍只有一张发票', async () => {
    const uploaded = await invoices.upload(ownerId, { body: Buffer.from('invoice-verify'), contentType: 'application/pdf' });
    const confirmed = await invoices.confirm(ownerId, uploaded.id, {
      invoiceCode: '011',
      invoiceNumber: '30001',
      amountFen: '3000',
      category: 'meal',
      merchant: '示例商家',
    });
    const before = await prisma.invoice.count();
    let calls = 0;
    const verifying = new InvoiceCommands(
      prisma as unknown as PrismaService,
      { putObject: async () => undefined, presignRead: async () => 'http://127.0.0.1/invoice', getObject: async () => new Uint8Array() },
      { recognize: async () => null },
      {
        verify: async () => {
          calls += 1;
          if (calls === 1) {
            throw new VerificationTimeout();
          }
          return { status: 'verified', buyerName: '示例公司', buyerTaxId: '91330100EXAMPLE001', message: '' };
        },
      },
    );
    await expect(verifying.verify(ownerId, confirmed.id, 'verify-1')).rejects.toThrow(/未验真/);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: confirmed.id } })).verificationStatus).toBe('unverified');
    expect(await prisma.invoice.count()).toBe(before);
    const passed = await verifying.verify(ownerId, confirmed.id, 'verify-2');
    expect(passed.verificationStatus).toBe('verified');
    const replay = await verifying.verify(ownerId, confirmed.id, 'verify-2');
    expect(replay.verificationStatus).toBe('verified');
    expect(calls).toBe(2);
    expect(await prisma.invoice.count()).toBe(before);
  });

  it('并发提交不能把同一预算行冻结成负数', async () => {
    const departmentId = uuidv7();
    const projectId = uuidv7();
    const subjectId = uuidv7();
    const budgetLineId = uuidv7();
    await prisma.department.create({ data: { id: departmentId, name: '研发' } });
    await prisma.project.create({ data: { id: projectId, name: '项目', code: 'P' } });
    await prisma.budgetSubject.create({ data: { id: subjectId, name: '差旅', code: 'T' } });
    await prisma.budgetLine.create({
      data: {
        id: budgetLineId,
        departmentId,
        projectId,
        subjectId,
        period: '2026-10',
        amountFen: 5000n,
      },
    });
    const leftInvoice = await confirmedInvoice('budget-left', '30002');
    const rightInvoice = await confirmedInvoice('budget-right', '30003');
    const left = await reports.createDraft(ownerId, [leftInvoice], 'budget-create-1', { budgetLineId });
    const right = await reports.createDraft(ownerId, [rightInvoice], 'budget-create-2', { budgetLineId });
    const results = await Promise.allSettled([
      reports.submit(ownerId, left.id, 'budget-submit-1'),
      reports.submit(ownerId, right.id, 'budget-submit-2'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const line = await prisma.budgetLine.findUniqueOrThrow({ where: { id: budgetLineId } });
    expect(line.reservedFen).toBe(3000n);
    expect(line.reservedFen + line.consumedFen <= line.amountFen).toBe(true);
  });
});
