import type {
  BudgetLineView,
  Colleague,
  DocumentList,
  EmployeeView,
  ExpenseReportDetail,
  ExpenseReportList,
  ExportJob,
  InvoiceList,
  InvoiceView,
  ProxyView,
} from '@frs/contracts';
import { authHeader } from './auth';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export type { BudgetLineView, Colleague, DocumentList, EmployeeView, ExpenseReportDetail, ExpenseReportList, ExportJob, InvoiceList, InvoiceView, ProxyView };

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
    throw new Error(body?.message || body?.code || `请求失败（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

export async function getMe(): Promise<EmployeeView> {
  return read(await request('/me'));
}

export async function listExpenseReports(inbox: boolean, page = 1, pageSize = 8, handled = false): Promise<ExpenseReportList> {
  const scope = handled ? 'handled=1' : `inbox=${inbox ? '1' : '0'}`;
  return read(await request(`/expense-reports?${scope}&page=${page}&pageSize=${pageSize}`));
}

export async function getExpenseReport(id: string): Promise<ExpenseReportDetail> {
  return read(await request(`/expense-reports/${id}`));
}

export async function listInvoices(page = 1, pageSize = 20, bucket = 'unreimbursed'): Promise<InvoiceList> {
  return read(await request(`/invoices?page=${page}&pageSize=${pageSize}&bucket=${bucket}`));
}

export async function classifyInvoice(id: string, action: 'exempt' | 'remove'): Promise<InvoiceView> {
  return read(await request(`/invoices/${id}/${action}`, { method: 'POST' }));
}

export async function transferInvoice(id: string, toEmployeeId: string): Promise<InvoiceView> {
  return read(
    await request(`/invoices/${id}/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transferToEmployeeId: toEmployeeId }),
    }),
  );
}

export async function listColleagues(): Promise<Colleague[]> {
  const body = await read<{ items: Colleague[] }>(await request('/colleagues'));
  return body.items;
}

export async function uploadInvoice(file: File): Promise<InvoiceView> {
  const body = new FormData();
  body.set('file', file);
  const headers = await authHeader();
  const response = await fetch(`${apiUrl}/invoices`, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(90_000),
  });
  return read(response);
}

export async function confirmInvoice(
  id: string,
  input: {
    invoiceCode: string;
    invoiceNumber: string;
    amountFen: string;
    currency: string;
    buyerName?: string;
    buyerTaxId?: string;
    invoiceDate?: string;
  },
): Promise<InvoiceView> {
  return read(
    await request(`/invoices/${id}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function invoiceContent(id: string): Promise<{ blob: Blob; contentType: string }> {
  const response = await request(`/invoices/${id}/content`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new Error(body?.message || body?.code || `请求失败（${response.status}）`);
  }
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  return { blob: await response.blob(), contentType };
}

export async function createExpenseReport(
  invoiceIds: string[],
  idempotencyKey: string,
  extras: Record<string, unknown> = {},
): Promise<ExpenseReportDetail> {
  return read(
    await request('/expense-reports', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ invoiceIds, ...extras }),
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

const documentPath: Record<string, string> = {
  application: '/applications',
  loan: '/loans',
  contract: '/contracts',
  installment: '/installments',
  repayment: '/repayments',
  payment: '/payments',
  corporate: '/corporate-bills',
  travel: '/travel-orders',
};

export async function listDocuments(kind: string, page = 1, pageSize = 8, inbox = false): Promise<DocumentList> {
  const path = documentPath[kind] ?? '/applications';
  const scope = inbox ? '&inbox=1' : '';
  return read(await request(`${path}?page=${page}&pageSize=${pageSize}${scope}`));
}

export async function postJson(path: string, body?: unknown, idempotencyKey?: string): Promise<unknown> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (idempotencyKey) {
    headers['idempotency-key'] = idempotencyKey;
  }
  return read(
    await request(path, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function listBudgets(): Promise<BudgetLineView[]> {
  const body = await read<{ items: BudgetLineView[] }>(await request('/budget-lines'));
  return body.items;
}

export async function listMaster(): Promise<{
  departments: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  costCenters: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
}> {
  return read(await request('/master-data'));
}

export async function listProxies(): Promise<ProxyView[]> {
  const body = await read<{ items: ProxyView[] }>(await request('/approval-proxies'));
  return body.items;
}

export async function verifyInvoice(id: string, idempotencyKey: string): Promise<InvoiceView> {
  return read(
    await request(`/invoices/${id}/verify`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    }),
  );
}

export type VerificationSetting = {
  provider: 'off' | 'tencent' | 'custom';
  baseUrl: string;
  model: string;
  region: string;
  secretId: string;
  apiKeySet: boolean;
  apiKeyHint: string;
};

export async function getVerificationSetting(): Promise<VerificationSetting> {
  return read(await request('/verification-settings'));
}

export async function saveVerificationSetting(input: {
  provider: VerificationSetting['provider'];
  baseUrl: string;
  model: string;
  region: string;
  secretId: string;
  apiKey: string;
}): Promise<VerificationSetting> {
  return read(
    await request('/verification-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
}

export async function createLedgerExport(idempotencyKey: string): Promise<ExportJob> {
  return read(
    await request('/invoice-ledger/exports', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
    }),
  );
}
