-- Up Migration
-- Public read models. The API/search indexer must read ONLY from these views (plan 4.4, 8.2),
-- never the base tables, so restricted products and unapproved sources cannot leak.
create view public_products as
select p.id, p.canonical_name_en, p.canonical_name_ar, p.brand_id, p.category_id, p.gtin,
       p.size_value, p.size_unit, p.pack_count, p.base_quantity, p.base_unit, p.attributes,
       p.search_text
from products p
join categories c on c.id = p.category_id
where not p.restricted and not c.restricted;

-- Offers visible to the public: matched listings, approved (green, not killed) sources, active
-- retailers, fresh (<= 30 days, plan 3.5) with an is_stale flag at > 7 days. Demo retailers are
-- hidden unless `set qarib.show_demo = 'on'`.
create view public_offers as
select cp.id as offer_id,
       p.id as product_id,
       p.canonical_name_en,
       p.canonical_name_ar,
       p.brand_id,
       p.category_id,
       r.id as retailer_id,
       r.slug as retailer_slug,
       r.name_en as retailer_name_en,
       r.name_ar as retailer_name_ar,
       cp.branch_id,
       b.name as branch_name,
       b.area as branch_area,
       cp.price_qar,
       cp.was_price_qar,
       cp.promo_type,
       cp.promo_ends_at,
       cp.in_stock,
       cp.unit_price_qar,
       cp.unit_price_base,
       cp.observed_at,
       (cp.observed_at < now() - interval '7 days') as is_stale,
       s.method as source_method
from current_prices cp
join retailer_products rp on rp.id = cp.retailer_product_id
join products p on p.id = rp.product_id
join categories c on c.id = p.category_id
join retailers r on r.id = rp.retailer_id
join sources s on s.id = rp.source_id
left join branches b on b.id = cp.branch_id
where rp.match_status in ('auto', 'manual')
  and not p.restricted
  and not c.restricted
  and r.active
  and s.legal_status = 'green'
  and not s.kill_switch
  and cp.observed_at >= now() - interval '30 days'
  and (not r.is_demo or current_setting('qarib.show_demo', true) = 'on');

-- DSR "delete my account" (plan 6.4): anonymise into a tombstone and drop personal content.
-- Consent rows stay (proof) until purge_expired_personal_data() removes the tombstone after 1 year.
create function erase_user(p_user_id uuid) returns void language plpgsql as $$
begin
  delete from alerts where user_id = p_user_id;
  delete from baskets where user_id = p_user_id;          -- cascades basket_items
  delete from search_history where user_id = p_user_id;
  update price_reports set user_id = null where user_id = p_user_id;
  update users
     set email = 'erased-' || id::text || '@invalid.invalid',
         pw_hash = '',
         email_verified_at = null,
         deleted_at = coalesce(deleted_at, now())
   where id = p_user_id;
  if not found then
    raise exception 'unknown user %', p_user_id using errcode = 'QAR01';
  end if;
end $$;

-- Retention enforcement (plan 0.9). Call daily. Blob deletion (receipts, 7 days) and backup
-- expiry (30 days) are infrastructure jobs: see receipts_due_for_deletion.
create function purge_expired_personal_data(p_now timestamptz default now())
returns table (entity text, rows_affected bigint) language plpgsql as $$
declare
  n bigint;
begin
  delete from search_history where created_at < p_now - interval '90 days';
  get diagnostics n = row_count;
  entity := 'search_history'; rows_affected := n; return next;

  delete from consents where user_id in
    (select id from users where deleted_at is not null and deleted_at < p_now - interval '1 year');
  get diagnostics n = row_count;
  entity := 'consents_of_erased_users'; rows_affected := n; return next;

  delete from users where deleted_at is not null and deleted_at < p_now - interval '1 year';
  get diagnostics n = row_count;
  entity := 'user_tombstones'; rows_affected := n; return next;
end $$;

create view receipts_due_for_deletion as
select id as price_report_id, receipt_blob_path
from price_reports
where receipt_blob_path is not null
  and receipt_deleted_at is null
  and created_at < now() - interval '7 days';

-- Down Migration
drop view if exists receipts_due_for_deletion;
drop function if exists purge_expired_personal_data(timestamptz);
drop function if exists erase_user(uuid);
drop view if exists public_offers;
drop view if exists public_products;
