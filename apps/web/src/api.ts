import type { EmployeeDirectory, EmployeeView, ExpenseReportDetail, ExpenseReportList, InvoiceList, InvoiceView } from '@frs/contracts';
import { authHeader } from './auth';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export type { EmployeeDirectory, EmployeeView, ExpenseReportDetail, ExpenseReportList, InvoiceList, InvoiceView };

export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const auth = await authHeader();
  for (const [key, value] of Object.entries(auth)) {
    headers.set(key, value);
  }
  return fetch(`${apiUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) });
}

async function read<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ApiError(body?.code ?? `HTTP_${response.status}`, body?.message ?? '请求失败，请稍后再试');
  }
  return response.json() as Promise<T>;
}

export async function getMe(): Promise<EmployeeView> {
  return read(await request('/me'));
}

export async function listEmployees(): Promise<EmployeeDirectory> {
  return read(await request('/employees'));
}

export async function listExpenseReports(inbox: boolean, page: number, pageSize = 20): Promise<ExpenseReportList> {
  return read(await request(`/expense-reports?inbox=${inbox ? '1' : '0'}&page=${page}&pageSize=${pageSize}`));
}

export async function getExpenseReport(id: string): Promise<ExpenseReportDetail> {
  return read(await request(`/expense-reports/${id}`));
}

export async function listInvoices(page = 1, pageSize = 20): Promise<InvoiceList> {
  return read(await request(`/invoices?page=${page}&pageSize=${pageSize}`));
}

export async function uploadInvoice(file: File): Promise<InvoiceView> {
  const body = new FormData();
  body.set('file', file);
  const headers = await authHeader();
  const response = await fetch(`${apiUrl}/invoices`, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });
  return read(response);
}

export async function confirmInvoice(
  id: string,
  input: { invoiceCode: string; invoiceNumber: string; amountFen: string },
): Promise<InvoiceView> {
  return read(
    await request(`/invoices/${id}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function invoiceContentUrl(id: string): Promise<{ url: string; expiresInSeconds: number }> {
  return read(await request(`/invoices/${id}/content-url`));
}

export async function createExpenseReport(invoiceIds: string[], idempotencyKey: string): Promise<ExpenseReportDetail> {
  return read(
    await request('/expense-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ invoiceIds }),
    }),
  );
}

export async function submitExpenseReport(id: string, idempotencyKey: string): Promise<ExpenseReportDetail> {
  return read(
    await request(`/expense-reports/${id}/submit`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    }),
  );
}

export async function postAction(id: string, action: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (idempotencyKey) {
    headers['idempotency-key'] = idempotencyKey;
  }
  return read(
    await request(`/expense-reports/${id}/${action}`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
