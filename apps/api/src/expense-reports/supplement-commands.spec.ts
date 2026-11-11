import { describe, expect, it, vi } from 'vitest';
vi.mock('./report-view', async () => {
  const actual = await vi.importActual<any>('./report-view');
  return {...actual, loadReport: async (tx:any) => ({...tx.state, supplementHistory:tx.state.supplementHistory})};
});
import { ExpenseReportCommands } from './expense-report-commands';

function fixture(status='approving', mode='single') {
  const state:any={id:'r', employeeId:'owner', employee:{managerId:'original',companyId:'c'}, status,
    approvalMode:mode, currentActorId:'reviewer', currentStep:status==='approving'?'manager':'finance',
    amountFen:100n,approvedAmountFen:100n,version:1,supplementHistory:[], assignments:[{actorId:'reviewer'}],
    votes:[{actorId:'reviewer',decision:'pending'}]};
  const grants:any[]=[];
  const tx:any={state,$queryRaw:vi.fn(),expenseReport:{
    findUnique:async()=>state,updateMany:async({data}:any)=>{Object.assign(state,data);state.version=2;return {count:1};}},
    payoutOrder:{findUnique:async()=>null},approvalProxy:{findMany:async()=>[],findFirst:async()=>null},
    approvalVote:{deleteMany:vi.fn(),createMany:vi.fn()},auditEvent:{create:vi.fn()},
    employee:{findMany:async()=>[{id:'finance'}],findUnique:async()=>({role:'finance',companyId:'c'})}};
  const command:any=new ExpenseReportCommands({} as any,{} as any);
  command.audit=vi.fn();command.grant=async(...args:any[])=>grants.push(args.slice(1));
  command.revokeDecide=vi.fn();
  return {state,tx,command,grants,run:(actorId:string,action:string,supplement:any)=>
    command.applyOnce(tx,{reportId:'r',actorId,action,workflowId:null,supplement})};
}
describe('补充命令权限与原节点恢复（模拟存储）',()=>{
  it('主管退回保存原因、原审批人并移除当前待办',async()=>{
    const f=fixture();await f.run('reviewer','request_supplement',{reason:'缺材料'});
    expect(f.state.status).toBe('needs_info');expect(f.state.resumeActorId).toBe('reviewer');
    expect(f.state.currentActorId).toBe(null);expect(f.state.supplementHistory[0].text).toBe('缺材料');
    expect(f.command.revokeDecide).toHaveBeenCalled();
  });
  it('其他员工不能退回',async()=>{
    await expect(fixture().run('intruder','request_supplement',{reason:'缺材料'})).rejects.toThrow();
  });
  it('所有人补交恢复转交后的主管，而非员工默认主管',async()=>{
    const f=fixture();await f.run('reviewer','request_supplement',{reason:'补附件'});
    await f.run('owner','resubmit_manager',{explanation:'已补',materialUrls:['https://example.test/a']});
    expect(f.state.status).toBe('approving');expect(f.state.currentActorId).toBe('reviewer');
    expect(f.grants.some(g=>g[0]==='reviewer' && g[2]==='decide')).toBe(true);
    expect(f.grants.some(g=>g[0]==='original')).toBe(false);
    expect(f.state.supplementHistory).toHaveLength(2);
  });
  it('非本人不可补交，也不可改投财务',async()=>{
    const f=fixture();await f.run('reviewer','request_supplement',{reason:'补附件'});
    await expect(f.run('intruder','resubmit_manager',{explanation:'x'})).rejects.toThrow();
    await expect(f.run('owner','resubmit_finance',{explanation:'x'})).rejects.toThrow();
  });
  it('财务退回后补交恢复财务节点',async()=>{
    const f=fixture('finance_review');await f.run('reviewer','request_supplement',{reason:'补附件'});
    await f.run('owner','resubmit_finance',{explanation:'已补'});
    expect(f.state.status).toBe('finance_review');expect(f.state.currentActorId).toBe('reviewer');
  });
  it('多人审批补交重新创建表决，旧的通过不沿用',async()=>{
    const f=fixture('approving','all');await f.run('reviewer','request_supplement',{reason:'补附件'});
    await f.run('owner','resubmit_manager',{explanation:'已补'});
    expect(f.tx.approvalVote.deleteMany).toHaveBeenCalled();
    expect(f.tx.approvalVote.createMany).toHaveBeenCalled();
  });
});
