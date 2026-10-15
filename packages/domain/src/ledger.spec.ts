import { describe, expect, it } from 'vitest';
import { assertLedgerOpen, draftFromVatPairs, invoiceTextFromGlyphs, ledgerBucket, pairsFromInvoiceText } from './invoice';

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
      buyerName: '',
      buyerTaxId: '',
      invoiceDate: '2024-03-07',
    });
  });

  it('从票面文字自己对应发票号码、金额、日期、销售方和购买方', () => {
    const draft = draftFromVatPairs(
      pairsFromInvoiceText(`
        电子发票（普通发票）
        发票号码：26112000000706612096
        开票日期：2024年3月7日
        购买方
        名称：示例公司
        纳税人识别号：91330100example001
        销售方
        名称：示例餐饮店
        价税合计（小写） ¥1,234.50
      `),
    );
    expect(draft).toEqual({
      invoiceCode: '',
      invoiceNumber: '26112000000706612096',
      amountFen: '123450',
      sellerName: '示例餐饮店',
      buyerName: '示例公司',
      buyerTaxId: '91330100EXAMPLE001',
      invoiceDate: '2024-03-07',
    });
  });

  it('左右两列时不把购买方名称当成销售方', () => {
    const draft = draftFromVatPairs(
      pairsFromInvoiceText(`
        购买方信息 销售方信息
        名称：示例公司 名称：示例餐饮店
        纳税人识别号：91330100example001 纳税人识别号：91310000seller0001
        价税合计（小写） ¥18.00
      `),
    );
    expect(draft.buyerName).toBe('示例公司');
    expect(draft.sellerName).toBe('示例餐饮店');
    expect(draft.buyerTaxId).toBe('91330100EXAMPLE001');
  });

  it('竖排购销标签时按同一行的两个名称区分购买方和销售方', () => {
    const text = invoiceTextFromGlyphs([
      { str: '购', x: 17, y: 296 },
      { str: '销', x: 302, y: 296 },
      { str: '名称：', x: 33, y: 293 },
      { str: '卫群（北京）生命科技有限公司', x: 57, y: 293 },
      { str: '名称：', x: 318, y: 293 },
      { str: '窦文铎', x: 340, y: 293 },
      { str: '统一社会信用代码/纳税人识别号：', x: 33, y: 264 },
      { str: '91110400MAEY1WXC4R', x: 153, y: 263 },
      { str: '统一社会信用代码/纳税人识别号：', x: 317, y: 264 },
      { str: '150104200502220610', x: 438, y: 263 },
      { str: '价税合计（小写）', x: 48, y: 109 },
      { str: '¥3600.00', x: 441, y: 111 },
    ]);
    const draft = draftFromVatPairs(pairsFromInvoiceText(text));
    expect(draft.buyerName).toBe('卫群（北京）生命科技有限公司');
    expect(draft.sellerName).toBe('窦文铎');
    expect(draft.buyerTaxId).toBe('91110400MAEY1WXC4R');
  });
  it('金额无法解析时留空，不把识别结果当成已入账', () => {
    const draft = draftFromVatPairs([{ name: '发票号码', value: '99' }, { name: '小写金额', value: '见备注' }]);
    expect(draft.invoiceNumber).toBe('99');
    expect(draft.amountFen).toBeNull();
  });
});
