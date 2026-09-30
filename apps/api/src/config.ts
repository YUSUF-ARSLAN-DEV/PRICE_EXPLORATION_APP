import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('postgresql://qarib:qarib_local_only@localhost:5432/qarib'),
  API_PORT: z.coerce.number().int().default(4000),
  JWT_SECRET: z.string().min(32).optional(),
  ACCESS_TTL_S: z.coerce.number().int().min(60).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  APP_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_URL: z.string().url().default('http://localhost:3001'),
  EXTRA_ALLOWED_ORIGINS: z.string().default(''),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  REFRESH_COOKIE_PATH: z.string().default('/v1/auth'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  MAIL_FROM: z.string().default('Qarib <no-reply@example.qa>'),
  LEGAL_EMAIL: z.string().default('legal@example.qa'),
  MEILI_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  MEILI_MASTER_KEY: z.string().optional(),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(120),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),
  RECEIPT_DIR: z.string().default('.receipts'),
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  // Preferred in Azure: managed identity (DefaultAzureCredential), no shared keys.
  AZURE_STORAGE_ACCOUNT_URL: z.string().url().optional(),
  AZURE_RECEIPT_CONTAINER: z.string().default('receipts'),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  SHOW_DEMO: bool.default('false'),
  SWAGGER_UI: bool.optional(),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  databaseUrl: string;
  port: number;
  jwtSecret: string;
  accessTtlS: number;
  refreshTtlDays: number;
  appUrl: string;
  adminUrl: string;
  allowedOrigins: string[];
  cookieSecure: boolean;
  trustProxyHops: number;
  refreshCookiePath: string;
  smtp: { host: string; port: number; from: string };
  legalEmail: string;
  meili?: { url: string; key?: string };
  rateLimitPerMin: number;
  showDemo: boolean;
  swaggerUi: boolean;
  receiptDir: string;
  azure?: { connectionString?: string; accountUrl?: string; container: string };
  clamav?: { host: string; port: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = schema.parse(env);
  const production = e.NODE_ENV === 'production';
  if (production && !e.JWT_SECRET) throw new Error('JWT_SECRET is required in production');
  if (production && e.SHOW_DEMO) throw new Error('SHOW_DEMO must be false in production');
  const origins = [
    e.APP_URL,
    e.ADMIN_URL,
    ...e.EXTRA_ALLOWED_ORIGINS.split(',').map((s) => s.trim()),
  ]
    .filter(Boolean)
    .map((o) => new URL(o).origin);
  return {
    env: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    port: e.API_PORT,
    jwtSecret: e.JWT_SECRET ?? 'dev-only-secret-change-me-dev-only-secret-change-me',
    accessTtlS: e.ACCESS_TTL_S,
    refreshTtlDays: e.REFRESH_TTL_DAYS,
    appUrl: e.APP_URL,
    adminUrl: e.ADMIN_URL,
    allowedOrigins: [...new Set(origins)],
    cookieSecure: e.COOKIE_SECURE ?? production,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    refreshCookiePath: e.REFRESH_COOKIE_PATH,
    smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, from: e.MAIL_FROM },
    legalEmail: e.LEGAL_EMAIL,
    meili: e.MEILI_URL ? { url: e.MEILI_URL, key: e.MEILI_MASTER_KEY } : undefined,
    rateLimitPerMin: e.RATE_LIMIT_PER_MIN,
    showDemo: e.SHOW_DEMO,
    swaggerUi: e.SWAGGER_UI ?? !production,
    receiptDir: e.RECEIPT_DIR,
    azure:
      e.AZURE_STORAGE_ACCOUNT_URL || e.AZURE_STORAGE_CONNECTION_STRING
        ? {
            connectionString: e.AZURE_STORAGE_CONNECTION_STRING,
            accountUrl: e.AZURE_STORAGE_ACCOUNT_URL,
            container: e.AZURE_RECEIPT_CONTAINER,
          }
        : undefined,
    clamav: e.CLAMAV_HOST ? { host: e.CLAMAV_HOST, port: e.CLAMAV_PORT } : undefined,
  };
}

export const CONFIG = Symbol('CONFIG');
