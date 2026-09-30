import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { alertBody, tokenBody } from '@qarib/shared';
import { AuthedRequest, AuthGuard } from '../auth/auth.guard';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { Db } from '../db/db.service';
import { HttpException } from '@nestjs/common';
import { AlertsService } from './alerts.service';

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly db: Db,
    private readonly alerts: AlertsService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  async list(@Req() req: AuthedRequest) {
    const rows = await this.db.query(
      `select a.id, a.product_id, p.canonical_name_en as product_name, a.threshold_qar, a.active, a.last_notified_at, a.created_at
         from alerts a join products p on p.id = a.product_id where a.user_id = $1 order by a.created_at desc`,
      [req.user!.id],
    );
    return { alerts: rows };
  }

  @Post()
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Create a price alert. Needs the alerts_email consent (PATCH /me/consents).',
  })
  @ApiZodBody(alertBody)
  async create(
    @Req() req: AuthedRequest,
    @Body(new ZodPipe(alertBody)) body: ReturnType<typeof alertBody.parse>,
  ) {
    const consent = await this.db.one<{ granted: boolean }>(
      `select granted from consents where user_id = $1 and purpose = 'alerts_email' order by created_at desc, id desc limit 1`,
      [req.user!.id],
    );
    if (!consent?.granted) {
      throw new HttpException(
        { message: 'Consent for alert emails is required', code: 'consent_required' },
        409,
      );
    }
    const visible = await this.db.one('select 1 from public_products where id = $1', [
      body.product_id,
    ]);
    if (!visible) throw new NotFoundException('Product not found');
    const count = await this.db.one<{ n: string }>(
      'select count(*) as n from alerts where user_id = $1 and active',
      [req.user!.id],
    );
    if (Number(count?.n) >= 50) throw new HttpException('Alert limit reached (50)', 409);
    const row = await this.db.one<{ id: string }>(
      'insert into alerts (user_id, product_id, threshold_qar) values ($1, $2, $3) returning id',
      [req.user!.id, body.product_id, body.threshold_qar],
    );
    return { id: row!.id };
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.db.query(
      'delete from alerts where id = $1 and user_id = $2 returning id',
      [id, req.user!.id],
    );
    if (!r.length) throw new NotFoundException('Alert not found');
  }

  /** One-click unsubscribe (RFC 8058 POST, and a GET-less body form for the web page). */
  @Post('unsubscribe')
  @HttpCode(204)
  @ApiZodBody(tokenBody)
  async unsubscribe(
    @Body(new ZodPipe(tokenBody)) body: ReturnType<typeof tokenBody.parse>,
    @Query('token') _q?: string,
  ) {
    if (!(await this.alerts.unsubscribe(body.token)))
      throw new HttpException('Invalid or expired link', 400);
  }
}
