import { DomainError } from './domain-error';
import { yuanTextToFen } from './money';

export type TravelDraft = {
  externalId: string;
  amountFen: string;
  occurredOn: string;
  summary: string;
};

/** 把商旅订单样例里的金额文本换算成分。不接受二进制浮点。 */
export function expenseDraftFromTravel(provider: 'ctrip' | 'didi', payload: unknown): TravelDraft {
  if (provider === 'ctrip') {
    return fromRecord(payload, {
      externalId: 'OrderID',
      amount: 'Amount',
      occurredOn: 'OrderDate',
      summary: 'ProductName',
    });
  }
  return fromRecord(payload, {
    externalId: 'order_id',
    amount: 'total_fee',
    occurredOn: 'create_time',
    summary: 'product_name',
  });
}

function fromRecord(
  payload: unknown,
  keys: { externalId: string; amount: string; occurredOn: string; summary: string },
): TravelDraft {
  if (!payload || typeof payload !== 'object') {
    throw new DomainError('REQUEST_INVALID', '商旅订单格式不正确');
  }
  const record = payload as Record<string, unknown>;
  const externalId = readText(record[keys.externalId]);
  const occurredOn = readText(record[keys.occurredOn]).slice(0, 10);
  const summary = readText(record[keys.summary]);
  if (!externalId || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
    throw new DomainError('REQUEST_INVALID', '商旅订单缺少单号或日期');
  }
  let amountFen: string;
  try {
    amountFen = yuanTextToFen(readText(record[keys.amount])).toString();
  } catch {
    throw new DomainError('AMOUNT_NOT_YUAN', '商旅订单金额必须是带两位小数的元');
  }
  return { externalId, amountFen, occurredOn, summary };
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
