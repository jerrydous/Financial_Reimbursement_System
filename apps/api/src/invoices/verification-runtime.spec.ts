import { describe, expect, it } from 'vitest';
import { VerificationNotConfigured } from '@frs/adapters';
import { verifierForSetting } from './verification-runtime';

const fallback = {
  verify: async () => ({ status: 'verified' as const, buyerName: '环境变量', buyerTaxId: '', message: '' }),
};

describe('按公司配置选择查验入口', () => {
  it('没有配置时继续用部署环境里的查验', async () => {
    const decision = await verifierForSetting(null, fallback).verify({
      invoiceCode: '',
      invoiceNumber: '10001',
      invoiceDate: '2026-01-02',
    });
    expect(decision.buyerName).toBe('环境变量');
  });

  it('关闭后不再回退到环境变量', async () => {
    const verifier = verifierForSetting(
      { provider: 'off', baseUrl: '', model: '', region: '', secretId: '', apiKey: '' },
      fallback,
    );
    await expect(verifier.verify({ invoiceCode: '', invoiceNumber: '10001', invoiceDate: '2026-01-02' })).rejects.toBeInstanceOf(
      VerificationNotConfigured,
    );
  });

  it('自定义模型按用户填写的地址查验', async () => {
    const verifier = verifierForSetting(
      {
        provider: 'custom',
        baseUrl: 'https://model.example/v1',
        model: 'demo-model',
        region: '',
        secretId: '',
        apiKey: 'sk-user-key',
      },
      fallback,
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ found: true, invoiceNumber: '10001', buyerName: '甲', buyerTaxId: '915' }) } }],
          }),
          { status: 200 },
        ),
    );
    const decision = await verifier.verify({ invoiceCode: '011', invoiceNumber: '10001', invoiceDate: '2026-01-02', amountYuan: '1.00' });
    expect(decision).toMatchObject({ status: 'verified', buyerName: '甲', buyerTaxId: '915' });
  });
});
