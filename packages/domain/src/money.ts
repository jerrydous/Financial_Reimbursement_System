export class MoneyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

declare const fenBrand: unique symbol;

/** 金额事实：整数分。禁止用 number 参与运算。 */
export type Fen = bigint & { readonly [fenBrand]: true };

const INTEGER_FEN = /^-?(0|[1-9]\d*)$/;

export function parseFen(input: string): Fen {
  if (typeof input !== 'string' || !INTEGER_FEN.test(input)) {
    throw new MoneyError('AMOUNT_NOT_INTEGER_FEN', '金额必须是整数字符串，单位为分');
  }
  return BigInt(input) as Fen;
}

export function fenToString(value: Fen): string {
  return value.toString(10);
}

export function addFen(left: Fen, right: Fen): Fen {
  return (left + right) as Fen;
}

export function compareFen(left: Fen, right: Fen): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function sumFen(values: readonly Fen[]): Fen {
  let total = 0n;
  for (const value of values) {
    total += value;
  }
  return total as Fen;
}

const YUAN_TEXT = /^(\d+)\.(\d{2})$/;

/** 展示层输入。只按十进制字符串换算成分，不经过 Number。 */
export function yuanTextToFen(input: string): Fen {
  if (typeof input !== 'string') {
    throw new MoneyError('AMOUNT_NOT_YUAN', '金额必须是元，且带两位小数');
  }
  const matched = YUAN_TEXT.exec(input.trim());
  if (!matched) {
    throw new MoneyError('AMOUNT_NOT_YUAN', '金额必须是元，且带两位小数');
  }
  const whole = BigInt(matched[1] ?? '0');
  const fraction = matched[2] ?? '00';
  return (whole * 100n + BigInt(fraction)) as Fen;
}

export function fenToYuanText(value: Fen): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}
