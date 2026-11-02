import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AccessTokenVerifier } from '@frs/domain';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_VERIFIER } from './access-token-verifier';
import { AuthGuard } from './auth.guard';
import { EmployeeController } from '../employee/employee.controller';
import { EmployeeService } from '../employee/employee.service';
import { ApiExceptionFilter } from '../http-exception.filter';

describe('未登录访问员工身份', () => {
  it('没有 Bearer 令牌时返回 401，并且不会去校验令牌', async () => {
    const verifier: AccessTokenVerifier = {
      verify: () => Promise.reject(new Error('should not be called')),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [EmployeeController],
      providers: [
        AuthGuard,
        { provide: ACCESS_TOKEN_VERIFIER, useValue: verifier },
        {
          provide: EmployeeService,
          useValue: { getOwn: () => Promise.reject(new Error('should not load employee')) },
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    const response = await request(app.getHttpServer()).get('/me');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'AUTH_REQUIRED', message: '需要登录' });
    expect(response.body).not.toHaveProperty('stack');

    await app.close();
  });

  it('校验失败时返回 AUTH_INVALID', async () => {
    const verifier: AccessTokenVerifier = {
      verify: () => Promise.reject(new UnauthorizedException('no')),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [EmployeeController],
      providers: [
        AuthGuard,
        { provide: ACCESS_TOKEN_VERIFIER, useValue: verifier },
        { provide: EmployeeService, useValue: { getOwn: () => Promise.resolve(null) } },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();

    const response = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', 'Bearer not-a-token');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('AUTH_INVALID');
    await app.close();
  });
});
