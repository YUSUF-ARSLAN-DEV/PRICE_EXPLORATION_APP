-- Up Migration
-- Phases 5-6: auth, idempotency, anonymous search aggregates, 4-eyes source changes, crowd consensus.

alter table users
  add column role text not null default 'user' check (role in ('user', 'admin')),
  add column failed_logins int not null default 0,
  add column locked_until timestamptz;
comment on column users.failed_logins is '[PII: account security - brute-force lockout counter]';
comment on column users.locked_until is '[PII: account security - brute-force lockout]';

-- One-time tokens (email verification, password reset). Only the SHA-256 hash is stored.
create table email_tokens (
  id uuid primary key default uuid_generate_v7(),
  user_id uuid not null references users (id) on delete cascade,
  purpose text not null check (purpose in ('verify_email', 'reset_password')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_tokens_user_idx on email_tokens (user_id, purpose);

-- Rotating refresh tokens with reuse detection (a replayed revoked token revokes the family).
create table refresh_tokens (
  id uuid primary key default uuid_generate_v7(),
  user_id uuid not null references users (id) on delete cascade,
  family uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index refresh_tokens_family_idx on refresh_tokens (family);
create index refresh_tokens_user_idx on refresh_tokens (user_id);

-- Idempotency for POSTs (plan 6.8). `scope` = user id or a hash of the client.
create table idempotency_keys (
  key text not null,
  scope text not null,
  method text not null,
  path text not null,
  status int not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (key, scope)
);
create index idempotency_created_idx on idempotency_keys (created_at);

-- Anonymous search aggregates (plan 5.3): no user id, no IP. Popular list applies k >= 20.
create table search_log (
  day date not null,
  query_norm text not null,
  hits int not null default 0,
  primary key (day, query_norm)
);

-- 4-eyes control for legal-status changes on sources (plan 8.2).
create table source_change_requests (
  id uuid primary key default uuid_generate_v7(),
  source_id uuid not null references sources (id),
  requested_by text not null,
  change jsonb not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint source_change_keys check (
    (change - 'legal_status' - 'approval_ref' - 'tos_archive_url' - 'robots_archive_url' - 'refresh_cron')
      = '{}'::jsonb
  )
);
create index source_change_pending_idx on source_change_requests (created_at) where status = 'pending';

create function decide_source_change(p_id uuid, p_approver text, p_approve boolean)
returns void language plpgsql as $$
declare
  r source_change_requests%rowtype;
begin
  select * into r from source_change_requests where id = p_id for update;
  if not found then
    raise exception 'unknown change request %', p_id using errcode = 'QAR01';
  end if;
  if r.status <> 'pending' then
    raise exception 'change request % is already %', p_id, r.status using errcode = 'QAR01';
  end if;
  if lower(r.requested_by) = lower(p_approver) then
    raise exception 'four-eyes: the requester cannot approve their own change' using errcode = 'QAR03';
  end if;
  if p_approve then
    perform set_config('qarib.actor', p_approver, true);
    update sources set
      legal_status = coalesce((r.change ->> 'legal_status')::legal_status, legal_status),
      approval_ref = coalesce(r.change ->> 'approval_ref', approval_ref),
      tos_archive_url = coalesce(r.change ->> 'tos_archive_url', tos_archive_url),
      robots_archive_url = coalesce(r.change ->> 'robots_archive_url', robots_archive_url),
      refresh_cron = coalesce(r.change ->> 'refresh_cron', refresh_cron)
    where id = r.source_id;
  end if;
  update source_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = p_approver, decided_at = now()
   where id = p_id;
end $$;

-- Crowd price reports (plan 3.3 C): a report names the product + retailer the reporter saw.
alter table price_reports add column product_id uuid references products (id);
create index price_reports_product_idx on price_reports (product_id, retailer_id, status);

-- Consensus: >= 2 reports from DISTINCT users within 5 % of their median, made in the last 7 days,
-- and not wildly off the current price (> 50 %, those stay pending for a moderator) are accepted
-- and published through the normal gate via the retailer's crowd source.
create function evaluate_price_consensus(p_product uuid, p_retailer uuid, p_branch uuid default null)
returns uuid language plpgsql as $$
declare
  v_ids uuid[];
  v_median numeric;
  v_current numeric;
  v_source uuid;
  v_rp uuid;
  v_price_id uuid;
begin
  select array_agg(id), percentile_cont(0.5) within group (order by reported_price_qar)::numeric(10, 2)
    into v_ids, v_median
  from (
    select distinct on (user_id) id, reported_price_qar
    from price_reports
    where product_id = p_product and retailer_id = p_retailer
      and branch_id is not distinct from p_branch
      and status = 'pending' and user_id is not null
      and created_at > now() - interval '7 days'
    order by user_id, created_at desc
  ) latest
  where true;
  if v_ids is null then
    return null;
  end if;

  -- keep only reports within 5 % of the median
  select array_agg(id) into v_ids from price_reports
   where id = any (v_ids) and abs(reported_price_qar - v_median) / nullif(v_median, 0) <= 0.05;
  if v_ids is null or array_length(v_ids, 1) < 2 then
    return null;
  end if;

  select cp.price_qar into v_current
  from current_prices cp join retailer_products rp on rp.id = cp.retailer_product_id
  where rp.product_id = p_product and rp.retailer_id = p_retailer
    and cp.branch_id is not distinct from p_branch
  order by cp.observed_at desc limit 1;
  if v_current is not null and abs(v_median - v_current) / nullif(v_current, 0) > 0.5 then
    return null; -- suspicious vs current price: leave pending for moderation
  end if;

  select id into v_source from sources
   where retailer_id = p_retailer and method = 'crowd' and legal_status = 'green' and not kill_switch
   order by created_at limit 1;
  if v_source is null then
    insert into sources (retailer_id, method, legal_status, notes)
    values (p_retailer, 'crowd', 'green', 'Crowd-sourced prices (auto-created)')
    returning id into v_source;
  end if;

  insert into retailer_products (retailer_id, source_id, external_sku, raw_name, raw_name_normalised,
                                 product_id, match_status, match_score)
  select p_retailer, v_source, 'crowd:' || p_product::text, p.canonical_name_en,
         lower(p.canonical_name_en), p_product, 'manual', 1
  from products p where p.id = p_product
  on conflict (source_id, external_sku) do update set last_seen = now()
  returning id into v_rp;

  v_price_id := record_price(v_rp, p_branch, v_median, null, 'none', null, true, now(), v_source, null);
  update price_reports set status = 'accepted', retailer_product_id = v_rp where id = any (v_ids);
  return v_price_id;
end $$;

-- Price history for charts: daily minimum per product+retailer, only for publicly visible data.
create view public_price_history as
select rp.product_id,
       rp.retailer_id,
       r.slug as retailer_slug,
       date_trunc('day', pr.observed_at)::date as day,
       min(pr.price_qar) as min_price_qar,
       max(pr.price_qar) as max_price_qar
from prices pr
join retailer_products rp on rp.id = pr.retailer_product_id
join products p on p.id = rp.product_id
join categories c on c.id = p.category_id
join retailers r on r.id = rp.retailer_id
join sources s on s.id = rp.source_id
where rp.match_status in ('auto', 'manual')
  and not p.restricted and not c.restricted
  and r.active and s.legal_status = 'green' and not s.kill_switch
  and pr.observed_at >= now() - interval '180 days'
  and (not r.is_demo or current_setting('qarib.show_demo', true) = 'on')
group by rp.product_id, rp.retailer_id, r.slug, date_trunc('day', pr.observed_at)::date;

-- Down Migration
drop view if exists public_price_history;
drop function if exists evaluate_price_consensus(uuid, uuid, uuid);
drop index if exists price_reports_product_idx;
alter table price_reports drop column if exists product_id;
drop function if exists decide_source_change(uuid, text, boolean);
drop table if exists source_change_requests;
drop table if exists search_log;
drop table if exists idempotency_keys;
drop table if exists refresh_tokens;
drop table if exists email_tokens;
alter table users drop column if exists locked_until, drop column if exists failed_logins, drop column if exists role;
