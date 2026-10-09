import { authHeader } from './auth';

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export type EmployeeView = {
  id: string;
  username: string;
  name: string;
  email: string;
  company: { id: string; name: string; taxId: string };
};

export type ExpenseReportList = {
  items: Array<{ id: string; status: string; amountFen: string; createdAt: string }>;
  page: number;
  pageSize: number;
  total: number;
};

export async function getMe(): Promise<EmployeeView> {
  const response = await fetch(`${apiUrl}/me`, { headers: await authHeader() });
  if (!response.ok) {
    throw new Error(response.status === 401 ? 'AUTH_REQUIRED' : 'ME_FAILED');
  }
  return response.json() as Promise<EmployeeView>;
}

export async function listExpenseReports(): Promise<ExpenseReportList> {
  const response = await fetch(`${apiUrl}/expense-reports`, { headers: await authHeader() });
  if (!response.ok) {
    throw new Error('LIST_FAILED');
  }
  return response.json() as Promise<ExpenseReportList>;
}
