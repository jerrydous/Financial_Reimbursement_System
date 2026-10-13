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
  budgetLineViewSchema,
  createApplicationSchema,
  createBudgetLineSchema,
  createContractSchema,
  createCorporateBillSchema,
  createLoanSchema,
  documentListSchema,
  exportJobSchema,
  installmentPaymentSchema,
  pageQuerySchema,
  policyPublishSchema,
  proxySchema,
  proxyViewSchema,
  repaymentSchema,
  travelImportSchema,
} from '@frs/contracts';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { EmployeeService } from '../employee/employee.service';
import { rethrowAsHttp } from '../expense-reports/http-error';
import { DocumentCommands } from './document-commands';

@Controller()
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(DocumentCommands) private readonly documents: DocumentCommands,
  ) {}

  @Get('applications')
  listApplications(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.list(request, query, (employeeId, page, pageSize) =>
      this.documents.listApplications(employeeId, page, pageSize, query.inbox === '1'),
    );
  }

  @Post('applications')
  async createApplication(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = createApplicationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '申请内容不合法' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.documents.createApplication(employee.id, parsed.data.purpose, parsed.data.amountFen, idempotencyKey);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('applications/:id/submit')
  submitApplication(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.submitApplication(employeeId, id));
  }

  @Post('applications/:id/approve')
  approveApplication(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.decideApplication(employeeId, id, 'approve'));
  }

  @Post('applications/:id/reject')
  rejectApplication(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.decideApplication(employeeId, id, 'reject'));
  }

  @Post('applications/:id/withdraw')
  withdrawApplication(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.decideApplication(employeeId, id, 'withdraw'));
  }

  @Post('applications/:id/revise')
  reviseApplication(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.decideApplication(employeeId, id, 'revise'));
  }

  @Post('applications/:id/close')
  closeApplication(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.decideApplication(employeeId, id, 'close'));
  }

  @Get('loans')
  listLoans(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.list(request, query, (employeeId, page, pageSize) =>
      this.documents.listLoans(employeeId, page, pageSize, query.inbox === '1'),
    );
  }

  @Post('loans')
  async createLoan(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = createLoanSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '借款内容不合法' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.documents.createLoan(employee.id, parsed.data.amountFen, parsed.data.dueOn, idempotencyKey);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('loans/:id/submit')
  submitLoan(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.submitLoan(employeeId, id));
  }

  @Post('loans/:id/approve')
  approveLoan(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.decideLoan(employeeId, id, 'approve'));
  }

  @Post('loans/:id/reject')
  rejectLoan(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.decideLoan(employeeId, id, 'reject'));
  }

  @Post('loans/:id/repayments')
  async repay(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = repaymentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '还款金额不合法' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.documents.repay(employee.id, id, parsed.data.amountFen, idempotencyKey);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Get('repayments')
  listRepayments(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.list(request, query, (employeeId, page, pageSize) => this.documents.listRepayments(employeeId, page, pageSize));
  }

  @Get('budget-lines')
  async budgets() {
    try {
      const result = await this.documents.listBudgets();
      return { items: result.items.map((item) => budgetLineViewSchema.parse(item)) };
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('budget-lines')
  async createBudget(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = createBudgetLineSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '预算行不合法' });
    }
    return this.act(request, (employeeId) => this.documents.createBudget(employeeId, parsed.data));
  }

  @Get('master-data')
  master(@Req() request: AuthenticatedRequest) {
    return this.act(request, () => this.documents.listMaster());
  }

  @Get('subsidies/preview')
  preview(@Req() request: AuthenticatedRequest, @Query('city') city = '', @Query('days') days = '1') {
    const parsedDays = Number(days);
    return this.act(request, (employeeId) => this.documents.previewSubsidy(employeeId, city, parsedDays));
  }

  @Get('approval-proxies')
  async proxies(@Req() request: AuthenticatedRequest) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      const result = await this.documents.listProxies(employee.id);
      return { items: result.items.map((item) => proxyViewSchema.parse(item)) };
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('approval-proxies')
  async createProxy(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = proxySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '代理设置不合法' });
    }
    return this.act(request, (employeeId) =>
      this.documents.createProxy(employeeId, parsed.data.agentId, parsed.data.startsOn, parsed.data.endsOn),
    );
  }

  @Post('approval-proxies/:id/disable')
  disableProxy(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.disableProxy(employeeId, id));
  }

  @Get('contracts')
  listContracts(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.list(request, query, (employeeId, page, pageSize) => this.documents.listContracts(employeeId, page, pageSize));
  }

  @Post('contracts')
  async createContract(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = createContractSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '合同内容不合法' });
    }
    return this.act(request, (employeeId) => this.documents.createContract(employeeId, parsed.data, idempotencyKey));
  }

  @Post('contracts/:id/activate')
  activateContract(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.activateContract(employeeId, id));
  }

  @Get('installments')
  listInstallments(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.list(request, query, (employeeId, page, pageSize) => this.documents.listInstallments(employeeId, page, pageSize));
  }

  @Post('installments/:id/payments')
  async payInstallment(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = installmentPaymentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '分期金额不合法' });
    }
    return this.act(request, (employeeId) => this.documents.payInstallment(employeeId, id, parsed.data.amountFen, idempotencyKey));
  }

  @Get('corporate-bills')
  listCorporate(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.list(request, query, (employeeId, page, pageSize) =>
      this.documents.listCorporate(employeeId, page, pageSize, query.inbox === '1'),
    );
  }

  @Post('corporate-bills')
  async createCorporate(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = createCorporateBillSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '对公付款不合法' });
    }
    return this.act(request, (employeeId) => this.documents.createCorporate(employeeId, parsed.data, idempotencyKey));
  }

  @Post('corporate-bills/:id/submit')
  submitCorporate(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.submitCorporate(employeeId, id));
  }

  @Post('corporate-bills/:id/approve')
  approveCorporate(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.decideCorporate(employeeId, id, 'approve'));
  }

  @Post('corporate-bills/:id/finance-approve')
  financeCorporate(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.decideCorporate(employeeId, id, 'finance_approve'));
  }

  @Post('corporate-bills/:id/reject')
  rejectCorporate(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.decideCorporate(employeeId, id, 'reject'));
  }

  @Post('corporate-bills/:id/withdraw')
  withdrawCorporate(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.decideCorporate(employeeId, id, 'withdraw'));
  }

  @Post('corporate-bills/:id/payments')
  payCorporate(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.act(request, (employeeId) => this.documents.decideCorporate(employeeId, id, 'pay_success', idempotencyKey));
  }

  @Get('payments')
  async listPayments(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = pageQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'PAGE_INVALID', message: '分页参数不合法' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return documentListSchema.parse(
        await this.documents.listPayments(employee.id, employee.role === 'finance' || employee.role === 'cashier', parsed.data.page, parsed.data.pageSize),
      );
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('travel-orders')
  async importTravel(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = travelImportSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '商旅订单不合法' });
    }
    return this.act(request, (employeeId) => this.documents.importTravel(employeeId, parsed.data.provider, parsed.data.payload));
  }

  @Get('travel-orders')
  listTravel(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.list(request, query, (employeeId, page, pageSize) => this.documents.listTravel(employeeId, page, pageSize));
  }

  @Post('expense-reports/:id/voucher')
  voucher(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.act(request, (employeeId) => this.documents.exportVoucher(employeeId, id));
  }

  @Post('invoice-ledger/exports')
  async createExport(@Req() request: AuthenticatedRequest, @Headers('idempotency-key') idempotencyKey: string | undefined) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return exportJobSchema.parse(await this.documents.createExport(employee.id, idempotencyKey));
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Get('invoice-ledger/exports/:id')
  async getExport(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return exportJobSchema.parse(await this.documents.getExport(employee.id, id));
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('policies')
  publish(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = policyPublishSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '制度内容不合法' });
    }
    return this.act(request, (employeeId) => this.documents.publishPolicy(employeeId, parsed.data));
  }

  private async list(
    request: AuthenticatedRequest,
    query: Record<string, unknown>,
    load: (employeeId: string, page: number, pageSize: number) => Promise<unknown>,
  ) {
    const parsed = pageQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'PAGE_INVALID', message: '分页参数不合法' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return documentListSchema.parse(await load(employee.id, parsed.data.page, parsed.data.pageSize));
    } catch (error) {
      if (error instanceof Error && error.message === 'PAGE_TOO_DEEP') {
        throw new BadRequestException({ code: 'PAGE_TOO_DEEP', message: '偏移过深，当前只支持前 1000 条' });
      }
      rethrowAsHttp(error);
    }
  }

  private async act<T>(request: AuthenticatedRequest, run: (employeeId: string) => Promise<T>): Promise<T> {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await run(employee.id);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }
}
