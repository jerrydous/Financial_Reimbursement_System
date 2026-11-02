import { PrismaClient } from '@prisma/client';

const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333';
const MANAGER_ID = '33333333-3333-4333-8333-333333333334';
const FINANCE_ID = '33333333-3333-4333-8333-333333333335';
const CASHIER_ID = '33333333-3333-4333-8333-333333333336';
const DEPT_ID = '44444444-4444-4444-8444-444444444441';
const RANK_ID = '44444444-4444-4444-8444-444444444442';
const PROJECT_ID = '44444444-4444-4444-8444-444444444443';
const SUBJECT_ID = '44444444-4444-4444-8444-444444444444';
const COST_ID = '44444444-4444-4444-8444-444444444445';
const BUDGET_ID = '44444444-4444-4444-8444-444444444446';
const POLICY_ID = '44444444-4444-4444-8444-444444444447';
const VENDOR_ID = '44444444-4444-4444-8444-444444444448';
const EXPENSE_TYPE_ID = '44444444-4444-4444-8444-444444444449';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.company.upsert({
    where: { id: COMPANY_ID },
    update: { name: '示例公司', taxId: '91330100EXAMPLE001' },
    create: {
      id: COMPANY_ID,
      name: '示例公司',
      taxId: '91330100EXAMPLE001',
    },
  });

  await prisma.department.upsert({ where: { id: DEPT_ID }, update: { name: '研发部' }, create: { id: DEPT_ID, name: '研发部' } });
  await prisma.rank.upsert({ where: { id: RANK_ID }, update: { name: '专员', level: 1 }, create: { id: RANK_ID, name: '专员', level: 1 } });

  await prisma.employee.upsert({
    where: { username: 'manager1' },
    update: { name: '示例主管', email: 'manager1@example.com', companyId: COMPANY_ID, role: 'manager' },
    create: {
      id: MANAGER_ID,
      username: 'manager1',
      name: '示例主管',
      email: 'manager1@example.com',
      companyId: COMPANY_ID,
      role: 'manager',
    },
  });
  await prisma.employee.upsert({
    where: { username: 'finance1' },
    update: { name: '示例财务', email: 'finance1@example.com', companyId: COMPANY_ID, role: 'finance' },
    create: {
      id: FINANCE_ID,
      username: 'finance1',
      name: '示例财务',
      email: 'finance1@example.com',
      companyId: COMPANY_ID,
      role: 'finance',
    },
  });
  await prisma.employee.upsert({
    where: { username: 'cashier1' },
    update: { name: '示例出纳', email: 'cashier1@example.com', companyId: COMPANY_ID, role: 'cashier' },
    create: {
      id: CASHIER_ID,
      username: 'cashier1',
      name: '示例出纳',
      email: 'cashier1@example.com',
      companyId: COMPANY_ID,
      role: 'cashier',
    },
  });
  await prisma.employee.upsert({
    where: { username: 'employee1' },
    update: {
      name: '示例员工',
      email: 'employee1@example.com',
      companyId: COMPANY_ID,
      role: 'employee',
      managerId: MANAGER_ID,
      departmentId: DEPT_ID,
      rankId: RANK_ID,
    },
    create: {
      id: EMPLOYEE_ID,
      username: 'employee1',
      name: '示例员工',
      email: 'employee1@example.com',
      companyId: COMPANY_ID,
      role: 'employee',
      managerId: MANAGER_ID,
      departmentId: DEPT_ID,
      rankId: RANK_ID,
    },
  });

  await prisma.department.upsert({ where: { id: DEPT_ID }, update: { name: '研发部' }, create: { id: DEPT_ID, name: '研发部' } });
  await prisma.rank.upsert({ where: { id: RANK_ID }, update: { name: '专员', level: 1 }, create: { id: RANK_ID, name: '专员', level: 1 } });
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: { name: '默认项目', code: 'P-DEFAULT' },
    create: { id: PROJECT_ID, name: '默认项目', code: 'P-DEFAULT' },
  });
  await prisma.budgetSubject.upsert({
    where: { id: SUBJECT_ID },
    update: { name: '差旅费', code: 'TRAVEL' },
    create: { id: SUBJECT_ID, name: '差旅费', code: 'TRAVEL' },
  });
  await prisma.costCenter.upsert({
    where: { id: COST_ID },
    update: { name: '总部', code: 'HQ' },
    create: { id: COST_ID, name: '总部', code: 'HQ' },
  });
  await prisma.expenseType.upsert({
    where: { id: EXPENSE_TYPE_ID },
    update: { name: '交通', code: 'TRAFFIC' },
    create: { id: EXPENSE_TYPE_ID, name: '交通', code: 'TRAFFIC' },
  });
  await prisma.vendor.upsert({
    where: { id: VENDOR_ID },
    update: { name: '示例供应商', taxId: '91330100VENDOR0001' },
    create: { id: VENDOR_ID, name: '示例供应商', taxId: '91330100VENDOR0001' },
  });
  await prisma.budgetLine.upsert({
    where: { id: BUDGET_ID },
    update: { amountFen: 100_000_000n },
    create: {
      id: BUDGET_ID,
      departmentId: DEPT_ID,
      projectId: PROJECT_ID,
      subjectId: SUBJECT_ID,
      period: '2026-10',
      amountFen: 100_000_000n,
    },
  });
  await prisma.subsidyRate.upsert({
    where: { tenantId_city_rankId: { tenantId: 'default', city: '北京', rankId: RANK_ID } },
    update: { dailyFen: 10_000n, enabled: true },
    create: { id: '44444444-4444-4444-8444-444444444450', city: '北京', rankId: RANK_ID, dailyFen: 10_000n },
  });
  await prisma.policyVersion.upsert({
    where: { tenantId_name_version: { tenantId: 'default', name: '差旅标准', version: 1 } },
    update: { status: 'published' },
    create: {
      id: POLICY_ID,
      name: '差旅标准',
      version: 1,
      status: 'published',
      rulesJson: [
        {
          conditions: { all: [{ fact: 'amountFen', operator: 'fenGreaterThan', value: '500000' }] },
          event: { type: 'standard', params: { level: 'block', message: '单笔超过 5000.00 元，强控不能提交' } },
        },
        {
          conditions: { all: [{ fact: 'amountFen', operator: 'fenGreaterThan', value: '100000' }] },
          event: { type: 'standard', params: { level: 'warn', message: '单笔超过 1000.00 元，弱控已记录' } },
        },
        {
          conditions: { all: [{ fact: 'crossYear', operator: 'equal', value: true }] },
          event: { type: 'timeliness', params: { level: 'warn', message: '发票跨年，提交时留下警告' } },
        },
        {
          conditions: { all: [{ fact: 'invoiceAgeDays', operator: 'greaterThanInclusive', value: 180 }] },
          event: { type: 'timeliness', params: { level: 'block', message: '发票超过 180 天，不能提交' } },
        },
      ],
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : 'seed failed');
    await prisma.$disconnect();
    process.exit(1);
  });
