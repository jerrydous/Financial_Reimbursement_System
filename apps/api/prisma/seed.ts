import { PrismaClient } from '@prisma/client';

const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333';
const MANAGER_ID = '33333333-3333-4333-8333-333333333334';
const FINANCE_ID = '33333333-3333-4333-8333-333333333335';
const CASHIER_ID = '33333333-3333-4333-8333-333333333336';

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
    },
    create: {
      id: EMPLOYEE_ID,
      username: 'employee1',
      name: '示例员工',
      email: 'employee1@example.com',
      companyId: COMPANY_ID,
      role: 'employee',
      managerId: MANAGER_ID,
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
