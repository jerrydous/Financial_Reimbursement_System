import { describe, expect, it } from 'vitest';
import { occupyQuota, releaseQuota, remainingQuota, transitionApplication } from './application';
import { allocateByWeights } from './allocation';
import { assertDelegate, assertWithdrawBeforeApproval, deskForCurrency, foldVotes, mayVote, nextDesk } from './approval-plan';
import { consumeBudget, releaseBudget, reserveBudget, retargetReservation } from './budget';
import { assertFindingsAllowSubmit, crossesYear, invoiceAgeDays, matchBuyer, matchInvoiceAmount } from './compliance';
import { applyInstallmentPayment, contractCanClose, transitionContract } from './corporate';
import { assertNoOverdue, assertWriteOffWithinReport, loanStatusAfterBalance, transitionLoan, writeOffLoan } from './loan';
import { parseFen } from './money';
import { subsidyAmount } from './subsidy';
import { expenseDraftFromTravel } from './travel-draft';
import { verificationFromOfficial } from './invoice-verify';
import { voucherFromPaidReport } from './voucher-draft';
import { nextActorAfter, transitionExpenseReport } from './expense-report';

const fen = (value: string) => parseFen(value);

describe('费控、审批、预算和发票不变量', () => {
  it('超额度不能占用，释放不能超过已占用', () => {
    expect(remainingQuota(fen('1000'), fen('400')).toString()).toBe('600');
    expect(occupyQuota(fen('1000'), fen('400'), fen('600')).toString()).toBe('1000');
    expect(() => occupyQuota(fen('1000'), fen('400'), fen('601'))).toThrow(/剩余额度/);
    expect(releaseQuota(fen('600'), fen('600')).toString()).toBe('0');
    expect(() => releaseQuota(fen('100'), fen('101'))).toThrow(/已占用/);
    expect(transitionApplication('approved', 'close')).toBe('closed');
    expect(transitionApplication('approving', 'reject')).toBe('rejected');
  });

  it('或签一人通过即前进，会签必须全员通过，有人通过后不能撤回', () => {
    expect(foldVotes('any', ['approved', 'pending'])).toBe('approved');
    expect(foldVotes('any', ['rejected', 'pending'])).toBe('pending');
    expect(foldVotes('any', ['rejected', 'rejected'])).toBe('rejected');
    expect(foldVotes('all', ['approved', 'pending'])).toBe('pending');
    expect(foldVotes('all', ['approved', 'approved'])).toBe('approved');
    expect(foldVotes('all', ['approved', 'rejected'])).toBe('rejected');
    assertWithdrawBeforeApproval(0);
    expect(() => assertWithdrawBeforeApproval(1)).toThrow(/不能撤回/);
  });

  it('代理期间代理人可以操作，原审批人不能操作', () => {
    assertDelegate('principal', 'agent', { agentId: 'agent', active: true });
    expect(() => assertDelegate('principal', 'principal', { agentId: 'agent', active: true })).toThrow(/原审批人/);
    assertDelegate('principal', 'principal', null);
    expect(mayVote({ mode: 'all', actorId: 'agent', principals: ['principal'], proxies: [{ principalId: 'principal', agentId: 'agent' }] })).toBe(
      'principal',
    );
    expect(() =>
      mayVote({ mode: 'all', actorId: 'principal', principals: ['principal'], proxies: [{ principalId: 'principal', agentId: 'agent' }] }),
    ).toThrow(/原审批人/);
  });

  it('金额不超过阈值时跳过主管', () => {
    expect(nextDesk(fen('100'), null)).toBe('manager');
    expect(nextDesk(fen('100'), fen('100'))).toBe('finance');
    expect(nextDesk(fen('101'), fen('100'))).toBe('manager');
    expect(deskForCurrency('CNY', fen('100'), fen('100'))).toBe('finance');
    expect(deskForCurrency('USD', fen('100'), fen('100'))).toBe('manager');
    expect(deskForCurrency('JPY', fen('100'), fen('100'))).toBe('manager');
    expect(transitionExpenseReport('submitted', 'skip_to_finance')).toBe('finance_review');
    expect(
      nextActorAfter('skip_to_finance', null, {
        managerId: 'manager',
        financeId: 'finance',
        cashierId: 'cashier',
        transferToEmployeeId: null,
      }),
    ).toBe('finance');
  });

  it('分摊尾差进金额最大的一行，合计仍等于总额', () => {
    expect(allocateByWeights(fen('100'), [fen('1'), fen('1'), fen('1')]).map(String)).toEqual(['34', '33', '33']);
    expect(allocateByWeights(fen('10'), [fen('1'), fen('3')]).map(String)).toEqual(['2', '8']);
    expect(() => allocateByWeights(fen('10'), [fen('0')])).toThrow(/权重必须大于/);
  });

  it('预算冻结、释放和转消耗不能变成负数', () => {
    const line = { amount: fen('100'), reserved: fen('0'), consumed: fen('0') };
    const reserved = reserveBudget(line, fen('60'));
    expect(reserved.reserved.toString()).toBe('60');
    expect(() => reserveBudget(reserved, fen('41'))).toThrow(/超过可用/);
    const consumed = consumeBudget(reserved, fen('60'));
    expect(consumed.reserved.toString()).toBe('0');
    expect(consumed.consumed.toString()).toBe('60');
    const released = releaseBudget(reserved, fen('20'));
    expect(released.reserved.toString()).toBe('40');
    expect(retargetReservation(reserved, fen('60'), fen('50')).reserved.toString()).toBe('50');
  });

  it('冲销不超过借款余额，逾期未还不能提交', () => {
    expect(writeOffLoan(fen('500'), fen('200')).toString()).toBe('300');
    expect(() => assertWriteOffWithinReport(fen('100'), [fen('80'), fen('30')])).toThrow(/不能超过本次报销/);
    expect(() => writeOffLoan(fen('500'), fen('501'))).toThrow(/借款余额/);
    expect(loanStatusAfterBalance(fen('0'))).toBe('settled');
    expect(transitionLoan('approving', 'approve')).toBe('outstanding');
    expect(() =>
      assertNoOverdue([{ status: 'outstanding', dueOn: '2026-01-01', balance: fen('1') }], '2026-10-10'),
    ).toThrow(/逾期未还/);
    assertNoOverdue([{ status: 'outstanding', dueOn: '2026-12-01', balance: fen('1') }], '2026-10-10');
  });

  it('补贴按日标准乘天数，弱控留下警告，强控阻断', () => {
    expect(subsidyAmount(fen('10000'), 3).toString()).toBe('30000');
    expect(() => subsidyAmount(fen('10000'), 1.5)).toThrow(/整数/);
    const warnings = assertFindingsAllowSubmit([{ level: 'warn', code: 'OVER', message: '超标' }]);
    expect(warnings).toHaveLength(1);
    expect(() => assertFindingsAllowSubmit([{ level: 'block', code: 'HARD', message: '不能提交' }])).toThrow(/不能提交/);
  });

  it('抬头不符阻断，空抬头不比对，跨年和天数可计算', () => {
    expect(matchBuyer({ name: '示例公司', taxId: '9133' }, { buyerName: '', buyerTaxId: '' })).toBeNull();
    expect(matchBuyer({ name: '示例公司', taxId: '9133' }, { buyerName: '别的公司', buyerTaxId: '9133' })?.level).toBe('block');
    expect(matchInvoiceAmount(fen('10'), fen('10')).level).toBe('pass');
    expect(matchInvoiceAmount(fen('10'), fen('11')).code).toBe('AMOUNT_MISMATCH');
    expect(invoiceAgeDays('2026-10-01', '2026-10-10')).toBe(9);
    expect(invoiceAgeDays('', '2026-10-10')).toBe(-1);
    expect(crossesYear('2025-12-31', '2026-01-01')).toBe(true);
    expect(crossesYear('', '2026-01-01')).toBe(false);
  });

  it('分期付款不能超过本期应付，付清后合同可以关闭', () => {
    expect(applyInstallmentPayment(fen('100'), fen('40'), fen('60'))).toEqual({ paid: 100n, status: 'paid' });
    expect(() => applyInstallmentPayment(fen('100'), fen('40'), fen('61'))).toThrow(/本期应付/);
    expect(contractCanClose([{ status: 'paid' }, { status: 'paid' }])).toBe(true);
    expect(contractCanClose([{ status: 'partial' }])).toBe(false);
    expect(transitionContract('draft', 'activate')).toBe('active');
  });

  it('查验没有对上号码时不能标成通过，凭证只给已支付单据', () => {
    expect(verificationFromOfficial(null, '10001').status).toBe('failed');
    expect(verificationFromOfficial({ invoiceNumber: '10002', buyerName: '甲', buyerTaxId: '1' }, '10001').status).toBe('failed');
    const passed = verificationFromOfficial({ invoiceNumber: '10001', buyerName: '甲', buyerTaxId: '1' }, '10001');
    expect(passed.status).toBe('verified');
    expect(passed.buyerTaxId).toBe('1');
    expect(() =>
      voucherFromPaidReport({ reportId: 'r', status: 'paying', paidOn: '2026-10-10', amount: fen('100'), explanation: '报销' }),
    ).toThrow(/已支付/);
    const voucher = voucherFromPaidReport({
      reportId: 'r',
      status: 'paid',
      paidOn: '2026-10-10',
      amount: fen('100'),
      explanation: '报销',
    });
    expect(voucher.lines.map((line) => line.debitYuan)).toEqual(['1.00', '0.00']);
    const yen = voucherFromPaidReport({
      reportId: 'r',
      status: 'paid',
      paidOn: '2026-10-10',
      amount: fen('1200'),
      currency: 'JPY',
      explanation: '报销',
    });
    expect(yen.lines[0]?.debitYuan).toBe('1200');
    expect(voucher.lines.map((line) => line.creditYuan)).toEqual(['0.00', '1.00']);
  });

  it('商旅订单金额按元文本换算成分', () => {
    expect(
      expenseDraftFromTravel('ctrip', { OrderID: 'C1', Amount: '12.30', OrderDate: '2026-10-01', ProductName: '机票' }).amountFen,
    ).toBe('1230');
    expect(
      expenseDraftFromTravel('didi', { order_id: 'D1', total_fee: '8.50', create_time: '2026-10-02 09:00', product_name: '快车' }).occurredOn,
    ).toBe('2026-10-02');
    expect(() => expenseDraftFromTravel('ctrip', { OrderID: 'C1', Amount: '12.3', OrderDate: '2026-10-01', ProductName: '机票' })).toThrow(
      /两位小数/,
    );
  });
});
