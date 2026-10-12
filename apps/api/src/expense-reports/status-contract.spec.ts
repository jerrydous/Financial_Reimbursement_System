import { expenseReportActionSchema, expenseReportStatusSchema } from '@frs/contracts';
import { expenseReportActions, expenseReportStatuses } from '@frs/domain';
import { describe, expect, it } from 'vitest';
import { enforceDocumentPolicy } from '@frs/adapters';

describe('契约和数据范围', () => {
  it('线上状态和动作与领域表一致', () => {
    expect([...expenseReportStatusSchema.options]).toEqual([...expenseReportStatuses]);
    expect([...expenseReportActionSchema.options]).toEqual([...expenseReportActions]);
  });

  it('没有授权策略时 casbin 拒绝读取别人的报销单', async () => {
    const allowed = await enforceDocumentPolicy('employee-a', 'report-1', 'read', [
      { actorId: 'employee-b', objectKey: 'report-1', action: 'read' },
    ]);
    expect(allowed).toBe(false);
    const own = await enforceDocumentPolicy('employee-a', 'report-1', 'read', [
      { actorId: 'employee-a', objectKey: 'report-1', action: 'read' },
    ]);
    expect(own).toBe(true);
  });
});
