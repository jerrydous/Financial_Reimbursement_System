// 已结算金额按发票权重分到分，尾差归金额最大的一行。角度和展示不在这里计算。
import { addFen, compareFen, sumFen, type Fen } from './money';

export const unsetSliceKey = 'unset';

export type WeightedLine = {
  amountFen: Fen;
  category: string | null;
  merchant: string | null;
};

export type SettledReportInput = {
  currency: string;
  amountFen: Fen;
  lines: readonly WeightedLine[];
};

export type FenSlice = {
  key: string;
  amountFen: Fen;
};

export type CurrencySettlement = {
  currency: string;
  totalFen: Fen;
  byCategory: FenSlice[];
  bySource: FenSlice[];
};

export function allocateByWeight(total: Fen, weights: readonly Fen[]): Fen[] {
  if (weights.length === 0) {
    return [];
  }
  const weightTotal = sumFen(weights);
  if (compareFen(weightTotal, 0n as Fen) === 0) {
    return weights.map((_, index) => (index === 0 ? total : (0n as Fen)));
  }
  const shares = weights.map((weight) => ((total * weight) / weightTotal) as Fen);
  const remainder = (total - sumFen(shares)) as Fen;
  let largest = 0;
  for (let index = 1; index < weights.length; index += 1) {
    const weight = weights[index];
    const current = weights[largest];
    if (weight !== undefined && current !== undefined && compareFen(weight, current) > 0) {
      largest = index;
    }
  }
  const largestShare = shares[largest];
  if (largestShare !== undefined) {
    shares[largest] = addFen(largestShare, remainder);
  }
  return shares;
}

export function groupFen(items: readonly FenSlice[]): FenSlice[] {
  const totals = new Map<string, Fen>();
  for (const item of items) {
    if (compareFen(item.amountFen, 0n as Fen) === 0) {
      continue;
    }
    totals.set(item.key, addFen(totals.get(item.key) ?? (0n as Fen), item.amountFen));
  }
  return [...totals.entries()]
    .map(([key, amountFen]) => ({ key, amountFen }))
    .sort((left, right) => compareFen(right.amountFen, left.amountFen) || left.key.localeCompare(right.key));
}

export function summarizeSettled(reports: readonly SettledReportInput[]): CurrencySettlement[] {
  const categories = new Map<string, FenSlice[]>();
  const sources = new Map<string, FenSlice[]>();
  const totals = new Map<string, Fen>();
  for (const report of reports) {
    totals.set(report.currency, addFen(totals.get(report.currency) ?? (0n as Fen), report.amountFen));
    const shares = report.lines.length === 0
      ? [report.amountFen]
      : allocateByWeight(report.amountFen, report.lines.map((line) => line.amountFen));
    const pieces = report.lines.length === 0
      ? [{ category: null, merchant: null, amountFen: report.amountFen }]
      : report.lines.map((line, index) => ({
          category: line.category,
          merchant: line.merchant,
          amountFen: shares[index] ?? (0n as Fen),
        }));
    for (const piece of pieces) {
      const categoryKey = piece.category && piece.category.trim() ? piece.category.trim() : unsetSliceKey;
      const merchantKey = piece.merchant && piece.merchant.trim() ? piece.merchant.trim() : unsetSliceKey;
      const categoryItems = categories.get(report.currency) ?? [];
      categoryItems.push({ key: categoryKey, amountFen: piece.amountFen });
      categories.set(report.currency, categoryItems);
      const sourceItems = sources.get(report.currency) ?? [];
      sourceItems.push({ key: merchantKey, amountFen: piece.amountFen });
      sources.set(report.currency, sourceItems);
    }
  }
  return [...totals.entries()]
    .map(([currency, totalFen]) => ({
      currency,
      totalFen,
      byCategory: groupFen(categories.get(currency) ?? []),
      bySource: groupFen(sources.get(currency) ?? []),
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}
