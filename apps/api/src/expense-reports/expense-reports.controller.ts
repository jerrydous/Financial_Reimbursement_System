import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  requestSupplementSchema,
  resubmitSupplementSchema,
  createExpenseReportSchema,
  expenseReportListSchema,
  financeAdjustmentSchema,
  pageQuerySchema,
  transferSchema,
} from '@frs/contracts';
import { PaymentService } from '../payments/payment-service';
import type { ExpenseReportAction } from '@frs/domain';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { EmployeeService } from '../employee/employee.service';
import { ExpenseReportCommands } from './expense-report-commands';
import { ExpenseReportsService } from './expense-reports.service';
import { rethrowAsHttp } from './http-error';

@Controller()
@UseGuards(AuthGuard)
export class ExpenseReportsController {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(ExpenseReportsService) private readonly reports: ExpenseReportsService,
    @Inject(ExpenseReportCommands) private readonly commands: ExpenseReportCommands,
    @Inject(PaymentService) private readonly payments: PaymentService,
  ) {}

  @Get('expense-reports')
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = pageQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'PAGE_INVALID', message: '分页参数不合法' });
    }
    try {
      const employee = await this.employees.getOwn(request.claims);
      const handled = query.handled === '1';
      const inbox = query.inbox === '1';
      const result = handled
        ? await this.reports.listHandled(employee.id, parsed.data.page, parsed.data.pageSize)
        : inbox
          ? await this.reports.listVisible(employee.id, parsed.data.page, parsed.data.pageSize, true)
          : await this.reports.listOwn(employee.id, parsed.data.page, parsed.data.pageSize);
      return expenseReportListSchema.parse(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'PAGE_TOO_DEEP') {
        throw new BadRequestException({
          code: 'PAGE_TOO_DEEP',
          message: '偏移过深，当前只支持前 1000 条',
        });
      }
      rethrowAsHttp(error);
    }
  }

  @Get('expense-reports/:id')
  async detail(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.commands.getVisible(employee.id, id);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('expense-reports')
  async create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = createExpenseReportSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '请求不合法' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.commands.createDraft(employee.id, parsed.data.invoiceIds, idempotencyKey, parsed.data);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('expense-reports/:id/submit')
  async submit(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.commands.submit(employee.id, id, idempotencyKey);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('expense-reports/:id/finance-adjustment')
  async adjust(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = financeAdjustmentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '批准金额不合法' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.commands.adjust(employee.id, id, parsed.data.approvedAmountFen);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('expense-reports/:id/request-supplement')
  async requestSupplement(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = requestSupplementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({code:'REQUEST_INVALID',message:'请填写退回补充原因'});
    const employee = await this.employees.getOwn(request.claims);
    try { return await this.commands.supplement(employee.id,id,'request',parsed.data); } catch(error) { rethrowAsHttp(error); }
  }

  @Post('expense-reports/:id/resubmit-supplement')
  async resubmitSupplement(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = resubmitSupplementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({code:'REQUEST_INVALID',message:'补充说明或材料链接不合法'});
    const employee = await this.employees.getOwn(request.claims);
    try { return await this.commands.supplement(employee.id,id,'resubmit',parsed.data); } catch(error) { rethrowAsHttp(error); }
  }

  @Post('expense-reports/:id/approve')
  approve(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.signal(request, id, 'approve', {});
  }

  @Post('expense-reports/:id/finance-approve')
  financeApprove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.signal(request, id, 'finance_approve', {});
  }

  @Post('expense-reports/:id/reject')
  reject(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.signal(request, id, 'reject', {});
  }

  @Post('expense-reports/:id/withdraw')
  async withdraw(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.commands.withdraw(employee.id, id);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('expense-reports/:id/revise')
  async revise(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.commands.apply({
        reportId: id,
        action: 'revise',
        actorId: employee.id,
        workflowId: null,
      });
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('expense-reports/:id/transfer')
  async transfer(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = transferSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '转交对象不合法' });
    }
    return this.signal(request, id, 'transfer', { transferToEmployeeId: parsed.data.transferToEmployeeId });
  }

  @Post('expense-reports/:id/payments')
  async pay(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    if (body && typeof body === 'object' && Object.keys(body).length > 0) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '不能由客户端声明支付结果' });
    }
    const employee = await this.employees.getOwn(request.claims);
    return this.payments.pay(employee.id, id);
  }

  private async signal(
    request: AuthenticatedRequest,
    id: string,
    action: ExpenseReportAction,
    extra: { transferToEmployeeId?: string; idempotencyKey?: string },
  ) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.commands.signal(employee.id, id, action, extra);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }
}
