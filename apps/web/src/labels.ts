import { minorToAmountText, parseFen } from '@frs/domain';

export const currencyOptions = [
  { value: 'CNY', label: '人民币 CNY' },
  { value: 'USD', label: '美元 USD' },
  { value: 'EUR', label: '欧元 EUR' },
  { value: 'HKD', label: '港币 HKD' },
  { value: 'GBP', label: '英镑 GBP' },
  { value: 'SGD', label: '新加坡元 SGD' },
  { value: 'JPY', label: '日元 JPY' },
] as const;

export function formatMoney(amountFen: string | null | undefined, currency = 'CNY'): string {
  if (!amountFen) {
    return '—';
  }
  return `${minorToAmountText(parseFen(amountFen), currency)} ${currency}`;
}

export const roleLabel: Record<string, string> = {
  employee: '员工',
  manager: '主管',
  finance: '财务',
  cashier: '出纳',
};

export const statusLabel: Record<string, string> = {
  draft: '草稿',
  submitted: '已提交',
  approving: '审批中',
  finance_review: '财务审核',
  paying: '待支付',
  paid: '已支付',
  rejected: '已驳回',
  withdrawn: '已撤回',
  outstanding: '未还清',
  settled: '已结清',
  closed: '已关闭',
  active: '履行中',
  pending: '待处理',
  partial: '部分支付',
  succeeded: '支付成功',
  failed: '支付失败',
  ctrip: '携程',
  didi: '滴滴',
};

export const actionLabel: Record<string, string> = {
  submit: '提交',
  start_approval: '开始审批',
  approve: '同意',
  reject: '驳回',
  withdraw: '撤回',
  transfer: '转交',
  finance_adjust: '调整批准金额',
  finance_approve: '财务通过',
  pay_success: '确认支付',
  pay_fail: '支付失败',
  revise: '改回草稿',
  skip_to_finance: '免审进入财务',
  upload_invoice: '上传发票',
  confirm_invoice: '确认发票',
};

export const verificationLabel: Record<string, string> = {
  unverified: '未验真',
  verified: '验真通过',
  failed: '验真未通过',
};

const activeStatuses = new Set(['submitted', 'approving', 'finance_review', 'paying']);

export function isActiveStatus(status: string): boolean {
  return activeStatuses.has(status);
}

export function shortNo(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
