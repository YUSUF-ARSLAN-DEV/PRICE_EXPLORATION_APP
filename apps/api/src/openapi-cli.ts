/** Writes the OpenAPI document to docs/api/openapi.json (run: pnpm --filter @qarib/api openapi). */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { buildOpenApi } from './app.factory';

async function main() {
  process.env.SHOW_DEMO = 'false';
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('v1');
  await app.init();
  const doc = buildOpenApi(app);
  const out = path.resolve(__dirname, '../../../docs/api/openapi.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  console.log(`wrote ${out} (${Object.keys(doc.paths).length} paths)`);
  await app.close();
}
void main();
