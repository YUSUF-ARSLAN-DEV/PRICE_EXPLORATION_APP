import { Inject, Injectable, Logger } from '@nestjs/common';
import { MeiliSearch } from 'meilisearch';
import { CONFIG, Config } from '../config';
import { Db } from '../db/db.service';

/** Index name; overridable (MEILI_INDEX) so tests and dev never touch a real index. */
export const indexName = () => process.env.MEILI_INDEX ?? 'products';

// Starter synonyms (search-normalised forms). Extend with real vocabulary from search logs.
export const SYNONYMS: Record<string, string[]> = {
  laban: ['لبن', 'روب'],
  لبن: ['laban', 'buttermilk'],
  rice: ['رز', 'ارز'],
  رز: ['rice', 'ارز'],
  ارز: ['rice', 'رز'],
  milk: ['حليب'],
  حليب: ['milk'],
  eggs: ['بيض', 'egg'],
  بيض: ['eggs', 'egg'],
  water: ['مياه', 'ماء'],
  مياه: ['water', 'ماء'],
  chicken: ['دجاج'],
  دجاج: ['chicken'],
  sugar: ['سكر'],
  سكر: ['sugar'],
  bread: ['خبز'],
  خبز: ['bread'],
  juice: ['عصير'],
  عصير: ['juice'],
  tea: ['شاي'],
  شاي: ['tea'],
  coffee: ['قهوه'],
  قهوه: ['coffee'],
};

export interface ProductDoc {
  id: string;
  name_en: string;
  name_ar: string | null;
  brand: string | null;
  category_slug: string | null;
  category_slugs: string[];
  retailer_slugs: string[];
  search_text: string;
  offer_count: number;
  min_price: number | null;
}

/** Keeps the Meilisearch index in sync with `public_products` (only ever indexes public data). */
@Injectable()
export class MeiliIndexer {
  private readonly log = new Logger('meili');
  readonly client?: MeiliSearch;

  constructor(
    @Inject(CONFIG) cfg: Config,
    private readonly db: Db,
  ) {
    if (cfg.meili) this.client = new MeiliSearch({ host: cfg.meili.url, apiKey: cfg.meili.key });
  }

  get enabled(): boolean {
    return Boolean(this.client);
  }

  async documents(): Promise<ProductDoc[]> {
    const rows = await this.db.query<{
      id: string;
      name_en: string;
      name_ar: string | null;
      brand: string | null;
      category_slug: string | null;
      category_slugs: string[] | null;
      retailer_slugs: string[] | null;
      search_text: string;
      offer_count: string;
      min_price: string | null;
    }>(
      `with recursive anc as (
         select id, id as leaf, slug, parent_id from categories
         union all
         select c.id, anc.leaf, c.slug, c.parent_id from categories c join anc on anc.parent_id = c.id
       )
       select p.id, p.canonical_name_en as name_en, p.canonical_name_ar as name_ar, b.name_en::text as brand,
              c.slug as category_slug,
              (select array_agg(distinct a.slug) from anc a where a.leaf = p.category_id) as category_slugs,
              (select array_agg(distinct o.retailer_slug) from public_offers o where o.product_id = p.id) as retailer_slugs,
              p.search_text,
              (select count(*) from public_offers o where o.product_id = p.id) as offer_count,
              (select min(o.price_qar) from public_offers o where o.product_id = p.id) as min_price
         from public_products p
         left join brands b on b.id = p.brand_id
         left join categories c on c.id = p.category_id`,
    );
    return rows
      .filter((r) => Number(r.offer_count) > 0)
      .map((r) => ({
        id: r.id,
        name_en: r.name_en,
        name_ar: r.name_ar,
        brand: r.brand,
        category_slug: r.category_slug,
        category_slugs: r.category_slugs ?? [],
        retailer_slugs: r.retailer_slugs ?? [],
        search_text: r.search_text,
        offer_count: Number(r.offer_count),
        min_price: r.min_price === null ? null : Number(r.min_price),
      }));
  }

  /** Full, idempotent re-index (documents with no public offers are removed). */
  async reindex(): Promise<number> {
    if (!this.client) throw new Error('Meilisearch is not configured (MEILI_URL)');
    const index = this.client.index(indexName());
    const created = await this.client.createIndex(indexName(), { primaryKey: 'id' });
    await this.client.tasks.waitForTask(created.taskUid);
    const settings = await index.updateSettings({
      searchableAttributes: ['name_en', 'name_ar', 'brand', 'search_text'],
      filterableAttributes: ['category_slugs', 'retailer_slugs'],
      sortableAttributes: ['min_price'],
      synonyms: SYNONYMS,
    });
    await this.client.tasks.waitForTask(settings.taskUid);
    const docs = await this.documents();
    const cleared = await index.deleteAllDocuments();
    await this.client.tasks.waitForTask(cleared.taskUid);
    for (let i = 0; i < docs.length; i += 1000) {
      const task = await index.addDocuments(docs.slice(i, i + 1000));
      await this.client.tasks.waitForTask(task.taskUid);
    }
    this.log.log(`indexed ${docs.length} products`);
    return docs.length;
  }

  async search(normQuery: string, filter: string[], limit = 200): Promise<string[]> {
    if (!this.client) throw new Error('Meilisearch is not configured');
    const res = await this.client.index(indexName()).search(normQuery, {
      limit,
      filter: filter.length ? filter : undefined,
      attributesToRetrieve: ['id'],
    });
    return res.hits.map((h) => (h as { id: string }).id);
  }
}
