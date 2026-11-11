import { Body, Controller, Headers, HttpException, Inject, Post, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentService } from './payment-service';
import { verifyCallback } from './payment-gateway';

@Controller()
export class PaymentCallbackController {
  constructor(@Inject(PaymentService) private readonly payments: PaymentService) {}
  @Post('payments/callback')
  async callback(@Req() req: RawBodyRequest<Request>, @Headers('x-payment-timestamp') timestamp: string | undefined,
    @Headers('x-payment-signature') signature: string | undefined, @Body() body: unknown) {
    if (!req.rawBody || !verifyCallback(req.rawBody, timestamp, signature, process.env.PAYMENT_CALLBACK_SECRET ?? '')) {
      throw new HttpException({ code: 'PAYMENT_SIGNATURE_INVALID' }, 401);
    }
    const id = (body as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(id)) {
      throw new HttpException({ code: 'REQUEST_INVALID' }, 400);
    }
    // A signed callback is only a wake-up: query the gateway instead of trusting its claimed outcome.
    return this.payments.reconcile(id);
  }
}
