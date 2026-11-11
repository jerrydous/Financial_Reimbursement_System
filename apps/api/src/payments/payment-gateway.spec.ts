import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HttpPaymentGateway, validateResult, verifyCallback } from './payment-gateway';
const input = { id: 'order-1', reportId: 'report-1', employeeId: 'employee-1', amountFen: '3000', currency: 'CNY' };
describe('payment gateway safety', () => {
  it('rejects missing configuration', () => { expect(() => new HttpPaymentGateway('', '')).toThrow(); });
  it('rejects plaintext production gateways', () => { expect(() => new HttpPaymentGateway('http://bank.example', 'test')).toThrow(); });
  it.each(['id', 'amountFen', 'currency', 'status', 'reference'])('rejects mismatched %s', key => {
    expect(() => validateResult({ ...input, status: 'succeeded', reference: 'bank-1', [key]: key === 'reference' ? '' : 'invalid' }, input)).toThrow();
  });
  it('accepts bound response', () => {
    expect(validateResult({ ...input, status: 'succeeded', reference: 'bank-1' }, input).status).toBe('succeeded');
  });
  it('checks signatures, tampering and expiry', () => {
    const raw = Buffer.from('{"id":"order-1"}'), ts = '1794294000', secret = 'x'.repeat(32);
    const sig = createHmac('sha256', secret).update(ts + '.').update(raw).digest('hex');
    expect(verifyCallback(raw, ts, sig, secret, Number(ts) * 1000)).toBe(true);
    expect(verifyCallback(Buffer.from('{}'), ts, sig, secret, Number(ts) * 1000)).toBe(false);
    expect(verifyCallback(raw, ts, sig, secret, Number(ts) * 1000 + 300001)).toBe(false);
    expect(verifyCallback(raw, ts, 'bad', secret)).toBe(false);
  });
  it('uses stable idempotency key and query without posting', async () => {
    const calls: any[] = [];
    const gateway = new HttpPaymentGateway('https://bank.example', 'test-token', (async (...args: any[]) => {
      calls.push(args); return new Response(JSON.stringify({ ...input, status: 'succeeded', reference: 'bank-1' }));
    }) as typeof fetch);
    await gateway.submit(input); await gateway.query(input);
    expect(calls[0][1].headers['idempotency-key']).toBe(input.id);
    expect(calls[0][1].method).toBe('POST'); expect(calls[1][1].method).toBe('GET');
  });
});
