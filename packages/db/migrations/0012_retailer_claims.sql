-- Up Migration
-- Retailer "claim your store" intake (plan 11.3). A claim is NOT an account and grants no access: it is a
-- request that a human verifies (company e-mail domain, call-back) before anything else happens, e.g.
-- registering an official partner feed as a source (four-eyes, policy P1).
create type claim_status as enum ('new', 'verifying', 'verified', 'rejected');

create table retailer_claims (
  id uuid primary key default uuid_generate_v7(),
  company_name text not null check (length(company_name) between 2 and 200),
  website text check (website is null or website ~* '^https?://'),
  contact_name text not null check (length(contact_name) between 2 and 200),
  contact_email text not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_role text,
  message text check (message is null or length(message) <= 2000),
  retailer_id uuid references retailers (id),
  status claim_status not null default 'new',
  received_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  notes text,
  check ((status in ('verified', 'rejected')) = (decided_at is not null))
);
comment on column retailer_claims.contact_name is '[PII: business contact of a claimant]';
comment on column retailer_claims.contact_email is '[PII: business contact of a claimant]';
create index retailer_claims_open_idx on retailer_claims (received_at) where status in ('new', 'verifying');

-- Decisions are audited like source changes: who decided, and (when verified) which retailer it maps to.
create or replace function decide_retailer_claim(
  p_claim_id uuid, p_status claim_status, p_actor text, p_notes text, p_retailer_id uuid default null
) returns void language plpgsql as $$
begin
  if p_status not in ('verifying', 'verified', 'rejected') then
    raise exception 'invalid claim decision %', p_status using errcode = 'QAR01';
  end if;
  if p_status in ('verified', 'rejected') and coalesce(length(trim(p_notes)), 0) < 5 then
    raise exception 'a decision needs a written reason' using errcode = 'QAR01';
  end if;
  update retailer_claims
     set status = p_status,
         retailer_id = coalesce(p_retailer_id, retailer_id),
         decided_at = case when p_status in ('verified', 'rejected') then now() else null end,
         decided_by = p_actor,
         notes = p_notes
   where id = p_claim_id and status in ('new', 'verifying');
  if not found then
    raise exception 'open claim not found' using errcode = 'QAR02';
  end if;
  insert into audit_log (actor, action, entity_type, entity_id, after)
  values (p_actor, 'claim_' || p_status::text, 'retailer_claims', p_claim_id,
          jsonb_build_object('notes', p_notes, 'retailer_id', p_retailer_id));
end $$;

-- Retention (docs/legal/retention-schedule.md): unverified and rejected claims are deleted after 12 months.
-- Verified claims are the business contact of an active partner and are kept while the partnership lasts.
create or replace function purge_retailer_claims() returns integer language plpgsql as $$
declare n integer;
begin
  delete from retailer_claims
   where status in ('new', 'verifying', 'rejected') and received_at < now() - interval '12 months';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function refresh_role_grants() returns void language plpgsql as $$
declare
  personal text[] := array['users', 'consents', 'baskets', 'basket_items', 'alerts', 'search_history',
                           'price_reports', 'email_tokens', 'refresh_tokens', 'idempotency_keys',
                           'takedown_requests', 'retailer_claims'];
  t text;
begin
  execute 'revoke all on all tables in schema public from qarib_api, qarib_worker, qarib_readonly';
  execute 'grant usage on schema public to qarib_api, qarib_worker, qarib_readonly';

  -- public read model
  execute 'grant select on public_products, public_offers, public_price_history to qarib_readonly';

  -- API: DML on everything, but prices and the audit log are append-only
  execute 'grant select, insert, update, delete on all tables in schema public to qarib_api';
  execute 'revoke update, delete on audit_log from qarib_api';
  if to_regclass('schema_migrations') is not null then
    execute 'revoke all on schema_migrations from qarib_api';
  end if;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'prices%' loop
    execute format('revoke update, delete on %I from qarib_api', t);
  end loop;

  -- Workers: read the catalogue, write ingestion/matching tables, never touch personal data
  execute 'grant select on all tables in schema public to qarib_worker';
  foreach t in array personal loop
    execute format('revoke all on %I from qarib_worker', t);
  end loop;
  if to_regclass('schema_migrations') is not null then
    execute 'revoke all on schema_migrations from qarib_worker';
  end if;
  execute 'grant insert, update on retailer_products, products, brands, brand_aliases, current_prices, sources to qarib_worker';
  execute 'grant insert on prices, audit_log, dead_letters, held_prices, raw_artefacts, staged_offers to qarib_worker';
  execute 'grant insert, update, delete on ingestion_batches, match_candidates to qarib_worker';
  execute 'grant update on held_prices, staged_offers, raw_artefacts to qarib_worker';
  execute 'grant delete on dead_letters to qarib_worker';
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'prices_%' loop
    execute format('grant insert on %I to qarib_worker', t);
  end loop;
end $$;

-- Down Migration
create or replace function refresh_role_grants() returns void language plpgsql as $$
declare
  personal text[] := array['users', 'consents', 'baskets', 'basket_items', 'alerts', 'search_history',
                           'price_reports', 'email_tokens', 'refresh_tokens', 'idempotency_keys',
                           'takedown_requests'];
  t text;
begin
  execute 'revoke all on all tables in schema public from qarib_api, qarib_worker, qarib_readonly';
  execute 'grant usage on schema public to qarib_api, qarib_worker, qarib_readonly';

  -- public read model
  execute 'grant select on public_products, public_offers, public_price_history to qarib_readonly';

  -- API: DML on everything, but prices and the audit log are append-only
  execute 'grant select, insert, update, delete on all tables in schema public to qarib_api';
  execute 'revoke update, delete on audit_log from qarib_api';
  if to_regclass('schema_migrations') is not null then
    execute 'revoke all on schema_migrations from qarib_api';
  end if;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'prices%' loop
    execute format('revoke update, delete on %I from qarib_api', t);
  end loop;

  -- Workers: read the catalogue, write ingestion/matching tables, never touch personal data
  execute 'grant select on all tables in schema public to qarib_worker';
  foreach t in array personal loop
    execute format('revoke all on %I from qarib_worker', t);
  end loop;
  if to_regclass('schema_migrations') is not null then
    execute 'revoke all on schema_migrations from qarib_worker';
  end if;
  execute 'grant insert, update on retailer_products, products, brands, brand_aliases, current_prices, sources to qarib_worker';
  execute 'grant insert on prices, audit_log, dead_letters, held_prices, raw_artefacts, staged_offers to qarib_worker';
  execute 'grant insert, update, delete on ingestion_batches, match_candidates to qarib_worker';
  execute 'grant update on held_prices, staged_offers, raw_artefacts to qarib_worker';
  execute 'grant delete on dead_letters to qarib_worker';
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'prices_%' loop
    execute format('grant insert on %I to qarib_worker', t);
  end loop;
end $$;
drop function if exists purge_retailer_claims();
drop function if exists decide_retailer_claim(uuid, claim_status, text, text, uuid);
drop table if exists retailer_claims;
drop type if exists claim_status;
