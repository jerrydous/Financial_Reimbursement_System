import { z } from 'zod';

/** 金额在契约里是整数分的十进制字符串，避免 JSON number。 */
export const fenStringSchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)$/, 'AMOUNT_NOT_INTEGER_FEN');

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const MAX_PAGE_OFFSET = 1000;

export function pageOffset(page: number, pageSize: number): number {
  const skip = (page - 1) * pageSize;
  if (skip > MAX_PAGE_OFFSET) {
    throw new Error('PAGE_TOO_DEEP');
  }
  return skip;
}

export const companyViewSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  taxId: z.string().min(1),
});

export const employeeViewSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  company: companyViewSchema,
});

export const expenseReportItemSchema = z.object({
  id: z.string().uuid(),
  status: z.string().min(1),
  amountFen: fenStringSchema,
  createdAt: z.string().datetime(),
});

export const expenseReportListSchema = z.object({
  items: z.array(expenseReportItemSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;
export type EmployeeView = z.infer<typeof employeeViewSchema>;
export type ExpenseReportList = z.infer<typeof expenseReportListSchema>;
