import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { defaultPolicyRules, evaluatePolicyRules } from '@frs/adapters';
import {
  DomainError,
  assertFindingsAllowSubmit,
  assertNoOverdue,
  consumeBudget,
  crossesYear,
  invoiceAgeDays,
  loanStatusAfterBalance,
  deskForCurrency,
  matchBuyer,
  matchInvoiceAmount,
  occupyQuota,
  assertWriteOffWithinReport,
  compareFen,
  parseFen,
  releaseBudget,
  releaseQuota,
  reserveBudget,
  retargetReservation,
  writeOffLoan,
  type Fen,
  type Finding,
  type LoanStatus,
} from '@frs/domain';

type Tx = Prisma.TransactionClient;

type LockedBudget = {
  id: string;
  amountFen: bigint;
  reservedFen: bigint;
  consumedFen: bigint;
  version: number;
};

export async function publishedPolicy(tx: Tx): Promise<{ rules: object[]; skipBelow: Fen | null }> {
  const published = await tx.policyVersion.findFirst({
    where: { tenantId: 'default', status: 'published' },
    orderBy: { version: 'desc' },
  });
  if (!published) {
    return { rules: defaultPolicyRules(), skipBelow: null };
  }
  if (!Array.isArray(published.rulesJson)) {
    throw new DomainError('POLICY_INVALID', '已发布制度不是规则列表');
  }
  return {
    rules: published.rulesJson as object[],
    skipBelow: published.skipManagerBelowFen === null ? null : parseFen(published.skipManagerBelowFen.toString()),
  };
}

export async function deskForAmount(tx: Tx, amount: Fen, currency: string): Promise<'manager' | 'finance'> {
  const policy = await publishedPolicy(tx);
  return deskForCurrency(currency, amount, policy.skipBelow);
}

export async function enforceSubmitControls(
  tx: Tx,
  input: {
    reportId: string;
    employeeId: string;
    company: { name: string; taxId: string };
    amount: Fen;
    currency: string;
    applicationId: string | null;
    budgetLineId: string | null;
    invoices: readonly {
      lineAmountFen: bigint;
      amountFen: bigint | null;
      buyerName: string;
      buyerTaxId: string;
      invoiceDate: string;
    }[];
    today: string;
  },
): Promise<Finding[]> {
  await tx.$queryRaw`SELECT id FROM loans WHERE employee_id = ${input.employeeId} ORDER BY id FOR UPDATE`;
  const loans = await tx.loan.findMany({ where: { employeeId: input.employeeId } });
  assertNoOverdue(
    loans.map((loan) => ({
      status: loan.status as LoanStatus,
      dueOn: loan.dueOn,
      balance: parseFen(loan.balanceFen.toString()),
    })),
    input.today,
  );
  const planned = await tx.loanWriteOff.findMany({ where: { reportId: input.reportId, status: 'planned' } });
  assertWriteOffWithinReport(
    input.amount,
    planned.map((item) => parseFen(item.amountFen.toString())),
  );
  for (const item of planned) {
    const loan = loans.find((row) => row.id === item.loanId);
    if (!loan || loan.status !== 'outstanding') {
      throw new DomainError('WRITE_OFF_EXCEEDS_BALANCE', '只能冲销未结清的借款');
    }
    const next = writeOffLoan(parseFen(loan.balanceFen.toString()), parseFen(item.amountFen.toString()));
    loan.balanceFen = BigInt(next.toString());
    const status = loanStatusAfterBalance(next);
    const updated = await tx.loan.updateMany({
      where: { id: loan.id, version: loan.version },
      data: { balanceFen: next, status: status === 'settled' ? 'settled' : loan.status, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new DomainError('VERSION_CONFLICT', '借款已被其他人更新');
    }
    loan.version += 1;
    await tx.loanWriteOff.update({ where: { id: item.id }, data: { status: 'applied' } });
  }
  if (input.applicationId) {
    await tx.$queryRaw`SELECT id FROM applications WHERE id = ${input.applicationId} FOR UPDATE`;
    const application = await tx.application.findUnique({ where: { id: input.applicationId } });
    if (!application || application.employeeId !== input.employeeId || (application.status !== 'approved' && application.status !== 'closed')) {
      throw new DomainError('QUOTA_EXCEEDED', '只能占用自己已批准的申请');
    }
    if (application.status === 'closed') {
      throw new DomainError('QUOTA_EXCEEDED', '报销金额超过申请剩余额度');
    }
    const consumed = occupyQuota(
      parseFen(application.amountFen.toString()),
      parseFen(application.consumedFen.toString()),
      input.amount,
    );
    const updated = await tx.application.updateMany({
      where: { id: application.id, version: application.version },
      data: {
        consumedFen: consumed,
        status: consumed === application.amountFen ? 'closed' : application.status,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new DomainError('VERSION_CONFLICT', '申请单已被其他人更新');
    }
  }
  if (input.budgetLineId) {
    const line = await lockBudget(tx, input.budgetLineId);
    const next = reserveBudget(snapshot(line), input.amount);
    await saveBudget(tx, line, next);
    await tx.budgetHold.create({
      data: {
        id: uuidv7(),
        budgetLineId: line.id,
        reportId: input.reportId,
        amountFen: input.amount,
        status: 'reserved',
      },
    });
  }
  const findings: Finding[] = [];
  let oldest = -1;
  let crossYear = false;
  for (const invoice of input.invoices) {
    if (!invoice.buyerName.trim() || !invoice.buyerTaxId.trim()) {
      findings.push({ level: 'block', code: 'BUYER_REQUIRED', message: '请填写购买方名称和税号' });
    }
    if (!invoice.invoiceDate.trim()) {
      findings.push({ level: 'block', code: 'INVOICE_DATE_REQUIRED', message: '请填写开票日期' });
    }
    const buyer = matchBuyer(input.company, invoice);
    if (buyer) {
      findings.push(buyer);
    }
    if (invoice.amountFen !== null) {
      findings.push(matchInvoiceAmount(parseFen(invoice.lineAmountFen.toString()), parseFen(invoice.amountFen.toString())));
    }
    const age = invoiceAgeDays(invoice.invoiceDate, input.today);
    if (age > oldest) {
      oldest = age;
    }
    crossYear = crossYear || crossesYear(invoice.invoiceDate, input.today);
  }
  const policy = await publishedPolicy(tx);
  const ruled = await evaluatePolicyRules(policy.rules, {
    amountFen: input.currency === 'CNY' ? input.amount.toString() : '0',
    crossYear,
    invoiceAgeDays: oldest,
  });
  findings.push(...ruled);
  return assertFindingsAllowSubmit(findings);
}

export async function releaseExcessWriteOff(tx: Tx, reportId: string, approved: Fen): Promise<void> {
  const rows = await tx.loanWriteOff.findMany({
    where: { reportId, status: 'applied' },
    orderBy: { createdAt: 'desc' },
  });
  let total = 0n;
  for (const row of rows) {
    total += row.amountFen;
  }
  if (compareFen(total as Fen, approved) <= 0) {
    return;
  }
  let excess = ((total as Fen) - approved) as Fen;
  for (const row of rows) {
    if (compareFen(excess, parseFen('0')) <= 0) {
      break;
    }
    const amount = parseFen(row.amountFen.toString());
    const giveBack = compareFen(excess, amount) < 0 ? excess : amount;
    await tx.$queryRaw`SELECT id FROM loans WHERE id = ${row.loanId} FOR UPDATE`;
    const loan = await tx.loan.findUnique({ where: { id: row.loanId } });
    if (!loan) {
      continue;
    }
    const balance = (parseFen(loan.balanceFen.toString()) + giveBack) as Fen;
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        balanceFen: balance,
        status: compareFen(balance, parseFen('0')) === 0 ? 'settled' : 'outstanding',
        version: { increment: 1 },
      },
    });
    const remain = (amount - giveBack) as Fen;
    await tx.loanWriteOff.update({
      where: { id: row.id },
      data: compareFen(remain, parseFen('0')) === 0 ? { status: 'reversed', amountFen: 0n } : { amountFen: remain },
    });
    excess = (excess - giveBack) as Fen;
  }
}

export async function releaseReportControls(tx: Tx, reportId: string): Promise<void> {
  const report = await tx.expenseReport.findUnique({ where: { id: reportId } });
  if (!report) {
    return;
  }
  const applied = await tx.loanWriteOff.findMany({ where: { reportId, status: 'applied' } });
  for (const item of applied) {
    await tx.$queryRaw`SELECT id FROM loans WHERE id = ${item.loanId} FOR UPDATE`;
    const loan = await tx.loan.findUnique({ where: { id: item.loanId } });
    if (!loan) {
      continue;
    }
    const balance = (parseFen(loan.balanceFen.toString()) + parseFen(item.amountFen.toString())) as Fen;
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        balanceFen: balance,
        status: loan.status === 'settled' ? 'outstanding' : loan.status,
        version: { increment: 1 },
      },
    });
    await tx.loanWriteOff.update({ where: { id: item.id }, data: { status: 'reversed' } });
  }
  if (report.applicationId) {
    await tx.$queryRaw`SELECT id FROM applications WHERE id = ${report.applicationId} FOR UPDATE`;
    const application = await tx.application.findUnique({ where: { id: report.applicationId } });
    if (application) {
      const consumed = releaseQuota(parseFen(application.consumedFen.toString()), parseFen(report.amountFen.toString()));
      await tx.application.update({
        where: { id: application.id },
        data: {
          consumedFen: consumed,
          status: application.status === 'closed' ? 'approved' : application.status,
          version: { increment: 1 },
        },
      });
    }
  }
  const hold = await tx.budgetHold.findFirst({ where: { reportId, status: 'reserved' } });
  if (hold) {
    const line = await lockBudget(tx, hold.budgetLineId);
    const next = releaseBudget(snapshot(line), parseFen(hold.amountFen.toString()));
    await saveBudget(tx, line, next);
    await tx.budgetHold.update({ where: { id: hold.id }, data: { status: 'released' } });
  }
}

export async function consumeReportBudget(tx: Tx, reportId: string): Promise<void> {
  const hold = await tx.budgetHold.findFirst({ where: { reportId, status: 'reserved' } });
  if (!hold) {
    return;
  }
  await consumeHold(tx, hold.id, hold.budgetLineId, parseFen(hold.amountFen.toString()));
}

export async function reserveCorporateBudget(tx: Tx, billId: string, budgetLineId: string, amount: Fen): Promise<void> {
  const line = await lockBudget(tx, budgetLineId);
  const next = reserveBudget(snapshot(line), amount);
  await saveBudget(tx, line, next);
  await tx.budgetHold.create({
    data: { id: uuidv7(), budgetLineId, corporateBillId: billId, amountFen: amount, status: 'reserved' },
  });
}

export async function releaseCorporateBudget(tx: Tx, billId: string): Promise<void> {
  const hold = await tx.budgetHold.findFirst({ where: { corporateBillId: billId, status: 'reserved' } });
  if (!hold) {
    return;
  }
  const line = await lockBudget(tx, hold.budgetLineId);
  const next = releaseBudget(snapshot(line), parseFen(hold.amountFen.toString()));
  await saveBudget(tx, line, next);
  await tx.budgetHold.update({ where: { id: hold.id }, data: { status: 'released' } });
}

export async function consumeCorporateBudget(tx: Tx, billId: string): Promise<void> {
  const hold = await tx.budgetHold.findFirst({ where: { corporateBillId: billId, status: 'reserved' } });
  if (!hold) {
    return;
  }
  await consumeHold(tx, hold.id, hold.budgetLineId, parseFen(hold.amountFen.toString()));
}

async function consumeHold(tx: Tx, holdId: string, budgetLineId: string, amount: Fen): Promise<void> {
  const line = await lockBudget(tx, budgetLineId);
  const next = consumeBudget(snapshot(line), amount);
  await saveBudget(tx, line, next);
  await tx.budgetHold.update({ where: { id: holdId }, data: { status: 'consumed' } });
}

export async function retargetReportBudget(tx: Tx, reportId: string, from: Fen, to: Fen): Promise<void> {
  if (from === to) {
    return;
  }
  const hold = await tx.budgetHold.findFirst({ where: { reportId, status: 'reserved' } });
  if (!hold) {
    return;
  }
  const line = await lockBudget(tx, hold.budgetLineId);
  const next = retargetReservation(snapshot(line), from, to);
  await saveBudget(tx, line, next);
  await tx.budgetHold.update({ where: { id: hold.id }, data: { amountFen: to } });
}

async function lockBudget(tx: Tx, budgetLineId: string): Promise<LockedBudget> {
  await tx.$queryRaw`SELECT id FROM budget_lines WHERE id = ${budgetLineId} FOR UPDATE`;
  const line = await tx.budgetLine.findUnique({ where: { id: budgetLineId } });
  if (!line) {
    throw new DomainError('BUDGET_EXCEEDED', '预算行不存在');
  }
  return line;
}

function snapshot(line: LockedBudget) {
  return {
    amount: parseFen(line.amountFen.toString()),
    reserved: parseFen(line.reservedFen.toString()),
    consumed: parseFen(line.consumedFen.toString()),
  };
}

async function saveBudget(
  tx: Tx,
  line: LockedBudget,
  next: { amount: Fen; reserved: Fen; consumed: Fen },
): Promise<void> {
  const updated = await tx.budgetLine.updateMany({
    where: { id: line.id, version: line.version },
    data: { reservedFen: next.reserved, consumedFen: next.consumed, version: { increment: 1 } },
  });
  if (updated.count !== 1) {
    throw new DomainError('VERSION_CONFLICT', '预算已被其他人更新');
  }
  line.version += 1;
  line.reservedFen = BigInt(next.reserved.toString());
  line.consumedFen = BigInt(next.consumed.toString());
}
