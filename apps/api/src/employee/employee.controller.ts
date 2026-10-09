import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { employeeViewSchema } from '@frs/contracts';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { EmployeeService } from './employee.service';

@Controller()
@UseGuards(AuthGuard)
export class EmployeeController {
  constructor(private readonly employees: EmployeeService) {}

  @Get('me')
  async me(@Req() request: AuthenticatedRequest) {
    return employeeViewSchema.parse(await this.employees.getOwn(request.claims));
  }
}
