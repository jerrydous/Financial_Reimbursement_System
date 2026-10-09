import { Injectable } from '@nestjs/common';
import { pageOffset, type ExpenseReportList } from '@frs/contracts';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ExpenseReportsService {
  constructor(private readonly prisma: PrismaService) {}

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
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        amountFen: row.amountFen.toString(),
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }
}
