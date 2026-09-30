-- Up Migration
-- Extensions are allow-listed on Azure Database for PostgreSQL Flexible Server (plan 9.0).
create extension if not exists pg_trgm;
create extension if not exists citext;
create extension if not exists vector;
create extension if not exists unaccent;

-- UUIDv7 (time-ordered) primary keys, plan 2.1. Native uuidv7() only exists in PG18+.
create or replace function uuid_generate_v7() returns uuid
language plpgsql volatile as $$
declare
  ts_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  b bytea := uuid_send(gen_random_uuid());
begin
  b := set_byte(b, 0, ((ts_ms >> 40) & 255)::int);
  b := set_byte(b, 1, ((ts_ms >> 32) & 255)::int);
  b := set_byte(b, 2, ((ts_ms >> 24) & 255)::int);
  b := set_byte(b, 3, ((ts_ms >> 16) & 255)::int);
  b := set_byte(b, 4, ((ts_ms >> 8) & 255)::int);
  b := set_byte(b, 5, (ts_ms & 255)::int);
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);  -- version 7
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);  -- RFC 4122 variant
  return encode(b, 'hex')::uuid;
end $$;

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function forbid_modification() returns trigger
language plpgsql as $$
begin
  raise exception '% on % is not allowed: table is append-only', tg_op, tg_table_name
    using errcode = 'QAR02';
end $$;

-- Down Migration
drop function if exists forbid_modification();
drop function if exists set_updated_at();
drop function if exists uuid_generate_v7();
-- Extensions are intentionally left installed.
