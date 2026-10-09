import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AccessTokenClaims, AccessTokenVerifier } from '@frs/domain';
import type { Request } from 'express';
import { ACCESS_TOKEN_VERIFIER } from './access-token-verifier';

export type AuthenticatedRequest = Request & { claims: AccessTokenClaims };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: '需要登录' });
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: '需要登录' });
    }
    try {
      request.claims = await this.verifier.verify(token);
    } catch {
      throw new UnauthorizedException({ code: 'AUTH_INVALID', message: '登录已失效' });
    }
    return true;
  }
}
