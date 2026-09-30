import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, from, of } from 'rxjs';
import { mergeMap, tap } from 'rxjs/operators';
import { AuthedRequest } from '../auth/auth.guard';
import { Db } from '../db/db.service';
import { clientScope } from './net';

/**
 * Idempotency-Key support for POSTs (plan 6.8). Same key + same route => the stored response is
 * replayed; same key on a different route => 422; concurrent duplicate => 409.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly db: Db) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'];
    if (req.method !== 'POST' || typeof key !== 'string') return next.handle();
    if (key.length < 8 || key.length > 100)
      throw new UnprocessableEntityException('Idempotency-Key must be 8-100 characters');

    const scope = req.user?.id ?? clientScope(req);
    const path = req.route?.path ?? req.path;

    return from(
      this.db.one<{ path: string; status: number; response: unknown }>(
        `insert into idempotency_keys (key, scope, method, path, status) values ($1, $2, 'POST', $3, 0)
         on conflict (key, scope) do nothing returning path, status, response`,
        [key, scope, path],
      ),
    ).pipe(
      mergeMap((inserted) => {
        if (inserted) {
          return next.handle().pipe(
            tap({
              next: (body) => {
                void this.db.query(
                  'update idempotency_keys set status = $3, response = $4 where key = $1 and scope = $2',
                  [key, scope, res.statusCode, JSON.stringify(body ?? null)],
                );
              },
              error: () => {
                void this.db.query('delete from idempotency_keys where key = $1 and scope = $2', [
                  key,
                  scope,
                ]);
              },
            }),
          );
        }
        return from(
          this.db.one<{ path: string; status: number; response: unknown }>(
            'select path, status, response from idempotency_keys where key = $1 and scope = $2',
            [key, scope],
          ),
        ).pipe(
          mergeMap((row) => {
            if (!row) return next.handle();
            if (row.path !== path)
              throw new UnprocessableEntityException(
                'Idempotency-Key was used for a different request',
              );
            if (row.status === 0)
              throw new ConflictException(
                'A request with this Idempotency-Key is still in progress',
              );
            res.status(row.status).setHeader('Idempotent-Replayed', 'true');
            return of(row.response);
          }),
        );
      }),
    );
  }
}
