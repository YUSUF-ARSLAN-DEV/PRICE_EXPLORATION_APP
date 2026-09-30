-- Up Migration
create type retailer_type as enum ('supermarket', 'hyper', 'marketplace', 'specialty');
create type source_method as enum ('partner_feed', 'flyer', 'crowd', 'public_web', 'manual');
create type legal_status as enum ('green', 'amber', 'red', 'disabled');
create type size_unit as enum ('g', 'kg', 'ml', 'l', 'pc');
create type match_status as enum ('auto', 'review', 'manual', 'rejected');
create type promo_type as enum ('none', 'discount', 'multibuy', 'bundle', 'clearance', 'loyalty');

create table retailers (
  id uuid primary key default uuid_generate_v7(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name_en text not null,
  name_ar text,
  logo_license_status text not null default 'none'
    check (logo_license_status in ('none', 'requested', 'granted')),
  website text,
  type retailer_type not null,
  active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column retailers.logo_license_status is
  'Logos may only be shown when granted (plan 0.4/0.5); otherwise text name only.';
comment on column retailers.is_demo is 'Fake retailer for dev/demo; hidden from public views by default.';

-- Source Registry (plan 0.6 / 2.1). The DB enforces policy P2: no automated source may be
-- green without a recorded approval, and public_web additionally needs archived ToS + robots.
create table sources (
  id uuid primary key default uuid_generate_v7(),
  retailer_id uuid not null references retailers (id),
  method source_method not null,
  legal_status legal_status not null default 'red',
  approval_ref text,
  tos_archive_url text,
  robots_archive_url text,
  refresh_cron text,
  last_ok_at timestamptz,
  kill_switch boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, retailer_id),
  constraint sources_green_requires_approval check (
    legal_status <> 'green' or method in ('crowd', 'manual') or approval_ref is not null
  ),
  constraint sources_public_web_green_requires_archives check (
    not (method = 'public_web' and legal_status = 'green')
    or (tos_archive_url is not null and robots_archive_url is not null)
  )
);
create index sources_retailer_idx on sources (retailer_id);

create table branches (
  id uuid primary key default uuid_generate_v7(),
  retailer_id uuid not null references retailers (id),
  name text not null,
  city text not null,
  area text,
  lat_approx numeric(6, 3) check (lat_approx between 24 and 27.5),
  lng_approx numeric(6, 3) check (lng_approx between 50 and 52),
  delivery_zone_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column branches.lat_approx is 'Approximate only (3 decimals ~ 100 m) - plan 2.1.';
create index branches_retailer_idx on branches (retailer_id);

create table brands (
  id uuid primary key default uuid_generate_v7(),
  name_en citext not null unique,
  name_ar text,
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default uuid_generate_v7(),
  parent_id uuid references categories (id),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name_en text not null,
  name_ar text not null,
  restricted boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
comment on column categories.restricted is
  'Alcohol/tobacco (and pork pending counsel) - never shown publicly (plan 0.5, P8).';
create index categories_parent_idx on categories (parent_id);

-- Children of a restricted category are restricted; un-restricting is a manual act.
create function categories_inherit_restriction() returns trigger
language plpgsql as $$
begin
  if new.parent_id is not null
     and exists (select 1 from categories where id = new.parent_id and restricted) then
    new.restricted := true;
  end if;
  return new;
end $$;
create trigger categories_inherit_restriction_trg
  before insert or update of parent_id on categories
  for each row execute function categories_inherit_restriction();

create table products (
  id uuid primary key default uuid_generate_v7(),
  canonical_name_en text not null,
  canonical_name_ar text,
  brand_id uuid references brands (id),
  category_id uuid not null references categories (id),
  gtin text check (gtin ~ '^([0-9]{8}|[0-9]{12,14})$'),
  size_value numeric(12, 4) check (size_value > 0),
  size_unit size_unit,
  pack_count int not null default 1 check (pack_count >= 1),
  -- Normalised quantity in base units (kg / L / piece) for unit-price comparison, plan 2.2.
  base_quantity numeric(14, 6) generated always as (
    case size_unit
      when 'g' then size_value * pack_count / 1000
      when 'kg' then size_value * pack_count
      when 'ml' then size_value * pack_count / 1000
      when 'l' then size_value * pack_count
      when 'pc' then size_value * pack_count
    end
  ) stored,
  base_unit text generated always as (
    case size_unit
      when 'g' then 'kg'
      when 'kg' then 'kg'
      when 'ml' then 'l'
      when 'l' then 'l'
      when 'pc' then 'pc'
    end
  ) stored,
  attributes jsonb not null default '{}'::jsonb,
  restricted boolean not null default false,
  image_id uuid,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_size_both_or_none check ((size_value is null) = (size_unit is null))
);
comment on column products.search_text is
  'Search-normalised en+ar+brand text (see @qarib/shared normalizeSearch); set by the application.';
comment on column products.image_id is 'Reserved for licensed/own images (plan P3); no table yet.';
create unique index products_gtin_uidx on products (gtin) where gtin is not null;
create index products_brand_category_idx on products (brand_id, category_id);
create index products_category_idx on products (category_id);
create index products_search_trgm_idx on products using gin (search_text gin_trgm_ops);

-- A product in a restricted category is always restricted (hard guarantee, plan P8).
create function products_enforce_restriction() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from categories where id = new.category_id and restricted) then
    new.restricted := true;
  end if;
  return new;
end $$;
create trigger products_enforce_restriction_trg
  before insert or update of category_id, restricted on products
  for each row execute function products_enforce_restriction();

create function categories_propagate_restriction() returns trigger
language plpgsql as $$
begin
  update categories set restricted = true where parent_id = new.id and not restricted;
  update products set restricted = true where category_id = new.id and not restricted;
  return null;
end $$;
create trigger categories_propagate_restriction_trg
  after update of restricted on categories
  for each row when (new.restricted and not old.restricted)
  execute function categories_propagate_restriction();

-- Retailer-specific listing, optionally matched to a canonical product (Phase 4).
create table retailer_products (
  id uuid primary key default uuid_generate_v7(),
  retailer_id uuid not null references retailers (id),
  source_id uuid not null,
  external_sku text not null,
  raw_name text not null,
  raw_name_normalised text not null default '',
  raw_size text,
  raw_url text,
  product_id uuid references products (id),
  match_status match_status not null default 'review',
  match_score numeric(4, 3) check (match_score between 0 and 1),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (source_id, retailer_id) references sources (id, retailer_id),
  unique (source_id, external_sku),
  constraint retailer_products_matched_has_product check (
    match_status in ('review', 'rejected') or product_id is not null
  )
);
create index retailer_products_product_idx on retailer_products (product_id);
create index retailer_products_retailer_idx on retailer_products (retailer_id);
create index retailer_products_name_trgm_idx
  on retailer_products using gin (raw_name_normalised gin_trgm_ops);
create index retailer_products_review_idx on retailer_products (match_status)
  where match_status = 'review';

create trigger retailers_updated before update on retailers
  for each row execute function set_updated_at();
create trigger sources_updated before update on sources
  for each row execute function set_updated_at();
create trigger branches_updated before update on branches
  for each row execute function set_updated_at();
create trigger products_updated before update on products
  for each row execute function set_updated_at();
create trigger retailer_products_updated before update on retailer_products
  for each row execute function set_updated_at();

-- Down Migration
drop table if exists retailer_products;
drop trigger if exists categories_propagate_restriction_trg on categories;
drop trigger if exists products_enforce_restriction_trg on products;
drop function if exists categories_propagate_restriction();
drop function if exists products_enforce_restriction();
drop table if exists products;
drop trigger if exists categories_inherit_restriction_trg on categories;
drop function if exists categories_inherit_restriction();
drop table if exists categories;
drop table if exists brands;
drop table if exists branches;
drop table if exists sources;
drop table if exists retailers;
drop type if exists promo_type;
drop type if exists match_status;
drop type if exists size_unit;
drop type if exists legal_status;
drop type if exists source_method;
drop type if exists retailer_type;
