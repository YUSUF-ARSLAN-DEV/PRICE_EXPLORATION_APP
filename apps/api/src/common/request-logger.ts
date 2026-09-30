import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { truncateIp } from './net';

const log = new Logger('http');

/**
 * Structured access log. PII-free by design (plan 8.2): no cookies, headers, bodies, query strings
 * (which may contain search terms), emails or tokens; client IP is truncated to /24.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    log.log(
      JSON.stringify({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(ms),
        ip: truncateIp(req.ip),
      }),
    );
  });
  next();
}
