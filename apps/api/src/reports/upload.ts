/**
 * Receipt upload safety (plan 8.2): type sniffing by magic bytes (never trust the client's
 * Content-Type), size cap, metadata stripping (EXIF/GPS), optional ClamAV scan.
 *
 * NOT implemented: automatic blurring of names / card numbers / loyalty ids in the image (needs a
 * computer-vision step). Mitigations: images are private, visible only to moderators, and deleted
 * after 7 days (see receipts_due_for_deletion). Tracked in plan Change Log CL-00x.
 */
import net from 'node:net';

export type ImageKind = 'jpeg' | 'png';
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length > 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  return null;
}

/** Remove APPn (EXIF, XMP, ICC...) and COM segments from a JPEG; pixel data is untouched. */
export function stripJpegMetadata(buf: Buffer): Buffer {
  const out: Buffer[] = [buf.subarray(0, 2)]; // SOI
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1]!;
    if (marker === 0xda) {
      out.push(buf.subarray(i)); // SOS: entropy-coded data to the end
      return Buffer.concat(out);
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const segEnd = i + 2 + len;
    if (segEnd > buf.length) throw new Error('truncated JPEG');
    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) out.push(buf.subarray(i, segEnd));
    i = segEnd;
  }
  return Buffer.concat(out);
}

const PNG_KEEP = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'sBIT',
  'bKGD',
  'pHYs',
]);

/** Drop ancillary text/EXIF chunks (tEXt, zTXt, iTXt, eXIf, tIME ...) from a PNG. */
export function stripPngMetadata(buf: Buffer): Buffer {
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) throw new Error('truncated PNG');
    if (PNG_KEEP.has(type)) out.push(buf.subarray(i, end));
    i = end;
  }
  return Buffer.concat(out);
}

export function stripMetadata(buf: Buffer, kind: ImageKind): Buffer {
  return kind === 'jpeg' ? stripJpegMetadata(buf) : stripPngMetadata(buf);
}

export class VirusFound extends Error {}

/** Minimal clamd INSTREAM client. Throws VirusFound on detection, Error if the scanner fails. */
export function clamScan(
  buf: Buffer,
  host: string,
  port: number,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    const chunks: Buffer[] = [];
    sock.setTimeout(timeoutMs, () => sock.destroy(new Error('clamd timeout')));
    sock.on('error', reject);
    sock.on('data', (d) => chunks.push(d));
    sock.on('end', () => {
      const reply = Buffer.concat(chunks).toString().replace(/\0/g, '').trim();
      if (reply.endsWith('OK')) resolve();
      else if (reply.includes('FOUND')) reject(new VirusFound(reply));
      else reject(new Error(`unexpected clamd reply: ${reply}`));
    });
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      for (let i = 0; i < buf.length; i += 64 * 1024) {
        const chunk = buf.subarray(i, i + 64 * 1024);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        sock.write(size);
        sock.write(chunk);
      }
      sock.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
    });
  });
}
