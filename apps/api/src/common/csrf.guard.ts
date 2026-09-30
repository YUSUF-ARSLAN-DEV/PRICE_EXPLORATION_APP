import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { CONFIG, Config } from '../config';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../auth/auth.guard';

/**
 * CSRF defence for cookie-authenticated, state-changing requests (plan 8.2):
 *   1. SameSite=Lax cookies (set at login), plus
 *   2. a custom header (`X-Qarib-CSRF`) which a cross-site form cannot send, plus
 *   3. an Origin allow-list check when the browser sends an Origin header.
 * Bearer-token API clients and anonymous requests are exempt.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const cookies = (req.cookies ?? {}) as Record<string, string>;
    const cookieAuth = Boolean(cookies[ACCESS_COOKIE] || cookies[REFRESH_COOKIE]);
    if (!cookieAuth) return true;
    const origin = req.headers.origin;
    if (origin && !this.cfg.allowedOrigins.includes(origin))
      throw new ForbiddenException('Origin not allowed');
    if (!req.headers['x-qarib-csrf']) throw new ForbiddenException('Missing CSRF header');
    return true;
  }
}
