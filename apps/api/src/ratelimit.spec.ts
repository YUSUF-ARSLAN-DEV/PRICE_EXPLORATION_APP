/**
 * Rate limits are read when the module graph loads, so this spec sets tiny limits first and then
 * requires the app fresh (jest.resetModules) - in isolation from the other specs.
 */
import request from 'supertest';

describe('rate limiting (plan 5.2 / 6.2)', () => {
  let t: import('../test/app').TestApp;
  beforeAll(async () => {
    process.env.RATE_LIMIT_PER_MIN = '8';
    process.env.AUTH_RATE_LIMIT_PER_MIN = '3';
    jest.resetModules();
    const mod = await import('../test/app');
    t = await mod.createTestApp();
  });
  afterAll(async () => {
    await t.close();
    process.env.RATE_LIMIT_PER_MIN = '100000';
    process.env.AUTH_RATE_LIMIT_PER_MIN = '100000';
  });

  it('throttles anonymous API traffic with 429 + Retry-After', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push((await request(t.server).get('/v1/categories')).status);
    expect(statuses.slice(0, 8).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(8).every((s) => s === 429)).toBe(true);
    const blocked = await request(t.server).get('/v1/categories').expect(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.headers['content-type']).toMatch(/problem\+json/);
  });

  it('applies a much stricter limit to authentication endpoints', async () => {
    const out: number[] = [];
    for (let i = 0; i < 5; i++) {
      out.push(
        (
          await request(t.server)
            .post('/v1/auth/login')
            .send({ email: 'nobody@example.com', password: 'wrong-password-1' })
        ).status,
      );
    }
    // first requests are processed (401) until the per-minute auth budget is spent, then 429
    expect(out).toContain(429);
  });
});
