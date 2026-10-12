import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFen } from '@frs/domain';
import { buildLedgerWorkbook, ledgerColumns } from './ledger-workbook';
import { defaultPolicyRules, evaluatePolicyRules } from './policy-engine';
import { mapTravelOrder } from './travel-order';
import { decideVatVerify } from './tencent-vat-invoice-verify';
import { buildVoucherPayload } from './voucher-export';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(process.cwd(), 'fixtures', name), 'utf8'));
}

describe('外部能力只做映射', () => {
  it('强控规则阻断大额，弱控只留下警告', async () => {
    const rules = defaultPolicyRules();
    const blocked = await evaluatePolicyRules(rules, { amountFen: '500001', crossYear: false, invoiceAgeDays: -1 });
    expect(blocked.some((item) => item.level === 'block')).toBe(true);
    const warned = await evaluatePolicyRules(rules, { amountFen: '100001', crossYear: false, invoiceAgeDays: -1 });
    expect(warned.map((item) => item.level)).toEqual(['warn']);
    const clean = await evaluatePolicyRules(rules, { amountFen: '3000', crossYear: false, invoiceAgeDays: -1 });
    expect(clean).toEqual([]);
  });

  it('查验样例对上号码才算通过', () => {
    const sample = fixture('vat-invoice-verify-sample.json') as Parameters<typeof decideVatVerify>[0];
    expect(decideVatVerify(sample, '10001').status).toBe('verified');
    expect(decideVatVerify(sample, '10002').status).toBe('failed');
    expect(decideVatVerify(null, '10001').status).toBe('failed');
  });

  it('商旅样例换成费用草稿', () => {
    expect(mapTravelOrder('ctrip', fixture('ctrip-order-sample.json')).amountFen).toBe('128000');
    expect(mapTravelOrder('didi', fixture('didi-order-sample.json')).externalId).toBe('DD202610100009');
  });

  it('凭证报文借贷相等，金额是元的文本', () => {
    const payload = buildVoucherPayload({
      reportId: 'report-1',
      status: 'paid',
      paidOn: '2026-10-10',
      amount: parseFen('2500'),
      explanation: '差旅',
    });
    expect(payload.lines[0]?.debitYuan).toBe('25.00');
    expect(payload.lines[1]?.creditYuan).toBe('25.00');
    expect(payload.formId).toBe('GL_VOUCHER');
  });

  it('台账工作簿包含约定的列', async () => {
    const buffer = await buildLedgerWorkbook([
      {
        invoiceCode: '011',
        invoiceNumber: '10001',
        amountFen: '3000',
        sellerName: '商店',
        invoiceDate: '2026-10-01',
        verificationStatus: 'unverified',
        ledgerStatus: 'open',
        reportId: '',
      },
    ]);
    expect(buffer.subarray(0, 2).toString('utf8')).toBe('PK');
    expect(ledgerColumns.map((column) => column.header)).toContain('价税合计（元）');
  }, 30_000);
});
