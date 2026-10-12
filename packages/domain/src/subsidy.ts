import { DomainError } from './domain-error';
import { compareFen, parseFen, type Fen } from './money';

/** 补贴 = 日标准 × 天数。天数是整数，金额只做 bigint 乘法。 */
export function subsidyAmount(dailyFen: Fen, days: number): Fen {
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new DomainError('SUBSIDY_INVALID', '补贴天数必须是 1 到 366 的整数');
  }
  if (compareFen(dailyFen, parseFen('0')) < 0) {
    throw new DomainError('SUBSIDY_INVALID', '补贴日标准不能为负');
  }
  return (dailyFen * BigInt(days)) as Fen;
}
