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

export const employeeRoleSchema = z.enum(['employee', 'manager', 'finance', 'cashier']);

export const employeeViewSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  role: employeeRoleSchema,
  company: companyViewSchema,
});

export const expenseReportStatusSchema = z.enum([
  'draft',
  'submitted',
  'approving',
  'finance_review',
  'paying',
  'paid',
  'rejected',
  'withdrawn',
]);

export const expenseReportActionSchema = z.enum([
  'submit',
  'start_approval',
  'approve',
  'reject',
  'withdraw',
  'transfer',
  'finance_adjust',
  'finance_approve',
  'pay_success',
  'pay_fail',
  'revise',
]);

export const expenseReportItemSchema = z.object({
  id: z.string().uuid(),
  status: expenseReportStatusSchema,
  amountFen: fenStringSchema,
  createdAt: z.string().datetime(),
});

export const expenseReportListSchema = z.object({
  items: z.array(expenseReportItemSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
});

export const invoiceViewSchema = z.object({
  id: z.string().uuid(),
  invoiceCode: z.string(),
  invoiceNumber: z.string(),
  amountFen: fenStringSchema.nullable(),
  recognitionStatus: z.enum(['pending_confirmation', 'confirmed']),
  verificationStatus: z.literal('unverified'),
  binding: z.enum(['active', 'released']),
});

export const auditViewSchema = z.object({
  action: z.string().min(1),
  actorId: z.string().min(1),
  fromStatus: z.string().min(1),
  toStatus: z.string().min(1),
  createdAt: z.string().datetime(),
});

export const expenseReportDetailSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  status: expenseReportStatusSchema,
  amountFen: fenStringSchema,
  submittedAmountFen: fenStringSchema.nullable(),
  approvedAmountFen: fenStringSchema.nullable(),
  currency: z.literal('CNY'),
  version: z.number().int(),
  currentStep: z.enum(['manager', 'finance', 'cashier']).nullable(),
  currentActorId: z.string().nullable(),
  createdAt: z.string().datetime(),
  invoices: z.array(invoiceViewSchema),
  audits: z.array(auditViewSchema),
});

export const createExpenseReportSchema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1).max(20),
});

export const confirmInvoiceSchema = z.object({
  invoiceCode: z.string().max(32),
  invoiceNumber: z.string().min(1).max(32),
  amountFen: fenStringSchema,
});

export const financeAdjustmentSchema = z.object({
  approvedAmountFen: fenStringSchema,
});

export const transferSchema = z.object({
  transferToEmployeeId: z.string().uuid(),
});

export const internalDecisionSchema = z.object({
  action: expenseReportActionSchema,
  actorId: z.string().min(1),
  workflowId: z.string().nullish(),
  approvedAmountFen: fenStringSchema.nullish(),
  transferToEmployeeId: z.string().uuid().nullish(),
  idempotencyKey: z.string().min(1).max(200).nullish(),
});

export const invoiceListSchema = z.object({
  items: z.array(invoiceViewSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
});

export { buildOpenApiDocument } from './openapi';

export type PageQuery = z.infer<typeof pageQuerySchema>;
export type EmployeeView = z.infer<typeof employeeViewSchema>;
export type ExpenseReportList = z.infer<typeof expenseReportListSchema>;
export type ExpenseReportDetail = z.infer<typeof expenseReportDetailSchema>;
export type InvoiceView = z.infer<typeof invoiceViewSchema>;
export type InvoiceList = z.infer<typeof invoiceListSchema>;
