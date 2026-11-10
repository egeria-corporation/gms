-- 0008_ledger: append-only audit ledger. Every write that changes status, money, consent or access
-- lands here. INSERT and SELECT only, for every role; triggers reject UPDATE, DELETE and TRUNCATE
-- even for the table owner. A nightly job archives rows to R2 as hash-chained JSONL.

create table public.ledger_events (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid references public.workspaces (id),
  actor         text not null check (actor ~ '^(user:[^/]+(/client:.+)?|client:.+|system:.+|passport)$'),
  event_type    text not null check (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$'),
  subject_type  text,
  subject_id    text,
  data          jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now(),
  -- created_at/updated_at are kept for uniformity; updated_at never changes because rows never do.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.ledger_events is 'Append-only audit ledger. No UPDATE, DELETE or TRUNCATE for any role.';
comment on column public.ledger_events.actor is 'user:<id> | client:<id> | user:<id>/client:<id> | system:<job> | passport.';
create index ledger_events_workspace_id_occurred_at_idx on public.ledger_events (workspace_id, occurred_at desc);
create index ledger_events_subject_idx on public.ledger_events (subject_type, subject_id);
create index ledger_events_occurred_at_idx on public.ledger_events (occurred_at);

create or replace function gms.append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only (% rejected)', tg_table_name, tg_op using errcode = '42501';
end;
$$;

create trigger ledger_events_no_update_delete before update or delete on public.ledger_events
  for each row execute function gms.append_only();
create trigger ledger_events_no_truncate before truncate on public.ledger_events
  for each statement execute function gms.append_only();

-- One manifest row per archived object. Each row records the SHA-256 of its object and of the
-- previous archive, so removing or editing an archived day breaks the chain.
create table public.ledger_archives (
  id           uuid primary key default gms.uuid_v7(),
  day          date not null,
  object_key   text not null unique check (object_key ~ '^ledger/[0-9]{4}/[0-9]{2}/[0-9]{2}(-r[0-9]+)?\.jsonl$'),
  events       integer not null check (events >= 0),
  first_event  uuid,
  last_event   uuid,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  prev_sha256  text check (prev_sha256 ~ '^[0-9a-f]{64}$'),
  archived_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.ledger_archives is 'Manifest of ledger_events JSONL objects in R2, hash-chained (prev_sha256).';
create index ledger_archives_day_idx on public.ledger_archives (day desc, archived_at desc);

create trigger ledger_archives_no_update_delete before update or delete on public.ledger_archives
  for each row execute function gms.append_only();
create trigger ledger_archives_no_truncate before truncate on public.ledger_archives
  for each statement execute function gms.append_only();
