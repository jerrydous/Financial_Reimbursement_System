import { ExpenseReportError } from './expense-report';
import { yuanTextToFen, type Fen } from './money';

export const recognitionStatuses = ['pending_confirmation', 'confirmed'] as const;
export type RecognitionStatus = (typeof recognitionStatuses)[number];

export const ledgerStatuses = ['open', 'exempt', 'removed', 'transferred'] as const;
export type LedgerStatus = (typeof ledgerStatuses)[number];

export const ledgerBuckets = ['unreimbursed', 'reimbursed', 'exempt', 'removed', 'transferred'] as const;
export type LedgerBucket = (typeof ledgerBuckets)[number];

export function ledgerBucket(input: { ledgerStatus: string; binding: string }): LedgerBucket {
  if (input.binding === 'active') {
    return 'reimbursed';
  }
  if (input.ledgerStatus === 'exempt' || input.ledgerStatus === 'removed' || input.ledgerStatus === 'transferred') {
    return input.ledgerStatus;
  }
  return 'unreimbursed';
}

export function assertLedgerOpen(ledgerStatus: string): void {
  if (ledgerStatus !== 'open') {
    throw new ExpenseReportError('LEDGER_LOCKED', '这张发票已经不在未报销里');
  }
}

export const invoiceVerificationStatuses = ['unverified', 'verified', 'failed'] as const;
export type InvoiceVerificationStatus = (typeof invoiceVerificationStatuses)[number];

export const invoiceVerificationStatus = 'unverified' as const;

export function assertVerificationStatus(status: string): InvoiceVerificationStatus {
  if (!(invoiceVerificationStatuses as readonly string[]).includes(status)) {
    throw new ExpenseReportError('VERIFICATION_NOT_ALLOWED', '发票验真状态不合法');
  }
  return status as InvoiceVerificationStatus;
}

export function assertVerificationUnverified(status: string): void {
  if (status !== invoiceVerificationStatus) {
    throw new ExpenseReportError('VERIFICATION_NOT_ALLOWED', '未接通查验时，发票只能是未验真');
  }
}

/** 未验真可以报销。查验通过后仍可报销。只有验真未通过才拦住。 */
export function assertVerificationAllowsExpense(status: string): void {
  if (status === 'failed') {
    throw new ExpenseReportError('VERIFICATION_NOT_ALLOWED', '验真未通过的发票不能报销');
  }
  if (status !== 'unverified' && status !== 'verified') {
    throw new ExpenseReportError('VERIFICATION_NOT_ALLOWED', '发票验真状态不合法');
  }
}

/** 人工确认之前不得入账。有没有识别结果都一样，不能自动过账。 */
export function assertReadyToAttach(status: RecognitionStatus, amount: Fen | null): Fen {
  if (status !== 'confirmed' || amount === null) {
    throw new ExpenseReportError('INVOICE_NOT_CONFIRMED', '发票还没经人工确认');
  }
  return amount;
}

export function confirmRecognition(status: RecognitionStatus): RecognitionStatus {
  if (status === 'confirmed') {
    return 'confirmed';
  }
  return 'confirmed';
}

export type InvoiceIdentity = {
  tenantId: string;
  invoiceCode: string;
  invoiceNumber: string;
  fileSha256: string;
};

export function sameActiveInvoiceNumber(left: InvoiceIdentity, right: InvoiceIdentity): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.invoiceCode === right.invoiceCode &&
    left.invoiceNumber === right.invoiceNumber &&
    left.invoiceNumber !== ''
  );
}

export type VatInvoicePair = { name: string; value: string };

export type OcrDraft = {
  invoiceCode: string;
  invoiceNumber: string;
  amountFen: string | null;
  sellerName: string;
  buyerName: string;
  buyerTaxId: string;
  invoiceDate: string;
};

const VAT_NAME: Record<string, keyof OcrDraft | 'amountWithTax'> = {
  发票代码: 'invoiceCode',
  发票号码: 'invoiceNumber',
  销售方名称: 'sellerName',
  购买方名称: 'buyerName',
  购买方税号: 'buyerTaxId',
  开票日期: 'invoiceDate',
  '价税合计(小写)': 'amountWithTax',
  价税合计: 'amountWithTax',
  小写金额: 'amountWithTax',
};

/** 把第三方增值税发票识别结果整理成可人工确认的草稿。识别失败的金额留空，不自动入账。 */
export function draftFromVatPairs(pairs: readonly VatInvoicePair[]): OcrDraft {
  const picked: Partial<Record<keyof OcrDraft | 'amountWithTax', string>> = {};
  for (const pair of pairs) {
    const key = VAT_NAME[pair.name.trim()];
    const value = pair.value.trim();
    if (!key || !value || picked[key]) {
      continue;
    }
    picked[key] = value;
  }
  let amountFen: string | null = null;
  if (picked.amountWithTax) {
    try {
      amountFen = yuanTextToFen(normalizeYuan(picked.amountWithTax)).toString();
    } catch {
      amountFen = null;
    }
  }
  return {
    invoiceCode: picked.invoiceCode ?? '',
    invoiceNumber: picked.invoiceNumber ?? '',
    amountFen,
    sellerName: picked.sellerName ?? '',
    buyerName: picked.buyerName ?? '',
    buyerTaxId: picked.buyerTaxId ?? '',
    invoiceDate: normalizeInvoiceDate(picked.invoiceDate ?? ''),
  };
}

/** 从票面文字里抽出增值税字段。OCR 引擎只负责出字，字段对应由这里完成。 */
export function pairsFromInvoiceText(text: string): VatInvoicePair[] {
  const source = collapseGlyphSpaces(text.replace(/\u00a0/g, ' '));
  const pairs: VatInvoicePair[] = [];
  const code = source.match(/发票代码[:：\s]*([0-9]{10,12})/);
  if (code?.[1]) {
    pairs.push({ name: '发票代码', value: code[1] });
  }
  const number = source.match(/发票号码[:：\s]*([0-9]{8,20})/);
  const detachedNumber = source.match(/(?<![0-9])([0-9]{20})(?![0-9])/) ?? source.match(/(?<![0-9])([0-9]{8})(?![0-9])/);
  const invoiceNumber = number?.[1] ?? (source.includes('发票号码') ? detachedNumber?.[1] : undefined);
  if (invoiceNumber) {
    pairs.push({ name: '发票号码', value: invoiceNumber });
  }
  const date =
    source.match(/开票日期[:：\s]*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/) ??
    source.match(/(\d{4}年\d{1,2}月\d{1,2}日)/);
  if (date?.[1] && source.includes('开票日期')) {
    pairs.push({ name: '开票日期', value: date[1].replace(/\s/g, '') });
  }
  const adjacentAmount =
    source.match(/价税合计[\s\S]{0,40}?([¥￥]\s*[0-9,]+\.\d{2})/) ??
    source.match(/小写[）)]?\s*([¥￥]?\s*[0-9,]+\.\d{2})/);
  const amountValue = adjacentAmount?.[1] ?? largestMoney(source);
  if (amountValue && (source.includes('价税合计') || source.includes('小写'))) {
    pairs.push({ name: '价税合计(小写)', value: amountValue.replace(/\s/g, '') });
  }
  const parties = readParties(source);
  if (parties.sellerName) {
    pairs.push({ name: '销售方名称', value: parties.sellerName });
  }
  if (parties.buyerName) {
    pairs.push({ name: '购买方名称', value: parties.buyerName });
  }
  if (parties.buyerTaxId) {
    pairs.push({ name: '购买方税号', value: parties.buyerTaxId });
  }
  return pairs;
}

/** 数电票常把购买方、销售方印在同一行的左右两列。按出现顺序成对取值，避免把左列购买方当成销售方。 */
function readParties(source: string): { buyerName: string; sellerName: string; buyerTaxId: string } {
  const buyerAt = source.search(/购买方|购方/);
  const sellerAt = source.search(/销售方|销方/);
  if (buyerAt < 0 && sellerAt < 0) {
    const block = partyBlock(source);
    const names = namesIn(block);
    const taxes = taxIdsIn(block);
    return { buyerName: names[0] ?? '', sellerName: names[1] ?? '', buyerTaxId: taxes[0] ?? '' };
  }
  const buyerFirst = buyerAt >= 0 && (sellerAt < 0 || buyerAt < sellerAt);
  const sameLine =
    buyerAt >= 0 && sellerAt >= 0 && !source.slice(Math.min(buyerAt, sellerAt), Math.max(buyerAt, sellerAt)).includes('\n');
  if (sameLine) {
    const block = partyBlock(source.slice(Math.max(buyerAt, sellerAt)));
    const names = namesIn(block);
    const taxes = taxIdsIn(block);
    return {
      buyerName: (buyerFirst ? names[0] : names[1]) ?? '',
      sellerName: (buyerFirst ? names[1] : names[0]) ?? '',
      buyerTaxId: (buyerFirst ? taxes[0] : taxes[1]) ?? '',
    };
  }
  if (buyerAt >= 0 && sellerAt > buyerAt) {
    return {
      buyerName: namesIn(source.slice(buyerAt, sellerAt))[0] ?? '',
      sellerName: namesIn(partyBlock(source.slice(sellerAt)))[0] ?? '',
      buyerTaxId: taxIdsIn(source.slice(buyerAt, sellerAt))[0] ?? '',
    };
  }
  if (sellerAt >= 0 && buyerAt > sellerAt) {
    return {
      sellerName: namesIn(source.slice(sellerAt, buyerAt))[0] ?? '',
      buyerName: namesIn(partyBlock(source.slice(buyerAt)))[0] ?? '',
      buyerTaxId: taxIdsIn(partyBlock(source.slice(buyerAt)))[0] ?? '',
    };
  }
  const only = partyBlock(source.slice(Math.max(buyerAt, sellerAt)));
  return buyerAt >= 0
    ? { buyerName: namesIn(only)[0] ?? '', sellerName: '', buyerTaxId: taxIdsIn(only)[0] ?? '' }
    : { buyerName: '', sellerName: namesIn(only)[0] ?? '', buyerTaxId: '' };
}

function partyBlock(text: string): string {
  const stop = text.search(/项目名称|货物或应税|规格型号|价税合计/);
  return stop >= 0 ? text.slice(0, stop) : text.slice(0, 500);
}

function namesIn(block: string): string[] {
  const names: string[] = [];
  const lines = block.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.includes('名称')) {
      continue;
    }
    const parts = line.split(/名称[:：]?/).slice(1);
    let taken = false;
    for (const part of parts) {
      const name = usableSeller((part.split(/纳税人|统一社会/)[0] ?? '').trim());
      if (name) {
        names.push(name);
        taken = true;
      }
    }
    if (!taken) {
      const next = usableSeller(lines[index + 1] ?? '');
      if (next && !next.includes('名称')) {
        names.push(next);
        index += 1;
      }
    }
  }
  return names;
}

function taxIdsIn(block: string): string[] {
  return [...block.matchAll(/纳税人识别号[:：\s]*([0-9A-Za-z]{15,20})/g)].map((match) => (match[1] ?? '').toUpperCase());
}

/** PDF 文字层经常一个字一块。按纵坐标拼成行，同一行再按从左到右连接。 */
export function invoiceTextFromGlyphs(items: readonly { str: string; x: number; y: number }[]): string {
  const glyphs = items.filter((item) => item.str.trim().length > 0);
  const sorted = [...glyphs].sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: { y: number; parts: { str: string; x: number; y: number }[] }[] = [];
  for (const glyph of sorted) {
    const line = lines.find((entry) => Math.abs(entry.y - glyph.y) <= 2);
    if (line) {
      line.parts.push(glyph);
    } else {
      lines.push({ y: glyph.y, parts: [glyph] });
    }
  }
  return lines
    .map((line) =>
      line.parts
        .sort((left, right) => left.x - right.x)
        .map((part) => part.str)
        .join(' '),
    )
    .join('\n');
}

function collapseGlyphSpaces(text: string): string {
  let current = text;
  let previous = '';
  while (current !== previous) {
    previous = current;
    current = current.replace(/([一-龥（）])[ \t\u3000]+(?=[一-龥（）])/g, '$1');
  }
  return current;
}

function cleanSeller(value: string): string {
  return value.replace(/\s+/g, '').replace(/纳税人识别号.*$/, '').replace(/地址.*$/, '');
}

function usableSeller(value: string): string {
  const name = cleanSeller(value);
  if (!name || /统一社会|纳税人|购买方|销售方|信息|价税合计/.test(name)) {
    return '';
  }
  return name;
}

function largestMoney(text: string): string {
  const found = [...text.matchAll(/[¥￥]\s*([0-9,]+\.\d{2})/g)];
  let best = '';
  let bestFen = -1n;
  for (const match of found) {
    const raw = match[1] ?? '';
    try {
      const fen = yuanTextToFen(normalizeYuan(raw));
      if (fen > bestFen) {
        bestFen = fen;
        best = `¥${raw.replace(/\s/g, '')}`;
      }
    } catch {
      continue;
    }
  }
  return best;
}

function normalizeYuan(input: string): string {
  const cleaned = input.replace(/[¥￥,\s]/g, '');
  if (/^\d+\.\d$/.test(cleaned)) {
    return `${cleaned}0`;
  }
  if (/^\d+$/.test(cleaned)) {
    return `${cleaned}.00`;
  }
  return cleaned;
}

function normalizeInvoiceDate(input: string): string {
  const matched = input.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!matched) {
    return input;
  }
  const month = matched[2]?.padStart(2, '0');
  const day = matched[3]?.padStart(2, '0');
  return `${matched[1]}-${month}-${day}`;
}

export function bindingAfterReportAction(action: 'submit' | 'reject' | 'withdraw' | 'revise'): 'active' | 'released' {
  if (action === 'reject' || action === 'withdraw') {
    return 'released';
  }
  return 'active';
}
