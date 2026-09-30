-- Up Migration
-- Phase 3 support tables: batch tracking, raw-artefact registry (90-day retention), dead letters,
-- held (outlier) prices awaiting review, and a per-source health view (plan 3.1, 3.2, 3.6).
create type batch_status as enum ('running', 'succeeded', 'failed', 'aborted');

alter table sources
  add column kill_switch_reason text,
  add column kill_switch_at timestamptz;
comment on column sources.kill_switch_reason is
  'Why the source was disabled (e.g. circuit breaker after repeated 403/429, takedown request).';

create table ingestion_batches (
  id uuid primary key default uuid_generate_v7(),
  source_id uuid not null references sources (id),
  status batch_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_fetched int not null default 0,
  rows_valid int not null default 0,
  rows_invalid int not null default 0,
  rows_published int not null default 0,
  rows_held int not null default 0,
  error text,
  stats jsonb not null default '{}'::jsonb
);
create index ingestion_batches_source_idx on ingestion_batches (source_id, started_at desc);

create table raw_artefacts (
  id uuid primary key default uuid_generate_v7(),
  batch_id uuid not null references ingestion_batches (id),
  uri text not null,
  source_url text,
  content_type text,
  sha256 text not null,
  size_bytes bigint not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  deleted_at timestamptz
);
create index raw_artefacts_batch_idx on raw_artefacts (batch_id);
create index raw_artefacts_expiry_idx on raw_artefacts (expires_at) where deleted_at is null;

create table dead_letters (
  id uuid primary key default uuid_generate_v7(),
  batch_id uuid not null references ingestion_batches (id),
  source_id uuid not null references sources (id),
  raw jsonb not null,
  error text not null,
  created_at timestamptz not null default now()
);
create index dead_letters_batch_idx on dead_letters (batch_id);
create index dead_letters_created_idx on dead_letters (created_at);

-- Suspicious prices are NOT auto-published (plan 3.6); a human approves or rejects them.
create table held_prices (
  id uuid primary key default uuid_generate_v7(),
  batch_id uuid not null references ingestion_batches (id),
  source_id uuid not null references sources (id),
  retailer_product_id uuid not null references retailer_products (id),
  branch_id uuid references branches (id),
  price_qar numeric(10, 2) not null,
  was_price_qar numeric(10, 2),
  promo_type promo_type not null default 'none',
  promo_ends_at timestamptz,
  in_stock boolean not null default true,
  observed_at timestamptz not null,
  reason text not null,
  reference_median numeric(10, 2),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);
create index held_prices_pending_idx on held_prices (source_id, created_at) where status = 'pending';

-- Approve a held price: publishes it through the normal gate (record_price) and closes the item.
create function release_held_price(p_id uuid, p_reviewer text) returns uuid
language plpgsql as $$
declare
  h held_prices%rowtype;
  v_price_id uuid;
begin
  select * into h from held_prices where id = p_id for update;
  if not found then
    raise exception 'unknown held price %', p_id using errcode = 'QAR01';
  end if;
  if h.status <> 'pending' then
    raise exception 'held price % is already %', p_id, h.status using errcode = 'QAR01';
  end if;
  v_price_id := record_price(h.retailer_product_id, h.branch_id, h.price_qar, h.was_price_qar,
                             h.promo_type, h.promo_ends_at, h.in_stock, h.observed_at,
                             h.source_id, h.batch_id);
  update held_prices set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer
   where id = p_id;
  return v_price_id;
end $$;

-- Disable a source immediately (circuit breaker, takedown). Audited by the sources trigger.
create function disable_source(p_source_id uuid, p_reason text) returns void
language plpgsql as $$
begin
  update sources
     set kill_switch = true, kill_switch_reason = p_reason, kill_switch_at = now()
   where id = p_source_id;
  if not found then
    raise exception 'unknown source %', p_source_id using errcode = 'QAR01';
  end if;
end $$;

create view source_health as
select s.id as source_id,
       r.slug as retailer_slug,
       s.method,
       s.legal_status,
       s.kill_switch,
       s.kill_switch_reason,
       s.last_ok_at,
       round((extract(epoch from (now() - s.last_ok_at)) / 3600)::numeric, 1) as hours_since_ok,
       lb.status as last_batch_status,
       lb.started_at as last_batch_at,
       lb.rows_fetched,
       lb.rows_invalid,
       case when lb.rows_fetched > 0
            then round(lb.rows_invalid::numeric / lb.rows_fetched, 4) end as invalid_ratio,
       (select count(*) from held_prices h
         where h.source_id = s.id and h.status = 'pending') as held_pending
from sources s
join retailers r on r.id = s.retailer_id
left join lateral (
  select * from ingestion_batches b where b.source_id = s.id order by b.started_at desc limit 1
) lb on true;

-- Down Migration
drop view if exists source_health;
drop function if exists disable_source(uuid, text);
drop function if exists release_held_price(uuid, text);
drop table if exists held_prices;
drop table if exists dead_letters;
drop table if exists raw_artefacts;
drop table if exists ingestion_batches;
alter table sources drop column if exists kill_switch_at, drop column if exists kill_switch_reason;
drop type if exists batch_status;
