-- Up Migration
-- Personal-data tables. Every personal column carries a purpose tag in its COMMENT
-- ("[PII: <purpose>]", plan 8.3) - a test fails if one is missing. Keep docs/legal/ropa.md in sync.
create table users (
  id uuid primary key default uuid_generate_v7(),
  email citext not null unique,
  email_verified_at timestamptz,
  pw_hash text not null,
  locale text not null default 'en' check (locale in ('en', 'ar')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on column users.email is '[PII: account sign-in and service emails] Erased via erase_user().';
comment on column users.pw_hash is '[PII: account authentication] argon2id hash only, never plaintext.';
comment on column users.locale is '[PII: language preference]';
comment on column users.deleted_at is
  'Set by erase_user(): row becomes an anonymised tombstone so consent proof keeps its FK (ROPA #2).';

-- Consent ledger (plan 0.3a). Append-only in spirit: rows are never updated; withdrawal is a new row.
create table consents (
  id uuid primary key default uuid_generate_v7(),
  user_id uuid not null references users (id),
  purpose text not null check (purpose in
    ('account_terms', 'history', 'alerts_email', 'contribute_receipts', 'analytics', 'area_sync')),
  granted boolean not null,
  version text not null,
  ip_trunc inet,
  created_at timestamptz not null default now()
);
comment on column consents.ip_trunc is '[PII: proof of consent] IP truncated to /24 (v4) or /48 (v6) by the app.';
comment on column consents.user_id is '[PII: proof of consent]';
create index consents_user_purpose_idx on consents (user_id, purpose, created_at desc);

create function consents_no_update() returns trigger language plpgsql as $$
begin
  raise exception 'consents is append-only: add a new row instead' using errcode = 'QAR02';
end $$;
create trigger consents_no_update_trg before update on consents
  for each row execute function consents_no_update();

create table baskets (
  id uuid primary key default uuid_generate_v7(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null default 'My basket',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column baskets.name is '[PII: saved basket feature] user-chosen text';
create index baskets_user_idx on baskets (user_id);

create table basket_items (
  id uuid primary key default uuid_generate_v7(),
  basket_id uuid not null references baskets (id) on delete cascade,
  product_id uuid not null references products (id),
  quantity numeric(8, 2) not null default 1 check (quantity > 0),
  unique (basket_id, product_id)
);

create table alerts (
  id uuid primary key default uuid_generate_v7(),
  user_id uuid not null references users (id) on delete cascade,
  product_id uuid not null references products (id),
  threshold_qar numeric(10, 2) not null check (threshold_qar > 0),
  active boolean not null default true,
  last_notified_at timestamptz,
  created_at timestamptz not null default now()
);
comment on column alerts.threshold_qar is '[PII: price alert feature]';
create index alerts_user_idx on alerts (user_id);
create index alerts_product_active_idx on alerts (product_id) where active;

-- Opt-in history (90-day rolling retention, plan 0.9).
create table search_history (
  id uuid primary key default uuid_generate_v7(),
  user_id uuid not null references users (id) on delete cascade,
  query text not null,
  created_at timestamptz not null default now()
);
comment on column search_history.query is
  '[PII: recent-searches convenience, consent: history] may reveal religion/health by inference; 90-day retention.';
create index search_history_user_idx on search_history (user_id, created_at desc);
create index search_history_created_idx on search_history (created_at);

create type report_status as enum ('pending', 'accepted', 'rejected');

-- Crowd-sourced price reports / receipts. user_id is nulled when the contributor is erased:
-- the extracted price is not personal data and is kept (ROPA #5).
create table price_reports (
  id uuid primary key default uuid_generate_v7(),
  user_id uuid references users (id) on delete set null,
  retailer_id uuid references retailers (id),
  branch_id uuid references branches (id),
  retailer_product_id uuid references retailer_products (id),
  reported_name text,
  reported_price_qar numeric(10, 2) not null check (reported_price_qar >= 0),
  observed_at timestamptz not null default now(),
  status report_status not null default 'pending',
  receipt_blob_path text,
  receipt_deleted_at timestamptz,
  created_at timestamptz not null default now()
);
comment on column price_reports.user_id is '[PII: contributor attribution] nulled on erasure.';
comment on column price_reports.receipt_blob_path is
  '[PII: receipt image may contain personal data] private blob; delete within 7 days.';
create index price_reports_status_idx on price_reports (status, created_at);
create index price_reports_user_idx on price_reports (user_id);

create trigger users_updated before update on users
  for each row execute function set_updated_at();
create trigger baskets_updated before update on baskets
  for each row execute function set_updated_at();

-- Down Migration
drop table if exists price_reports;
drop type if exists report_status;
drop table if exists search_history;
drop table if exists alerts;
drop table if exists basket_items;
drop table if exists baskets;
drop trigger if exists consents_no_update_trg on consents;
drop function if exists consents_no_update();
drop table if exists consents;
drop table if exists users;
