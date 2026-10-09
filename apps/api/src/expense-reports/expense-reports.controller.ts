import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { pageQuerySchema } from '@frs/contracts';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { EmployeeService } from '../employee/employee.service';
import { ExpenseReportsService } from './expense-reports.service';

@Controller()
@UseGuards(AuthGuard)
export class ExpenseReportsController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly reports: ExpenseReportsService,
  ) {}

  @Get('expense-reports')
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = pageQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'PAGE_INVALID', message: '分页参数不合法' });
    }
    try {
      const employee = await this.employees.getOwn(request.claims);
      return await this.reports.listOwn(employee.id, parsed.data.page, parsed.data.pageSize);
    } catch (error) {
      if (error instanceof Error && error.message === 'PAGE_TOO_DEEP') {
        throw new BadRequestException({
          code: 'PAGE_TOO_DEEP',
          message: '偏移过深，当前只支持前 1000 条',
        });
      }
      throw error;
    }
  }
}
