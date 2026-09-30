import request from 'supertest';
import { PASSWORD, TestApp, client, createTestApp, signUp, uniq } from '../test/app';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const reg = (email: string, extra: object = {}) => ({
  email,
  password: PASSWORD,
  acceptTerms: true,
  ...extra,
});

describe('registration', () => {
  it('always answers 202 and sends a verification email; stores a hash, never the password', async () => {
    const email = `${uniq('r')}@example.com`;
    const res = await request(t.server).post('/v1/auth/register').send(reg(email)).expect(202);
    expect(res.body.message).toMatch(/confirmation/i);
    expect(t.mailer.last(email)?.text).toContain('/verify?token=');
    const row = await t.db.one<{ pw_hash: string }>('select pw_hash from users where email = $1', [
      email,
    ]);
    expect(row!.pw_hash).toMatch(/^\$argon2id\$/);
    expect(row!.pw_hash).not.toContain(PASSWORD);
    const consent = await t.db.one<{ purpose: string; granted: boolean; ip_trunc: string | null }>(
      `select c.purpose, c.granted, c.ip_trunc::text from consents c join users u on u.id = c.user_id where u.email = $1`,
      [email],
    );
    expect(consent).toMatchObject({ purpose: 'account_terms', granted: true });
    // IP is stored only as a truncated network, never a full address
    if (consent!.ip_trunc) expect(consent!.ip_trunc).toMatch(/\/(24|48)$/);
  });

  it('does not reveal whether an address is already registered', async () => {
    const { email } = await signUp(t);
    const before = t.mailer.sent.length;
    const res = await request(t.server).post('/v1/auth/register').send(reg(email)).expect(202);
    expect(res.body.message).toMatch(/confirmation/i);
    expect(t.mailer.sent.length).toBe(before + 1);
    expect(t.mailer.last(email)?.text).toMatch(/already exists/);
  });

  it.each([
    ['missing terms consent', { acceptTerms: false }],
    ['weak password', { password: 'short1' }],
    ['no digits', { password: 'onlyletterspassword' }],
    ['bad email', { email: 'nope' }],
  ])('rejects %s with a 422 problem document', async (_n, patch) => {
    const res = await request(t.server)
      .post('/v1/auth/register')
      .send({ ...reg(`${uniq('b')}@example.com`), ...patch })
      .expect(422);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 422, title: 'Unprocessable Entity' });
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('verification tokens are single-use and expire', async () => {
    const email = `${uniq('v')}@example.com`;
    await request(t.server).post('/v1/auth/register').send(reg(email)).expect(202);
    const token = t.mailer.tokenFrom(email);
    await request(t.server).post('/v1/auth/verify-email').send({ token }).expect(204);
    await request(t.server).post('/v1/auth/verify-email').send({ token }).expect(400);
    await request(t.server)
      .post('/v1/auth/verify-email')
      .send({ token: 'x'.repeat(43) })
      .expect(400);
    const email2 = `${uniq('v')}@example.com`;
    await request(t.server).post('/v1/auth/register').send(reg(email2)).expect(202);
    await t.db.query(
      `update email_tokens set expires_at = now() - interval '1 minute' where user_id = (select id from users where email = $1)`,
      [email2],
    );
    await request(t.server)
      .post('/v1/auth/verify-email')
      .send({ token: t.mailer.tokenFrom(email2) })
      .expect(400);
  });
});

describe('login & sessions', () => {
  it('blocks unverified accounts, sets httpOnly SameSite cookies on success', async () => {
    const email = `${uniq('l')}@example.com`;
    await request(t.server).post('/v1/auth/register').send(reg(email)).expect(202);
    const blocked = await request(t.server)
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(403);
    expect(blocked.body.code).toBe('email_not_verified');
    await request(t.server)
      .post('/v1/auth/verify-email')
      .send({ token: t.mailer.tokenFrom(email) })
      .expect(204);
    const ok = await request(t.server)
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const cookies = ok.headers['set-cookie'] as unknown as string[];
    expect(cookies).toHaveLength(2);
    for (const c of cookies) (expect(c).toMatch(/HttpOnly/i), expect(c).toMatch(/SameSite=Lax/i));
    expect(cookies.find((c) => c.startsWith('qarib_rt='))).toMatch(/Path=\/v1\/auth/);
    expect(ok.body.user).toMatchObject({ email, role: 'user' });
    expect(JSON.stringify(ok.body)).not.toMatch(/pw_hash|password/);
  });

  it('gives the same error for unknown users and wrong passwords', async () => {
    const { email } = await signUp(t);
    const a = await request(t.server)
      .post('/v1/auth/login')
      .send({ email, password: 'wrong-password-1' })
      .expect(401);
    const b = await request(t.server)
      .post('/v1/auth/login')
      .send({ email: `${uniq('no')}@example.com`, password: 'wrong-password-1' })
      .expect(401);
    expect(a.body.detail).toBe(b.body.detail);
  });

  it('locks the account after 5 failures, even for the right password', async () => {
    const { email } = await signUp(t);
    for (let i = 0; i < 5; i++)
      await request(t.server)
        .post('/v1/auth/login')
        .send({ email, password: 'wrong-password-1' })
        .expect(401);
    await request(t.server).post('/v1/auth/login').send({ email, password: PASSWORD }).expect(429);
    await t.db.query(
      `update users set locked_until = now() - interval '1 second' where email = $1`,
      [email],
    );
    await request(t.server).post('/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  });

  it('rotates refresh tokens and revokes the whole family when an old one is replayed', async () => {
    const email = `${uniq('rf')}@example.com`;
    const c = client(t);
    await c.post('/v1/auth/register').send(reg(email)).expect(202);
    await c
      .post('/v1/auth/verify-email')
      .send({ token: t.mailer.tokenFrom(email) })
      .expect(204);
    const login = await c.post('/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
    const oldRefresh = (login.headers['set-cookie'] as unknown as string[])
      .find((x) => x.startsWith('qarib_rt='))!
      .split(';')[0]!;

    const r1 = await c.post('/v1/auth/refresh').expect(200);
    const newRefresh = (r1.headers['set-cookie'] as unknown as string[])
      .find((x) => x.startsWith('qarib_rt='))!
      .split(';')[0]!;
    expect(newRefresh).not.toBe(oldRefresh);

    // an attacker replays the stolen, already-rotated token
    const attacker = request(t.server);
    await attacker
      .post('/v1/auth/refresh')
      .set('x-qarib-csrf', '1')
      .set('Cookie', oldRefresh)
      .expect(401);
    // the legitimate (newer) token of that family is now dead too
    await request(t.server)
      .post('/v1/auth/refresh')
      .set('x-qarib-csrf', '1')
      .set('Cookie', newRefresh)
      .expect(401);
  });

  it('logout revokes the session and clears cookies', async () => {
    const { c } = await signUp(t);
    await c.get('/v1/me').expect(200);
    const out = await c.post('/v1/auth/logout').expect(204);
    expect((out.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(/qarib_at=;/);
    await c.post('/v1/auth/refresh').expect(401);
  });

  it('rejects tampered, expired or wrong-type access tokens', async () => {
    await request(t.server).get('/v1/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    await request(t.server).get('/v1/me').expect(401);
    const jwt = await import('jsonwebtoken');
    const { email } = await signUp(t);
    const u = await t.db.one<{ id: string }>('select id from users where email = $1', [email]);
    const secret = process.env.JWT_SECRET!;
    const expired = jwt.sign({ sub: u!.id, typ: 'access' }, secret, { expiresIn: -10 });
    const wrongType = jwt.sign({ sub: u!.id, typ: 'unsub' }, secret, { expiresIn: 60 });
    const wrongKey = jwt.sign({ sub: u!.id, typ: 'access' }, 'x'.repeat(40), { expiresIn: 60 });
    const none = jwt.sign({ sub: u!.id, typ: 'access' }, '', { algorithm: 'none' as never });
    for (const tok of [expired, wrongType, wrongKey, none]) {
      await request(t.server).get('/v1/me').set('Authorization', `Bearer ${tok}`).expect(401);
    }
  });
});

describe('password reset', () => {
  it('resets the password, revokes existing sessions, and never reveals unknown emails', async () => {
    const { c, email } = await signUp(t);
    await request(t.server)
      .post('/v1/auth/forgot-password')
      .send({ email: `${uniq('no')}@example.com` })
      .expect(202);
    const sentBefore = t.mailer.sent.length;
    await request(t.server).post('/v1/auth/forgot-password').send({ email }).expect(202);
    expect(t.mailer.sent.length).toBe(sentBefore + 1);
    const token = t.mailer.tokenFrom(email);
    await request(t.server)
      .post('/v1/auth/reset-password')
      .send({ token, password: 'brand-new-pass-77' })
      .expect(204);
    await request(t.server)
      .post('/v1/auth/reset-password')
      .send({ token, password: 'another-pass-88x' })
      .expect(400);
    await c.post('/v1/auth/refresh').expect(401); // old session gone
    await request(t.server).post('/v1/auth/login').send({ email, password: PASSWORD }).expect(401);
    await request(t.server)
      .post('/v1/auth/login')
      .send({ email, password: 'brand-new-pass-77' })
      .expect(200);
  });
});

describe('CSRF protection for cookie sessions', () => {
  it('rejects state-changing cookie requests without the custom header or from a foreign origin', async () => {
    const { c } = await signUp(t);
    await c.agent.patch('/v1/me').send({ locale: 'ar' }).expect(403); // no X-Qarib-CSRF
    await c
      .patch('/v1/me')
      .set('Origin', 'https://evil.example')
      .send({ locale: 'ar' })
      .expect(403);
    await c
      .patch('/v1/me')
      .set('Origin', 'http://localhost:3000')
      .send({ locale: 'ar' })
      .expect(200);
    await c.patch('/v1/me').send({ locale: 'en' }).expect(200);
  });

  it('does not affect Bearer clients or anonymous requests', async () => {
    const { c, email } = await signUp(t);
    const me = await c.get('/v1/me').expect(200);
    expect(me.body.user.email).toBe(email);
    await request(t.server)
      .post('/v1/baskets/optimise')
      .send({ items: [{ product_id: '00000000-0000-4000-8000-000000000000' }] })
      .expect(200);
  });
});
