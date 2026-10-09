import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.API_URL ?? 'http://127.0.0.1:3000',
  },
  webServer: {
    command: 'pnpm --filter @frs/api start',
    cwd: '../..',
    url: 'http://127.0.0.1:3000/live',
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      ...process.env,
      API_PORT: '3000',
      KEYCLOAK_URL: process.env.KEYCLOAK_URL ?? 'http://127.0.0.1:8088',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://frs:frs@127.0.0.1:5432/frs',
    },
  },
});
