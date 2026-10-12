export const roleLabel: Record<string, string> = {
  employee: '员工',
  manager: '主管',
  finance: '财务',
  cashier: '出纳',
};

export const statusLabel: Record<string, string> = {
  draft: '草稿',
  submitted: '已提交',
  approving: '主管审批',
  finance_review: '财务审核',
  paying: '待支付',
  paid: '已支付',
  rejected: '已驳回',
  withdrawn: '已撤回',
};

export const actionLabel: Record<string, string> = {
  submit: '提交',
  start_approval: '开始审批',
  approve: '主管同意',
  reject: '驳回',
  withdraw: '撤回',
  transfer: '转交',
  finance_adjust: '修改批准金额',
  finance_approve: '财务通过',
  pay_success: '确认支付',
  pay_fail: '支付失败',
  revise: '改回草稿',
};

const flowing = new Set(['submitted', 'approving', 'finance_review', 'paying']);

export function statusStillMoving(status: string | undefined): boolean {
  return status !== undefined && flowing.has(status);
}

export function reportNo(id: string): string {
  return id.replaceAll('-', '').slice(0, 8).toUpperCase();
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function labelOf(table: Record<string, string>, code: string): string {
  return table[code] ?? code;
}
