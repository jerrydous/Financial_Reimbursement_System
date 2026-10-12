// 浏览器登录来自 keycloak-js。本文件在应用内换取令牌，避免跳到英文登录页。
import Keycloak from 'keycloak-js';

const keycloakUrl = import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8088';
const realm = import.meta.env.VITE_KEYCLOAK_REALM || 'expense';
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT || 'web';
const storageKey = 'frs.auth';

export const keycloak = new Keycloak({
  url: keycloakUrl,
  realm,
  clientId,
});

let initPromise: Promise<boolean> | null = null;

type StoredAuth = {
  token: string;
  refreshToken: string;
  idToken?: string;
};

function tokenEndpoint(): string {
  return `${keycloakUrl.replace(/\/$/, '')}/realms/${realm}/protocol/openid-connect/token`;
}

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? '';
  const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    Array.from(atob(padded), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
  );
  return JSON.parse(json) as Record<string, unknown>;
}

function readStored(): StoredAuth | null {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredAuth;
    if (!parsed.token || !parsed.refreshToken) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistTokens(): void {
  if (!keycloak.token || !keycloak.refreshToken) {
    return;
  }
  const stored: StoredAuth = {
    token: keycloak.token,
    refreshToken: keycloak.refreshToken,
    idToken: keycloak.idToken,
  };
  sessionStorage.setItem(storageKey, JSON.stringify(stored));
}

function clearStored(): void {
  sessionStorage.removeItem(storageKey);
}

function applyTokens(accessToken: string, refreshToken: string, idToken?: string): void {
  const parsed = decodeJwt(accessToken);
  const issuedAt = typeof parsed.iat === 'number' ? parsed.iat : Math.floor(Date.now() / 1000);
  keycloak.token = accessToken;
  keycloak.refreshToken = refreshToken;
  keycloak.tokenParsed = parsed as NonNullable<typeof keycloak.tokenParsed>;
  keycloak.refreshTokenParsed = decodeJwt(refreshToken) as NonNullable<typeof keycloak.refreshTokenParsed>;
  if (idToken) {
    keycloak.idToken = idToken;
    keycloak.idTokenParsed = decodeJwt(idToken) as NonNullable<typeof keycloak.idTokenParsed>;
  }
  keycloak.authenticated = true;
  keycloak.subject = typeof parsed.sub === 'string' ? parsed.sub : undefined;
  keycloak.sessionId = typeof parsed.sid === 'string' ? parsed.sid : undefined;
  keycloak.realmAccess = parsed.realm_access as typeof keycloak.realmAccess;
  keycloak.resourceAccess = parsed.resource_access as typeof keycloak.resourceAccess;
  keycloak.timeSkew = Math.floor(Date.now() / 1000) - issuedAt;
  persistTokens();
  keycloak.onAuthSuccess?.();
}

export function initAuth(): Promise<boolean> {
  if (!initPromise) {
    keycloak.onAuthRefreshSuccess = () => {
      persistTokens();
    };
    const stored = readStored();
    initPromise = keycloak
      .init({
        pkceMethod: 'S256',
        checkLoginIframe: false,
        token: stored?.token,
        refreshToken: stored?.refreshToken,
        idToken: stored?.idToken,
      })
      .then(() => {
        if (keycloak.authenticated) {
          persistTokens();
          return true;
        }
        clearStored();
        return false;
      })
      .catch(() => {
        clearStored();
        return false;
      });
  }
  return initPromise;
}

export async function loginWithPassword(username: string, password: string): Promise<void> {
  await initAuth();
  let response: Response;
  try {
    response = await fetch(tokenEndpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: clientId,
        username: username.trim(),
        password,
        scope: 'openid',
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('登录服务没有响应');
  }
  const body = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    error?: string;
  } | null;
  if (!response.ok || !body?.access_token || !body.refresh_token) {
    throw new Error(body?.error === 'invalid_grant' ? '用户名或密码不正确' : '登录没有成功，请稍后再试');
  }
  applyTokens(body.access_token, body.refresh_token, body.id_token);
}

export async function logout(): Promise<void> {
  const refreshToken = keycloak.refreshToken;
  if (refreshToken) {
    await fetch(`${keycloakUrl.replace(/\/$/, '')}/realms/${realm}/protocol/openid-connect/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, refresh_token: refreshToken }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined);
  }
  clearStored();
  keycloak.clearToken();
}

export async function authHeader(): Promise<HeadersInit> {
  if (!keycloak.authenticated) {
    return {};
  }
  await keycloak.updateToken(30);
  return { Authorization: `Bearer ${keycloak.token ?? ''}` };
}
