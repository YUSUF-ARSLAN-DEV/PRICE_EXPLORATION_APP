import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { DISCLAIMER_EN } from '@qarib/shared';
import { ZodPipe } from '../common/zod';
import { Db } from '../db/db.service';
import { SearchService, toOffer } from '../search/search.service';

const offersQuery = z.object({
  retailer: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(2000).default(0),
});

@ApiTags('catalogue')
@Controller()
export class CatalogController {
  constructor(
    private readonly db: Db,
    private readonly search: SearchService,
  ) {}

  @Get('retailers')
  @ApiOperation({ summary: 'Retailers that currently have public prices.' })
  async retailers() {
    const rows = await this.db.query(
      `select r.id, r.slug, r.name_en, r.name_ar, r.type, r.logo_license_status = 'granted' as show_logo,
              count(o.offer_id)::int as offer_count, max(o.observed_at) as last_updated
         from retailers r join public_offers o on o.retailer_id = r.id
        where r.active group by r.id order by r.name_en`,
    );
    return { retailers: rows };
  }

  @Get('categories')
  @ApiOperation({ summary: 'Category tree (restricted categories are never listed).' })
  async categories() {
    const rows = await this.db.query(
      "select id, parent_id, slug, name_en, name_ar, sort_order from categories where not restricted and slug <> 'uncategorised' order by sort_order, name_en",
    );
    return { categories: rows };
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'One product with all current offers and ~90 days of price history.' })
  async product(@Param('id', new ParseUUIDPipe()) id: string) {
    const [p] = await this.search.loadProducts([id]);
    if (!p) throw new NotFoundException('Product not found');
    const history = await this.db.query<{
      retailer_slug: string;
      day: string;
      min_price_qar: string;
    }>(
      `select retailer_slug, to_char(day, 'YYYY-MM-DD') as day, min_price_qar
         from public_price_history where product_id = $1 and day >= current_date - 90 order by day`,
      [id],
    );
    return {
      product: p,
      history: history.map((h) => ({
        retailer_slug: h.retailer_slug,
        day: h.day,
        min_price_qar: Number(h.min_price_qar),
      })),
      disclaimer: DISCLAIMER_EN,
    };
  }

  @Get('offers')
  @ApiOperation({ summary: 'Current promotions / flyer offers, biggest discounts first.' })
  async offers(@Query(new ZodPipe(offersQuery)) q: ReturnType<typeof offersQuery.parse>) {
    const params: unknown[] = [q.limit, q.offset];
    let filter = '';
    if (q.retailer) {
      params.push(q.retailer);
      filter = `and retailer_slug = $${params.length}`;
    }
    const rows = await this.db.query<
      Parameters<typeof toOffer>[0] & {
        canonical_name_en: string;
        canonical_name_ar: string | null;
      }
    >(
      `select * from public_offers
        where promo_type <> 'none' and (promo_ends_at is null or promo_ends_at >= now()) ${filter}
        order by coalesce((was_price_qar - price_qar) / nullif(was_price_qar, 0), 0) desc, observed_at desc
        limit $1 offset $2`,
      params,
    );
    return {
      offers: rows.map((r) => ({
        product_id: r.product_id,
        name_en: r.canonical_name_en,
        name_ar: r.canonical_name_ar,
        ...toOffer(r),
      })),
    };
  }

  @Get('sitemap')
  @ApiOperation({ summary: 'Public product ids + update times (feeds the web sitemap).' })
  async sitemap() {
    const rows = await this.db.query(
      `select product_id as id, max(observed_at) as updated_at from public_offers group by product_id order by 2 desc limit 45000`,
    );
    return { products: rows };
  }
}
