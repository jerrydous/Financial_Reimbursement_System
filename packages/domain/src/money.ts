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
