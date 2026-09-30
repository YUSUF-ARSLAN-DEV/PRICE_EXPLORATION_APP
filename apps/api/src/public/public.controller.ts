import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { publicTakedownBody } from '@qarib/shared';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { CONFIG, Config } from '../config';
import { Db } from '../db/db.service';
import { Mailer } from '../mail/mailer';

@ApiTags('public')
@Controller()
export class PublicController {
  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    private readonly db: Db,
    private readonly mailer: Mailer,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness + database reachability.' })
  async health() {
    await this.db.query('select 1');
    return { status: 'ok', service: 'api', time: new Date().toISOString() };
  }

  /** Takedown / complaint intake (policy P6): anyone may file; a human handles it within 2 business days. */
  @Post('takedown')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiZodBody(publicTakedownBody)
  async takedown(
    @Body(new ZodPipe(publicTakedownBody)) b: ReturnType<typeof publicTakedownBody.parse>,
  ) {
    const row = await this.db.one<{ id: string }>(
      `insert into takedown_requests (requester_name, requester_email, channel, summary) values ($1, $2, 'web_form', $3) returning id`,
      [b.requester_name ?? null, b.requester_email, b.summary],
    );
    await this.mailer
      .send({
        to: this.cfg.legalEmail,
        subject: `Takedown / complaint received (${row!.id})`,
        text: `A new takedown request was filed (id ${row!.id}). Open the admin console to handle it.\nTarget: acknowledge within 1 business day, resolve within 2.`,
      })
      .catch(() => undefined);
    return {
      id: row!.id,
      message: 'Thank you. We will acknowledge your request within 1 business day.',
    };
  }
}
