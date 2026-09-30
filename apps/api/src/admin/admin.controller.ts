import {
  Body,
  Controller,
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
import { z } from 'zod';
import {
  decideMatchBody,
  killSwitchBody,
  mergeBody,
  resolveTakedownBody,
  sourceChangeBody,
  takedownBody,
} from '@qarib/shared';
import { AdminGuard, AuthedRequest } from '../auth/auth.guard';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { Db } from '../db/db.service';

const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'accepted']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
type ListQuery = z.infer<typeof listQuery>;
const uuidParam = new ParseUUIDPipe();

/**
 * Internal admin API (plan 6.1). Every mutation runs with `qarib.actor` = the admin's email so the
 * database audit trail names who did it. Production access additionally sits behind SSO + MFA + an
 * IP allow-list at the edge (plan 8.2); locally it is role-based only.
 */
@ApiTags('admin')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly db: Db) {}

  private actor(req: AuthedRequest) {
    return req.user!.email;
  }

  // ---- sources & health -----------------------------------------------------------------------
  @Get('health')
  health() {
    return this.db.query('select * from source_health order by retailer_slug, method');
  }

  @Get('sources')
  sources() {
    return this.db.query(
      `select s.*, r.slug as retailer_slug, r.name_en as retailer_name from sources s
         join retailers r on r.id = s.retailer_id order by r.slug, s.method`,
    );
  }

  @Post('sources/:id/kill-switch')
  @HttpCode(200)
  @ApiOperation({ summary: 'Immediately disable a source (hides its prices from public views).' })
  @ApiZodBody(killSwitchBody)
  async kill(
    @Req() req: AuthedRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(killSwitchBody)) body: ReturnType<typeof killSwitchBody.parse>,
  ) {
    await this.db.tx(
      (c) => c.query('select disable_source($1, $2)', [id, `${this.actor(req)}: ${body.reason}`]),
      this.actor(req),
    );
    return { ok: true };
  }

  @Post('sources/:id/kill-switch/release')
  @HttpCode(200)
  @ApiZodBody(killSwitchBody)
  async release(
    @Req() req: AuthedRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(killSwitchBody)) _body: ReturnType<typeof killSwitchBody.parse>,
  ) {
    const r = await this.db.tx(
      (c) =>
        c.query(
          'update sources set kill_switch = false, kill_switch_reason = null, kill_switch_at = null where id = $1 returning id',
          [id],
        ),
      this.actor(req),
    );
    if (!r.rowCount) throw new NotFoundException('Source not found');
    return { ok: true };
  }

  /** Legal status changes need a second admin (four-eyes): request here, approve elsewhere. */
  @Post('sources/:id/changes')
  @ApiZodBody(sourceChangeBody)
  async requestChange(
    @Req() req: AuthedRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(sourceChangeBody)) body: ReturnType<typeof sourceChangeBody.parse>,
  ) {
    const row = await this.db.one<{ id: string }>(
      'insert into source_change_requests (source_id, requested_by, change, reason) values ($1, $2, $3, $4) returning id',
      [id, this.actor(req), JSON.stringify(body.change), body.reason],
    );
    return { id: row!.id, status: 'pending' };
  }

  @Get('source-changes')
  sourceChanges(@Query(new ZodPipe(listQuery)) q: ListQuery) {
    return this.db.query(
      `select c.*, r.slug as retailer_slug from source_change_requests c
         join sources s on s.id = c.source_id join retailers r on r.id = s.retailer_id
        where ($1::text is null or c.status = $1) order by c.created_at desc limit $2 offset $3`,
      [q.status ?? null, q.limit, q.offset],
    );
  }

  @Post('source-changes/:id/approve')
  @HttpCode(200)
  async approveChange(@Req() req: AuthedRequest, @Param('id', uuidParam) id: string) {
    await this.db.tx(
      (c) => c.query('select decide_source_change($1, $2, true)', [id, this.actor(req)]),
      this.actor(req),
    );
    return { ok: true };
  }

  @Post('source-changes/:id/reject')
  @HttpCode(200)
  async rejectChange(@Req() req: AuthedRequest, @Param('id', uuidParam) id: string) {
    await this.db.tx(
      (c) => c.query('select decide_source_change($1, $2, false)', [id, this.actor(req)]),
      this.actor(req),
    );
    return { ok: true };
  }

  // ---- held prices, staged offers, dead letters -----------------------------------------------
  @Get('held-prices')
  held(@Query(new ZodPipe(listQuery)) q: ListQuery) {
    return this.db.query(
      `select h.*, rp.raw_name, r.slug as retailer_slug from held_prices h
         join retailer_products rp on rp.id = h.retailer_product_id join retailers r on r.id = rp.retailer_id
        where h.status = coalesce($1, 'pending') order by h.created_at limit $2 offset $3`,
      [q.status ?? null, q.limit, q.offset],
    );
  }

  @Post('held-prices/:id/approve')
  @HttpCode(200)
  async approveHeld(@Req() req: AuthedRequest, @Param('id', uuidParam) id: string) {
    await this.db.tx(
      (c) => c.query('select release_held_price($1, $2)', [id, this.actor(req)]),
      this.actor(req),
    );
    return { ok: true };
  }

  @Post('held-prices/:id/reject')
  @HttpCode(200)
  async rejectHeld(@Req() req: AuthedRequest, @Param('id', uuidParam) id: string) {
    const r = await this.db.query(
      `update held_prices set status = 'rejected', reviewed_at = now(), reviewed_by = $2 where id = $1 and status = 'pending' returning id`,
      [id, this.actor(req)],
    );
    if (!r.length) throw new NotFoundException('Pending held price not found');
    return { ok: true };
  }

  @Get('staged-offers')
  staged(@Query(new ZodPipe(listQuery)) q: ListQuery) {
    return this.db.query(
      `select so.*, r.slug as retailer_slug from staged_offers so join sources s on s.id = so.source_id
         join retailers r on r.id = s.retailer_id
        where so.status = coalesce($1, 'pending') order by so.created_at limit $2 offset $3`,
      [q.status ?? null, q.limit, q.offset],
    );
  }

  @Post('staged-offers/:id/approve')
  @HttpCode(200)
  async approveStaged(@Req() req: AuthedRequest, @Param('id', uuidParam) id: string) {
    await this.db.tx(
      (c) => c.query('select release_staged_offer($1, $2)', [id, this.actor(req)]),
      this.actor(req),
    );
    return { ok: true };
  }

  @Post('staged-offers/:id/reject')
  @HttpCode(200)
  async rejectStaged(@Req() req: AuthedRequest, @Param('id', uuidParam) id: string) {
    await this.db.query('select reject_staged_offer($1, $2)', [id, this.actor(req)]);
    return { ok: true };
  }

  @Get('dead-letters')
  deadLetters(@Query(new ZodPipe(listQuery)) q: ListQuery) {
    return this.db.query(
      'select id, batch_id, source_id, raw, error, created_at from dead_letters order by created_at desc limit $1 offset $2',
      [q.limit, q.offset],
    );
  }

  // ---- matching review queue ------------------------------------------------------------------
  @Get('matches')
  @ApiOperation({ summary: "Listings awaiting a match decision, with the matcher's candidates." })
  async matches(@Query(new ZodPipe(listQuery)) q: ListQuery) {
    return this.db.query(
      `select rp.id, rp.raw_name, rp.raw_size, rp.barcode, r.slug as retailer_slug,
              coalesce(json_agg(json_build_object('product_id', mc.product_id, 'name', p.canonical_name_en,
                        'score', mc.score, 'reasons', mc.reasons) order by mc.score desc)
                       filter (where mc.id is not null), '[]') as candidates
         from retailer_products rp
         join retailers r on r.id = rp.retailer_id
         left join match_candidates mc on mc.retailer_product_id = rp.id
         left join products p on p.id = mc.product_id
        where rp.match_status = 'review' and rp.product_id is null
        group by rp.id, r.slug order by (count(mc.id) > 0) desc, rp.created_at limit $1 offset $2`,
      [q.limit, q.offset],
    );
  }

  @Post('matches/:id/decide')
  @HttpCode(200)
  @ApiZodBody(decideMatchBody)
  async decide(
    @Req() req: AuthedRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(decideMatchBody)) body: ReturnType<typeof decideMatchBody.parse>,
  ) {
    await this.db.query('select decide_match($1, $2, $3)', [id, body.product_id, this.actor(req)]);
    return { ok: true };
  }

  @Post('matches/:id/reject')
  @HttpCode(200)
  async rejectMatch(@Req() req: AuthedRequest, @Param('id', uuidParam) id: string) {
    await this.db.query('select reject_match($1, $2)', [id, this.actor(req)]);
    return { ok: true };
  }

  @Post('matches/:id/split')
  @HttpCode(200)
  async split(@Req() req: AuthedRequest, @Param('id', uuidParam) id: string) {
    await this.db.query('select split_match($1, $2)', [id, this.actor(req)]);
    return { ok: true };
  }

  @Post('products/merge')
  @HttpCode(200)
  @ApiZodBody(mergeBody)
  async merge(
    @Req() req: AuthedRequest,
    @Body(new ZodPipe(mergeBody)) body: ReturnType<typeof mergeBody.parse>,
  ) {
    await this.db.query('select merge_products($1, $2, $3)', [
      body.keep,
      body.drop,
      this.actor(req),
    ]);
    return { ok: true };
  }

  // ---- crowd report moderation ----------------------------------------------------------------
  @Get('reports')
  reports(@Query(new ZodPipe(listQuery)) q: ListQuery) {
    return this.db.query(
      `select pr.id, pr.product_id, p.canonical_name_en as product_name, r.slug as retailer_slug,
              pr.reported_price_qar, pr.status, pr.created_at, (pr.receipt_blob_path is not null) as has_receipt
         from price_reports pr join products p on p.id = pr.product_id join retailers r on r.id = pr.retailer_id
        where pr.status::text = coalesce($1, 'pending') order by pr.created_at limit $2 offset $3`,
      [q.status ?? null, q.limit, q.offset],
    );
  }

  @Post('reports/:id/accept')
  @HttpCode(200)
  async acceptReport(@Req() req: AuthedRequest, @Param('id', uuidParam) id: string) {
    await this.db.tx(
      (c) => c.query('select accept_price_report($1, $2)', [id, this.actor(req)]),
      this.actor(req),
    );
    return { ok: true };
  }

  @Post('reports/:id/reject')
  @HttpCode(200)
  async rejectReport(@Param('id', uuidParam) id: string) {
    const r = await this.db.query(
      `update price_reports set status = 'rejected' where id = $1 and status = 'pending' returning id`,
      [id],
    );
    if (!r.length) throw new NotFoundException('Pending report not found');
    return { ok: true };
  }

  // ---- takedowns & complaints -----------------------------------------------------------------
  @Get('takedowns')
  takedowns(
    @Query(new ZodPipe(z.object({ open: z.coerce.boolean().default(true) }))) q: { open: boolean },
  ) {
    return this.db.query(
      `select * from takedown_requests where ($1::boolean is false or resolved_at is null) order by received_at desc limit 200`,
      [q.open],
    );
  }

  @Post('takedowns')
  @ApiZodBody(takedownBody)
  async createTakedown(@Body(new ZodPipe(takedownBody)) b: ReturnType<typeof takedownBody.parse>) {
    const row = await this.db.one<{ id: string }>(
      `insert into takedown_requests (retailer_id, source_id, requester_name, requester_email, channel, summary)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        b.retailer_id ?? null,
        b.source_id ?? null,
        b.requester_name ?? null,
        b.requester_email ?? null,
        b.channel,
        b.summary,
      ],
    );
    return { id: row!.id };
  }

  @Post('takedowns/:id/acknowledge')
  @HttpCode(200)
  async ack(@Param('id', uuidParam) id: string) {
    const r = await this.db.query(
      'update takedown_requests set acknowledged_at = coalesce(acknowledged_at, now()) where id = $1 returning id',
      [id],
    );
    if (!r.length) throw new NotFoundException('Request not found');
    return { ok: true };
  }

  /** Resolving with `source_disabled` flips the kill switch in the same transaction (policy P6). */
  @Post('takedowns/:id/resolve')
  @HttpCode(200)
  @ApiZodBody(resolveTakedownBody)
  async resolve(
    @Req() req: AuthedRequest,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(resolveTakedownBody)) body: ReturnType<typeof resolveTakedownBody.parse>,
  ) {
    await this.db.tx(async (c) => {
      const t = await c.query<{ source_id: string | null; retailer_id: string | null }>(
        'select source_id, retailer_id from takedown_requests where id = $1 and resolved_at is null for update',
        [id],
      );
      if (!t.rowCount) throw new NotFoundException('Open request not found');
      if (body.action === 'source_disabled') {
        const { source_id, retailer_id } = t.rows[0]!;
        if (source_id)
          await c.query('select disable_source($1, $2)', [source_id, `takedown request ${id}`]);
        else if (retailer_id) {
          const ids = await c.query<{ id: string }>(
            'select id from sources where retailer_id = $1',
            [retailer_id],
          );
          for (const s of ids.rows)
            await c.query('select disable_source($1, $2)', [s.id, `takedown request ${id}`]);
        }
      }
      await c.query(
        `update takedown_requests set action = $2, notes = $3, resolved_at = now(), acknowledged_at = coalesce(acknowledged_at, now()) where id = $1`,
        [id, body.action, body.notes ?? null],
      );
    }, this.actor(req));
    return { ok: true };
  }
}
