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
  while (!terminal.has(current.status)) {
    await condition(() => pending.length > 0);
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
exports.workerPing = async function workerPing() {
  return 'ok';
};
