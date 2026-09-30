import { normalizeSearch, parseSize } from '@qarib/shared';
import type { Client } from 'pg';

/**
 * Idempotent seed (plan 2.1): category tree + two FAKE demo retailers (+ a few fictional products
 * so the pipeline can be exercised end-to-end). Demo data is flagged is_demo and stays hidden from
 * public views unless `set qarib.show_demo = 'on'`.
 */

interface Cat {
  slug: string;
  en: string;
  ar: string;
  restricted?: boolean;
  children?: Cat[];
}

export const CATEGORY_TREE: Cat[] = [
  {
    slug: 'dairy-eggs',
    en: 'Dairy & Eggs',
    ar: 'الألبان والبيض',
    children: [
      {
        slug: 'milk',
        en: 'Milk',
        ar: 'حليب',
        children: [
          { slug: 'fresh-milk', en: 'Fresh Milk', ar: 'حليب طازج' },
          { slug: 'long-life-milk', en: 'Long Life Milk', ar: 'حليب طويل الأجل' },
        ],
      },
      { slug: 'yogurt-laban', en: 'Yogurt & Laban', ar: 'زبادي ولبن' },
      { slug: 'cheese', en: 'Cheese', ar: 'جبن' },
      { slug: 'eggs', en: 'Eggs', ar: 'بيض' },
      { slug: 'butter-cream', en: 'Butter & Cream', ar: 'زبدة وقشطة' },
    ],
  },
  {
    slug: 'fruit-vegetables',
    en: 'Fruit & Vegetables',
    ar: 'الفواكه والخضروات',
    children: [
      { slug: 'fruit', en: 'Fruit', ar: 'فواكه' },
      { slug: 'vegetables', en: 'Vegetables', ar: 'خضروات' },
      { slug: 'herbs', en: 'Herbs', ar: 'أعشاب' },
    ],
  },
  {
    slug: 'meat-seafood',
    en: 'Meat & Seafood',
    ar: 'اللحوم والمأكولات البحرية',
    children: [
      { slug: 'chicken', en: 'Chicken', ar: 'دجاج' },
      { slug: 'beef-lamb', en: 'Beef & Lamb', ar: 'لحم بقري وضأن' },
      { slug: 'fish-seafood', en: 'Fish & Seafood', ar: 'أسماك ومأكولات بحرية' },
    ],
  },
  {
    slug: 'bakery',
    en: 'Bakery',
    ar: 'المخبوزات',
    children: [
      { slug: 'bread', en: 'Bread', ar: 'خبز' },
      { slug: 'cakes-sweets', en: 'Cakes & Sweets', ar: 'كعك وحلويات' },
    ],
  },
  {
    slug: 'pantry',
    en: 'Pantry',
    ar: 'المواد الغذائية الأساسية',
    children: [
      { slug: 'rice', en: 'Rice', ar: 'أرز' },
      { slug: 'pasta', en: 'Pasta', ar: 'معكرونة' },
      { slug: 'flour', en: 'Flour', ar: 'دقيق' },
      { slug: 'oils', en: 'Oils', ar: 'زيوت' },
      { slug: 'sugar', en: 'Sugar', ar: 'سكر' },
      { slug: 'canned-food', en: 'Canned Food', ar: 'معلبات' },
      { slug: 'spices', en: 'Spices', ar: 'بهارات' },
      { slug: 'tea-coffee', en: 'Tea & Coffee', ar: 'شاي وقهوة' },
    ],
  },
  {
    slug: 'beverages',
    en: 'Beverages',
    ar: 'المشروبات',
    children: [
      { slug: 'water', en: 'Water', ar: 'مياه' },
      { slug: 'juice', en: 'Juice', ar: 'عصائر' },
      { slug: 'soft-drinks', en: 'Soft Drinks', ar: 'مشروبات غازية' },
    ],
  },
  { slug: 'snacks', en: 'Snacks', ar: 'الوجبات الخفيفة' },
  { slug: 'frozen', en: 'Frozen', ar: 'المجمدات' },
  { slug: 'household', en: 'Household & Cleaning', ar: 'المنظفات والمستلزمات المنزلية' },
  { slug: 'baby', en: 'Baby', ar: 'مستلزمات الأطفال' },
  {
    // Never public (plan 0.5 / P8). Exists so classifiers have somewhere to put such products.
    slug: 'restricted-alcohol-tobacco',
    en: 'Alcohol & Tobacco (restricted)',
    ar: 'الكحول والتبغ (محظور)',
    restricted: true,
  },
];

async function seedCategories(client: Client, nodes: Cat[], parentId: string | null, depth = 0) {
  let order = 0;
  for (const n of nodes) {
    const res = await client.query<{ id: string }>(
      `insert into categories (parent_id, slug, name_en, name_ar, restricted, sort_order)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (slug) do update
         set name_en = excluded.name_en, name_ar = excluded.name_ar, sort_order = excluded.sort_order
       returning id`,
      [parentId, n.slug, n.en, n.ar, n.restricted ?? false, order++],
    );
    if (n.children) await seedCategories(client, n.children, res.rows[0]!.id, depth + 1);
  }
}

const DEMO_RETAILERS = [
  { slug: 'demo-mart', en: 'Demo Mart', ar: 'ديمو مارت', type: 'supermarket' },
  { slug: 'sample-hyper', en: 'Sample Hyper', ar: 'سمبل هايبر', type: 'hyper' },
] as const;

// Fictional brands/products - no real retailer data.
const DEMO_PRODUCTS = [
  {
    sku: 'MILK1',
    brand: 'DemoFarm',
    en: 'DemoFarm Fresh Milk Full Fat',
    ar: 'حليب ديمو فارم طازج كامل الدسم',
    size: '1L',
    cat: 'fresh-milk',
    prices: [6.5, 6.25],
  },
  {
    sku: 'MILK2',
    brand: 'DemoFarm',
    en: 'DemoFarm Fresh Milk Full Fat',
    ar: 'حليب ديمو فارم طازج كامل الدسم',
    size: '2 x 500ml',
    cat: 'fresh-milk',
    prices: [5.9, 6.1],
  },
  {
    sku: 'RICE5',
    brand: 'SampleGrain',
    en: 'SampleGrain Basmati Rice',
    ar: 'أرز سمبل جرين بسمتي',
    size: '5kg',
    cat: 'rice',
    prices: [32, 29.5],
  },
  {
    sku: 'WATER6',
    brand: 'AquaDemo',
    en: 'AquaDemo Mineral Water',
    ar: 'مياه أكوا ديمو المعدنية',
    size: '6 x 1.5L',
    cat: 'water',
    prices: [9, 8.5],
  },
  {
    sku: 'EGGS12',
    brand: 'SampleGrain',
    en: 'Farm Eggs Medium',
    ar: 'بيض مزرعة متوسط',
    size: '12 pcs',
    cat: 'eggs',
    prices: [11, 10.75],
  },
] as const;

async function seedDemo(client: Client) {
  const retailerIds: string[] = [];
  const sourceIds: string[] = [];
  for (const r of DEMO_RETAILERS) {
    const rr = await client.query<{ id: string }>(
      `insert into retailers (slug, name_en, name_ar, type, is_demo)
       values ($1, $2, $3, $4, true)
       on conflict (slug) do update set name_en = excluded.name_en, name_ar = excluded.name_ar
       returning id`,
      [r.slug, r.en, r.ar, r.type],
    );
    const retailerId = rr.rows[0]!.id;
    retailerIds.push(retailerId);
    // One manual, green source per demo retailer (manual/crowd need no external approval).
    const existing = await client.query<{ id: string }>(
      `select id from sources where retailer_id = $1 and method = 'manual' limit 1`,
      [retailerId],
    );
    const sourceId =
      existing.rows[0]?.id ??
      (
        await client.query<{ id: string }>(
          `insert into sources (retailer_id, method, legal_status, notes)
           values ($1, 'manual', 'green', 'Demo data - fictional') returning id`,
          [retailerId],
        )
      ).rows[0]!.id;
    sourceIds.push(sourceId);
  }

  for (const p of DEMO_PRODUCTS) {
    const brand = await client.query<{ id: string }>(
      `insert into brands (name_en) values ($1)
       on conflict (name_en) do update set name_en = excluded.name_en returning id`,
      [p.brand],
    );
    const cat = await client.query<{ id: string }>('select id from categories where slug = $1', [
      p.cat,
    ]);
    const size = parseSize(p.size);
    if (!size) throw new Error(`seed: unparseable size ${p.size}`);
    const search = normalizeSearch(`${p.en} ${p.ar} ${p.brand}`);

    // Product identity = brand + english name + size (no GTIN for fictional items).
    const found = await client.query<{ id: string }>(
      `select id from products where brand_id = $1 and canonical_name_en = $2
         and size_value = $3 and size_unit = $4 and pack_count = $5`,
      [brand.rows[0]!.id, p.en, size.size_value, size.size_unit, size.pack_count],
    );
    const productId =
      found.rows[0]?.id ??
      (
        await client.query<{ id: string }>(
          `insert into products (canonical_name_en, canonical_name_ar, brand_id, category_id,
                                 size_value, size_unit, pack_count, search_text)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
          [
            p.en,
            p.ar,
            brand.rows[0]!.id,
            cat.rows[0]!.id,
            size.size_value,
            size.size_unit,
            size.pack_count,
            search,
          ],
        )
      ).rows[0]!.id;

    for (let i = 0; i < DEMO_RETAILERS.length; i++) {
      const rp = await client.query<{ id: string }>(
        `insert into retailer_products (retailer_id, source_id, external_sku, raw_name,
                                        raw_name_normalised, raw_size, product_id, match_status, match_score)
         values ($1, $2, $3, $4, $5, $6, $7, 'manual', 1)
         on conflict (source_id, external_sku) do update set raw_name = excluded.raw_name
         returning id`,
        [retailerIds[i], sourceIds[i], p.sku, p.en, normalizeSearch(p.en), p.size, productId],
      );
      const has = await client.query(
        'select 1 from current_prices where retailer_product_id = $1',
        [rp.rows[0]!.id],
      );
      if (has.rowCount === 0) {
        await client.query(
          `select record_price($1, null, $2, null, 'none', null, true, now(), $3)`,
          [rp.rows[0]!.id, p.prices[i], sourceIds[i]],
        );
      }
    }
  }
}

export async function seed(client: Client): Promise<void> {
  await client.query('begin');
  try {
    await client.query(`select set_config('qarib.actor', 'seed', true)`);
    await seedCategories(client, CATEGORY_TREE, null);
    await seedDemo(client);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}
