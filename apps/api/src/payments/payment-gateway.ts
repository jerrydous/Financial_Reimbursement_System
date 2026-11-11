import { createHmac, timingSafeEqual } from 'node:crypto';

export type PayoutRequest = { id: string; reportId: string; employeeId: string; amountFen: string; currency: string };
export type PayoutResult = { id: string; amountFen: string; currency: string; status: 'processing' | 'succeeded' | 'failed'; reference: string };
export interface PaymentGateway {
  submit(input: PayoutRequest): Promise<PayoutResult>;
  query(input: PayoutRequest): Promise<PayoutResult>;
}
export function validateResult(value: unknown, input: PayoutRequest): PayoutResult {
  const v = value as Partial<PayoutResult> | null;
  if (!v || v.id !== input.id || v.amountFen !== input.amountFen || v.currency !== input.currency ||
      !['processing', 'succeeded', 'failed'].includes(v.status ?? '') || typeof v.reference !== 'string' || !v.reference.trim()) {
    throw new Error('PAYMENT_RESPONSE_INVALID');
  }
  return v as PayoutResult;
}
export class HttpPaymentGateway implements PaymentGateway {
  constructor(private readonly url: string, private readonly token: string, private readonly transport: typeof fetch = fetch) {
    if (!url || !token) throw new Error('PAYMENT_NOT_CONFIGURED');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && parsed.hostname === '127.0.0.1')) {
      throw new Error('PAYMENT_HTTPS_REQUIRED');
    }
  }
  private async request(input: PayoutRequest, query: boolean): Promise<PayoutResult> {
    const response = await this.transport(`${this.url.replace(/\/$/, '')}/payouts${query ? `/${encodeURIComponent(input.id)}` : ''}`, {
      method: query ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', 'idempotency-key': input.id },
      ...(query ? {} : { body: JSON.stringify(input) }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('PAYMENT_GATEWAY_UNAVAILABLE');
    return validateResult(await response.json(), input);
  }
  submit(input: PayoutRequest) { return this.request(input, false); }
  query(input: PayoutRequest) { return this.request(input, true); }
}
export function verifyCallback(raw: Buffer, timestamp: string | undefined, signature: string | undefined, secret: string, now = Date.now()): boolean {
  if (!secret || secret.length < 32 || !timestamp || !/^\d{10}$/.test(timestamp) || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(now - Number(timestamp) * 1000) > 300000) return false;
  const expected = createHmac('sha256', secret).update(timestamp).update('.').update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
