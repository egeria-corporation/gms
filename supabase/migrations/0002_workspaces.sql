-- 0002_workspaces: tenancy. One workspace per org-side; a Passport org that both funds and applies
-- has two. Individuals apply from a workspace with no passport_org_id.

create table public.workspaces (
  id                  uuid primary key default gms.uuid_v7(),
  kind                text not null check (kind in ('funder', 'applicant')),
  passport_org_id     uuid,
  handle              text not null unique check (handle ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  display_name        text not null check (length(btrim(display_name)) between 1 and 200),
  legal_name          text,
  ein                 text check (ein ~ '^[0-9]{9}$'),
  brand               jsonb not null default '{}'::jsonb,
  settings            jsonb not null default '{}'::jsonb,
  org_projection      jsonb,
  org_projection_at   timestamptz,
  verification_level  text check (verification_level = any (gms.verification_levels())),
  status              text not null default 'active' check (status in ('onboarding', 'active', 'suspended', 'closed')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (passport_org_id, kind)
);
comment on table public.workspaces is 'Funder or applicant workspace. org_projection caches the Passport OrganizationBase; profile fields are never edited here.';
comment on column public.workspaces.brand is 'logoUrl, accent, onAccent, fontPreference (funder public pages, letters, emails).';
comment on column public.workspaces.ein is 'Employer identification number, digits only (public registry id org:us:ein).';
create index workspaces_passport_org_id_idx on public.workspaces (passport_org_id);

create table public.workspace_members (
  id               uuid primary key default gms.uuid_v7(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             text not null check (role in (
                     'admin', 'program_officer', 'finance', 'reviewer', 'external_reviewer', 'observer', 'auditor',
                     'editor', 'viewer', 'consultant')),
  scope            jsonb not null default '{}'::jsonb,
  expires_at       timestamptz,
  mfa_enrolled_at  timestamptz,
  invited_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, user_id)
);
comment on column public.workspace_members.scope is 'Restrictions for consultants and external reviewers: applicationIds, awardIds, competitionIds.';
create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- Funder roles on funder workspaces, applicant roles on applicant workspaces.
create or replace function gms.check_member_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k text;
begin
  select w.kind into k from public.workspaces w where w.id = new.workspace_id;
  if k = 'funder' and new.role not in ('admin','program_officer','finance','reviewer','external_reviewer','observer','auditor') then
    raise exception 'role % is not a funder role', new.role using errcode = '23514';
  elsif k = 'applicant' and new.role not in ('admin','editor','finance','viewer','consultant') then
    raise exception 'role % is not an applicant role', new.role using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger workspace_members_check_role before insert or update of role, workspace_id on public.workspace_members
  for each row execute function gms.check_member_role();

create table public.invitations (
  id            uuid primary key default gms.uuid_v7(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  email         text not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  role          text not null,
  scope         jsonb not null default '{}'::jsonb,
  token_hash    text not null unique,
  invited_by    uuid,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index invitations_workspace_id_idx on public.invitations (workspace_id);

create table public.passport_links (
  id                 uuid primary key default gms.uuid_v7(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  mode               text not null check (mode in ('funder_client', 'applicant_consent')),
  client_id          text,
  client_secret_enc  text,
  refresh_token_enc  text,
  scopes             text[] not null default '{}',
  linked_by_user_id  uuid,
  linked_at          timestamptz not null default now(),
  revoked_at         timestamptz,
  last_ok_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (mode <> 'funder_client' or (client_id is not null and client_secret_enc is not null))
);
comment on table public.passport_links is 'How a workspace reaches Passport. Secrets are AES-GCM ciphertext (CREDENTIALS_ENCRYPTION_KEY); never readable by user-scoped keys.';
create index passport_links_workspace_id_idx on public.passport_links (workspace_id);
create unique index passport_links_one_active_idx on public.passport_links (workspace_id, mode) where revoked_at is null;

create table public.consents (
  id                      uuid primary key default gms.uuid_v7(),
  applicant_workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  funder_workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  basis                   text not null check (basis in ('application', 'passport_grant', 'shared_submission')),
  scopes                  text[] not null default '{}',
  granted_by              uuid,
  granted_at              timestamptz not null default now(),
  revoked_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (applicant_workspace_id <> funder_workspace_id)
);
comment on table public.consents is 'Which funders may read which applicant data, and on what basis.';
create index consents_applicant_idx on public.consents (applicant_workspace_id);
create index consents_funder_idx on public.consents (funder_workspace_id);
