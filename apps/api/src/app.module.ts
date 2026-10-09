import { Module } from '@nestjs/common';
import { KeycloakAccessTokenVerifier } from '@frs/adapters';
import { ACCESS_TOKEN_VERIFIER } from './auth/access-token-verifier';
import { EmployeeController } from './employee/employee.controller';
import { EmployeeService } from './employee/employee.service';
import { ExpenseReportsController } from './expense-reports/expense-reports.controller';
import { ExpenseReportsService } from './expense-reports/expense-reports.service';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';

@Module({
  controllers: [HealthController, EmployeeController, ExpenseReportsController],
  providers: [
    PrismaService,
    EmployeeService,
    ExpenseReportsService,
    {
      provide: ACCESS_TOKEN_VERIFIER,
      useFactory: () =>
        new KeycloakAccessTokenVerifier({
          baseUrl: process.env.KEYCLOAK_URL ?? 'http://localhost:8088',
          realm: process.env.KEYCLOAK_REALM ?? 'expense',
          clientId: process.env.KEYCLOAK_API_CLIENT ?? 'web',
        }),
    },
  ],
})
export class AppModule {}
