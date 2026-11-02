import { ForbiddenException } from '@nestjs/common';
import { colleagueListSchema } from '@frs/contracts';
import type { AccessTokenClaims } from '@frs/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma.service';
import { EmployeeService } from './employee.service';
import { ExpenseReportsService } from '../expense-reports/expense-reports.service';

const claims: AccessTokenClaims = { subject: 'subject-a', username: 'employee1' };

function employee(subject: string | null) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    username: 'employee1',
    name: '示例员工',
    email: 'employee1@example.com',
    role: 'employee',
    keycloakSubject: subject,
    company: {
      id: '22222222-2222-4222-8222-222222222222',
      name: '示例公司',
      taxId: '91330100EXAMPLE001',
    },
  };
}

describe('员工只看到自己的身份', () => {
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const findUniqueOrThrow = vi.fn();
  const prisma = {
    employee: { findUnique, updateMany, findUniqueOrThrow },
  } as unknown as PrismaService;

  beforeEach(() => {
    findUnique.mockReset();
    updateMany.mockReset();
    findUniqueOrThrow.mockReset();
  });

  it('首次登录绑定 subject，返回该公司抬头', async () => {
    findUnique.mockImplementation(async ({ where }: { where: { keycloakSubject?: string; username?: string } }) => {
      if (where.keycloakSubject) {
        return null;
      }
      return employee(null);
    });
    updateMany.mockResolvedValue({ count: 1 });
    findUniqueOrThrow.mockResolvedValue(employee('subject-a'));

    const view = await new EmployeeService(prisma).getOwn(claims);
    expect(view.name).toBe('示例员工');
    expect(view.company.name).toBe('示例公司');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: employee(null).id, keycloakSubject: null },
      data: { keycloakSubject: 'subject-a' },
    });
  });

  it('已绑定其他 subject 时拒绝', async () => {
    findUnique.mockImplementation(async ({ where }: { where: { keycloakSubject?: string } }) => {
      if (where.keycloakSubject) {
        return null;
      }
      return employee('subject-other');
    });
    await expect(new EmployeeService(prisma).getOwn(claims)).rejects.toBeInstanceOf(ForbiddenException);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('转交名单是同公司的其他账号', () => {
  it('按姓名返回 items，排除自己', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'self', companyId: '22222222-2222-4222-8222-222222222222' });
    const findMany = vi.fn().mockResolvedValue([
      { id: '33333333-3333-4333-8333-333333333334', name: '示例主管', role: 'manager' },
      { id: '33333333-3333-4333-8333-333333333335', name: '示例财务', role: 'finance' },
    ]);
    const prisma = { employee: { findUnique, findMany } } as unknown as PrismaService;

    const list = await new EmployeeService(prisma).listColleagues('self');

    expect(colleagueListSchema.parse(list).items.map((person) => person.name)).toEqual(['示例主管', '示例财务']);
    expect(findMany).toHaveBeenCalledWith({
      where: { companyId: '22222222-2222-4222-8222-222222222222', NOT: { id: 'self' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: true },
    });
  });
});

describe('报销列表只查当前员工', () => {
  it('查询条件锁定 employeeId，空表返回空列表', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      expenseReport: { count, findMany },
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    } as unknown as PrismaService;

    const list = await new ExpenseReportsService(prisma).listOwn(
      '33333333-3333-4333-8333-333333333333',
      1,
      20,
    );
    expect(list).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    expect(count).toHaveBeenCalledWith({
      where: { employeeId: '33333333-3333-4333-8333-333333333333' },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { employeeId: '33333333-3333-4333-8333-333333333333' },
        skip: 0,
        take: 20,
      }),
    );
  });

  it('金额从数据库 bigint 转成字符串', async () => {
    const prisma = {
      expenseReport: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: '44444444-4444-4444-8444-444444444444',
            status: 'draft',
            amountFen: 1234n,
            createdAt: new Date('2026-10-09T00:00:00.000Z'),
          },
        ]),
      },
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    } as unknown as PrismaService;
    const list = await new ExpenseReportsService(prisma).listOwn(
      '33333333-3333-4333-8333-333333333333',
      1,
      20,
    );
    expect(list.items[0]?.amountFen).toBe('1234');
    expect(typeof list.items[0]?.amountFen).toBe('string');
  });
});
