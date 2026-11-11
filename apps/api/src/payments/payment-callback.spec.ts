import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentCallbackController } from './payment-callback.controller';
import type { PaymentService } from './payment-service';
describe('payment callback boundary', () => {
 afterEach(()=>vi.unstubAllEnvs());
 it('rejects unsigned callback before querying',async()=>{
  const reconcile=vi.fn();const controller=new PaymentCallbackController({reconcile} as unknown as PaymentService);
  await expect(controller.callback({rawBody:Buffer.from('{}')} as any,undefined,undefined,{id:'order-1'})).rejects.toThrow();
  expect(reconcile).not.toHaveBeenCalled();
 });
 it('signed callback queries authoritative status and ignores claimed outcome',async()=>{
  vi.stubEnv('PAYMENT_CALLBACK_SECRET','x'.repeat(32));
  const raw=Buffer.from('{"id":"order-1","status":"succeeded"}');
  const ts=Math.floor(Date.now()/1000).toString();
  const sig=createHmac('sha256','x'.repeat(32)).update(ts+'.').update(raw).digest('hex');
  const reconcile=vi.fn().mockResolvedValue({status:'processing'});
  const controller=new PaymentCallbackController({reconcile} as unknown as PaymentService);
  expect(await controller.callback({rawBody:raw} as any,ts,sig,JSON.parse(raw.toString()))).toEqual({status:'processing'});
  expect(reconcile).toHaveBeenCalledWith('order-1');
 });
});
