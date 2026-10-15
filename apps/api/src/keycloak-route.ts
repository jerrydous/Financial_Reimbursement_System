import http from 'node:http';
import https from 'node:https';
import type { RequestOptions } from 'node:http';

function defaultPort(protocol?: string | null, explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  return protocol === 'https:' ? '443' : '80';
}

/** 把发往公网 Keycloak 地址的请求改送到容器内地址，路径和签发者仍用公网地址。 */
export function rewriteKeycloakTarget(options: RequestOptions, external: URL, internal: URL): boolean {
  const hostname = options.hostname || String(options.host ?? '').split(':')[0];
  if (!hostname || hostname !== external.hostname) {
    return false;
  }
  const port = options.port != null && String(options.port) !== '' ? String(options.port) : defaultPort(options.protocol);
  if (port !== defaultPort(external.protocol, external.port)) {
    return false;
  }
  options.protocol = internal.protocol;
  options.hostname = internal.hostname;
  options.host = internal.host;
  options.port = internal.port || defaultPort(internal.protocol);
  return true;
}

type HttpLike = { request: typeof http.request };

function patch(mod: HttpLike, external: URL, internal: URL, secure: boolean): void {
  const original = mod.request.bind(mod);
  mod.request = ((input: RequestOptions | string | URL, options?: RequestOptions | ((response: http.IncomingMessage) => void), callback?: (response: http.IncomingMessage) => void) => {
    if (input && typeof input === 'object' && !(input instanceof URL)) {
      const switched = rewriteKeycloakTarget(input, external, internal);
      const next = typeof options === 'function' ? options : callback;
      if (switched && input.protocol === 'http:' && secure) {
        return http.request(input, next);
      }
      if (switched && input.protocol === 'https:' && !secure) {
        return https.request(input, next);
      }
    }
    return original(input as never, options as never, callback as never);
  }) as typeof http.request;
}

export function installKeycloakInternalRoute(): void {
  const externalRaw = process.env.KEYCLOAK_URL?.trim();
  const internalRaw = process.env.KEYCLOAK_INTERNAL_URL?.trim();
  if (!externalRaw || !internalRaw || externalRaw === internalRaw) {
    return;
  }
  const external = new URL(externalRaw);
  const internal = new URL(internalRaw);
  patch(http, external, internal, false);
  patch(https, external, internal, true);
}
