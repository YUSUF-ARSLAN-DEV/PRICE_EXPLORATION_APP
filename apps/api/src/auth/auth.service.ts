import { randomBytes, randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { CONFIG, Config } from '../config';
import { Db } from '../db/db.service';
import { inetForStorage, sha256 } from '../common/net';
import { Mailer } from '../mail/mailer';
import { ACCESS_COOKIE, REFRESH_COOKIE, AuthUser } from './auth.guard';

// OWASP-recommended argon2id parameters (19 MiB, t=2, p=1). 2 === Algorithm.Argon2id.
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const hashPassword = (pw: string) => hash(pw, ARGON);

type UserRow = {
  id: string;
  email: string;
  pw_hash: string;
  role: 'user' | 'admin';
  locale: 'en' | 'ar';
  email_verified_at: Date | null;
  failed_logins: number;
  locked_until: Date | null;
};

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    private readonly db: Db,
    private readonly mailer: Mailer,
  ) {}

  // ---- registration & email verification ------------------------------------------------------
  async register(
    req: Request,
    body: { email: string; password: string; locale: 'en' | 'ar'; consentVersion: string },
  ): Promise<void> {
    const pwHash = await hashPassword(body.password);
    try {
      const token = await this.db.tx(async (c) => {
        const u = await c.query<{ id: string }>(
          'insert into users (email, pw_hash, locale) values ($1, $2, $3) returning id',
          [body.email, pwHash, body.locale],
        );
        const id = u.rows[0]!.id;
        await c.query(
          `insert into consents (user_id, purpose, granted, version, ip_trunc) values ($1, 'account_terms', true, $2, $3)`,
          [id, body.consentVersion, inetForStorage(req)],
        );
        return this.newEmailToken(c, id, 'verify_email', 24 * 60);
      });
      await this.mailer.send({
        to: body.email,
        subject: body.locale === 'ar' ? 'تأكيد بريدك الإلكتروني' : 'Confirm your email',
        text: `${this.cfg.appUrl}/${body.locale}/verify?token=${token}\n\nThis link expires in 24 hours. If you did not sign up, ignore this email.`,
      });
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
      // Already registered: respond identically (no account enumeration) but tell the owner.
      await this.mailer.send({
        to: body.email,
        subject: 'Sign-up attempt',
        text: `Someone tried to sign up with this address, but an account already exists. If this was you, sign in or reset your password at ${this.cfg.appUrl}.`,
      });
    }
  }

  private async newEmailToken(
    c: { query: (sql: string, params: unknown[]) => Promise<unknown> },
    userId: string,
    purpose: 'verify_email' | 'reset_password',
    minutes: number,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await c.query(
      `insert into email_tokens (user_id, purpose, token_hash, expires_at)
       values ($1, $2, $3, now() + make_interval(mins => $4))`,
      [userId, purpose, sha256(token), minutes],
    );
    return token;
  }

  private async consumeToken(token: string, purpose: string): Promise<string> {
    const row = await this.db.one<{ user_id: string }>(
      `update email_tokens set used_at = now()
        where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
        returning user_id`,
      [sha256(token), purpose],
    );
    if (!row) throw new HttpException('Invalid or expired token', HttpStatus.BAD_REQUEST);
    return row.user_id;
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.consumeToken(token, 'verify_email');
    await this.db.query(
      'update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1',
      [userId],
    );
  }

  // ---- login / sessions -----------------------------------------------------------------------
  private async fakeVerify(password: string): Promise<void> {
    this.dummyHash ??= hashPassword('dummy-password-for-timing');
    await verify(await this.dummyHash, password).catch(() => false);
  }

  async login(req: Request, res: Response, email: string, password: string): Promise<AuthUser> {
    const u = await this.db.one<UserRow>(
      `select id, email::text as email, pw_hash, role, locale, email_verified_at, failed_logins, locked_until
         from users where email = $1 and deleted_at is null`,
      [email],
    );
    const invalid = new UnauthorizedException('Invalid email or password');
    if (!u) {
      await this.fakeVerify(password); // equalise timing: no user enumeration
      throw invalid;
    }
    if (u.locked_until && u.locked_until > new Date()) {
      throw new HttpException(
        'Too many failed attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const ok = await verify(u.pw_hash, password).catch(() => false);
    if (!ok) {
      await this.db.query(
        `update users set failed_logins = failed_logins + 1,
                locked_until = case when failed_logins + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end
          where id = $1`,
        [u.id, MAX_FAILED, LOCK_MINUTES],
      );
      throw invalid;
    }
    if (!u.email_verified_at)
      throw new ForbiddenException({ message: 'Email not verified', code: 'email_not_verified' });
    await this.db.query('update users set failed_logins = 0, locked_until = null where id = $1', [
      u.id,
    ]);
    await this.issueSession(res, { id: u.id, role: u.role }, randomUUID());
    return { id: u.id, email: u.email, role: u.role, locale: u.locale };
  }

  private async issueSession(
    res: Response,
    user: { id: string; role: string },
    family: string,
  ): Promise<void> {
    const access = jwt.sign({ sub: user.id, role: user.role, typ: 'access' }, this.cfg.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: this.cfg.accessTtlS,
    });
    const refresh = randomBytes(48).toString('base64url');
    await this.db.query(
      `insert into refresh_tokens (user_id, family, token_hash, expires_at)
       values ($1, $2, $3, now() + make_interval(days => $4))`,
      [user.id, family, sha256(refresh), this.cfg.refreshTtlDays],
    );
    const base = { httpOnly: true, secure: this.cfg.cookieSecure, sameSite: 'lax' as const };
    res.cookie(ACCESS_COOKIE, access, { ...base, path: '/', maxAge: this.cfg.accessTtlS * 1000 });
    res.cookie(REFRESH_COOKIE, refresh, {
      ...base,
      path: this.cfg.refreshCookiePath,
      maxAge: this.cfg.refreshTtlDays * 86400 * 1000,
    });
  }

  clearCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: this.cfg.refreshCookiePath });
  }

  /** Rotate the refresh token. Replaying a revoked token revokes the whole family (theft signal). */
  async refresh(req: Request, res: Response): Promise<AuthUser> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('No session');
    const row = await this.db.one<{
      id: string;
      user_id: string;
      family: string;
      revoked_at: Date | null;
      expires_at: Date;
    }>(
      'select id, user_id, family, revoked_at, expires_at from refresh_tokens where token_hash = $1',
      [sha256(token)],
    );
    if (!row) throw new UnauthorizedException('Invalid session');
    if (row.revoked_at) {
      await this.db.query(
        'update refresh_tokens set revoked_at = now() where family = $1 and revoked_at is null',
        [row.family],
      );
      this.clearCookies(res);
      throw new UnauthorizedException('Session revoked');
    }
    if (row.expires_at < new Date()) throw new UnauthorizedException('Session expired');
    const u = await this.db.one<{
      id: string;
      email: string;
      role: 'user' | 'admin';
      locale: 'en' | 'ar';
    }>(
      'select id, email::text as email, role, locale from users where id = $1 and deleted_at is null',
      [row.user_id],
    );
    if (!u) throw new UnauthorizedException('Invalid session');
    await this.db.query('update refresh_tokens set revoked_at = now() where id = $1', [row.id]);
    await this.issueSession(res, u, row.family);
    return u;
  }

  async logout(req: Request, res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (token) {
      await this.db.query(
        `update refresh_tokens set revoked_at = now()
          where family = (select family from refresh_tokens where token_hash = $1) and revoked_at is null`,
        [sha256(token)],
      );
    }
    this.clearCookies(res);
  }

  // ---- password reset -------------------------------------------------------------------------
  async forgotPassword(email: string): Promise<void> {
    const u = await this.db.one<{ id: string; locale: string }>(
      'select id, locale from users where email = $1 and deleted_at is null and email_verified_at is not null',
      [email],
    );
    if (!u) return; // silent: no account enumeration
    const token = await this.db.tx((c) => this.newEmailToken(c, u.id, 'reset_password', 60));
    await this.mailer.send({
      to: email,
      subject: 'Reset your password',
      text: `${this.cfg.appUrl}/${u.locale}/reset?token=${token}\n\nThis link expires in 1 hour. If you did not ask for it, ignore this email.`,
    });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.consumeToken(token, 'reset_password');
    const pwHash = await hashPassword(password);
    await this.db.tx(async (c) => {
      await c.query(
        'update users set pw_hash = $2, failed_logins = 0, locked_until = null where id = $1',
        [userId, pwHash],
      );
      await c.query(
        'update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null',
        [userId],
      );
    });
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const u = await this.db.one<{ pw_hash: string }>(
      'select pw_hash from users where id = $1 and deleted_at is null',
      [userId],
    );
    return u ? verify(u.pw_hash, password).catch(() => false) : false;
  }

  async revokeAll(userId: string): Promise<void> {
    await this.db.query(
      'update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null',
      [userId],
    );
  }
}
