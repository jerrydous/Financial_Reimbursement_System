import { DomainError } from './domain-error';
import { compareFen, parseFen, sumFen, type Fen } from './money';

/** 按权重分到分。尾差加到分摊后金额最大的一行；并列时加到权重更大的一行，仍并列则加到更靠前的一行。 */
export function allocateByWeights(total: Fen, weights: readonly Fen[]): Fen[] {
  if (weights.length === 0) {
    throw new DomainError('ALLOCATION_INVALID', '至少要有一行分摊');
  }
  if (compareFen(total, parseFen('0')) < 0) {
    throw new DomainError('ALLOCATION_INVALID', '分摊总额不能为负');
  }
  let weightSum = 0n;
  for (const weight of weights) {
    if (compareFen(weight, parseFen('0')) <= 0) {
      throw new DomainError('ALLOCATION_INVALID', '分摊权重必须大于 0');
    }
    weightSum += weight;
  }
  const shares: Fen[] = [];
  let allocated = 0n;
  for (const weight of weights) {
    const share = ((total * weight) / weightSum) as Fen;
    shares.push(share);
    allocated += share;
  }
  const remainder = (total - allocated) as Fen;
  let target = 0;
  for (let index = 1; index < shares.length; index += 1) {
    const share = shares[index] as Fen;
    const current = shares[target] as Fen;
    const shareWins = compareFen(share, current) > 0;
    const tiedShare = compareFen(share, current) === 0;
    const weightWins = compareFen(weights[index] as Fen, weights[target] as Fen) > 0;
    if (shareWins || (tiedShare && weightWins)) {
      target = index;
    }
  }
  shares[target] = (shares[target] + remainder) as Fen;
  if (compareFen(sumFen(shares), total) !== 0) {
    throw new DomainError('ALLOCATION_INVALID', '分摊合计必须等于总额');
  }
  return shares;
}
