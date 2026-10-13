// 耐久等待来自 @temporalio/workflow。本文件只排队信号并调用活动，单线审批不是自研流程引擎。
const { condition, defineSignal, proxyActivities, setHandler } = require('@temporalio/workflow');

const decisionSignal = defineSignal('expenseDecision');
const activities = proxyActivities({
  startToCloseTimeout: '30 seconds',
  scheduleToCloseTimeout: '2 minutes',
  retry: {
    maximumAttempts: 5,
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumInterval: '20 seconds',
  },
});

const terminal = new Set(['paid', 'rejected', 'withdrawn']);

async function expenseApproval(input) {
  const pending = [];
  setHandler(decisionSignal, (decision) => {
    pending.push(decision);
  });
  let current = await activities.applyExpenseDecision({
    reportId: input.reportId,
    action: 'start_approval',
    actorId: 'system',
    workflowId: `expense-approval-${input.reportId}`,
    approvedAmountFen: null,
    transferToEmployeeId: null,
    idempotencyKey: null,
  });
  let reminded = false;
  while (!terminal.has(current.status)) {
    const arrived = reminded
      ? await condition(() => pending.length > 0)
      : await condition(() => pending.length > 0, '48 hours');
    if (!arrived) {
      reminded = true;
      await activities.remindExpenseApprover({ reportId: input.reportId });
      continue;
    }
    reminded = false;
    const decision = pending.shift();
    current = await activities.applyExpenseDecision({
      reportId: input.reportId,
      action: decision.action,
      actorId: decision.actorId,
      workflowId: `expense-approval-${input.reportId}`,
      approvedAmountFen: decision.approvedAmountFen ?? null,
      transferToEmployeeId: decision.transferToEmployeeId ?? null,
      idempotencyKey: decision.idempotencyKey ?? null,
    });
  }
}

exports.expenseApproval = expenseApproval;

async function documentReminder(input) {
  const pending = [];
  setHandler(decisionSignal, (decision) => {
    pending.push(decision);
  });
  const arrived = await condition(() => pending.length > 0, '48 hours');
  if (!arrived) {
    await activities.remindDocument({ documentId: input.documentId, kind: input.kind });
  }
}

exports.documentReminder = documentReminder;
exports.workerPing = async function workerPing() {
  return 'ok';
};
