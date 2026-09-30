-- Up Migration
-- Phase 8: least-privilege database roles (plan 8.2) and a more complete erase_user().
--
-- Roles are NOLOGIN here. Operators enable login and set passwords out-of-band (Key Vault), e.g.
--   alter role qarib_api login password '...';
-- Azure: use Entra ID authentication / managed identities where available.
--   qarib_api       the API + admin API: DML everywhere it needs, no DDL, append-only prices/audit
--   qarib_worker    ingestion + matcher: NO access to any personal-data table
--   qarib_readonly  public_* views only (search indexer, analytics, BI)
-- The migration owner (who runs DDL) keeps full rights. Functions stay invoker-rights, so a role can
-- only do through a function what its table privileges already allow.

do $$
begin
  if not exists (select from pg_roles where rolname = 'qarib_api') then create role qarib_api nologin; end if;
  if not exists (select from pg_roles where rolname = 'qarib_worker') then create role qarib_worker nologin; end if;
  if not exists (select from pg_roles where rolname = 'qarib_readonly') then create role qarib_readonly nologin; end if;
end $$;

-- Re-applies every grant from scratch. The migration runner calls it after each migrate run, so
-- tables/partitions added later are covered automatically.
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

-- Erasure now also removes every other row that identifies the user (found by the schema-drift
-- test): auth tokens, idempotency records scoped to the user. The tombstone row remains so that
-- consent proof keeps its foreign key until purge_expired_personal_data().
create or replace function erase_user(p_user_id uuid) returns void language plpgsql as $$
begin
  delete from alerts where user_id = p_user_id;
  delete from baskets where user_id = p_user_id;
  delete from search_history where user_id = p_user_id;
  delete from email_tokens where user_id = p_user_id;
  delete from refresh_tokens where user_id = p_user_id;
  delete from idempotency_keys where scope = p_user_id::text;
  update price_reports set user_id = null where user_id = p_user_id;
  update users
     set email = 'erased-' || id::text || '@invalid.invalid',
         pw_hash = '',
         email_verified_at = null,
         failed_logins = 0,
         locked_until = null,
         deleted_at = coalesce(deleted_at, now())
   where id = p_user_id;
  if not found then
    raise exception 'unknown user %', p_user_id using errcode = 'QAR01';
  end if;
end $$;

select refresh_role_grants();

-- Down Migration
-- Roles are cluster-wide and may own privileges elsewhere: they are left in place on purpose.
drop function if exists refresh_role_grants();
create or replace function erase_user(p_user_id uuid) returns void language plpgsql as $$
begin
  delete from alerts where user_id = p_user_id;
  delete from baskets where user_id = p_user_id;
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
