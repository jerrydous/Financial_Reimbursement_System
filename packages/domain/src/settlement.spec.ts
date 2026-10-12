import { describe, expect, it } from 'vitest';
import { parseFen } from './money';
import { allocateByWeight, summarizeSettled } from './settlement';

describe('已结算费用分摊', () => {
  it('按权重分到分，尾差归金额最大的一行', () => {
    const shares = allocateByWeight(parseFen('100'), [parseFen('1'), parseFen('2')]);
    expect(shares.map((share) => share.toString())).toEqual(['33', '67']);
    expect(shares.reduce((sum, share) => sum + share, 0n).toString()).toBe('100');
  });

  it('已支付金额按类别和商家汇总，不同币种不混在一起', () => {
    const summary = summarizeSettled([
      {
        currency: 'CNY',
        amountFen: parseFen('1000'),
        lines: [
          { amountFen: parseFen('600'), category: 'meal', merchant: '美团' },
          { amountFen: parseFen('400'), category: 'transport', merchant: '滴滴' },
        ],
      },
      {
        currency: 'CNY',
        amountFen: parseFen('200'),
        lines: [{ amountFen: parseFen('200'), category: 'meal', merchant: '美团' }],
      },
      {
        currency: 'USD',
        amountFen: parseFen('500'),
        lines: [{ amountFen: parseFen('500'), category: null, merchant: '  ' }],
      },
    ]);
    expect(summary.map((item) => item.currency)).toEqual(['CNY', 'USD']);
    const cny = summary[0];
    expect(cny?.totalFen.toString()).toBe('1200');
    expect(cny?.byCategory.map((slice) => [slice.key, slice.amountFen.toString()])).toEqual([
      ['meal', '800'],
      ['transport', '400'],
    ]);
    expect(cny?.bySource.map((slice) => [slice.key, slice.amountFen.toString()])).toEqual([
      ['美团', '800'],
      ['滴滴', '400'],
    ]);
    expect(summary[1]?.byCategory[0]?.key).toBe('unset');
    expect(summary[1]?.bySource[0]?.key).toBe('unset');
  });
});
