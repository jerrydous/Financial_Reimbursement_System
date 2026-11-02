import { afterEach, describe, expect, it } from 'vitest';
import { openSecret, sealSecret, secretHint } from './verification-secret';

const previous = process.env.VERIFICATION_DATA_KEY;

afterEach(() => {
  if (previous === undefined) {
    delete process.env.VERIFICATION_DATA_KEY;
  } else {
    process.env.VERIFICATION_DATA_KEY = previous;
  }
});

describe('查验密钥', () => {
  it('保存后能读回，页面只看到末四位', () => {
    process.env.VERIFICATION_DATA_KEY = 'test-verification-data-key';
    const stored = sealSecret('sk-live-secret-7788');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(stored).not.toContain('sk-live-secret-7788');
    expect(openSecret(stored)).toBe('sk-live-secret-7788');
    expect(secretHint(stored)).toBe('7788');
    expect(openSecret('')).toBe('');
  });

  it('密钥材料变了就不能读', () => {
    process.env.VERIFICATION_DATA_KEY = 'test-verification-data-key';
    const stored = sealSecret('sk-live-secret-7788');
    process.env.VERIFICATION_DATA_KEY = 'another-verification-key';
    expect(() => openSecret(stored)).toThrow(/重新保存/);
  });
});
