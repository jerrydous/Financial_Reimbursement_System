import { Inject, Injectable } from '@nestjs/common';
import { expenseReportListSchema, pageOffset, type ExpenseReportList } from '@frs/contracts';
import { PrismaService } from '../prisma.service';

const handledActions = ['approve', 'reject', 'transfer', 'skip_to_finance', 'finance_adjust', 'finance_approve', 'pay_success', 'pay_fail'];

@Injectable()
export class ExpenseReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listHandled(actorId: string, page: number, pageSize: number): Promise<ExpenseReportList> {
    const skip = pageOffset(page, pageSize);
    const where = {
      auditEvents: { some: { actorId, action: { in: handledActions } } },
      accesses: { some: { actorId, action: 'read', revokedAt: null } },
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.expenseReport.count({ where }),
      this.prisma.expenseReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);
    return this.toList(rows, page, pageSize, total);
  }

  async listVisible(
    actorId: string,
    page: number,
    pageSize: number,
    inbox: boolean,
  ): Promise<ExpenseReportList> {
    const skip = pageOffset(page, pageSize);
    const where = {
      accesses: { some: { actorId, action: 'read', revokedAt: null } },
      ...(inbox ? { currentActorId: actorId } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.expenseReport.count({ where }),
      this.prisma.expenseReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);
    return this.toList(rows, page, pageSize, total);
  }

  async listOwn(employeeId: string, page: number, pageSize: number): Promise<ExpenseReportList> {
    const skip = pageOffset(page, pageSize);
    const where = { employeeId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.expenseReport.count({ where }),
      this.prisma.expenseReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);
    return this.toList(rows, page, pageSize, total);
  }

  private toList(
    rows: { id: string; status: string; amountFen: bigint; currency: string; createdAt: Date }[],
    page: number,
    pageSize: number,
    total: number,
  ): ExpenseReportList {
    return expenseReportListSchema.parse({
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        amountFen: row.amountFen.toString(),
        currency: row.currency,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    });
  }
}
