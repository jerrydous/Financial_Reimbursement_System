import { Injectable } from '@nestjs/common';
import { expenseReportListSchema, pageOffset, type ExpenseReportList } from '@frs/contracts';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ExpenseReportsService {
  constructor(private readonly prisma: PrismaService) {}

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
    return expenseReportListSchema.parse({
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        amountFen: row.amountFen.toString(),
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    });
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
    return expenseReportListSchema.parse({
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        amountFen: row.amountFen.toString(),
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    });
  }
}
