import { PrismaClient } from '@prisma/client';

const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333';

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
    where: { username: 'employee1' },
    update: {
      name: '示例员工',
      email: 'employee1@example.com',
      companyId: COMPANY_ID,
    },
    create: {
      id: EMPLOYEE_ID,
      username: 'employee1',
      name: '示例员工',
      email: 'employee1@example.com',
      companyId: COMPANY_ID,
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
