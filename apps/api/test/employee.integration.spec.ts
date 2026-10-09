import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpenseReportsService } from '../src/expense-reports/expense-reports.service';
import type { PrismaService } from '../src/prisma.service';

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!dockerAvailable())('报销列表在真实 PostgreSQL 上按员工隔离', () => {
  let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
  let prisma: PrismaClient;
  const employeeA = uuidv7();
  const employeeB = uuidv7();
  const companyId = uuidv7();

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const databaseUrl = container.getConnectionUri();
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.company.create({
      data: { id: companyId, name: '示例公司', taxId: '91330100EXAMPLE001' },
    });
    await prisma.employee.createMany({
      data: [
        {
          id: employeeA,
          username: 'employee-a',
          name: '员工甲',
          email: 'a@example.com',
          companyId,
        },
        {
          id: employeeB,
          username: 'employee-b',
          name: '员工乙',
          email: 'b@example.com',
          companyId,
        },
      ],
    });
    await prisma.expenseReport.create({
      data: {
        id: uuidv7(),
        employeeId: employeeB,
        status: 'draft',
        amountFen: 100n,
      },
    });
  }, 180000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('员工甲看不到员工乙的报销单', async () => {
    const list = await new ExpenseReportsService(prisma as unknown as PrismaService).listOwn(
      employeeA,
      1,
      20,
    );
    expect(list.total).toBe(0);
    expect(list.items).toEqual([]);
  });
});
