import { describe, expect, it } from 'vitest';
import { CustomModelInvoiceVerify, customVerifyUrl, decisionFromCustomBody, normalizeCustomBaseUrl } from './custom-model-invoice-verify';
import { VerificationTimeout } from './tencent-vat-invoice-verify';

describe('自定义模型查验', () => {
  it('地址只接受 http 或 https，并补上 chat/completions', () => {
    expect(normalizeCustomBaseUrl('https://model.example/v1/')).toBe('https://model.example/v1');
    expect(customVerifyUrl('https://model.example/v1/')).toBe('https://model.example/v1/chat/completions');
    expect(customVerifyUrl('https://model.example/v1/chat/completions')).toBe('https://model.example/v1/chat/completions');
    expect(normalizeCustomBaseUrl('https://model.example/v1?key=secret')).toBeNull();
    expect(normalizeCustomBaseUrl('file:///tmp/model')).toBeNull();
    expect(normalizeCustomBaseUrl('https://user:pass@model.example/v1')).toBeNull();
  });

  it('模型说没查到时，即使号码相同也不通过', () => {
    const decision = decisionFromCustomBody(
      { choices: [{ message: { content: JSON.stringify({ found: false, invoiceNumber: '10001', message: '没有这张票' }) } }] },
      '10001',
    );
    expect(decision.status).toBe('failed');
    expect(decision.message).toBe('没有这张票');
  });

  it('模型查到且号码一致才通过', () => {
    const decision = decisionFromCustomBody(
      {
        choices: [
          {
            message: {
              content: JSON.stringify({ found: true, invoiceNumber: '10001', buyerName: '甲公司', buyerTaxId: '915' }),
            },
          },
        ],
      },
      '10001',
    );
    expect(decision).toMatchObject({ status: 'verified', buyerName: '甲公司', buyerTaxId: '915' });
    expect(decisionFromCustomBody({ found: true, invoiceNumber: '10002', buyerName: '', buyerTaxId: '' }, '10001').status).toBe('failed');
  });

  it('请求带上用户的 API Key，失败文案不把密钥带回', async () => {
    const seen: { url: string; authorization: string }[] = [];
    const verifier = new CustomModelInvoiceVerify(
      { baseUrl: 'https://model.example/v1', model: 'demo-model', apiKey: 'sk-test-secret' },
      async (url, init) => {
        const headers = new Headers(init.headers);
        seen.push({ url, authorization: headers.get('authorization') ?? '' });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ found: false, message: '拒绝 sk-test-secret' }) } }],
          }),
          { status: 200 },
        );
      },
    );
    const decision = await verifier.verify({
      invoiceCode: '011',
      invoiceNumber: '10001',
      invoiceDate: '2026-01-02',
      amountYuan: '10.00',
    });
    expect(seen).toEqual([{ url: 'https://model.example/v1/chat/completions', authorization: 'Bearer sk-test-secret' }]);
    expect(decision.status).toBe('failed');
    expect(decision.message).not.toContain('sk-test-secret');
  });

  it('超时交给上层重试', async () => {
    const verifier = new CustomModelInvoiceVerify({ baseUrl: 'https://model.example/v1', model: 'demo-model', apiKey: 'sk-test-secret' }, async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    });
    await expect(
      verifier.verify({ invoiceCode: '', invoiceNumber: '10001', invoiceDate: '2026-01-02', amountYuan: '1.00' }),
    ).rejects.toBeInstanceOf(VerificationTimeout);
  });
});
