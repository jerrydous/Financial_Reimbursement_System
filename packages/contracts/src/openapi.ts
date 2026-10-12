import type { ZodTypeAny } from 'zod';
import {
  confirmInvoiceSchema,
  createExpenseReportSchema,
  employeeViewSchema,
  expenseReportDetailSchema,
  expenseReportListSchema,
  financeAdjustmentSchema,
  invoiceListSchema,
  invoiceViewSchema,
} from './index';

type ZodDef = {
  typeName: string;
  value?: unknown;
  values?: string[];
  innerType?: ZodTypeAny;
  type?: ZodTypeAny;
  schema?: ZodTypeAny;
  shape?: () => Record<string, ZodTypeAny>;
};

function zodToSchema(schema: ZodTypeAny): unknown {
  const def = schema._def as ZodDef;
  if (def.typeName === 'ZodString' || def.typeName === 'ZodNumber' || def.typeName === 'ZodBoolean') {
    return { type: def.typeName.replace('Zod', '').toLowerCase() };
  }
  if (def.typeName === 'ZodLiteral') {
    return { const: def.value };
  }
  if (def.typeName === 'ZodEnum' || def.typeName === 'ZodNativeEnum') {
    return { type: 'string', enum: def.values };
  }
  if (def.typeName === 'ZodNullable') {
    return { anyOf: [zodToSchema(def.innerType as ZodTypeAny), { type: 'null' }] };
  }
  if (def.typeName === 'ZodOptional' || def.typeName === 'ZodDefault') {
    return zodToSchema(def.innerType as ZodTypeAny);
  }
  if (def.typeName === 'ZodArray') {
    return { type: 'array', items: zodToSchema(def.type as ZodTypeAny) };
  }
  if (def.typeName === 'ZodObject') {
    const shape = def.shape?.() ?? {};
    const properties: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      const field = shape[key];
      if (field) {
        properties[key] = zodToSchema(field);
      }
    }
    return { type: 'object', properties };
  }
  if (def.typeName === 'ZodEffects' && def.schema) {
    return zodToSchema(def.schema);
  }
  return {};
}

function jsonResponse(schema: ZodTypeAny) {
  return {
    description: 'ok',
    content: {
      'application/json': {
        schema: zodToSchema(schema),
      },
    },
  };
}

/** OpenAPI 由 Zod 契约直接展开，避免再手写一套字段。 */
export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: { title: '财务报销系统', version: '0.1.0' },
    paths: {
      '/me': { get: { responses: { '200': jsonResponse(employeeViewSchema) } } },
      '/expense-reports': {
        get: { responses: { '200': jsonResponse(expenseReportListSchema) } },
        post: {
          requestBody: { content: { 'application/json': { schema: zodToSchema(createExpenseReportSchema) } } },
          responses: { '200': jsonResponse(expenseReportDetailSchema) },
        },
      },
      '/expense-reports/{id}': { get: { responses: { '200': jsonResponse(expenseReportDetailSchema) } } },
      '/invoices': { get: { responses: { '200': jsonResponse(invoiceListSchema) } } },
      '/invoices/{id}/confirm': {
        post: {
          requestBody: { content: { 'application/json': { schema: zodToSchema(confirmInvoiceSchema) } } },
          responses: { '200': jsonResponse(invoiceViewSchema) },
        },
      },
      '/expense-reports/{id}/finance-adjustment': {
        post: {
          requestBody: { content: { 'application/json': { schema: zodToSchema(financeAdjustmentSchema) } } },
          responses: { '200': jsonResponse(expenseReportDetailSchema) },
        },
      },
    },
  };
}
