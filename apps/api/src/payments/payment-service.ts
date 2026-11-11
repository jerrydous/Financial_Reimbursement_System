import { HttpException, Inject, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { PrismaService } from '../prisma.service';
import { ExpenseReportCommands } from '../expense-reports/expense-report-commands';
import { HttpPaymentGateway, type PaymentGateway, type PayoutRequest, validateResult } from './payment-gateway';

function fail(code: string, status = 409): never { throw new HttpException({ code }, status); }

@Injectable()
export class PaymentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ExpenseReportCommands) private readonly commands: ExpenseReportCommands,
  ) {}
  private gateway(): PaymentGateway {
    try { return new HttpPaymentGateway(process.env.PAYMENT_GATEWAY_URL ?? '', process.env.PAYMENT_GATEWAY_TOKEN ?? ''); }
    catch { return fail('PAYMENT_NOT_CONFIGURED', 503); }
  }
  async pay(actorId: string, reportId: string, gateway = this.gateway()) {
    const claim = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM expense_reports WHERE id = ${reportId} FOR UPDATE`;
      const report = await tx.expenseReport.findUnique({ where: { id: reportId }, include: { employee: true } });
      if (!report) return fail('REPORT_NOT_FOUND', 404);
      const actor = await tx.employee.findUnique({ where: { id: actorId } });
      if (!actor || actor.role !== 'cashier' || actor.companyId !== report.employee.companyId || actorId === report.employeeId) {
        return fail('ACTOR_FORBIDDEN', 403);
      }
      const existing = await tx.payoutOrder.findUnique({ where: { reportId } });
      if (existing) return { order: existing, employeeId: report.employeeId, fresh: false };
      if (report.status !== 'paying' || !report.approvedAmountFen) {
        return fail('PAYMENT_NOT_READY');
      }
      // Loan offsets require a separate net-payable design; never send the gross total by accident.
      if (await tx.loanWriteOff.count({ where: { reportId, status: { in: ['planned', 'reserved', 'consumed', 'applied'] } } })) {
        return fail('PAYMENT_WRITE_OFF_UNSUPPORTED');
      }
      const order = await tx.payoutOrder.create({ data: {
        id: uuidv7(), reportId, actorId, amountFen: report.approvedAmountFen, currency: report.currency, status: 'processing',
      } });
      return { order, employeeId: report.employeeId, fresh: true };
    });
    const { order } = claim;
    if (order.status === 'succeeded' || order.status === 'failed') {
      await this.commands.notifyPaymentWorkflow(reportId, order.actorId, order.status, order.id);
      return this.view(order);
    }
    const input: PayoutRequest = {
      id: order.id, reportId, employeeId: claim.employeeId, amountFen: order.amountFen.toString(), currency: order.currency,
    };
    let result;
    try {
      result = validateResult(await (claim.fresh ? gateway.submit(input) : gateway.query(input)), input);
    } catch {
      await this.prisma.payoutOrder.updateMany({
        where: { id: order.id, status: { in: ['processing', 'unknown'] } }, data: { status: 'unknown' },
      });
      return fail('PAYMENT_OUTCOME_UNKNOWN_RECONCILE_REQUIRED', 503);
    }
    const settled = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM expense_reports WHERE id = ${reportId} FOR UPDATE`;
      const latest = await tx.payoutOrder.findUniqueOrThrow({ where: { id: order.id } });
      if (latest.status === 'succeeded' || latest.status === 'failed') {
        if (result.status !== 'processing' && latest.status !== result.status) return fail('PAYMENT_TERMINAL_CONFLICT');
        return latest;
      }
      if (latest.providerReference && latest.providerReference !== result.reference) return fail('PAYMENT_REFERENCE_MISMATCH');
      const updated = await tx.payoutOrder.update({ where: { id: order.id }, data: {
        status: result.status, providerReference: result.reference,
      } });
      if (result.status !== 'processing') {
        await this.commands.settleGatewayPayment(tx, {
          reportId, actorId: order.actorId, action: result.status === 'succeeded' ? 'pay_success' : 'pay_fail',
          workflowId: null, idempotencyKey: order.id,
        });
      }
      return updated;
    });
    if (settled.status === 'succeeded' || settled.status === 'failed') {
      await this.commands.notifyPaymentWorkflow(reportId, order.actorId, settled.status, order.id);
    }
    return this.view(settled);
  }
  async reconcile(orderId: string) {
    const order = await this.prisma.payoutOrder.findUnique({ where: { id: orderId } });
    if (!order) return fail('PAYMENT_NOT_FOUND', 404);
    return this.pay(order.actorId, order.reportId);
  }
  private view(order: { id: string; status: string; amountFen: bigint; currency: string; providerReference: string | null }) {
    return { id: order.id, status: order.status, amountFen: order.amountFen.toString(), currency: order.currency, reference: order.providerReference };
  }
}
