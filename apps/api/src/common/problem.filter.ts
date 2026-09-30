import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

/** RFC 7807 problem details for every error (plan 6.8). Never leaks internals on 5xx. */
interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: { path: string; message: string }[];
  code?: string;
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
};

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('errors');

  catch(exc: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const problem = this.toProblem(exc, req.path);
    if (problem.status >= 500)
      this.log.error(exc instanceof Error ? (exc.stack ?? exc.message) : String(exc));
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exc: unknown, instance: string): Problem {
    const base = (status: number, extra: Partial<Problem> = {}): Problem => ({
      type: `https://httpstatuses.com/${status}`,
      title: TITLES[status] ?? 'Error',
      status,
      instance,
      ...extra,
    });

    if (exc instanceof ZodError) {
      return base(422, {
        detail: 'Validation failed',
        errors: exc.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    if (exc instanceof HttpException) {
      const status = exc.getStatus();
      const body = exc.getResponse();
      const obj = typeof body === 'object' ? (body as Record<string, unknown>) : { message: body };
      const message = Array.isArray(obj.message)
        ? obj.message.join('; ')
        : (obj.message as string | undefined);
      return base(status, { detail: message, code: obj.code as string | undefined });
    }
    // Errors from Express middleware (body-parser: 413 too large, 400 malformed JSON ...)
    const http = exc as { status?: number; statusCode?: number; type?: string };
    const code = http?.status ?? http?.statusCode;
    if (typeof code === 'number' && code >= 400 && code < 500 && typeof http.type === 'string') {
      return base(code, { detail: code === 413 ? 'Request body too large' : 'Malformed request' });
    }
    // Database unreachable / restarting / pool exhausted: a clean 503, never a leaked connection error
    const net = exc as { code?: string; message?: string };
    if (
      (typeof net?.code === 'string' &&
        /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|57P0[1-3]|08[0-9]{3}|53300)$/.test(
          net.code,
        )) ||
      /Connection terminated|timeout exceeded when trying to connect/i.test(net?.message ?? '')
    ) {
      return base(503, {
        title: 'Service Unavailable',
        detail: 'The service is temporarily unavailable. Please try again shortly.',
        code: 'unavailable',
      });
    }
    // Postgres errors raised by our SQL functions / constraints
    const pg = exc as { code?: string; message?: string };
    if (pg && typeof pg.code === 'string') {
      if (pg.code === 'QAR01') return base(409, { detail: pg.message });
      if (pg.code === 'QAR02') return base(409, { detail: pg.message });
      if (pg.code === 'QAR03') return base(403, { detail: pg.message, code: 'four_eyes' });
      if (pg.code === '23505') return base(409, { detail: 'Already exists' });
      if (pg.code === '23503') return base(400, { detail: 'Referenced record does not exist' });
      if (pg.code === '23514' || pg.code === '22P02') return base(400, { detail: 'Invalid value' });
    }
    return base(500, { title: 'Internal Server Error', detail: 'Unexpected error' });
  }
}
