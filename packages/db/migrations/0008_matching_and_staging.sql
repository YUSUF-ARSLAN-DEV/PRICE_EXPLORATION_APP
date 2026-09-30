-- Up Migration
-- Phase 4 (matching) + Phase 3 leftovers (flyer/verification staging).

-- Barcode captured from feeds (plan 4.1 step 1: exact GTIN match).
alter table retailer_products add column barcode text
  check (barcode is null or barcode ~ '^[0-9]{8,14}$');
create index retailer_products_barcode_idx on retailer_products (barcode) where barcode is not null;

-- Essential categories (idempotent; seed adds the full tree).
insert into categories (slug, name_en, name_ar, restricted, sort_order) values
  ('uncategorised', 'Uncategorised', 'غير مصنف', false, 9999),
  ('restricted-alcohol-tobacco', 'Alcohol & Tobacco (restricted)', 'الكحول والتبغ (محظور)', true, 9000),
  ('restricted-pork', 'Pork products (restricted pending legal advice)', 'منتجات لحم الخنزير (محظور)', true, 9001)
on conflict (slug) do nothing;

-- Brand aliases (AR/EN spellings) so "Almarai" / "المراعي" / "Al Marai" resolve to one brand.
create table brand_aliases (
  id uuid primary key default uuid_generate_v7(),
  brand_id uuid not null references brands (id) on delete cascade,
  alias text not null,           -- search-normalised (see normalizeSearch)
  unique (alias)
);
create index brand_aliases_brand_idx on brand_aliases (brand_id);

-- Optional semantic embeddings (plan 4.1 step 3). NULL until an embedder is configured.
alter table products add column embedding vector(384);

-- Candidate matches shown in the review UI (plan 4.5).
create table match_candidates (
  id uuid primary key default uuid_generate_v7(),
  retailer_product_id uuid not null references retailer_products (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  score numeric(4, 3) not null check (score between 0 and 1),
  method text not null check (method in ('gtin', 'fuzzy', 'embedding', 'llm')),
  reasons jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (retailer_product_id, product_id)
);
create index match_candidates_rp_idx on match_candidates (retailer_product_id, score desc);

-- Human (or automated) match decision; always audited.
create function decide_match(p_retailer_product_id uuid, p_product_id uuid, p_actor text)
returns void language plpgsql as $$
declare
  old_row retailer_products%rowtype;
begin
  select * into old_row from retailer_products where id = p_retailer_product_id for update;
  if not found then
    raise exception 'unknown retailer_product %', p_retailer_product_id using errcode = 'QAR01';
  end if;
  perform 1 from products where id = p_product_id;
  if not found then
    raise exception 'unknown product %', p_product_id using errcode = 'QAR01';
  end if;
  update retailer_products
     set product_id = p_product_id, match_status = 'manual', match_score = 1
   where id = p_retailer_product_id;
  delete from match_candidates where retailer_product_id = p_retailer_product_id;
  insert into audit_log (actor, action, entity_type, entity_id, before, after)
  values (p_actor, 'match.decided', 'retailer_product', p_retailer_product_id,
          jsonb_build_object('product_id', old_row.product_id, 'match_status', old_row.match_status),
          jsonb_build_object('product_id', p_product_id, 'match_status', 'manual'));
end $$;

create function reject_match(p_retailer_product_id uuid, p_actor text)
returns void language plpgsql as $$
begin
  update retailer_products
     set product_id = null, match_status = 'rejected', match_score = null
   where id = p_retailer_product_id;
  if not found then
    raise exception 'unknown retailer_product %', p_retailer_product_id using errcode = 'QAR01';
  end if;
  delete from match_candidates where retailer_product_id = p_retailer_product_id;
  insert into audit_log (actor, action, entity_type, entity_id, after)
  values (p_actor, 'match.rejected', 'retailer_product', p_retailer_product_id,
          jsonb_build_object('match_status', 'rejected'));
end $$;

-- Split: detach a wrongly matched listing so it re-enters the review queue.
create function split_match(p_retailer_product_id uuid, p_actor text)
returns void language plpgsql as $$
declare
  old_pid uuid;
begin
  select product_id into old_pid from retailer_products where id = p_retailer_product_id for update;
  if not found then
    raise exception 'unknown retailer_product %', p_retailer_product_id using errcode = 'QAR01';
  end if;
  update retailer_products
     set product_id = null, match_status = 'review', match_score = null
   where id = p_retailer_product_id;
  update current_prices set updated_at = now() where retailer_product_id = p_retailer_product_id;
  insert into audit_log (actor, action, entity_type, entity_id, before)
  values (p_actor, 'match.split', 'retailer_product', p_retailer_product_id,
          jsonb_build_object('product_id', old_pid));
end $$;

-- Merge duplicate canonical products (keeps `p_keep`, repoints listings/baskets/alerts).
create function merge_products(p_keep uuid, p_drop uuid, p_actor text)
returns void language plpgsql as $$
begin
  if p_keep = p_drop then
    raise exception 'cannot merge a product into itself' using errcode = 'QAR01';
  end if;
  update retailer_products set product_id = p_keep where product_id = p_drop;
  -- baskets/alerts: avoid unique violations by dropping rows that would collide
  delete from basket_items bi using basket_items k
   where bi.product_id = p_drop and k.basket_id = bi.basket_id and k.product_id = p_keep;
  update basket_items set product_id = p_keep where product_id = p_drop;
  update alerts set product_id = p_keep where product_id = p_drop;
  delete from match_candidates where product_id = p_drop;
  delete from products where id = p_drop;
  insert into audit_log (actor, action, entity_type, entity_id, after)
  values (p_actor, 'product.merged', 'product', p_keep, jsonb_build_object('dropped', p_drop));
end $$;

-- Flyer / verification staging (plan 3.3 B): offers extracted from flyers wait here for a human.
create table staged_offers (
  id uuid primary key default uuid_generate_v7(),
  source_id uuid not null references sources (id),
  batch_id uuid references ingestion_batches (id),
  external_sku text,
  raw_name text not null,
  size_text text,
  price_qar numeric(10, 2) not null check (price_qar > 0),
  was_price_qar numeric(10, 2),
  promo_text text,
  valid_from date,
  valid_to date,
  page_ref text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index staged_offers_pending_idx on staged_offers (source_id, created_at) where status = 'pending';

-- Approving a staged offer publishes it through the normal gate (record_price).
create function release_staged_offer(p_id uuid, p_reviewer text) returns uuid
language plpgsql as $$
declare
  so staged_offers%rowtype;
  src sources%rowtype;
  v_sku text;
  v_rp uuid;
  v_was numeric;
  v_price_id uuid;
begin
  select * into so from staged_offers where id = p_id for update;
  if not found then
    raise exception 'unknown staged offer %', p_id using errcode = 'QAR01';
  end if;
  if so.status <> 'pending' then
    raise exception 'staged offer % is already %', p_id, so.status using errcode = 'QAR01';
  end if;
  select * into src from sources where id = so.source_id;
  v_sku := coalesce(so.external_sku, 'flyer:' || md5(lower(so.raw_name) || '|' || coalesce(so.size_text, '')));
  v_was := case when so.was_price_qar is not null and so.was_price_qar > so.price_qar
                then so.was_price_qar end;
  insert into retailer_products (retailer_id, source_id, external_sku, raw_name,
                                 raw_name_normalised, raw_size, match_status)
  values (src.retailer_id, so.source_id, v_sku, so.raw_name, lower(so.raw_name), so.size_text, 'review')
  on conflict (source_id, external_sku) do update set raw_name = excluded.raw_name
  returning id into v_rp;
  v_price_id := record_price(v_rp, null, so.price_qar, v_was,
                             case when v_was is not null then 'discount'::promo_type else 'none'::promo_type end,
                             so.valid_to::timestamptz, true, now(), so.source_id, so.batch_id);
  update staged_offers set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer
   where id = p_id;
  return v_price_id;
end $$;

create function reject_staged_offer(p_id uuid, p_reviewer text) returns void
language plpgsql as $$
begin
  update staged_offers set status = 'rejected', reviewed_at = now(), reviewed_by = p_reviewer
   where id = p_id and status = 'pending';
  if not found then
    raise exception 'staged offer % not pending', p_id using errcode = 'QAR01';
  end if;
end $$;

-- Down Migration
drop function if exists reject_staged_offer(uuid, text);
drop function if exists release_staged_offer(uuid, text);
drop table if exists staged_offers;
drop function if exists merge_products(uuid, uuid, text);
drop function if exists split_match(uuid, text);
drop function if exists reject_match(uuid, text);
drop function if exists decide_match(uuid, uuid, text);
drop table if exists match_candidates;
alter table products drop column if exists embedding;
drop table if exists brand_aliases;
delete from categories where slug in ('uncategorised', 'restricted-alcohol-tobacco', 'restricted-pork')
  and not exists (select 1 from products p where p.category_id = categories.id);
alter table retailer_products drop column if exists barcode;
