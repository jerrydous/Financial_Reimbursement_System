import { PrismaClient } from '@prisma/client';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentService } from '../src/payments/payment-service';
import { ExpenseReportCommands } from '../src/expense-reports/expense-report-commands';
import type { PrismaService } from '../src/prisma.service';
import type { PaymentGateway, PayoutRequest } from '../src/payments/payment-gateway';

describe.skipIf(!process.env.PAYMENT_TEST_DATABASE_URL)('payment real PostgreSQL / simulated gateway', () => {
 const db = new PrismaClient({datasources:{db:{url:process.env.PAYMENT_TEST_DATABASE_URL}}});
 const company=uuid(), owner=uuid(), cashier=uuid(), outsider=uuid();
 const commands=new ExpenseReportCommands(db as PrismaService,{startApproval:async()=>undefined,signalDecision:async()=>undefined});
 const service=new PaymentService(db as PrismaService,commands);
 beforeAll(async()=>{
  await db.company.create({data:{id:company,name:'Payment test',taxId:uuid()}});
  for(const [id,role] of [[owner,'employee'],[cashier,'cashier'],[outsider,'employee']]){
   await db.employee.create({data:{id,role,companyId:company,username:id,name:role,email:id+'@example.test'}});
  }
 });
 afterAll(()=>db.$disconnect());
 async function report(status='paying'){
  const id=uuid();
  await db.expenseReport.create({data:{id,employeeId:owner,status,amountFen:3000n,approvedAmountFen:3000n,currentActorId:cashier}});
  return id;
 }
 function gateway(status:'succeeded'|'failed'|'processing'='succeeded'){
  let posts=0, queries=0;
  const result=(i:PayoutRequest)=>({...i,status,reference:'bank-'+i.id});
  const g:PaymentGateway={submit:async i=>{posts++;return result(i)},query:async i=>{queries++;return result(i)}};
  return {g,posts:()=>posts,queries:()=>queries};
 }
 it('settles once, replay never reposts',async()=>{
  const id=await report(), g=gateway();
  expect((await service.pay(cashier,id,g.g)).status).toBe('succeeded');
  expect((await service.pay(cashier,id,g.g)).status).toBe('succeeded');
  expect(g.posts()).toBe(1);
  expect((await db.expenseReport.findUniqueOrThrow({where:{id}})).status).toBe('paid');
  expect(await db.payment.count({where:{reportId:id,status:'succeeded'}})).toBe(1);
 });
 it('blocks unauthorized and unapproved reports before submitting',async()=>{
  const id=await report(), g=gateway();
  await expect(service.pay(outsider,id,g.g)).rejects.toThrow();
  await expect(service.pay(cashier,await report('draft'),g.g)).rejects.toThrow();
  expect(g.posts()).toBe(0);
 });
 it('rejects legacy direct confirmation',async()=>{
  await expect(commands.apply({reportId:await report(),action:'pay_success',actorId:cashier,workflowId:null,idempotencyKey:uuid()})).rejects.toThrow();
 });
 it('unknown outcome queries rather than resubmitting',async()=>{
  const id=await report(); let posts=0,queries=0;
  const g:PaymentGateway={
   submit:async()=>{posts++;throw new Error('timeout')},
   query:async i=>{queries++;return {...i,status:'succeeded',reference:'reconciled'}},
  };
  await expect(service.pay(cashier,id,g)).rejects.toThrow();
  expect((await db.payoutOrder.findUniqueOrThrow({where:{reportId:id}})).status).toBe('unknown');
  expect((await service.pay(cashier,id,g)).status).toBe('succeeded');
  expect(posts).toBe(1);expect(queries).toBe(1);
 });
 it('concurrent requests submit at most once',async()=>{
  const id=await report(),g=gateway();
  await Promise.all([service.pay(cashier,id,g.g),service.pay(cashier,id,g.g)]);
  expect(g.posts()).toBe(1);
  expect(await db.payment.count({where:{reportId:id,status:'succeeded'}})).toBe(1);
 });
 it('failed channel result does not mark report paid or auto retry',async()=>{
  const id=await report(),g=gateway('failed');
  expect((await service.pay(cashier,id,g.g)).status).toBe('failed');
  await service.pay(cashier,id,g.g);
  expect(g.posts()).toBe(1);
  expect((await db.expenseReport.findUniqueOrThrow({where:{id}})).status).toBe('paying');
 });
 it('freezes report mutations while payment is processing',async()=>{
  const id=await report(),g=gateway('processing');
  expect((await service.pay(cashier,id,g.g)).status).toBe('processing');
  await expect(commands.apply({reportId:id,action:'withdraw',actorId:owner,workflowId:null,idempotencyKey:uuid()})).rejects.toThrow();
  expect((await db.expenseReport.findUniqueOrThrow({where:{id}})).status).toBe('paying');
 });

});
