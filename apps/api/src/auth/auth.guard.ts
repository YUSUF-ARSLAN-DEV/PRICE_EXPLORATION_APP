import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { CONFIG, Config } from '../config';
import { Db } from '../db/db.service';

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  locale: 'en' | 'ar';
}
export type AuthedRequest = Request & { user?: AuthUser };

export const ACCESS_COOKIE = 'qarib_at';
export const REFRESH_COOKIE = 'qarib_rt';

@Injectable()
export class AuthResolver {
  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    private readonly db: Db,
  ) {}

  /** Resolve the caller from the access cookie or a Bearer token. Returns undefined if anonymous. */
  async resolve(req: Request): Promise<AuthUser | undefined> {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE] ?? bearer;
    if (!token) return undefined;
    let claims: { sub?: string; typ?: string };
    try {
      claims = jwt.verify(token, this.cfg.jwtSecret, { algorithms: ['HS256'] }) as typeof claims;
    } catch {
      return undefined;
    }
    if (claims.typ !== 'access' || !claims.sub) return undefined;
    const u = await this.db.one<{
      id: string;
      email: string;
      role: 'user' | 'admin';
      locale: 'en' | 'ar';
    }>(
      'select id, email::text as email, role, locale from users where id = $1 and deleted_at is null',
      [claims.sub],
    );
    return u;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly resolver: AuthResolver) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.resolver.resolve(req);
    if (!user) throw new UnauthorizedException('Sign in required');
    req.user = user;
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly resolver: AuthResolver) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.resolver.resolve(req);
    if (!user) throw new UnauthorizedException('Sign in required');
    if (user.role !== 'admin') throw new ForbiddenException('Admin only');
    req.user = user;
    return true;
  }
}

/** Sets req.user when a valid session exists, never rejects (for anonymous-first endpoints). */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly resolver: AuthResolver) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    req.user = await this.resolver.resolve(req);
    return true;
  }
}
