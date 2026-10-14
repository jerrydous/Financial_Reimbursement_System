import { describe, expect, it } from 'vitest';
import { rewriteKeycloakTarget } from './keycloak-route';

describe('公网 Keycloak 地址改送到容器内', () => {
  it('只改主机和端口，路径仍由调用方保留', () => {
    const options = { protocol: 'http:', hostname: '203.0.113.10', port: undefined, path: '/auth/realms/expense' };
    const changed = rewriteKeycloakTarget(options, new URL('http://203.0.113.10/auth'), new URL('http://keycloak:8080/auth'));
    expect(changed).toBe(true);
    expect(options).toMatchObject({ protocol: 'http:', hostname: 'keycloak', port: '8080', path: '/auth/realms/expense' });
  });

  it('其他地址不动', () => {
    const options = { protocol: 'http:', hostname: 'minio', port: '9000' };
    expect(rewriteKeycloakTarget(options, new URL('http://203.0.113.10/auth'), new URL('http://keycloak:8080/auth'))).toBe(false);
    expect(options.hostname).toBe('minio');
  });
});
