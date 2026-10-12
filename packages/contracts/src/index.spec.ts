import { describe, expect, it } from 'vitest';
import { ZodNumber, ZodString } from 'zod';
import { buildOpenApiDocument } from './openapi';
import { confirmInvoiceSchema, expenseReportItemSchema, fenStringSchema, pageOffset, pageQuerySchema } from './index';

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

  it('确认发票可以选币种，不填则是人民币', () => {
    const confirmed = { invoiceCode: '', invoiceNumber: '1', amountFen: '100', category: 'meal', merchant: '美团' };
    expect(confirmInvoiceSchema.parse(confirmed).currency).toBe('CNY');
    expect(confirmInvoiceSchema.safeParse({ ...confirmed, currency: 'USD' }).success).toBe(true);
    expect(confirmInvoiceSchema.safeParse({ ...confirmed, currency: 'BTC' }).success).toBe(false);
    expect(confirmInvoiceSchema.safeParse({ ...confirmed, category: 'office' }).success).toBe(false);
  });

  it('OpenAPI 从 Zod 生成，金额字段是 string', () => {
    const document = JSON.stringify(buildOpenApiDocument());
    expect(document).toContain('"amountFen"');
    expect(document).toContain('"type":"string"');
    expect(document).not.toContain('"amountFen":{"type":"number"');
  });
});
