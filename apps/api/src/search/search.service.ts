import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  DISCLAIMER_AR,
  DISCLAIMER_EN,
  normalizeSearch,
  type Offer,
  type ProductResult,
  type SearchQuery,
  type SearchResponse,
} from '@qarib/shared';
import { Db } from '../db/db.service';
import { MeiliIndexer } from './meili.indexer';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
const num = (v: string | number | null) => (v === null || v === undefined ? null : Number(v));

type OfferRow = {
  product_id: string;
  offer_id: string;
  retailer_id: string;
  retailer_slug: string;
  retailer_name_en: string;
  retailer_name_ar: string | null;
  branch_name: string | null;
  branch_area: string | null;
  price_qar: string;
  was_price_qar: string | null;
  promo_type: string;
  promo_ends_at: Date | null;
  in_stock: boolean;
  unit_price_qar: string | null;
  unit_price_base: string | null;
  observed_at: Date;
  is_stale: boolean;
};

export function toOffer(r: OfferRow): Offer {
  return {
    offer_id: r.offer_id,
    retailer_id: r.retailer_id,
    retailer_slug: r.retailer_slug,
    retailer_name_en: r.retailer_name_en,
    retailer_name_ar: r.retailer_name_ar,
    branch_name: r.branch_name,
    branch_area: r.branch_area,
    price_qar: Number(r.price_qar),
    was_price_qar: num(r.was_price_qar),
    promo_type: r.promo_type,
    promo_ends_at: r.promo_ends_at ? r.promo_ends_at.toISOString() : null,
    in_stock: r.in_stock,
    unit_price_qar: num(r.unit_price_qar),
    unit_price_base: r.unit_price_base,
    observed_at: r.observed_at.toISOString(),
    is_stale: r.is_stale,
  };
}

@Injectable()
export class SearchService implements OnModuleDestroy {
  private readonly log = new Logger('search');

  constructor(
    private readonly db: Db,
    private readonly meili: MeiliIndexer,
  ) {}

  /** Products (public view only) with their current offers, in the given id order. */
  async loadProducts(ids: string[]): Promise<ProductResult[]> {
    if (ids.length === 0) return [];
    const [products, offers] = await Promise.all([
      this.db.query<{
        id: string;
        name_en: string;
        name_ar: string | null;
        brand: string | null;
        category_slug: string | null;
        size_value: string | null;
        size_unit: string | null;
        pack_count: number;
      }>(
        `select p.id, p.canonical_name_en as name_en, p.canonical_name_ar as name_ar, b.name_en::text as brand,
                c.slug as category_slug, p.size_value, p.size_unit, p.pack_count
           from public_products p
           left join brands b on b.id = p.brand_id
           left join categories c on c.id = p.category_id
          where p.id = any($1::uuid[])`,
        [ids],
      ),
      this.db.query<OfferRow>(
        'select * from public_offers where product_id = any($1::uuid[]) order by price_qar asc, observed_at desc',
        [ids],
      ),
    ]);
    const byProduct = new Map<string, Offer[]>();
    for (const o of offers) {
      const list = byProduct.get(o.product_id) ?? [];
      list.push(toOffer(o));
      byProduct.set(o.product_id, list);
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    return products
      .map((p): ProductResult => {
        const list = byProduct.get(p.id) ?? [];
        const prices = list.map((o) => o.price_qar);
        return {
          id: p.id,
          name_en: p.name_en,
          name_ar: p.name_ar,
          brand: p.brand,
          category_slug: p.category_slug,
          size_value: num(p.size_value),
          size_unit: p.size_unit,
          pack_count: p.pack_count,
          offers: list,
          offer_count: list.length,
          min_price_qar: prices.length ? Math.min(...prices) : null,
          max_price_qar: prices.length ? Math.max(...prices) : null,
          last_updated: list.length
            ? list
                .map((o) => o.observed_at)
                .sort()
                .at(-1)!
            : null,
        };
      })
      .filter((p) => p.offer_count > 0)
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  private async postgresCandidates(
    norm: string,
    q: SearchQuery,
    pool: number,
  ): Promise<{ id: string; score: number }[]> {
    const tokens = norm.split(' ').filter(Boolean).slice(0, 6);
    const params: unknown[] = [norm];
    const tokenConds = tokens.map((t) => {
      params.push(`%${escapeLike(t)}%`);
      return `p.search_text ilike $${params.length}`;
    });
    const all = tokenConds.length ? `(${tokenConds.join(' and ')})` : 'false';
    let cte = '';
    let categoryFilter = '';
    if (q.category) {
      params.push(q.category);
      cte = `with recursive tree as (select id from categories where slug = $${params.length}
               union all select c.id from categories c join tree t on c.parent_id = t.id) `;
      categoryFilter = 'and p.category_id in (select id from tree)';
    }
    let retailerFilter = '';
    if (q.retailer) {
      params.push(q.retailer);
      retailerFilter = `and o.retailer_slug = $${params.length}`;
    }
    const rows = await this.db.query<{ id: string; score: number }>(
      `${cte}select p.id,
              (case when ${all} then 0.6 + 0.4 * similarity(p.search_text, $1)
                    else similarity(p.search_text, $1) end)::float8 as score
         from public_products p
        where (p.search_text % $1 or ${all})
          and exists (select 1 from public_offers o where o.product_id = p.id ${retailerFilter})
          ${categoryFilter}
        order by score desc
        limit ${pool}`,
      params,
    );
    return rows;
  }

  private async meiliCandidates(
    norm: string,
    q: SearchQuery,
    pool: number,
  ): Promise<{ id: string; score: number }[]> {
    const filter: string[] = [];
    if (q.category) filter.push(`category_slugs = "${q.category.replace(/"/g, '')}"`);
    if (q.retailer) filter.push(`retailer_slugs = "${q.retailer.replace(/"/g, '')}"`);
    const ids = await this.meili.search(norm, filter, pool);
    return ids.map((id, i) => ({ id, score: 0.6 + 0.4 * (1 - i / Math.max(ids.length, 1)) }));
  }

  /** Plan 5.4: relevance first, then sold by >= 2 retailers, then popularity. */
  async search(q: SearchQuery): Promise<SearchResponse> {
    const norm = normalizeSearch(q.q);
    let backend: SearchResponse['backend'] = 'postgres';
    let cands: { id: string; score: number }[] = [];
    const pool = Math.min(200, Math.max(60, q.offset + q.limit));
    if (norm) {
      if (this.meili.enabled) {
        try {
          cands = await this.meiliCandidates(norm, q, pool);
          backend = 'meilisearch';
        } catch (err) {
          this.log.warn(`Meilisearch unavailable, falling back to Postgres: ${(err as Error).message}`);
        }
      }
      if (backend === 'postgres') cands = await this.postgresCandidates(norm, q, pool);
    }
    this.logQuery(q.q, norm);

    // Rank on a light aggregate (one row per candidate), then load ONLY the requested page in full.
    const ids = cands.map((c) => c.id);
    const score = new Map(cands.map((c) => [c.id, c.score]));
    const [agg, pop] = await Promise.all([
      ids.length
        ? this.db.query<{ product_id: string; offer_count: string; min_price: string; min_unit: string | null }>(
            `select product_id, count(*) as offer_count, min(price_qar) as min_price, min(unit_price_qar) as min_unit
               from public_offers where product_id = any($1::uuid[]) group by product_id`,
            [ids],
          )
        : Promise.resolve([]),
      ids.length
        ? this.db.query<{ product_id: string; n: string }>(
            `select product_id, count(*) as n from (
               select product_id from basket_items where product_id = any($1::uuid[])
               union all select product_id from alerts where product_id = any($1::uuid[])) x
             group by product_id`,
            [ids],
          )
        : Promise.resolve([]),
    ]);
    const info = new Map(agg.map((r) => [r.product_id, { offers: Number(r.offer_count), price: Number(r.min_price), unit: r.min_unit === null ? Infinity : Number(r.min_unit) }]));
    const popularity = new Map(pop.map((p) => [p.product_id, Number(p.n)]));
    const bucket = (id: string) => ((score.get(id) ?? 0) >= 0.6 ? 1 : 0);

    const ranked = ids
      .filter((id) => info.has(id)) // products without a public offer are never shown
      .sort((a, b) => {
        const ia = info.get(a)!;
        const ib = info.get(b)!;
        if (q.sort === 'price') return ia.price - ib.price;
        if (q.sort === 'unit_price') return ia.unit - ib.unit;
        return (
          bucket(b) - bucket(a) ||
          Number(ib.offers >= 2) - Number(ia.offers >= 2) ||
          (popularity.get(b) ?? 0) - (popularity.get(a) ?? 0) ||
          (score.get(b) ?? 0) - (score.get(a) ?? 0)
        );
      });
    const page = await this.loadProducts(ranked.slice(q.offset, q.offset + q.limit));
    return {
      query: q.q,
      backend,
      total: ranked.length,
      results: page,
      disclaimer: q.lang === 'ar' ? DISCLAIMER_AR : DISCLAIMER_EN,
    };
  }

  // ---- anonymous query log: buffered, so a popular query does not become a hot row -------------
  private readonly logBuffer = new Map<string, number>();
  private logTimer?: NodeJS.Timeout;

  /** Anonymous aggregate only: no user id, no IP. Skips anything that looks like personal data. */
  private logQuery(raw: string, norm: string): void {
    const digits = norm.match(/\d/g)?.length ?? 0;
    if (!norm || norm.length > 60 || raw.includes('@') || digits >= 6) return;
    this.logBuffer.set(norm, (this.logBuffer.get(norm) ?? 0) + 1);
    this.logTimer ??= setInterval(() => void this.flushLog(), 5000).unref();
  }

  /** Writes buffered counts (one upsert per distinct query). Called every 5 s and on shutdown. */
  async flushLog(): Promise<void> {
    if (this.logBuffer.size === 0) return;
    const batch = [...this.logBuffer];
    this.logBuffer.clear();
    const queries = batch.map(([q]) => q);
    const hits = batch.map(([, n]) => n);
    await this.db
      .query(
        `insert into search_log (day, query_norm, hits)
         select current_date, q, h from unnest($1::text[], $2::int[]) as t(q, h)
         on conflict (day, query_norm) do update set hits = search_log.hits + excluded.hits`,
        [queries, hits],
      )
      .catch((err: Error) => this.log.warn(`search log flush failed: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.logTimer) clearInterval(this.logTimer);
    await this.flushLog();
  }

  async autocomplete(
    q: string,
    limit: number,
  ): Promise<{ text: string; kind: 'product' | 'brand'; product_id?: string }[]> {
    const norm = normalizeSearch(q);
    if (!norm) return [];
    const like = `%${escapeLike(norm)}%`;
    const rows = await this.db.query<{
      text: string;
      kind: 'product' | 'brand';
      product_id: string | null;
      s: number;
    }>(
      `select text, kind, product_id, s from (
         select p.canonical_name_en as text, 'product' as kind, p.id as product_id,
                (similarity(p.search_text, $1) + case when p.search_text ilike $3 then 0.5 else 0 end)::float8 as s
           from public_products p
          where (p.search_text ilike $2 or p.search_text % $1)
            and exists (select 1 from public_offers o where o.product_id = p.id)
         union all
         select b.name_en::text, 'brand', null::uuid, (0.4 + similarity(ba.alias, $1))::float8
           from brands b join brand_aliases ba on ba.brand_id = b.id
          where ba.alias ilike $3 and exists (select 1 from public_products p where p.brand_id = b.id)
       ) t order by s desc limit $4`,
      [norm, like, `${escapeLike(norm)}%`, limit * 3],
    );
    const seen = new Set<string>();
    const out: { text: string; kind: 'product' | 'brand'; product_id?: string }[] = [];
    for (const r of rows) {
      const key = `${r.kind}:${r.text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        text: r.text,
        kind: r.kind,
        ...(r.product_id ? { product_id: r.product_id } : {}),
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Popular searches: aggregated, anonymous, k-anonymity threshold of 20 (plan 5.3). */
  async popular(): Promise<{ query: string; hits: number }[]> {
    const rows = await this.db.query<{ query: string; hits: string }>(
      `select query_norm as query, sum(hits) as hits from search_log
        where day >= current_date - 7 group by query_norm having sum(hits) >= 20
        order by sum(hits) desc limit 10`,
    );
    return rows.map((r) => ({ query: r.query, hits: Number(r.hits) }));
  }
}
