import { describe, expect, it } from 'vitest';
import { assertCanBindSubject, assertSameSubject, IdentityError } from './identity';

describe('员工身份', () => {
  it('未绑定的 subject 可以绑定，已绑定后只接受同一个 subject', () => {
    expect(() => assertCanBindSubject(null, 'subject-a')).not.toThrow();
    expect(() => assertCanBindSubject('subject-a', 'subject-a')).not.toThrow();
    expect(() => assertCanBindSubject('subject-a', 'subject-b')).toThrow(IdentityError);
  });

  it('不能把别人的 subject 当成当前员工', () => {
    expect(() => assertSameSubject('subject-a', 'subject-b')).toThrow(IdentityError);
  });
});
