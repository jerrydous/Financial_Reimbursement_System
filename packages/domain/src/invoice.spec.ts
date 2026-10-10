import { describe, expect, it } from 'vitest';
import { parseFen } from './money';
import {
  assertReadyToAttach,
  assertVerificationUnverified,
  bindingAfterReportAction,
  sameActiveInvoiceNumber,
} from './invoice';

describe('发票', () => {
  it('未确认不能进入报销单，验真状态不能写成通过', () => {
    expect(() => assertReadyToAttach('pending_confirmation', parseFen('100'))).toThrow(/人工确认/);
    expect(assertReadyToAttach('confirmed', parseFen('100'))).toBe(100n);
    expect(() => assertVerificationUnverified('verified')).toThrow(/未验真/);
    assertVerificationUnverified('unverified');
  });

  it('同一代码和号码视为同一张有效发票，驳回后绑定释放', () => {
    const left = { tenantId: 'default', invoiceCode: '011', invoiceNumber: '100', fileSha256: 'a' };
    const right = { ...left, fileSha256: 'b' };
    expect(sameActiveInvoiceNumber(left, right)).toBe(true);
    expect(sameActiveInvoiceNumber(left, { ...left, invoiceNumber: '101' })).toBe(false);
    expect(bindingAfterReportAction('submit')).toBe('active');
    expect(bindingAfterReportAction('reject')).toBe('released');
    expect(bindingAfterReportAction('withdraw')).toBe('released');
  });
});