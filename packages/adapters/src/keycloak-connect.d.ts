declare module 'keycloak-connect' {
  class Keycloak {
    grantManager: {
      createGrant(rawData: { access_token: string }): Promise<{
        access_token?: { content?: { sub?: string; preferred_username?: string } };
      }>;
    };

    constructor(
      config: { store: unknown },
      keycloakConfig: Record<string, string | number | boolean>,
    );
  }

  export = Keycloak;
}
