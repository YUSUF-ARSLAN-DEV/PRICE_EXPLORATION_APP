import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthSchema } from '@qarib/shared';
import { AppModule } from './app.module';

describe('GET /health', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  it('returns a valid health payload', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(HealthSchema.safeParse(res.body).success).toBe(true);
  });
});
