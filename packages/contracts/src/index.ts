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

export const employeeSummarySchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(1),
  name: z.string().min(1),
  role: employeeRoleSchema,
});

export const employeeDirectorySchema = z.object({
  items: z.array(employeeSummarySchema),
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
  'skip_to_finance',
]);

/** 票面币种。金额仍按该币种的最小单位保存，不在币种之间换算。 */
export const currencyCodeSchema = z.enum(['CNY', 'USD', 'EUR', 'HKD', 'GBP', 'SGD', 'JPY']);

export const expenseReportItemSchema = z.object({
  id: z.string().uuid(),
  status: expenseReportStatusSchema,
  amountFen: fenStringSchema,
  currency: currencyCodeSchema,
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
  currency: currencyCodeSchema,
  sellerName: z.string(),
  invoiceDate: z.string(),
  ledgerStatus: z.enum(['open', 'exempt', 'removed', 'transferred']),
  ocrStatus: z.enum(['skipped', 'recognized', 'failed']),
  ocrMessage: z.string(),
  recognitionStatus: z.enum(['pending_confirmation', 'confirmed']),
  verificationStatus: z.enum(['unverified', 'verified', 'failed']),
  buyerName: z.string(),
  buyerTaxId: z.string(),
  invoiceType: z.string(),
  binding: z.enum(['active', 'released']),
  reused: z.boolean().optional(),
});

export const ledgerBucketSchema = z.enum(['unreimbursed', 'reimbursed', 'exempt', 'removed', 'transferred']);

export const colleagueSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: employeeRoleSchema,
});

export const colleagueListSchema = z.object({
  items: z.array(colleagueSchema),
});

export const auditViewSchema = z.object({
  action: z.string().min(1),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
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
  currency: currencyCodeSchema,
  version: z.number().int(),
  currentStep: z.enum(['manager', 'finance', 'cashier']).nullable(),
  currentActorId: z.string().nullable(),
  approvalMode: z.enum(['single', 'any', 'all']),
  canAct: z.boolean().default(false),
  subsidyFen: fenStringSchema,
  createdAt: z.string().datetime(),
  invoices: z.array(invoiceViewSchema),
  audits: z.array(auditViewSchema),
  warnings: z.array(z.object({ code: z.string().min(1), message: z.string().min(1) })),
});

export const createExpenseReportSchema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1).max(20),
  applicationId: z.string().uuid().nullish(),
  budgetLineId: z.string().uuid().nullish(),
  approvalMode: z.enum(['single', 'any', 'all']).default('single'),
  approverIds: z.array(z.string().uuid()).max(8).default([]),
  writeOffs: z
    .array(z.object({ loanId: z.string().uuid(), amountFen: fenStringSchema }))
    .max(10)
    .default([]),
  subsidy: z
    .object({
      city: z.string().min(1).max(40),
      days: z.number().int().min(1).max(366),
    })
    .nullish(),
  allocations: z
    .array(
      z.object({
        departmentId: z.string().uuid(),
        projectId: z.string().uuid(),
        costCenterId: z.string().uuid(),
        weight: z.string().regex(/^[1-9]\d*$/),
      }),
    )
    .max(20)
    .default([]),
});

export const confirmInvoiceSchema = z.object({
  invoiceCode: z.string().max(32),
  invoiceNumber: z.string().min(1).max(32),
  amountFen: fenStringSchema,
  currency: currencyCodeSchema.default('CNY'),
  buyerName: z.string().max(80).optional(),
  buyerTaxId: z.string().max(32).optional(),
  invoiceDate: z.string().max(20).optional(),
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

export const documentItemSchema = z.object({
  id: z.string().uuid(),
  status: z.string().min(1),
  amountFen: fenStringSchema,
  title: z.string(),
  createdAt: z.string().datetime(),
});

export const documentListSchema = z.object({
  items: z.array(documentItemSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  total: z.number().int().min(0),
});

export const createApplicationSchema = z.object({
  purpose: z.string().min(1).max(200),
  amountFen: fenStringSchema,
});

export const createLoanSchema = z.object({
  amountFen: fenStringSchema,
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const repaymentSchema = z.object({
  amountFen: fenStringSchema,
});

export const budgetLineViewSchema = z.object({
  id: z.string().uuid(),
  period: z.string().min(1),
  amountFen: fenStringSchema,
  reservedFen: fenStringSchema,
  consumedFen: fenStringSchema,
  departmentName: z.string(),
  projectName: z.string(),
  subjectName: z.string(),
});

export const createBudgetLineSchema = z.object({
  departmentId: z.string().uuid(),
  projectId: z.string().uuid(),
  subjectId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  amountFen: fenStringSchema,
});

export const masterOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
});

export const proxySchema = z.object({
  agentId: z.string().uuid(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const proxyViewSchema = z.object({
  id: z.string().uuid(),
  principalId: z.string().uuid(),
  agentId: z.string().uuid(),
  agentName: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  enabled: z.boolean(),
});

export const createContractSchema = z.object({
  vendorId: z.string().uuid(),
  title: z.string().min(1).max(200),
  installments: z
    .array(
      z.object({
        dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amountFen: fenStringSchema,
      }),
    )
    .min(1)
    .max(36),
});

export const createCorporateBillSchema = z.object({
  vendorId: z.string().uuid(),
  contractId: z.string().uuid().nullish(),
  invoiceNumber: z.string().max(32).default(''),
  amountFen: fenStringSchema,
  budgetLineId: z.string().uuid().nullish(),
});

export const installmentPaymentSchema = z.object({
  amountFen: fenStringSchema,
});

export const travelImportSchema = z.object({
  provider: z.enum(['ctrip', 'didi']),
  payload: z.unknown(),
});

export const policyPublishSchema = z.object({
  name: z.string().min(1).max(80),
  rules: z.array(z.record(z.unknown())).min(1),
  skipManagerBelowFen: fenStringSchema.nullish(),
});

export const exportJobSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  message: z.string(),
  downloadPath: z.string(),
});

export { buildOpenApiDocument } from './openapi';

export type PageQuery = z.infer<typeof pageQuerySchema>;
export type EmployeeView = z.infer<typeof employeeViewSchema>;
export type EmployeeSummary = z.infer<typeof employeeSummarySchema>;
export type EmployeeDirectory = z.infer<typeof employeeDirectorySchema>;
export type ExpenseReportList = z.infer<typeof expenseReportListSchema>;
export type ExpenseReportDetail = z.infer<typeof expenseReportDetailSchema>;
export type InvoiceView = z.infer<typeof invoiceViewSchema>;
export type InvoiceList = z.infer<typeof invoiceListSchema>;
export type Colleague = z.infer<typeof colleagueSchema>;
export type DocumentList = z.infer<typeof documentListSchema>;
export type BudgetLineView = z.infer<typeof budgetLineViewSchema>;
export type ProxyView = z.infer<typeof proxyViewSchema>;
export type ExportJob = z.infer<typeof exportJobSchema>;
