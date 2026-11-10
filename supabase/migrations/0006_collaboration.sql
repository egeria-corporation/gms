-- 0006_collaboration: threads, tasks, documents, the applicant answer library, the funder's
-- grantee directory, the org-change inbox and saved discovery items.

create table public.threads (
  id                      uuid primary key default gms.uuid_v7(),
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  funder_workspace_id     uuid references public.workspaces (id) on delete cascade,
  applicant_workspace_id  uuid references public.workspaces (id) on delete cascade,
  subject_type            text not null check (subject_type in ('application', 'award', 'requirement')),
  subject_id              uuid not null,
  visibility              text not null default 'shared' check (visibility in ('shared', 'funder_internal', 'applicant_internal')),
  title                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (visibility <> 'funder_internal' or funder_workspace_id is not null),
  check (visibility <> 'applicant_internal' or applicant_workspace_id is not null),
  check (visibility <> 'shared' or (funder_workspace_id is not null and applicant_workspace_id is not null))
);
comment on table public.threads is 'workspace_id is the workspace that opened the thread. shared threads are visible to both sides; internal ones to one.';
create index threads_workspace_id_idx on public.threads (workspace_id);
create index threads_funder_workspace_id_idx on public.threads (funder_workspace_id);
create index threads_applicant_workspace_id_idx on public.threads (applicant_workspace_id);
create index threads_subject_idx on public.threads (subject_type, subject_id);

create table public.messages (
  id                uuid primary key default gms.uuid_v7(),
  thread_id         uuid not null references public.threads (id) on delete cascade,
  author            text not null,
  author_user_id    uuid,
  body              text not null,
  attachments       jsonb not null default '[]'::jsonb,
  email_message_id  text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on column public.messages.author is 'Ledger-style actor: user:<id>, user:<id>/client:<id>, system:<job>.';
create index messages_thread_id_idx on public.messages (thread_id, created_at);

create table public.tasks (
  id                uuid primary key default gms.uuid_v7(),
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  subject_type      text,
  subject_id        uuid,
  title             text not null check (length(btrim(title)) between 1 and 300),
  assignee_user_id  uuid,
  due_at            timestamptz,
  done_at           timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index tasks_workspace_id_idx on public.tasks (workspace_id);
create index tasks_assignee_idx on public.tasks (assignee_user_id) where done_at is null;
create index tasks_subject_idx on public.tasks (subject_type, subject_id);

create table public.documents (
  id                    uuid primary key default gms.uuid_v7(),
  workspace_id          uuid not null references public.workspaces (id) on delete cascade,
  owner_workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  subject_type          text,
  subject_id            uuid,
  name                  text not null check (length(btrim(name)) between 1 and 300),
  mime                  text not null,
  size                  bigint not null check (size >= 0),
  sha256                text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage               text not null check (storage in ('supabase', 'r2')),
  path                  text not null,
  passport_document_id  text,
  scan_status           text not null default 'not_scanned' check (scan_status in ('not_scanned', 'clean', 'infected')),
  uploaded_by           uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table public.documents is 'File metadata. workspace_id may read it; owner_workspace_id uploaded it. passport_document_id references the Passport locker (no copy).';
create index documents_workspace_id_idx on public.documents (workspace_id);
create index documents_owner_workspace_id_idx on public.documents (owner_workspace_id);
create index documents_subject_idx on public.documents (subject_type, subject_id);

create table public.answers (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  key           text not null check (key ~ '^[a-z0-9][a-z0-9_.-]{0,98}$'),
  title         text not null check (length(btrim(title)) between 1 and 300),
  body          text not null default '',
  version       integer not null default 1 check (version >= 1),
  used_in       jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, key, version)
);
comment on table public.answers is 'Applicant answer library.';

create table public.grantee_records (
  id                      uuid primary key default gms.uuid_v7(),
  workspace_id            uuid not null references public.workspaces (id) on delete cascade,
  applicant_workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  owner_user_id           uuid,
  tags                    text[] not null default '{}',
  notes                   text,
  pending_org_changes     jsonb not null default '[]'::jsonb,
  last_synced_at          timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (workspace_id, applicant_workspace_id)
);
comment on table public.grantee_records is 'Funder-side relationship memory. Never visible to the grantee.';
create index grantee_records_applicant_workspace_id_idx on public.grantee_records (applicant_workspace_id);

create table public.org_change_inbox (
  id               uuid primary key default gms.uuid_v7(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  passport_org_id  uuid not null,
  change_id        text not null,
  patch            jsonb not null,
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, change_id)
);
comment on table public.org_change_inbox is 'Organization profile changes received from Passport (ADR-0026) awaiting the funder''s review.';
create index org_change_inbox_passport_org_id_idx on public.org_change_inbox (passport_org_id);

create table public.discover_saved (
  id                 uuid primary key default gms.uuid_v7(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  source             text not null check (source in ('gms', 'opengrants')),
  external_id        text not null,
  title              text not null,
  url                text,
  listing            jsonb not null default '{}'::jsonb,
  gms_opportunity_id uuid references public.opportunities (id) on delete set null,
  saved_by           uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (workspace_id, source, external_id)
);
comment on table public.discover_saved is 'Find funding: listings an applicant saved (§10.10). gms_opportunity_id is set when the listing matches a GMS opportunity.';
create index discover_saved_gms_opportunity_id_idx on public.discover_saved (gms_opportunity_id);
