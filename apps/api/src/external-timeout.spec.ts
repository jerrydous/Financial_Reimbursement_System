import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { withExternalDeadline } from '@frs/adapters';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

function productionSources(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name === 'dist' || name.endsWith('.spec.ts')) {
      continue;
    }
    const fullPath = path.join(directory, name);
    if (statSync(fullPath).isDirectory()) {
      files.push(...productionSources(fullPath));
    } else if (/\.(ts|js)$/.test(name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('外部调用必须有超时', () => {
  it('挂起的调用在期限内失败', async () => {
    await expect(withExternalDeadline(new Promise(() => undefined), 20)).rejects.toThrow('EXTERNAL_TIMEOUT');
  });

  it('生产代码里的 fetch 都带 AbortSignal.timeout', () => {
    const files = [
      ...productionSources(path.join(repoRoot, 'apps/api/src')),
      ...productionSources(path.join(repoRoot, 'apps/worker/src')),
      ...productionSources(path.join(repoRoot, 'apps/web/src')),
      ...productionSources(path.join(repoRoot, 'packages/adapters/src')),
    ];
    const missing = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes('fetch(') && !source.includes('AbortSignal.timeout');
    });
    expect(missing).toEqual([]);
  });

  it('Keycloak 校验和对象存储都限制等待时间', () => {
    const keycloak = readFileSync(path.join(repoRoot, 'packages/adapters/src/keycloak-access-token.ts'), 'utf8');
    const storage = readFileSync(path.join(repoRoot, 'packages/adapters/src/s3-invoice-storage.ts'), 'utf8');
    expect(keycloak).toContain('withExternalDeadline');
    expect(storage).toContain('throwOnRequestTimeout: true');
    expect(storage).toContain('abortSignal: AbortSignal.timeout');
  });
});
