-- Synthetic catalogue for LOAD TESTING ONLY (plan 10.3): 15,000 products x ~60 % coverage across 8 fake
-- retailers. All rows are flagged demo (is_demo = true) so they never appear without SHOW_DEMO. Never run
-- this against a real environment. Usage (local stack):
--   docker compose -f docker-compose.stack.yml exec -T db psql -U qarib -d qarib < load/seed-large.sql
begin;
select set_config('qarib.actor', 'load-seed', true);

insert into retailers (slug, name_en, name_ar, type, is_demo)
select 'load-' || g, 'Load Mart ' || g, 'لود مارت ' || g, 'supermarket', true
from generate_series(1, 8) g
on conflict (slug) do nothing;

insert into sources (retailer_id, method, legal_status, notes)
select r.id, 'manual', 'green', 'load test data'
from retailers r
where r.slug like 'load-%' and not exists (select 1 from sources s where s.retailer_id = r.id);

with cat as (select id from categories where slug = 'pantry'),
brands_l as (
  select row_number() over (order by n) as i, n
  from unnest(array['Nadec','Almarai','Baladna','Lulu','Americana','Nestle','Heinz','Kraft','Sunbites','Goodfood','Oasis','Rawabi','Saffola','Tiffany','Crystal','Hayat','Freshly','Golden','Royal','Sahara']) n
),
items as (
  select row_number() over (order by n) as i, n
  from unnest(array['milk','rice','eggs','water','juice','cheese','butter','yogurt','bread','flour','sugar','oil','tea','coffee','pasta','tuna','beans','corn','honey','jam','biscuits','chips','cereal','salt','pepper','ketchup','mayonnaise','detergent','tissue','soap']) n
),
variants as (
  select row_number() over (order by n) as i, n
  from unnest(array['classic','organic','low fat','extra','premium','light','family','fresh']) n
),
sizes as (
  select row_number() over (order by n) as i, n, u
  from (values (250,'g'),(500,'g'),(1,'kg'),(2,'kg'),(330,'ml'),(750,'ml'),(1,'l'),(1500,'ml')) v(n, u)
),
combos as (
  select g,
         (select n from brands_l where i = 1 + (g % 20)) as brand,
         (select n from items where i = 1 + ((g / 20) % 30)) as item,
         (select n from variants where i = 1 + ((g / 600) % 8)) as variant,
         (select i from sizes s where s.i = 1 + ((g / 4800) % 8)) as size_i
  from generate_series(0, 14999) g
)
insert into products (canonical_name_en, canonical_name_ar, category_id, size_value, size_unit, search_text)
select c.brand || ' ' || c.item || ' ' || c.variant,
       null,
       (select id from cat),
       s.n,
       s.u::size_unit,
       lower(c.brand || ' ' || c.item || ' ' || c.variant)
from combos c join sizes s on s.i = c.size_i;

-- listings + current prices for ~60 % of (product, retailer) pairs, via the normal write path
insert into retailer_products (retailer_id, source_id, external_sku, raw_name, product_id, match_status, match_score)
select r.id, s.id, 'load-' || p.id::text, p.canonical_name_en, p.id, 'manual', 1
from products p
join retailers r on r.slug like 'load-%'
join sources s on s.retailer_id = r.id
where p.canonical_name_ar is null
  and p.canonical_name_en !~ 'DemoFarm|AquaDemo|SampleGrain'
  and (abs(('x' || substr(md5(p.id::text || r.slug), 1, 4))::bit(16)::int) % 100) < 60
on conflict (source_id, external_sku) do nothing;

select count(record_price(rp.id, null, round((2 + (abs(('x' || substr(md5(rp.id::text), 1, 6))::bit(24)::int) % 4000) / 100.0)::numeric, 2),
                          null, 'none', null, true, now() - (random() * interval '2 days'), rp.source_id))
from retailer_products rp where rp.external_sku like 'load-%';
commit;

select (select count(*) from products) as products, (select count(*) from current_prices) as current_prices;
