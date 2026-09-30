import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  Inject,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  Post,
  Req,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { reportBody } from '@qarib/shared';
import { AuthedRequest, AuthGuard } from '../auth/auth.guard';
import { ZodPipe } from '../common/zod';
import { CONFIG, Config } from '../config';
import { Db } from '../db/db.service';
import { BlobStore } from './blob-store';
import { MAX_RECEIPT_BYTES, VirusFound, clamScan, sniffImage, stripMetadata } from './upload';

const DAILY_LIMIT = 20;

@ApiTags('reports')
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  private readonly log = new Logger('reports');

  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    private readonly db: Db,
    private readonly blobs: BlobStore,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Report a shelf price (optionally with a receipt/shelf photo). Needs sign-in.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(
    FileInterceptor('receipt', { limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 } }),
  )
  async create(
    @Req() req: AuthedRequest,
    @Body(new ZodPipe(reportBody)) body: ReturnType<typeof reportBody.parse>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const userId = req.user!.id;
    const today = await this.db.one<{ n: string }>(
      `select count(*) as n from price_reports where user_id = $1 and created_at > now() - interval '24 hours'`,
      [userId],
    );
    if (Number(today?.n) >= DAILY_LIMIT) throw new HttpException('Daily report limit reached', 429);

    const visible = await this.db.one(
      `select 1 from public_products p, retailers r where p.id = $1 and r.id = $2 and r.active and not r.is_demo`,
      [body.product_id, body.retailer_id],
    );
    if (!visible) throw new NotFoundException('Product or retailer not found');

    let blobUri: string | null = null;
    if (file) {
      const consent = await this.db.one<{ granted: boolean }>(
        `select granted from consents where user_id = $1 and purpose = 'contribute_receipts' order by created_at desc, id desc limit 1`,
        [userId],
      );
      if (!consent?.granted)
        throw new HttpException(
          { message: 'Consent to upload receipts is required', code: 'consent_required' },
          409,
        );
      if (file.size > MAX_RECEIPT_BYTES)
        throw new PayloadTooLargeException('Receipt image is larger than 5 MB');
      const kind = sniffImage(file.buffer);
      if (!kind) throw new UnsupportedMediaTypeException('Only JPEG or PNG images are accepted');
      let clean: Buffer;
      try {
        clean = stripMetadata(file.buffer, kind);
      } catch {
        throw new BadRequestException('Corrupt image');
      }
      if (this.cfg.clamav) {
        try {
          await clamScan(clean, this.cfg.clamav.host, this.cfg.clamav.port);
        } catch (err) {
          if (err instanceof VirusFound)
            throw new BadRequestException('File rejected by malware scan');
          this.log.error(`malware scanner unavailable: ${(err as Error).message}`);
          throw new HttpException('Upload temporarily unavailable', 503); // fail closed
        }
      } else if (this.cfg.env === 'production') {
        throw new HttpException('Upload temporarily unavailable', 503); // never skip scanning in prod
      }
      blobUri = await this.blobs.put(kind === 'jpeg' ? 'jpeg' : 'png', clean);
    }

    const row = await this.db.one<{ id: string }>(
      `insert into price_reports (user_id, retailer_id, branch_id, product_id, reported_price_qar, receipt_blob_path)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [userId, body.retailer_id, body.branch_id ?? null, body.product_id, body.price_qar, blobUri],
    );
    // Publishes only when >= 2 distinct users agree within 5 % (see evaluate_price_consensus).
    const published = await this.db.one<{ p: string | null }>(
      'select evaluate_price_consensus($1, $2, $3) as p',
      [body.product_id, body.retailer_id, body.branch_id ?? null],
    );
    const status = await this.db.one<{ status: string }>(
      'select status from price_reports where id = $1',
      [row!.id],
    );
    return { id: row!.id, status: status!.status, published: Boolean(published?.p) };
  }
}
