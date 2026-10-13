import { Module } from '@nestjs/common';
import {
  KeycloakAccessTokenVerifier,
  S3InvoiceStorage,
  TemporalExpenseWorkflow,
  createInvoiceObjectClient,
  createInvoiceOcrFromEnv,
  createInvoiceVerifierFromEnv,
  createTaskQueueFromEnv,
} from '@frs/adapters';
import { ACCESS_TOKEN_VERIFIER } from './auth/access-token-verifier';
import { EmployeeController } from './employee/employee.controller';
import { EmployeeService } from './employee/employee.service';
import { ExpenseReportCommands } from './expense-reports/expense-report-commands';
import { ExpenseReportsController } from './expense-reports/expense-reports.controller';
import { ExpenseReportsService } from './expense-reports/expense-reports.service';
import { InternalDecisionController } from './expense-reports/internal-decision.controller';
import { DocumentCommands } from './documents/document-commands';
import { DocumentsController } from './documents/documents.controller';
import { InternalJobsController } from './documents/internal-jobs.controller';
import { HealthController } from './health.controller';
import { InvoiceCommands } from './invoices/invoice-commands';
import { InvoicesController } from './invoices/invoices.controller';
import { OpenApiController } from './openapi.controller';
import { PrismaService } from './prisma.service';

@Module({
  controllers: [
    HealthController,
    OpenApiController,
    EmployeeController,
    ExpenseReportsController,
    InternalDecisionController,
    InvoicesController,
    DocumentsController,
    InternalJobsController,
  ],
  providers: [
    PrismaService,
    EmployeeService,
    ExpenseReportsService,
    {
      provide: InvoiceCommands,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => {
        const bucket = process.env.S3_BUCKET ?? 'invoices';
        const client = createInvoiceObjectClient({
          endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
          region: process.env.S3_REGION ?? 'us-east-1',
          accessKeyId: process.env.S3_ACCESS_KEY ?? 'frs',
          secretAccessKey: process.env.S3_SECRET_KEY ?? 'frs-dev-secret',
          bucket,
        });
        return new InvoiceCommands(prisma, new S3InvoiceStorage(client, bucket), createInvoiceOcrFromEnv(), createInvoiceVerifierFromEnv(), {
          enqueue: (invoiceId, idempotencyKey) => createTaskQueueFromEnv().enqueue('verify-invoice', { invoiceId, idempotencyKey }),
        });
      },
    },
    {
      provide: ExpenseReportCommands,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new ExpenseReportCommands(
          prisma,
          new TemporalExpenseWorkflow({
            address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
            namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
          }),
        ),
    },
    {
      provide: DocumentCommands,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => {
        const bucket = process.env.S3_BUCKET ?? 'invoices';
        const client = createInvoiceObjectClient({
          endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
          region: process.env.S3_REGION ?? 'us-east-1',
          accessKeyId: process.env.S3_ACCESS_KEY ?? 'frs',
          secretAccessKey: process.env.S3_SECRET_KEY ?? 'frs-dev-secret',
          bucket,
        });
        return new DocumentCommands(
          prisma,
          new TemporalExpenseWorkflow({
            address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
            namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
          }),
          new S3InvoiceStorage(client, bucket),
        );
      },
    },
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
