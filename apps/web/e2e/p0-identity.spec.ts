import { expect, test } from '@playwright/test';

test('未登录不能提交报销单', async ({ request }) => {
  const response = await request.post('/expense-reports', {
    data: { invoiceIds: ['33333333-3333-4333-8333-333333333333'] },
    headers: { 'idempotency-key': 'missing-auth' },
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ code: 'AUTH_REQUIRED', message: '需要登录' });
});

test('未登录不能读取员工身份', async ({ request }) => {
  const response = await request.get('/me');
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ code: 'AUTH_REQUIRED', message: '需要登录' });
});

test('登录后只返回自己的员工身份，报销列表为空', async ({ request }) => {
  const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://127.0.0.1:8088';
  let tokenResponse;
  try {
    tokenResponse = await request.post(
      `${keycloakUrl}/realms/expense/protocol/openid-connect/token`,
      {
        form: {
          client_id: 'web',
          grant_type: 'password',
          username: process.env.KEYCLOAK_DEV_USER ?? 'employee1',
          password: process.env.KEYCLOAK_DEV_PASSWORD ?? 'employee1',
        },
        failOnStatusCode: false,
        timeout: 3000,
      },
    );
  } catch {
    test.skip(true, 'Keycloak 未启动，跳过登录身份断言');
    return;
  }
  test.skip(tokenResponse.status() !== 200, 'Keycloak 未启动，跳过登录身份断言');
  const tokenBody = (await tokenResponse.json()) as { access_token?: string };
  expect(tokenBody.access_token).toBeTruthy();
  const me = await request.get('/me', {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  expect(me.status()).toBe(200);
  const employee = (await me.json()) as { username: string; company: { name: string } };
  expect(employee.username).toBe('employee1');
  expect(employee.company.name).toBe('示例公司');
  const list = await request.get('/expense-reports', {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  expect(list.status()).toBe(200);
  expect(await list.json()).toMatchObject({ items: [], total: 0 });
});
