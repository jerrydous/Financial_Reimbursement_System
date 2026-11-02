// 商旅订单导入把携程、滴滴的订单报文换成费用草稿。配置了拉取地址时走官方 HTTP 入口。
import { expenseDraftFromTravel, type TravelDraft } from '@frs/domain';

export function mapTravelOrder(provider: 'ctrip' | 'didi', payload: unknown): TravelDraft {
  return expenseDraftFromTravel(provider, payload);
}

export class TravelOrderPull {
  constructor(private readonly baseUrl: string) {}

  async pull(provider: 'ctrip' | 'didi', externalId: string): Promise<TravelDraft> {
    if (!this.baseUrl) {
      throw new Error('未配置商旅拉取地址');
    }
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/${provider}/orders/${encodeURIComponent(externalId)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`商旅返回 ${response.status}`);
    }
    return mapTravelOrder(provider, await response.json());
  }
}

export function createTravelPullFromEnv(): TravelOrderPull {
  return new TravelOrderPull(process.env.TRAVEL_PULL_URL ?? '');
}
