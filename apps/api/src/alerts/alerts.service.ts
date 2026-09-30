import { Inject, Injectable, Logger } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { CONFIG, Config } from '../config';
import { Db } from '../db/db.service';
import { Mailer } from '../mail/mailer';

/** Qatar is UTC+3 all year. Courtesy quiet hours: no alert emails 23:00-07:00 local time. */
export function inQuietHours(now: Date): boolean {
  const hour = (now.getUTCHours() + 3) % 24;
  return hour >= 23 || hour < 7;
}

@Injectable()
export class AlertsService {
  private readonly log = new Logger('alerts');

  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    private readonly db: Db,
    private readonly mailer: Mailer,
  ) {}

  unsubscribeToken(userId: string): string {
    return jwt.sign({ sub: userId, typ: 'unsub' }, this.cfg.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: '60d',
    });
  }

  async unsubscribe(token: string): Promise<boolean> {
    let claims: { sub?: string; typ?: string };
    try {
      claims = jwt.verify(token, this.cfg.jwtSecret, { algorithms: ['HS256'] }) as typeof claims;
    } catch {
      return false;
    }
    if (claims.typ !== 'unsub' || !claims.sub) return false;
    await this.db.tx(async (c) => {
      await c.query(
        `insert into consents (user_id, purpose, granted, version) values ($1, 'alerts_email', false, 'unsubscribe-link')`,
        [claims.sub],
      );
      await c.query('update alerts set active = false where user_id = $1', [claims.sub]);
    });
    return true;
  }

  /**
   * Send due alerts (run every ~15 min by the scheduler). An alert fires when the cheapest PUBLIC
   * current price is at or below the threshold, at most once per 24 h, only to verified users whose
   * latest 'alerts_email' consent is granted, and never during quiet hours.
   */
  async evaluate(now = new Date()): Promise<{ sent: number; skipped: number }> {
    if (inQuietHours(now)) return { sent: 0, skipped: 0 };
    const due = await this.db.query<{
      id: string;
      user_id: string;
      email: string;
      locale: string;
      threshold_qar: string;
      product_name: string;
      min_price: string;
      retailer_name: string;
    }>(
      `select a.id, a.user_id, u.email::text as email, u.locale, a.threshold_qar,
              p.canonical_name_en as product_name, best.price_qar as min_price, best.retailer_name_en as retailer_name
         from alerts a
         join users u on u.id = a.user_id and u.deleted_at is null and u.email_verified_at is not null
         join public_products p on p.id = a.product_id
         join lateral (select price_qar, retailer_name_en from public_offers o
                        where o.product_id = a.product_id and o.in_stock and not o.is_stale
                        order by price_qar asc limit 1) best on true
        where a.active and best.price_qar <= a.threshold_qar
          and (a.last_notified_at is null or a.last_notified_at < $1::timestamptz - interval '24 hours')
          and coalesce((select granted from consents c where c.user_id = a.user_id and c.purpose = 'alerts_email'
                         order by c.created_at desc, c.id desc limit 1), false)`,
      [now],
    );
    let sent = 0;
    let skipped = 0;
    for (const a of due) {
      try {
        const link = `${this.cfg.appUrl}/${a.locale}/unsubscribe?token=${this.unsubscribeToken(a.user_id)}`;
        await this.mailer.send({
          to: a.email,
          subject: `Price alert: ${a.product_name} is QAR ${Number(a.min_price).toFixed(2)}`,
          text:
            `${a.product_name} is now QAR ${Number(a.min_price).toFixed(2)} at ${a.retailer_name} ` +
            `(your alert: QAR ${Number(a.threshold_qar).toFixed(2)} or less).\n\n` +
            `Prices can change - check at the store or checkout.\n\nStop these emails: ${link}`,
          headers: {
            'List-Unsubscribe': `<${link}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        await this.db.query('update alerts set last_notified_at = $2 where id = $1', [a.id, now]);
        sent++;
      } catch (err) {
        skipped++;
        this.log.warn(`alert ${a.id} not sent: ${(err as Error).message}`);
      }
    }
    return { sent, skipped };
  }
}
