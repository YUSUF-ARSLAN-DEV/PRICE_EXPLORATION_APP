-- Up Migration
create table audit_log (
  id uuid primary key default uuid_generate_v7(),
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  ts timestamptz not null default clock_timestamp()
);
create index audit_log_entity_idx on audit_log (entity_type, entity_id, ts desc);
create index audit_log_ts_idx on audit_log (ts desc);

create trigger audit_log_append_only_trg
  before update or delete on audit_log
  for each row execute function forbid_modification();

-- Actor comes from `set local qarib.actor = '<user>'` set by the app/admin per transaction.
create function audit_source_changes() returns trigger language plpgsql as $$
declare
  v_actor text := coalesce(nullif(current_setting('qarib.actor', true), ''), current_user);
begin
  if tg_op = 'INSERT' then
    insert into audit_log (actor, action, entity_type, entity_id, after)
    values (v_actor, 'source.created', 'source', new.id, to_jsonb(new));
  elsif old.legal_status is distinct from new.legal_status
     or old.kill_switch is distinct from new.kill_switch
     or old.approval_ref is distinct from new.approval_ref
     or old.method is distinct from new.method then
    insert into audit_log (actor, action, entity_type, entity_id, before, after)
    values (v_actor, 'source.updated', 'source', new.id, to_jsonb(old), to_jsonb(new));
  end if;
  return null;
end $$;
create trigger sources_audit_trg
  after insert or update on sources
  for each row execute function audit_source_changes();

create table takedown_requests (
  id uuid primary key default uuid_generate_v7(),
  retailer_id uuid references retailers (id),
  source_id uuid references sources (id),
  requester_name text,
  requester_email text,
  channel text not null default 'email' check (channel in ('email', 'web_form', 'letter', 'other')),
  summary text not null,
  received_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  action text check (action in
    ('source_disabled', 'price_corrected', 'content_hidden', 'rejected', 'forwarded_to_counsel')),
  notes text
);
comment on column takedown_requests.requester_name is '[PII: handling takedown/complaint request]';
comment on column takedown_requests.requester_email is '[PII: handling takedown/complaint request]';
create index takedown_open_idx on takedown_requests (received_at) where resolved_at is null;

-- Down Migration
drop table if exists takedown_requests;
drop trigger if exists sources_audit_trg on sources;
drop function if exists audit_source_changes();
drop table if exists audit_log;
