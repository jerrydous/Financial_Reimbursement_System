import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { DomainError } from '@frs/domain';

const PREFIX = 'v1';

function key(): Buffer {
  const configured = process.env.VERIFICATION_DATA_KEY?.trim() ?? '';
  const material = configured.length >= 16 ? configured : 'frs-dev-verification-data-key';
  return createHash('sha256').update(material).digest();
}

export function sealSecret(plain: string): string {
  if (!plain) {
    return '';
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join(':');
}

export function openSecret(stored: string): string {
  if (!stored) {
    return '';
  }
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX || !parts[1] || !parts[2] || !parts[3]) {
    throw new DomainError('VERIFICATION_NOT_CONFIGURED', '查验密钥无法读取，请财务重新保存');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new DomainError('VERIFICATION_NOT_CONFIGURED', '查验密钥无法读取，请财务重新保存');
  }
}

export function secretHint(stored: string): string {
  if (!stored) {
    return '';
  }
  try {
    const plain = openSecret(stored);
    if (plain.length <= 4) {
      return '已保存';
    }
    return plain.slice(-4);
  } catch {
    return '';
  }
}
