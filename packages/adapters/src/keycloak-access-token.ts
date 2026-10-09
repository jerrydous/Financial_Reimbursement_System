// 令牌校验来自 keycloak-connect 的 GrantManager。本文件只把 Keycloak 的 subject 映射成领域声明。
import {
  type AccessTokenClaims,
  type AccessTokenVerifier,
  IdentityError,
} from '@frs/domain';
import session from 'express-session';
import KeycloakConnect from 'keycloak-connect';

type KeycloakTokenContent = {
  sub?: string;
  preferred_username?: string;
};

type KeycloakGrant = {
  access_token?: {
    content?: KeycloakTokenContent;
  };
};

type KeycloakConnectInstance = {
  grantManager: {
    createGrant: (raw: { access_token: string }) => Promise<KeycloakGrant>;
  };
};

export class KeycloakAccessTokenVerifier implements AccessTokenVerifier {
  private readonly keycloak: KeycloakConnectInstance;

  constructor(options: { baseUrl: string; realm: string; clientId: string }) {
    const store = new session.MemoryStore();
    const factory = KeycloakConnect as unknown as new (
      options: { store: session.MemoryStore },
      config: Record<string, string | boolean | number>,
    ) => KeycloakConnectInstance;
    this.keycloak = new factory(
      { store },
      {
        realm: options.realm,
        'auth-server-url': options.baseUrl.replace(/\/$/, ''),
        resource: options.clientId,
        'bearer-only': true,
        'confidential-port': 0,
      },
    );
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const grant = await this.keycloak.grantManager.createGrant({ access_token: token });
    const content = grant.access_token?.content;
    if (!content?.sub || !content.preferred_username) {
      throw new IdentityError();
    }
    return {
      subject: content.sub,
      username: content.preferred_username,
    };
  }
}
