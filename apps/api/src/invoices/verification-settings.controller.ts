import { BadRequestException, Body, Controller, Get, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { saveVerificationSettingSchema, verificationSettingViewSchema } from '@frs/contracts';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { EmployeeService } from '../employee/employee.service';
import { rethrowAsHttp } from '../expense-reports/http-error';
import { VerificationSettingsCommands } from './verification-settings';

@Controller()
@UseGuards(AuthGuard)
export class VerificationSettingsController {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(VerificationSettingsCommands) private readonly settings: VerificationSettingsCommands,
  ) {}

  @Get('verification-settings')
  async get(@Req() request: AuthenticatedRequest) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return verificationSettingViewSchema.parse(await this.settings.get(employee));
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Put('verification-settings')
  async save(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = saveVerificationSettingSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '查验配置不合法' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return verificationSettingViewSchema.parse(await this.settings.save(employee, parsed.data));
    } catch (error) {
      rethrowAsHttp(error);
    }
  }
}
