// 数据范围来自 casbin。本文件只加载已授予的策略并调用 enforce。
import { newEnforcer, newModel } from 'casbin';

export type DocumentPolicy = {
  actorId: string;
  objectKey: string;
  action: string;
};

export async function enforceDocumentPolicy(
  actorId: string,
  objectKey: string,
  action: string,
  policies: readonly DocumentPolicy[],
): Promise<boolean> {
  const model = newModel();
  model.addDef('r', 'r', 'sub, obj, act');
  model.addDef('p', 'p', 'sub, obj, act');
  model.addDef('e', 'e', 'some(where (p.eft == allow))');
  model.addDef('m', 'm', 'r.sub == p.sub && r.obj == p.obj && r.act == p.act');
  const enforcer = await newEnforcer(model);
  for (const policy of policies) {
    await enforcer.addPolicy(policy.actorId, policy.objectKey, policy.action);
  }
  return enforcer.enforce(actorId, objectKey, action);
}
