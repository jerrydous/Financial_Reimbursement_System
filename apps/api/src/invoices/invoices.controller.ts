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
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { confirmInvoiceSchema, currencyCodeSchema, invoiceListSchema, ledgerBucketSchema, pageQuerySchema, transferSchema } from '@frs/contracts';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { EmployeeService } from '../employee/employee.service';
import { rethrowAsHttp } from '../expense-reports/http-error';
import { InvoiceCommands } from './invoice-commands';

@Controller()
@UseGuards(AuthGuard)
export class InvoicesController {
  constructor(
    @Inject(EmployeeService) private readonly employees: EmployeeService,
    @Inject(InvoiceCommands) private readonly invoices: InvoiceCommands,
  ) {}

  @Get('invoices')
  async list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const parsed = pageQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'PAGE_INVALID', message: '分页参数不合法' });
    }
    const bucket = ledgerBucketSchema.safeParse(query.bucket ?? 'unreimbursed');
    if (!bucket.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '发票分类不合法' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return invoiceListSchema.parse(
        await this.invoices.listOwn(employee.id, parsed.data.page, parsed.data.pageSize, bucket.data),
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
    if (body && typeof body === 'object' && 'currency' in body) {
      const currency = (body as { currency?: unknown }).currency;
      if (currency !== undefined && !currencyCodeSchema.safeParse(currency).success) {
        throw new BadRequestException({ code: 'CURRENCY_MISMATCH', message: '币种不支持' });
      }
    }
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

  @Post('invoices/:id/verify')
  async verify(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.invoices.verify(employee.id, id, idempotencyKey);
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('invoices/:id/exempt')
  async exempt(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.invoices.classify(employee.id, id, 'exempt');
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('invoices/:id/remove')
  async remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.invoices.classify(employee.id, id, 'removed');
    } catch (error) {
      rethrowAsHttp(error);
    }
  }

  @Post('invoices/:id/transfer')
  async transfer(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    const parsed = transferSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'REQUEST_INVALID', message: '转交对象不合法' });
    }
    const employee = await this.employees.getOwn(request.claims);
    try {
      return await this.invoices.transfer(employee.id, id, parsed.data.transferToEmployeeId);
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

  @Get('invoices/:id/content')
  async download(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<StreamableFile> {
    const employee = await this.employees.getOwn(request.claims);
    try {
      const file = await this.invoices.readContent(employee.id, id);
      return new StreamableFile(file.body, {
        type: file.contentType,
        disposition: `inline; filename="${file.fileName}"`,
        length: file.body.byteLength,
      });
    } catch (error) {
      rethrowAsHttp(error);
    }
  }
}
