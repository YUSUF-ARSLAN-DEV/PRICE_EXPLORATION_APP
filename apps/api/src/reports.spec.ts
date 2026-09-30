import net from 'node:net';
import { existsSync } from 'node:fs';
import {
  clamScan,
  sniffImage,
  stripJpegMetadata,
  stripPngMetadata,
  VirusFound,
} from './reports/upload';
import {
  TestApp,
  createTestApp,
  mkCategory,
  mkOffer,
  mkProduct,
  mkRetailer,
  signUp,
} from '../test/app';

// ---- fixtures: tiny hand-built images ------------------------------------------------------------
const seg = (marker: number, payload: Buffer) => {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
};
const GPS = Buffer.from('Exif\0\0GPSLatitude=25.2854;GPSLongitude=51.5310');
const jpegWithExif = (): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01')), // APP0
    seg(0xe1, GPS), // APP1: EXIF with GPS
    seg(0xfe, Buffer.from('a comment with a name')), // COM
    seg(0xdb, Buffer.alloc(65, 1)), // DQT (must be kept)
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9]), // SOS + data + EOI
  ]);

const crc = Buffer.alloc(4);
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type), data, crc]);
};
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngWithText = (): Buffer =>
  Buffer.concat([
    PNG_SIG,
    chunk('IHDR', Buffer.alloc(13)),
    chunk('tEXt', Buffer.from('Author\0Jane Doe')),
    chunk('eXIf', Buffer.from('GPS data')),
    chunk('IDAT', Buffer.from([1, 2, 3])),
    chunk('IEND', Buffer.alloc(0)),
  ]);

describe('upload safety primitives', () => {
  it('sniffs by magic bytes, not by name or declared type', () => {
    expect(sniffImage(jpegWithExif())).toBe('jpeg');
    expect(sniffImage(pngWithText())).toBe('png');
    expect(sniffImage(Buffer.from('<?php echo 1; ?>'))).toBeNull();
    expect(sniffImage(Buffer.from('GIF89a....'))).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });

  it('strips EXIF/GPS, comments and app segments from JPEGs but keeps the image data', () => {
    const out = stripJpegMetadata(jpegWithExif());
    expect(out.includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect(out.includes(Buffer.from('a comment'))).toBe(false);
    expect(out.includes(Buffer.from('JFIF'))).toBe(false);
    expect(out.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(out.includes(Buffer.alloc(65, 1))).toBe(true); // quantisation table kept
    expect(out.subarray(-3).equals(Buffer.from([0x33, 0xff, 0xd9]))).toBe(true); // scan data + EOI kept
    expect(() =>
      stripJpegMetadata(
        Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), Buffer.alloc(10)]),
      ),
    ).toThrow(/truncated/);
  });

  it('strips text/EXIF chunks from PNGs and keeps critical chunks', () => {
    const out = stripPngMetadata(pngWithText());
    expect(out.includes(Buffer.from('Jane Doe'))).toBe(false);
    expect(out.includes(Buffer.from('GPS data'))).toBe(false);
    for (const k of ['IHDR', 'IDAT', 'IEND']) expect(out.includes(Buffer.from(k))).toBe(true);
    expect(sniffImage(out)).toBe('png');
  });
});

describe('clamd client', () => {
  const fakeClamd = (reply: string) =>
    new Promise<{ port: number; received: () => Buffer; close: () => void }>((resolve) => {
      const chunks: Buffer[] = [];
      const srv = net.createServer((sock) => {
        sock.on('data', (d) => {
          chunks.push(d);
          if (d.subarray(-4).equals(Buffer.alloc(4))) sock.end(reply + '\0');
        });
      });
      srv.listen(0, '127.0.0.1', () =>
        resolve({
          port: (srv.address() as net.AddressInfo).port,
          received: () => Buffer.concat(chunks),
          close: () => srv.close(),
        }),
      );
    });

  it('speaks INSTREAM and accepts clean files', async () => {
    const s = await fakeClamd('stream: OK');
    await expect(clamScan(Buffer.from('hello'), '127.0.0.1', s.port)).resolves.toBeUndefined();
    const got = s.received();
    expect(got.subarray(0, 10).toString()).toBe('zINSTREAM\0');
    expect(got.includes(Buffer.from('hello'))).toBe(true);
    s.close();
  });

  it('rejects infected files and fails closed on scanner errors', async () => {
    const bad = await fakeClamd('stream: Eicar-Signature FOUND');
    await expect(clamScan(Buffer.from('x'), '127.0.0.1', bad.port)).rejects.toBeInstanceOf(
      VirusFound,
    );
    bad.close();
    const weird = await fakeClamd('INSTREAM size limit exceeded. ERROR');
    await expect(clamScan(Buffer.from('x'), '127.0.0.1', weird.port)).rejects.toThrow(
      /unexpected clamd reply/,
    );
    weird.close();
    await expect(clamScan(Buffer.from('x'), '127.0.0.1', 1)).rejects.toThrow();
  });
});

// ---- HTTP -------------------------------------------------------------------------------------------
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function world() {
  const cat = await mkCategory(t);
  const product = await mkProduct(t, { category: cat.id });
  const retailer = await mkRetailer(t);
  await mkOffer(t, product, retailer, 10); // existing listing from another source so the product is public
  return { product, retailer };
}
const report = (
  c: Awaited<ReturnType<typeof signUp>>['c'],
  w: Awaited<ReturnType<typeof world>>,
  price: number,
) =>
  c
    .post('/v1/reports')
    .send({ product_id: w.product.id, retailer_id: w.retailer.id, price_qar: price });

describe('crowd price reports', () => {
  it('requires sign-in and a public product/retailer', async () => {
    const w = await world();
    const anon = (await import('supertest')).default(t.server);
    await anon
      .post('/v1/reports')
      .send({ product_id: w.product.id, retailer_id: w.retailer.id, price_qar: 9 })
      .expect(401);
    const { c } = await signUp(t);
    await c
      .post('/v1/reports')
      .send({
        product_id: '00000000-0000-4000-8000-000000000000',
        retailer_id: w.retailer.id,
        price_qar: 9,
      })
      .expect(404);
    await report(c, w, -1).expect(422);
  });

  it('publishes only when two DIFFERENT users agree within 5 %', async () => {
    const w = await world();
    const [a, b, c3] = [await signUp(t), await signUp(t), await signUp(t)];
    const r1 = await report(a.c, w, 10.0).expect(201);
    expect(r1.body).toMatchObject({ status: 'pending', published: false });
    const dup = await report(a.c, w, 10.0).expect(201); // same user again does not count twice
    expect(dup.body.published).toBe(false);
    const far = await report(b.c, w, 12.0).expect(201); // 20 % away: no consensus
    expect(far.body.published).toBe(false);
    const agree = await report(c3.c, w, 10.2).expect(201); // within 5 % of a's report
    expect(agree.body).toMatchObject({ status: 'accepted', published: true });
    const cp = await t.db.one<{ price_qar: string; method: string }>(
      `select cp.price_qar, s.method from current_prices cp join sources s on s.id = cp.source_id
        where s.retailer_id = $1 and s.method = 'crowd'`,
      [w.retailer.id],
    );
    expect(cp).toBeDefined();
    expect(['10.00', '10.10', '10.20']).toContain(cp!.price_qar);
  });

  it('a wild report versus the current price is left for a moderator, who can accept it', async () => {
    const w = await world();
    const [a, b] = [await signUp(t), await signUp(t)];
    await report(a.c, w, 40).expect(201);
    const second = await report(b.c, w, 40).expect(201);
    expect(second.body).toMatchObject({ status: 'pending', published: false }); // 300 % above the current 10.00
    const admin = await signUp(t, { admin: true });
    const pending = await admin.c.get('/v1/admin/reports').expect(200);
    const mine = pending.body.find((r: { product_id: string }) => r.product_id === w.product.id);
    expect(mine).toBeDefined();
    await admin.c.post(`/v1/admin/reports/${mine.id}/accept`).expect(200);
    const audit = await t.db.one('select 1 from audit_log where action = $1 and entity_id = $2', [
      'report.accepted',
      mine.id,
    ]);
    expect(audit).toBeDefined();
  });

  it('caps reports per user per day', async () => {
    const w = await world();
    const { c } = await signUp(t);
    for (let i = 0; i < 20; i++) await report(c, w, 10 + (i % 3)).expect(201);
    await report(c, w, 10).expect(429);
  });
});

describe('receipt uploads', () => {
  const upload = (
    c: Awaited<ReturnType<typeof signUp>>['c'],
    w: Awaited<ReturnType<typeof world>>,
    file: Buffer,
    name = 'r.jpg',
    mime = 'image/jpeg',
  ) =>
    c
      .post('/v1/reports')
      .field('product_id', w.product.id)
      .field('retailer_id', w.retailer.id)
      .field('price_qar', '10')
      .attach('receipt', file, { filename: name, contentType: mime });

  it('needs the contribute_receipts consent', async () => {
    const w = await world();
    const { c } = await signUp(t);
    const res = await upload(c, w, jpegWithExif()).expect(409);
    expect(res.body.code).toBe('consent_required');
  });

  it('accepts a JPEG, strips its metadata before storing, and records the private path', async () => {
    const w = await world();
    const { c, email } = await signUp(t);
    await c
      .patch('/v1/me/consents')
      .send({ consents: [{ purpose: 'contribute_receipts', granted: true }] })
      .expect(200);
    const res = await upload(c, w, jpegWithExif()).expect(201);
    const row = await t.db.one<{ receipt_blob_path: string }>(
      'select receipt_blob_path from price_reports where id = $1',
      [res.body.id],
    );
    const path = row!.receipt_blob_path.replace('file://', '');
    expect(existsSync(path)).toBe(true);
    const stored = (await import('node:fs')).readFileSync(path);
    expect(stored.includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect(sniffImage(stored)).toBe('jpeg');
    expect(row!.receipt_blob_path).not.toContain(email);
  });

  it.each([
    [
      'a script renamed to .jpg',
      Buffer.from('<?php system($_GET[1]); ?>'),
      'shell.jpg',
      'image/jpeg',
      415,
    ],
    ['a PDF', Buffer.from('%PDF-1.7 ...'), 'r.pdf', 'application/pdf', 415],
    ['a GIF', Buffer.from('GIF89a......'), 'r.gif', 'image/gif', 415],
    [
      'a truncated JPEG',
      Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3]),
      'r.jpg',
      'image/jpeg',
      400,
    ],
  ])('rejects %s', async (_n, file, name, mime, status) => {
    const w = await world();
    const { c } = await signUp(t);
    await c
      .patch('/v1/me/consents')
      .send({ consents: [{ purpose: 'contribute_receipts', granted: true }] })
      .expect(200);
    await upload(c, w, file, name, mime).expect(status);
    const stored = await t.db.one<{ n: string }>(
      'select count(*) as n from price_reports where receipt_blob_path is not null and user_id = (select id from users where email = (select email from users order by created_at desc limit 1))',
    );
    expect(Number(stored!.n)).toBe(0);
  });

  it('rejects files over 5 MB', async () => {
    const w = await world();
    const { c } = await signUp(t);
    await c
      .patch('/v1/me/consents')
      .send({ consents: [{ purpose: 'contribute_receipts', granted: true }] })
      .expect(200);
    const big = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(5 * 1024 * 1024 + 10),
    ]);
    await upload(c, w, big).expect(413);
  });
});
