import { describe, expect, it } from 'vitest';
import { ZodNumber, ZodString } from 'zod';
import { expenseReportItemSchema, fenStringSchema, pageOffset, pageQuerySchema } from './index';

describe('金额契约', () => {
  it('报销金额字段是字符串，不是 number', () => {
    expect(expenseReportItemSchema.shape.amountFen).toBeInstanceOf(ZodString);
    expect(expenseReportItemSchema.shape.amountFen).not.toBeInstanceOf(ZodNumber);
    expect(fenStringSchema.safeParse('100').success).toBe(true);
    expect(fenStringSchema.safeParse('1.5').success).toBe(false);
    expect(fenStringSchema.safeParse(100).success).toBe(false);
  });

  it('分页有上限，过深的偏移被拒绝', () => {
    expect(pageQuerySchema.safeParse({ page: '1', pageSize: '20' }).success).toBe(true);
    expect(pageQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(pageOffset(1, 20)).toBe(0);
    expect(() => pageOffset(100, 20)).toThrow('PAGE_TOO_DEEP');
  });
});
