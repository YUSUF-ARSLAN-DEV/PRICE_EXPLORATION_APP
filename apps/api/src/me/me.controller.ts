import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { consentsBody, deleteMeBody, updateMeBody } from '@qarib/shared';
import { AuthedRequest, AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { inetForStorage } from '../common/net';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { Db } from '../db/db.service';

@ApiTags('me')
@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  private async consents(userId: string) {
    return this.db.query<{ purpose: string; granted: boolean; version: string; created_at: Date }>(
      `select distinct on (purpose) purpose, granted, version, created_at
         from consents where user_id = $1 order by purpose, created_at desc, id desc`,
      [userId],
    );
  }

  @Get()
  async me(@Req() req: AuthedRequest) {
    const u = req.user!;
    return { user: u, consents: await this.consents(u.id) };
  }

  @Patch()
  @ApiZodBody(updateMeBody)
  async update(
    @Req() req: AuthedRequest,
    @Body(new ZodPipe(updateMeBody)) body: ReturnType<typeof updateMeBody.parse>,
  ) {
    if (body.locale)
      await this.db.query('update users set locale = $2 where id = $1', [
        req.user!.id,
        body.locale,
      ]);
    return { ok: true };
  }

  @Patch('consents')
  @ApiOperation({ summary: 'Grant/withdraw consents. Each change appends to the consent ledger.' })
  @ApiZodBody(consentsBody)
  async setConsents(
    @Req() req: AuthedRequest,
    @Body(new ZodPipe(consentsBody)) body: ReturnType<typeof consentsBody.parse>,
  ) {
    if (body.consents.some((c) => c.purpose === 'account_terms' && !c.granted)) {
      throw new BadRequestException('Terms cannot be withdrawn here; delete your account instead.');
    }
    await this.db.tx(async (c) => {
      for (const { purpose, granted } of body.consents) {
        await c.query(
          'insert into consents (user_id, purpose, granted, version, ip_trunc) values ($1, $2, $3, $4, $5)',
          [req.user!.id, purpose, granted, body.version, inetForStorage(req)],
        );
        if (purpose === 'history' && !granted)
          await c.query('delete from search_history where user_id = $1', [req.user!.id]);
        if (purpose === 'alerts_email' && !granted)
          await c.query('update alerts set active = false where user_id = $1', [req.user!.id]);
      }
    });
    return { consents: await this.consents(req.user!.id) };
  }

  /** Data-subject access: everything we hold about the caller (plan 0.3c, 6.4). */
  @Get('export')
  @ApiOperation({ summary: 'Download all personal data we hold (JSON).' })
  async export(@Req() req: AuthedRequest, @Res() res: Response) {
    const id = req.user!.id;
    const [user, consents, baskets, alerts, history, reports] = await Promise.all([
      this.db.one(
        'select email::text as email, locale, email_verified_at, created_at from users where id = $1',
        [id],
      ),
      this.db.query(
        'select purpose, granted, version, created_at from consents where user_id = $1 order by created_at',
        [id],
      ),
      this.db.query(
        `select b.id, b.name, b.created_at,
                coalesce(json_agg(json_build_object('product_id', i.product_id, 'quantity', i.quantity)) filter (where i.id is not null), '[]') as items
           from baskets b left join basket_items i on i.basket_id = b.id where b.user_id = $1 group by b.id`,
        [id],
      ),
      this.db.query(
        'select product_id, threshold_qar, active, created_at from alerts where user_id = $1',
        [id],
      ),
      this.db.query(
        'select query, created_at from search_history where user_id = $1 order by created_at',
        [id],
      ),
      this.db.query(
        'select product_id, retailer_id, reported_price_qar, status, created_at from price_reports where user_id = $1',
        [id],
      ),
    ]);
    res
      .setHeader('Content-Type', 'application/json; charset=utf-8')
      .setHeader('Content-Disposition', 'attachment; filename="qarib-my-data.json"')
      .send(
        JSON.stringify(
          {
            exported_at: new Date().toISOString(),
            user,
            consents,
            baskets,
            alerts,
            search_history: history,
            price_reports: reports,
          },
          null,
          2,
        ),
      );
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Erase the account (anonymises the row; removes personal content).' })
  @ApiZodBody(deleteMeBody)
  async remove(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodPipe(deleteMeBody)) body: ReturnType<typeof deleteMeBody.parse>,
  ) {
    if (!(await this.auth.verifyPassword(req.user!.id, body.password)))
      throw new ForbiddenException('Wrong password');
    await this.db.query('select erase_user($1)', [req.user!.id]);
    await this.auth.revokeAll(req.user!.id);
    this.auth.clearCookies(res);
  }

  @Get('history')
  history(@Req() req: AuthedRequest) {
    return this.db.query(
      'select id, query, created_at from search_history where user_id = $1 order by created_at desc limit 100',
      [req.user!.id],
    );
  }

  @Delete('history')
  @HttpCode(204)
  async clearHistory(@Req() req: AuthedRequest) {
    await this.db.query('delete from search_history where user_id = $1', [req.user!.id]);
  }
}
