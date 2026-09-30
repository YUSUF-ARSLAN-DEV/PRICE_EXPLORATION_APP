-- Up Migration
-- Append-only price observations, partitioned by month (plan 2.1).
-- NOTE (CL-004): native declarative partitioning + ensure_price_partitions() instead of
-- pg_partman, because the local pgvector image has no pg_partman. Revisit after step 9.0.
create table prices (
  id uuid not null default uuid_generate_v7(),
  retailer_product_id uuid not null references retailer_products (id),
  branch_id uuid references branches (id),
  price_qar numeric(10, 2) not null check (price_qar >= 0),
  was_price_qar numeric(10, 2),
  promo_type promo_type not null default 'none',
  promo_ends_at timestamptz,
  in_stock boolean not null default true,
  tax_included boolean not null default true,  -- plan 2.3: future-proof for VAT
  observed_at timestamptz not null,
  source_id uuid not null references sources (id),
  batch_id uuid,
  ingested_at timestamptz not null default now(),
  primary key (id, observed_at),
  constraint prices_was_price_gt_price check (was_price_qar is null or was_price_qar > price_qar)
) partition by range (observed_at);

create index prices_rp_observed_idx on prices (retailer_product_id, observed_at desc);
create index prices_source_observed_idx on prices (source_id, observed_at desc);
create index prices_batch_idx on prices (batch_id) where batch_id is not null;

create table prices_default partition of prices default;

create function ensure_price_partitions(p_months_behind int default 1, p_months_ahead int default 3)
returns int language plpgsql as $$
declare
  first_day date;
  part text;
  created int := 0;
begin
  for i in -p_months_behind..p_months_ahead loop
    first_day := (date_trunc('month', now() at time zone 'UTC')::date + make_interval(months => i))::date;
    part := format('prices_y%sm%s', to_char(first_day, 'YYYY'), to_char(first_day, 'MM'));
    if to_regclass(part) is null then
      execute format(
        'create table %I partition of prices for values from (%L) to (%L)',
        part,
        to_char(first_day, 'YYYY-MM-DD') || ' 00:00:00+00',
        to_char((first_day + interval '1 month')::date, 'YYYY-MM-DD') || ' 00:00:00+00'
      );
      created := created + 1;
    end if;
  end loop;
  return created;
end $$;
comment on function ensure_price_partitions(int, int) is
  'Must run on a schedule (monthly job, Phase 3/9) so future partitions exist.';

select ensure_price_partitions(1, 3);

-- Latest price per listing (+ branch); drives search joins and public views.
create table current_prices (
  id uuid primary key default uuid_generate_v7(),
  retailer_product_id uuid not null references retailer_products (id),
  branch_id uuid references branches (id),
  branch_key uuid generated always as
    (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  price_qar numeric(10, 2) not null check (price_qar >= 0),
  was_price_qar numeric(10, 2),
  promo_type promo_type not null default 'none',
  promo_ends_at timestamptz,
  in_stock boolean not null default true,
  observed_at timestamptz not null,
  source_id uuid not null references sources (id),
  unit_price_qar numeric(12, 4),
  unit_price_base text,
  updated_at timestamptz not null default now()
);
create unique index current_prices_listing_uidx on current_prices (retailer_product_id, branch_key);
create index current_prices_unit_price_idx on current_prices (unit_price_qar)
  where unit_price_qar is not null;
create index current_prices_observed_idx on current_prices (observed_at desc);

-- unit price = price / base_quantity (per kg / L / piece), plan 2.2
create function current_prices_compute_unit_price() returns trigger
language plpgsql as $$
declare
  v_qty numeric;
  v_base text;
begin
  select p.base_quantity, p.base_unit into v_qty, v_base
  from retailer_products rp
  join products p on p.id = rp.product_id
  where rp.id = new.retailer_product_id;

  if v_qty is not null and v_qty > 0 then
    new.unit_price_qar := round(new.price_qar / v_qty, 4);
    new.unit_price_base := v_base;
  else
    new.unit_price_qar := null;
    new.unit_price_base := null;
  end if;
  return new;
end $$;
create trigger current_prices_unit_price_trg
  before insert or update on current_prices
  for each row execute function current_prices_compute_unit_price();

-- Recompute when a listing is (re)matched or a product's size changes.
create function retailer_products_rematch() returns trigger
language plpgsql as $$
begin
  update current_prices set updated_at = now() where retailer_product_id = new.id;
  return null;
end $$;
create trigger retailer_products_rematch_trg
  after update of product_id on retailer_products
  for each row when (new.product_id is distinct from old.product_id)
  execute function retailer_products_rematch();

create function products_size_changed() returns trigger
language plpgsql as $$
begin
  update current_prices cp set updated_at = now()
  from retailer_products rp
  where rp.id = cp.retailer_product_id and rp.product_id = new.id;
  return null;
end $$;
create trigger products_size_changed_trg
  after update of size_value, size_unit, pack_count on products
  for each row execute function products_size_changed();

-- Single write path for prices. Defence in depth for policy P2: refuses unapproved sources
-- even if an adapter forgets to check.
create function record_price(
  p_retailer_product_id uuid,
  p_branch_id uuid,
  p_price numeric,
  p_was_price numeric,
  p_promo_type promo_type,
  p_promo_ends_at timestamptz,
  p_in_stock boolean,
  p_observed_at timestamptz,
  p_source_id uuid,
  p_batch_id uuid default null
) returns uuid language plpgsql as $$
declare
  v_src sources%rowtype;
  v_rp retailer_products%rowtype;
  v_id uuid := uuid_generate_v7();
begin
  select * into v_src from sources where id = p_source_id;
  if not found then
    raise exception 'unknown source %', p_source_id using errcode = 'QAR01';
  end if;
  if v_src.kill_switch or v_src.legal_status <> 'green' then
    raise exception 'source % is not approved (legal_status=%, kill_switch=%)',
      p_source_id, v_src.legal_status, v_src.kill_switch using errcode = 'QAR01';
  end if;

  select * into v_rp from retailer_products where id = p_retailer_product_id;
  if not found then
    raise exception 'unknown retailer_product %', p_retailer_product_id using errcode = 'QAR01';
  end if;
  if v_rp.source_id <> p_source_id then
    raise exception 'retailer_product % does not belong to source %',
      p_retailer_product_id, p_source_id using errcode = 'QAR01';
  end if;
  if p_observed_at > now() + interval '1 day' then
    raise exception 'observed_at % is in the future', p_observed_at using errcode = 'QAR01';
  end if;

  insert into prices (id, retailer_product_id, branch_id, price_qar, was_price_qar, promo_type,
                      promo_ends_at, in_stock, observed_at, source_id, batch_id)
  values (v_id, p_retailer_product_id, p_branch_id, p_price, p_was_price,
          coalesce(p_promo_type, 'none'), p_promo_ends_at, coalesce(p_in_stock, true),
          p_observed_at, p_source_id, p_batch_id);

  insert into current_prices (retailer_product_id, branch_id, price_qar, was_price_qar, promo_type,
                              promo_ends_at, in_stock, observed_at, source_id)
  values (p_retailer_product_id, p_branch_id, p_price, p_was_price,
          coalesce(p_promo_type, 'none'), p_promo_ends_at, coalesce(p_in_stock, true),
          p_observed_at, p_source_id)
  on conflict (retailer_product_id, branch_key) do update set
    price_qar = excluded.price_qar,
    was_price_qar = excluded.was_price_qar,
    promo_type = excluded.promo_type,
    promo_ends_at = excluded.promo_ends_at,
    in_stock = excluded.in_stock,
    observed_at = excluded.observed_at,
    source_id = excluded.source_id,
    updated_at = now()
  where current_prices.observed_at <= excluded.observed_at;

  update retailer_products set last_seen = greatest(last_seen, p_observed_at)
  where id = p_retailer_product_id;

  return v_id;
end $$;

-- Down Migration
drop function if exists record_price(uuid, uuid, numeric, numeric, promo_type, timestamptz, boolean, timestamptz, uuid, uuid);
drop trigger if exists products_size_changed_trg on products;
drop function if exists products_size_changed();
drop trigger if exists retailer_products_rematch_trg on retailer_products;
drop function if exists retailer_products_rematch();
drop table if exists current_prices;
drop function if exists current_prices_compute_unit_price();
drop function if exists ensure_price_partitions(int, int);
drop table if exists prices;
