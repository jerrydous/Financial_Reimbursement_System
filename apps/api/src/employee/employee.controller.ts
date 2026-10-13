import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { colleagueListSchema, employeeViewSchema } from '@frs/contracts';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { EmployeeService } from './employee.service';

@Controller()
@UseGuards(AuthGuard)
export class EmployeeController {
  constructor(@Inject(EmployeeService) private readonly employees: EmployeeService) {}

  @Get('me')
  async me(@Req() request: AuthenticatedRequest) {
    return employeeViewSchema.parse(await this.employees.getOwn(request.claims));
  }

  @Get('colleagues')
  async colleagues(@Req() request: AuthenticatedRequest) {
    const employee = await this.employees.getOwn(request.claims);
    return colleagueListSchema.parse(await this.employees.listColleagues(employee.id));
  }
}
