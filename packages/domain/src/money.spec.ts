import { describe, expect, it } from 'vitest';
import { addFen, compareFen, fenToString, parseFen } from './money';

describe('金额以整数分计算', () => {
  it('拒绝小数、科学计数和前导零', () => {
    expect(() => parseFen('1.2')).toThrow(/整数字符串/);
    expect(() => parseFen('1e2')).toThrow(/整数字符串/);
    expect(() => parseFen('01')).toThrow(/整数字符串/);
    expect(() => parseFen('')).toThrow(/整数字符串/);
  });

  it('0.1 元加 0.2 元等于 30 分，结果是 bigint', () => {
    const sum = addFen(parseFen('10'), parseFen('20'));
    expect(typeof sum).toBe('bigint');
    expect(sum).toBe(30n);
    expect(fenToString(sum)).toBe('30');
    expect(compareFen(sum, parseFen('30'))).toBe(0);
    expect(compareFen(sum, parseFen('31'))).toBe(-1);
  });
});
