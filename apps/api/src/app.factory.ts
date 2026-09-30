import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ProblemFilter } from './common/problem.filter';
import { requestLogger } from './common/request-logger';
import { CONFIG, Config } from './config';

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const doc = new DocumentBuilder()
    .setTitle('Qarib API')
    .setDescription(
      'Qatar grocery price comparison. Prices come from retailers, partners and community reports and may change.',
    )
    .setVersion('1.0')
    .addCookieAuth('qarib_at')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, doc);
}

/** Shared by main.ts and the test-suite so tests exercise the real HTTP pipeline. */
export async function configureApp(app: NestExpressApplication): Promise<NestExpressApplication> {
  const cfg = app.get<Config>(CONFIG);
  // Number of reverse proxies in front of the API (App Gateway -> Next.js rewrite = 2), so that
  // req.ip is the real client and rate limits / truncated-IP logs are per client, not per proxy.
  if (cfg.trustProxyHops > 0) app.set('trust proxy', cfg.trustProxyHops);
  app.disable('x-powered-by');
  app.use(
    helmet({
      // API returns JSON only; Swagger UI (dev) needs inline assets so CSP is relaxed only there.
      contentSecurityPolicy: cfg.swaggerUi
        ? false
        : { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts:
        cfg.env === 'production'
          ? { maxAge: 63072000, includeSubDomains: true, preload: true }
          : false,
    }),
  );
  app.use(cookieParser());
  app.use(requestLogger);
  app.enableCors({
    origin: cfg.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Qarib-CSRF', 'Idempotency-Key'],
    exposedHeaders: ['Idempotent-Replayed'],
    maxAge: 600,
  });
  app.setGlobalPrefix('v1', { exclude: [] });
  app.useGlobalFilters(new ProblemFilter());
  app.useBodyParser('json', { limit: '256kb' });

  const doc = buildOpenApi(app);
  // The raw spec is always served; the interactive UI only outside production.
  const serveSpec = (_req: unknown, res: { json(body: unknown): void }) => res.json(doc);
  app.getHttpAdapter().get('/v1/openapi.json', serveSpec as never);
  if (cfg.swaggerUi) SwaggerModule.setup('v1/docs', app, doc);
  return app;
}

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  return configureApp(app);
}
