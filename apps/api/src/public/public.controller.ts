import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { publicClaimBody, publicTakedownBody } from '@qarib/shared';
import { ApiZodBody, ZodPipe } from '../common/zod';
import { CONFIG, Config } from '../config';
import { Db } from '../db/db.service';
import { Mailer } from '../mail/mailer';

// Public forms (takedown, retailer claim): 5 per hour per client unless FORM_RATE_LIMIT_PER_HOUR says otherwise
// (only the local E2E stack raises it). Read at load time, like the other throttles.
const FORM_LIMIT = { limit: Number(process.env.FORM_RATE_LIMIT_PER_HOUR ?? 5), ttl: 3_600_000 };

@ApiTags('public')
@Controller()
export class PublicController {
  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    private readonly db: Db,
    private readonly mailer: Mailer,
  ) {}

  /** Liveness: the process is up. Must NOT touch the database, or a DB blip restarts every replica. */
  @Get('health/live')
  @ApiOperation({ summary: 'Liveness (process only, no dependencies).' })
  live() {
    return { status: 'ok', service: 'api', time: new Date().toISOString() };
  }

  /** Readiness: can serve traffic (database reachable). 503 takes the replica out of rotation only. */
  @Get('health/ready')
  @ApiOperation({ summary: 'Readiness (database reachable).' })
  async ready() {
    await this.db.query('select 1');
    return { status: 'ok', service: 'api', time: new Date().toISOString() };
  }

  @Get('health')
  @ApiOperation({ summary: 'Alias of readiness (kept for compatibility with older probes).' })
  async health() {
    return this.ready();
  }

  /**
   * "Claim your store" (plan 11.3). Intake only: nothing is granted, nothing is e-mailed back to the
   * address given (that would make us a spam relay); the legal/partnerships inbox is notified instead.
   */
  @Post('retailers/claims')
  @HttpCode(202)
  @Throttle({ default: FORM_LIMIT })
  @ApiZodBody(publicClaimBody)
  async claimStore(
    @Body(new ZodPipe(publicClaimBody)) b: ReturnType<typeof publicClaimBody.parse>,
  ) {
    const row = await this.db.one<{ id: string }>(
      `insert into retailer_claims (company_name, website, contact_name, contact_email, contact_role, message)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        b.company_name,
        b.website ?? null,
        b.contact_name,
        b.contact_email,
        b.contact_role ?? null,
        b.message ?? null,
      ],
    );
    await this.mailer
      .send({
        to: this.cfg.legalEmail,
        subject: `Retailer claim received (${row!.id})`,
        text: `A retailer asked to claim or supply data (id ${row!.id}). Verify by a call-back to a number from the company's own website before anything else: see docs/runbooks/retailer-onboarding.md.`,
      })
      .catch(() => undefined);
    return {
      id: row!.id,
      message: 'Thank you. A member of our team will contact you within 3 business days.',
    };
  }

  /** Takedown / complaint intake (policy P6): anyone may file; a human handles it within 2 business days. */
  @Post('takedown')
  @HttpCode(202)
  @Throttle({ default: FORM_LIMIT })
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
