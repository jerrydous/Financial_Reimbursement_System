import { describe, expect, it } from 'vitest';
import {
  actorForAction,
  applyFinanceAdjustment,
  assertActor,
  assertPaidAmountStable,
  assertReportMatchesLines,
  expenseReportTransitions,
  nextActorAfter,
  normalizeIdempotencyKey,
  transitionExpenseReport,
} from './expense-report';
import { parseFen } from './money';

const assignment = { ownerId: 'owner', currentActorId: 'manager' };

describe('报销单状态机', () => {
  it('单线走到支付，驳回后可以改回草稿再提交', () => {
    let status = transitionExpenseReport('draft', 'submit');
    status = transitionExpenseReport(status, 'start_approval');
    status = transitionExpenseReport(status, 'approve');
    status = transitionExpenseReport(status, 'finance_approve');
    status = transitionExpenseReport(status, 'pay_success');
    expect(status).toBe('paid');

    const rejected = transitionExpenseReport('approving', 'reject');
    expect(transitionExpenseReport(rejected, 'revise')).toBe('draft');
    expect(transitionExpenseReport('draft', 'submit')).toBe('submitted');
  });

  it('主管通过前可以撤回，财务审核开始后不能撤回', () => {
    expect(transitionExpenseReport('approving', 'withdraw')).toBe('withdrawn');
    expect(() => transitionExpenseReport('finance_review', 'withdraw')).toThrow(/不能从财务审核执行撤回/);
    expect(() => transitionExpenseReport('paid', 'finance_adjust')).toThrow(/不能从已支付执行修改批准金额/);
  });

  it('转交留在当前步骤，不增加审批层级', () => {
    const transfer = expenseReportTransitions.find((item) => item.action === 'transfer' && item.from === 'approving');
    expect(transfer?.to).toBe('approving');
    expect(
      nextActorAfter('transfer', 'manager', {
        managerId: 'manager',
        financeId: 'finance',
        cashierId: 'cashier',
        transferToEmployeeId: 'other',
      }),
    ).toBe('other');
  });

  it('财务才能改批准金额，支付成功后金额锁定', () => {
    const approved = applyFinanceAdjustment('finance_review', parseFen('100'), parseFen('80'));
    expect(approved).toBe(80n);
    expect(() => applyFinanceAdjustment('paying', parseFen('80'), parseFen('70'))).toThrow(/不能从待支付/);
    expect(() =>
      actorForAction('paid', 'finance_adjust', { ownerId: 'owner', currentActorId: null }),
    ).toThrow(/不能从已支付/);
    expect(() => assertPaidAmountStable('paid', parseFen('80'), parseFen('70'))).toThrow(/支付成功后/);
    assertPaidAmountStable('finance_review', parseFen('100'), parseFen('80'));
  });

  it('报销单金额必须等于费用行，操作者必须是当前步骤的人', () => {
    assertReportMatchesLines(parseFen('30'), [parseFen('10'), parseFen('20')]);
    expect(() => assertReportMatchesLines(parseFen('30'), [parseFen('10')])).toThrow(/费用行合计/);
    expect(actorForAction('approving', 'approve', assignment)).toBe('manager');
    expect(() => assertActor('manager', 'employee')).toThrow(/不能执行/);
  });

  it('提交和支付必须带幂等键', () => {
    expect(normalizeIdempotencyKey(' same ')).toBe('same');
    expect(() => normalizeIdempotencyKey(undefined)).toThrow(/Idempotency-Key/);
    expect(() => normalizeIdempotencyKey('  ')).toThrow(/Idempotency-Key/);
  });
});
