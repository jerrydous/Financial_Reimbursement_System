// 浏览器登录来自 keycloak-js。本文件只初始化官方适配器并读取访问令牌。
import Keycloak from 'keycloak-js';
import { useEffect, useState } from 'react';

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8088',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'expense',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT || 'web',
});

let initPromise: Promise<boolean> | null = null;

export function initAuth(): Promise<boolean> {
  if (!initPromise) {
    initPromise = keycloak.init({ onLoad: 'check-sso', pkceMethod: 'S256' }).catch((error: unknown) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

export async function authHeader(): Promise<HeadersInit> {
  if (!keycloak.authenticated) {
    return {};
  }
  await keycloak.updateToken(30);
  return { Authorization: `Bearer ${keycloak.token ?? ''}` };
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
    keycloak.onAuthSuccess = sync;
    keycloak.onAuthLogout = () => {
      if (!alive) {
        return;
      }
      setAuthenticated(false);
      setPhase('ready');
    };
    keycloak.onAuthError = () => {
      if (!alive) {
        return;
      }
      setAuthenticated(false);
      setPhase('ready');
    };
    keycloak.onAuthRefreshError = () => {
      if (!alive) {
        return;
      }
      setAuthenticated(false);
    };
    void initAuth().then(sync).catch(() => {
      if (!alive) {
        return;
      }
      setAuthenticated(false);
      setPhase('ready');
    });
    return () => {
      alive = false;
    };
  }, []);

  return { phase, authenticated };
}
