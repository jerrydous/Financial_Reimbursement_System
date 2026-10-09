// 浏览器登录来自 keycloak-js。本文件只初始化官方适配器并读取访问令牌。
import Keycloak from 'keycloak-js';

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8088',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'expense',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT || 'web',
});

export async function initAuth(): Promise<boolean> {
  return keycloak.init({ onLoad: 'check-sso', pkceMethod: 'S256' });
}

export async function authHeader(): Promise<HeadersInit> {
  if (!keycloak.authenticated) {
    return {};
  }
  await keycloak.updateToken(30);
  return { Authorization: `Bearer ${keycloak.token ?? ''}` };
}
