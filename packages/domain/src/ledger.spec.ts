import { describe, expect, it } from 'vitest';
import { assertLedgerOpen, draftFromVatPairs, ledgerBucket } from './invoice';

describe('发票分类', () => {
  it('占用中的发票归入已报销，其余按台账状态分类', () => {
    expect(ledgerBucket({ ledgerStatus: 'open', binding: 'released' })).toBe('unreimbursed');
    expect(ledgerBucket({ ledgerStatus: 'open', binding: 'active' })).toBe('reimbursed');
    expect(ledgerBucket({ ledgerStatus: 'exempt', binding: 'released' })).toBe('exempt');
    expect(ledgerBucket({ ledgerStatus: 'removed', binding: 'released' })).toBe('removed');
    expect(ledgerBucket({ ledgerStatus: 'transferred', binding: 'released' })).toBe('transferred');
    expect(ledgerBucket({ ledgerStatus: 'exempt', binding: 'active' })).toBe('reimbursed');
  });

  it('只有未报销的发票可以再改分类', () => {
    expect(() => assertLedgerOpen('removed')).toThrow(/未报销/);
    expect(() => assertLedgerOpen('open')).not.toThrow();
  });
});

describe('增值税发票识别草稿', () => {
  it('从第三方字段整理号码、价税合计和日期，金额带符号时也能换成整数分', () => {
    const draft = draftFromVatPairs([
      { name: '发票代码', value: '011001900104' },
      { name: '发票号码', value: '12345678' },
      { name: '价税合计(小写)', value: '¥1,234.50' },
      { name: '销售方名称', value: '示例餐饮店' },
      { name: '开票日期', value: '2024年3月7日' },
      { name: '价税合计(小写)', value: '不要覆盖' },
    ]);
    expect(draft).toEqual({
      invoiceCode: '011001900104',
      invoiceNumber: '12345678',
      amountFen: '123450',
      sellerName: '示例餐饮店',
      invoiceDate: '2024-03-07',
    });
  });

  it('金额无法解析时留空，不把识别结果当成已入账', () => {
    const draft = draftFromVatPairs([{ name: '发票号码', value: '99' }, { name: '小写金额', value: '见备注' }]);
    expect(draft.invoiceNumber).toBe('99');
    expect(draft.amountFen).toBeNull();
  });
});
