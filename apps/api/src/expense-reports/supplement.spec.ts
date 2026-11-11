import { describe, expect, it } from 'vitest';
import { transitionExpenseReport, actorForAction, stepForStatus, isTerminalStatus } from '@frs/domain';
import { requestSupplementSchema, resubmitSupplementSchema } from '@frs/contracts';

describe('待补充状态', () => {
  it('主管和财务可以退回并返回原审核节点', () => {
    expect(transitionExpenseReport('approving','request_supplement')).toBe('needs_info');
    expect(transitionExpenseReport('finance_review','request_supplement')).toBe('needs_info');
    expect(transitionExpenseReport('needs_info','resubmit_manager')).toBe('approving');
    expect(transitionExpenseReport('needs_info','resubmit_finance')).toBe('finance_review');
  });
  it('补交仅归单据所有人，不是审批人', () => {
    for (const action of ['resubmit_manager','resubmit_finance'] as const) {
      expect(actorForAction('needs_info',action,{ownerId:'owner',currentActorId:'manager'})).toBe('owner');
    }
  });
  it('待补充不是终态，也不属于付款或审批待办', () => {
    expect(isTerminalStatus('needs_info')).toBe(false);
    expect(stepForStatus('needs_info')).toBe(null);
    for (const action of ['approve','finance_approve','pay_success','pay_fail','submit','revise'] as const) {
      expect(()=>transitionExpenseReport('needs_info',action)).toThrow();
    }
  });
  it('草稿、已付款和付款中不能退回补充', () => {
    for (const status of ['draft','paying','paid','rejected','withdrawn'] as const)
      expect(()=>transitionExpenseReport(status,'request_supplement')).toThrow();
  });
  it('退回原因和补充说明必填', () => {
    expect(requestSupplementSchema.safeParse({reason:'  '}).success).toBe(false);
    expect(requestSupplementSchema.safeParse({reason:'缺发票影像'}).success).toBe(true);
    expect(resubmitSupplementSchema.safeParse({explanation:''}).success).toBe(false);
    expect(resubmitSupplementSchema.safeParse({explanation:'已补材料',materialUrls:['javascript:alert(1)']}).success).toBe(false);
    expect(resubmitSupplementSchema.safeParse({explanation:'已补材料',materialUrls:['https://example.test/a.pdf']}).success).toBe(true);
  });
});
