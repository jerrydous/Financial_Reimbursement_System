import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { confirmInvoiceSchema, invoiceListSchema, pageQuerySchema } from '@frs/contracts';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { EmployeeService } from '../employee/employee.service';
import { rethrowAsHttp } from '../expense-reports/http-error';
import { InvoiceCommands } from './invoice-commands';

@Controller()
@UseGuards(AuthGuard)
export class InvoicesController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly invoices: InvoiceCommands,
  ) {}

  @Get('invoices')
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = pageQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'PAGE_INVALID', message: '分页参数不合法' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return invoiceListSchema.parse(
        await this.invoices.listOwn(employee.id, parsed.data.page, parsed.data.pageSize),
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'PAGE_TOO_DEEP') {
        throw new BadRequestException({ code: 'PAGE_TOO_DEEP', message: '偏移过深，当前只支持前 1000 条' });
      }
      rethrowAsHttp(error);
    }
  }

  @Post('invoices')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(@Req() request: AuthenticatedRequest, @UploadedFile() file?: { buffer: Buffer; mimetype: string }) {
    if (!file) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: '需要发票文件' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.invoices.upload(employee.id, { body: file.buffer, contentType: file.mimetype });
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('invoices/:id/confirm')
  async confirm(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = confirmInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '确认内容不合法' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.invoices.confirm(employee.id, id, parsed.data);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Get('invoices/:id/content-url')
  async content(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.invoices.presign(employee.id, id);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }
}
