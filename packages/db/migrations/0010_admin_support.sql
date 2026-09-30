-- Up Migration
-- Moderator acceptance of a single crowd report (publishes it through the crowd source).
create function accept_price_report(p_report_id uuid, p_actor text) returns uuid
language plpgsql as $$
declare
  r price_reports%rowtype;
  v_source uuid;
  v_rp uuid;
  v_price_id uuid;
begin
  select * into r from price_reports where id = p_report_id for update;
  if not found or r.status <> 'pending' or r.product_id is null then
    raise exception 'no pending report %', p_report_id using errcode = 'QAR01';
  end if;
  select id into v_source from sources
   where retailer_id = r.retailer_id and method = 'crowd' and legal_status = 'green' and not kill_switch
   order by created_at limit 1;
  if v_source is null then
    insert into sources (retailer_id, method, legal_status, notes)
    values (r.retailer_id, 'crowd', 'green', 'Crowd-sourced prices (auto-created)')
    returning id into v_source;
  end if;
  insert into retailer_products (retailer_id, source_id, external_sku, raw_name, raw_name_normalised,
                                 product_id, match_status, match_score)
  select r.retailer_id, v_source, 'crowd:' || r.product_id::text, p.canonical_name_en,
         lower(p.canonical_name_en), r.product_id, 'manual', 1
  from products p where p.id = r.product_id
  on conflict (source_id, external_sku) do update set last_seen = now()
  returning id into v_rp;
  v_price_id := record_price(v_rp, r.branch_id, r.reported_price_qar, null, 'none', null, true, now(), v_source, null);
  update price_reports set status = 'accepted', retailer_product_id = v_rp where id = p_report_id;
  insert into audit_log (actor, action, entity_type, entity_id, after)
  values (p_actor, 'report.accepted', 'price_report', p_report_id,
          jsonb_build_object('price', r.reported_price_qar));
  return v_price_id;
end $$;

-- Data minimisation for anonymous search aggregates (plan 0.9): rare queries (possible personal
-- data typed into the search box) are dropped after 30 days; everything after 13 months.
create function purge_search_log() returns bigint language plpgsql as $$
declare
  n bigint;
begin
  delete from search_log where day < current_date - 395
     or (day < current_date - 30 and query_norm in (
           select query_norm from search_log group by query_norm having sum(hits) < 20));
  get diagnostics n = row_count;
  return n;
end $$;

-- Down Migration
drop function if exists purge_search_log();
drop function if exists accept_price_report(uuid, text);
