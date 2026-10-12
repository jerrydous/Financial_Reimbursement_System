// 登录留在本系统的弹层里，用 Keycloak 的密码授权换令牌，不再跳到另一套登录页。
import Keycloak, { type KeycloakTokenParsed } from 'keycloak-js';
import { useEffect, useState } from 'react';

const keycloakUrl = (import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8088').replace(/\/$/, '');
const realm = import.meta.env.VITE_KEYCLOAK_REALM || 'expense';
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT || 'web';
const realmUrl = `${keycloakUrl}/realms/${encodeURIComponent(realm)}/protocol/openid-connect`;

export const keycloak = new Keycloak({
  url: keycloakUrl,
  realm,
  clientId,
});

const storageKey = 'frs-auth';

type StoredAuth = {
  token: string;
  refreshToken: string;
  idToken?: string;
};

let initPromise: Promise<boolean> | null = null;

export function initAuth(): Promise<boolean> {
  if (!initPromise) {
    const stored = readStoredAuth();
    initPromise = keycloak
      .init({
        pkceMethod: 'S256',
        checkLoginIframe: false,
        token: stored?.token,
        refreshToken: stored?.refreshToken,
        idToken: stored?.idToken,
      })
      .then((authenticated) => {
        if (authenticated) {
          rememberSession();
        } else {
          writeStoredAuth(null);
        }
        return authenticated;
      })
      .catch(() => {
        writeStoredAuth(null);
        return false;
      });
  }
  return initPromise;
}

export async function authHeader(): Promise<HeadersInit> {
  if (!keycloak.authenticated) {
    return {};
  }
  await keycloak.updateToken(30);
  rememberSession();
  return { Authorization: `Bearer ${keycloak.token ?? ''}` };
}

export async function loginWithPassword(username: string, password: string): Promise<void> {
  await initAuth();
  let response: Response;
  try {
    response = await fetch(`${realmUrl}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: clientId,
        username,
        password,
        scope: 'openid',
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('登录服务暂时连不上，请稍后再试');
  }
  if (!response.ok) {
    throw new Error(await loginFailureMessage(response));
  }
  const payload = (await response.json()) as { access_token?: string; refresh_token?: string; id_token?: string };
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error('登录没有成功，请稍后再试');
  }
  applySession(payload.access_token, payload.refresh_token, payload.id_token);
}

export async function signOut(): Promise<void> {
  const refreshToken = keycloak.refreshToken;
  if (refreshToken) {
    await fetch(`${realmUrl}/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, refresh_token: refreshToken }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
  writeStoredAuth(null);
  keycloak.clearToken();
}

export function useSession(): { phase: 'loading' | 'ready'; authenticated: boolean } {
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let alive = true;
    const sync = () => {
      if (!alive) {
        return;
      }
      setAuthenticated(keycloak.authenticated === true);
      setPhase('ready');
    };
    keycloak.onReady = sync;
    keycloak.onAuthSuccess = () => {
      rememberSession();
      sync();
    };
    keycloak.onAuthRefreshSuccess = () => {
      rememberSession();
    };
    keycloak.onAuthLogout = () => {
      writeStoredAuth(null);
      if (!alive) {
        return;
      }
      setAuthenticated(false);
      setPhase('ready');
    };
    keycloak.onAuthError = () => {
      writeStoredAuth(null);
      if (!alive) {
        return;
      }
      setAuthenticated(false);
      setPhase('ready');
    };
    keycloak.onAuthRefreshError = () => {
      writeStoredAuth(null);
      if (!alive) {
        return;
      }
      setAuthenticated(false);
    };
    void initAuth().then(sync);
    return () => {
      alive = false;
    };
  }, []);

  return { phase, authenticated };
}

function applySession(token: string, refreshToken: string, idToken?: string): void {
  const parsed = decodeJwt(token);
  keycloak.token = token;
  keycloak.refreshToken = refreshToken;
  keycloak.idToken = idToken;
  keycloak.tokenParsed = parsed;
  keycloak.refreshTokenParsed = decodeJwt(refreshToken);
  keycloak.idTokenParsed = idToken ? decodeJwt(idToken) : undefined;
  keycloak.authenticated = true;
  keycloak.subject = parsed.sub;
  keycloak.sessionId = typeof parsed.sid === 'string' ? parsed.sid : undefined;
  keycloak.realmAccess = parsed.realm_access;
  keycloak.resourceAccess = parsed.resource_access;
  if (typeof parsed.iat === 'number') {
    keycloak.timeSkew = Math.floor(Date.now() / 1000) - parsed.iat;
  }
  rememberSession();
  keycloak.onAuthSuccess?.();
}

function rememberSession(): void {
  if (!keycloak.token || !keycloak.refreshToken) {
    writeStoredAuth(null);
    return;
  }
  writeStoredAuth({
    token: keycloak.token,
    refreshToken: keycloak.refreshToken,
    idToken: keycloak.idToken,
  });
}

function readStoredAuth(): StoredAuth | null {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAuth>;
    if (!parsed.token || !parsed.refreshToken) {
      return null;
    }
    return { token: parsed.token, refreshToken: parsed.refreshToken, idToken: parsed.idToken };
  } catch {
    return null;
  }
}

function writeStoredAuth(value: StoredAuth | null): void {
  if (!value) {
    sessionStorage.removeItem(storageKey);
    return;
  }
  sessionStorage.setItem(storageKey, JSON.stringify(value));
}

function decodeJwt(token: string): KeycloakTokenParsed {
  const payload = token.split('.')[1] ?? '';
  const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  const json = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  return JSON.parse(json) as KeycloakTokenParsed;
}

async function loginFailureMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (body?.error === 'invalid_grant' || response.status === 401) {
    return '账号或密码不正确';
  }
  return '登录没有成功，请稍后再试';
}
