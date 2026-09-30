import { createHash } from 'node:crypto';
import type { Request } from 'express';

/** Truncate an IP for storage/logs: IPv4 -> /24, IPv6 -> /48 (plan 0.3, ROPA #2/#6). */
export function truncateIp(ip: string | undefined): string | null {
  if (!ip) return null;
  const v = ip.replace(/^::ffff:/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return v.split('.').slice(0, 3).join('.') + '.0';
  if (v.includes(':')) {
    const parts = v.split(':').filter((_, i) => i < 3);
    return parts.join(':') + '::';
  }
  return null;
}

/** Network value usable with Postgres `inet` (a /24 network address, never the raw client IP). */
export function inetForStorage(req: Request): string | null {
  const t = truncateIp(req.ip);
  if (!t) return null;
  return t.includes(':') ? `${t}/48` : `${t}/24`;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function clientScope(req: Request): string {
  return 'anon:' + sha256(truncateIp(req.ip) ?? 'unknown').slice(0, 32);
}
