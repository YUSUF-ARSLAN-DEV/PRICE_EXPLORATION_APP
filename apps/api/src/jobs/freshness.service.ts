import { Injectable, Logger } from '@nestjs/common';
import { Db } from '../db/db.service';

export interface FreshnessBreach {
  source_id: string;
  retailer_slug: string;
  method: string;
  hours_since_ok: number | null;
  target_hours: number;
}

/** Freshness targets in hours by source method (plan 1.4: 90 % of prices < 48 h; flyers weekly). */
export const FRESHNESS_TARGET_HOURS: Record<string, number> = {
  partner_feed: 48,
  public_web: 48,
  manual: 24 * 35,
  crowd: 24 * 14,
  flyer: 24 * 8,
};

/**
 * SLO watchdog: every approved, enabled source must have delivered fresh data within its target.
 * A breach is logged as a single structured line containing `qarib.freshness.breach`, which the
 * Azure Monitor log alert (infra/terraform/modules/observability) turns into a page.
 */
@Injectable()
export class FreshnessService {
  private readonly log = new Logger('freshness');
  constructor(private readonly db: Db) {}

  async check(): Promise<{ checked: number; breaches: FreshnessBreach[] }> {
    const rows = await this.db.query<{
      source_id: string;
      retailer_slug: string;
      method: string;
      hours_since_ok: string | null;
    }>(
      `select source_id, retailer_slug, method::text as method, hours_since_ok
         from source_health
        where legal_status = 'green' and not kill_switch and method <> 'crowd'`,
    );
    const breaches: FreshnessBreach[] = [];
    for (const r of rows) {
      const target = FRESHNESS_TARGET_HOURS[r.method] ?? 48;
      const hours = r.hours_since_ok === null ? null : Number(r.hours_since_ok);
      if (hours === null || hours > target) {
        breaches.push({
          source_id: r.source_id,
          retailer_slug: r.retailer_slug,
          method: r.method,
          hours_since_ok: hours,
          target_hours: target,
        });
      }
    }
    for (const b of breaches)
      this.log.warn(JSON.stringify({ event: 'qarib.freshness.breach', ...b }));
    return { checked: rows.length, breaches };
  }
}
