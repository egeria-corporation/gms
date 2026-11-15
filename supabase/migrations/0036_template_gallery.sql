-- 0036_template_gallery.sql
-- The template gallery (v1.8.0): ready-to-use application forms, rubrics, report forms, email
-- templates and program kits that any funder copies into its own workspace. A funder workspace
-- admin shares one of its own; an operator approves or declines it; only approved items are
-- public, and only through the API (`GET /gms/gallery`), never by table access.
--
-- Privacy. A gallery item holds a content snapshot taken when it was shared, with contact details
-- and the organization's own names taken out (apps/api/src/services/gallery.ts). It is a copy: it
-- never links back to the author's live form. A submission belongs to one funder workspace and is
-- readable only by that workspace's staff (gms.is_staff). An item is readable by table access only
-- by its author's staff; the public reads approved items through the API's service role. Every
-- write goes through the API's service role. No money, bank or identity data.
--
-- What this changes on a live database (no existing table, column or row is changed or removed):
--   * adds gms.gallery_tags_ok(jsonb) and gms.gallery_snapshot_ok(text, jsonb): shape checks.
--   * adds gms.gallery_funder_only(): a row's workspace must be a funder workspace.
--   * adds two tables, RLS on, with updated_at triggers and the funder-only trigger:
--       gallery_items        what the gallery publishes (approved, or withdrawn by its author);
--       gallery_submissions  what a workspace shared, waiting for or past moderation.
--   * inserts the nine starter items of the OpenGrants starter library (author_workspace_id null),
--     with fixed ids so a re-run inserts nothing twice. They are new rows in a new table.

-- ---------------------------------------------------------------------------------------------
-- Shape checks
-- ---------------------------------------------------------------------------------------------

-- Tags: { fieldOfWork, grantSize, audience }, each an array of at most 10 strings of 1-60
-- characters with no outer spaces. The API keeps the vocabularies; the database keeps the shape.
create or replace function gms.gallery_tags_ok(t jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(t) = 'object'
     and not exists (select 1 from pg_catalog.jsonb_object_keys(t) k where k not in ('fieldOfWork', 'grantSize', 'audience'))
     and not exists (
       select 1 from pg_catalog.jsonb_each(t) f
        where pg_catalog.jsonb_typeof(f.value) <> 'array'
           or pg_catalog.jsonb_array_length(f.value) > 10
           or exists (
                select 1 from pg_catalog.jsonb_array_elements(f.value) e
                 where pg_catalog.jsonb_typeof(e) <> 'string'
                    or pg_catalog.length(e #>> '{}') not between 1 and 60
                    or (e #>> '{}') <> pg_catalog.btrim(e #>> '{}')
              )
     );
$$;

-- A snapshot is { forms: [...], rubrics: [...], emails: [...] }, at most 500,000 characters, and
-- holds what its kind says: one application form (any purpose but report), one report form, one
-- rubric, one email, or a program kit (an application form, a report form, a rubric and 1-10
-- emails). Each form has a title, a JSON Schema object and a UI schema object; each rubric a name
-- and criteria; each email a name, a subject and a body.
create or replace function gms.gallery_snapshot_ok(kind text, s jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(s) = 'object'
     and pg_catalog.length(s::text) <= 500000
     and not exists (select 1 from pg_catalog.jsonb_object_keys(s) k where k not in ('forms', 'rubrics', 'emails'))
     and pg_catalog.jsonb_typeof(coalesce(s -> 'forms', '[]')) = 'array'
     and pg_catalog.jsonb_typeof(coalesce(s -> 'rubrics', '[]')) = 'array'
     and pg_catalog.jsonb_typeof(coalesce(s -> 'emails', '[]')) = 'array'
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(coalesce(s -> 'forms', '[]')) f
        where pg_catalog.jsonb_typeof(f) <> 'object'
           or pg_catalog.jsonb_typeof(f -> 'title') <> 'string'
           or pg_catalog.jsonb_typeof(f -> 'jsonSchema') <> 'object'
           or pg_catalog.jsonb_typeof(f -> 'uiSchema') <> 'object'
           or coalesce(f ->> 'purpose', '') not in ('application', 'report', 'loi', 'amendment', 'site_visit', 'other')
     )
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(coalesce(s -> 'rubrics', '[]')) r
        where pg_catalog.jsonb_typeof(r) <> 'object'
           or pg_catalog.jsonb_typeof(r -> 'name') <> 'string'
           or pg_catalog.jsonb_typeof(r -> 'criteria') <> 'array'
           or pg_catalog.jsonb_array_length(r -> 'criteria') = 0
     )
     and not exists (
       select 1 from pg_catalog.jsonb_array_elements(coalesce(s -> 'emails', '[]')) m
        where pg_catalog.jsonb_typeof(m) <> 'object'
           or pg_catalog.jsonb_typeof(m -> 'name') <> 'string'
           or pg_catalog.jsonb_typeof(m -> 'subject') <> 'string'
           or pg_catalog.jsonb_typeof(m -> 'body') <> 'string'
     )
     and (
       with n as (
         select pg_catalog.jsonb_array_length(coalesce(s -> 'forms', '[]')) as forms,
                (select count(*) from pg_catalog.jsonb_array_elements(coalesce(s -> 'forms', '[]')) f where f ->> 'purpose' = 'report') as reports,
                pg_catalog.jsonb_array_length(coalesce(s -> 'rubrics', '[]')) as rubrics,
                pg_catalog.jsonb_array_length(coalesce(s -> 'emails', '[]')) as emails
       )
       select case kind
                when 'application_form' then forms = 1 and reports = 0 and rubrics = 0 and emails = 0
                when 'report_form' then forms = 1 and reports = 1 and rubrics = 0 and emails = 0
                when 'rubric' then forms = 0 and rubrics = 1 and emails = 0
                when 'email_template' then forms = 0 and rubrics = 0 and emails = 1
                when 'program_kit' then forms = 2 and reports = 1 and rubrics = 1 and emails between 1 and 10
                else false
              end
         from n
     );
$$;

-- The workspace a row names (the column in the trigger's first argument) is a funder workspace.
-- Null passes: a starter item has no author workspace.
create or replace function gms.gallery_funder_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws uuid := (pg_catalog.to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if ws is not null and (select w.kind from public.workspaces w where w.id = ws) is distinct from 'funder' then
    raise exception '%: rows belong to funder workspaces', tg_table_name using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------
create table public.gallery_items (
  id                   uuid primary key default gms.uuid_v7(),
  slug                 text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$' and slug <> 'moderation'),
  kind                 text not null check (kind in ('application_form', 'report_form', 'rubric', 'email_template', 'program_kit')),
  title                text not null check (length(btrim(title)) between 1 and 200),
  summary              text not null check (length(btrim(summary)) between 1 and 1000),
  tags                 jsonb not null default '{"fieldOfWork":[],"grantSize":[],"audience":[]}'::jsonb check (gms.gallery_tags_ok(tags)),
  -- The funder workspace that shared it; null for the OpenGrants starter library.
  author_workspace_id  uuid references public.workspaces (id) on delete cascade,
  licence              text not null default 'CC-BY-4.0' check (licence = 'CC-BY-4.0'),
  status               text not null default 'approved' check (status in ('approved', 'withdrawn')),
  version              integer not null default 1 check (version >= 1),
  snapshot             jsonb not null,
  uses_count           integer not null default 0 check (uses_count >= 0),
  published_at         timestamptz not null default now(),
  withdrawn_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (gms.gallery_snapshot_ok(kind, snapshot)),
  check ((status = 'withdrawn') = (withdrawn_at is not null))
);
comment on table public.gallery_items is 'The template gallery: approved copies of forms, rubrics, report forms and emails, CC BY 4.0. Public only through the API, and only while approved.';
comment on column public.gallery_items.snapshot is '{ forms, rubrics, emails }: a copy taken when it was shared, with contact details and the organization''s names taken out. Never a link to the live record.';
create index gallery_items_listing_idx on public.gallery_items (status, published_at desc);
create index gallery_items_author_idx on public.gallery_items (author_workspace_id) where author_workspace_id is not null;

create table public.gallery_submissions (
  id               uuid primary key default gms.uuid_v7(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  submitted_by     uuid not null,
  kind             text not null check (kind in ('application_form', 'report_form', 'rubric', 'email_template')),
  title            text not null check (length(btrim(title)) between 1 and 200),
  summary          text not null check (length(btrim(summary)) between 1 and 1000),
  tags             jsonb not null default '{"fieldOfWork":[],"grantSize":[],"audience":[]}'::jsonb check (gms.gallery_tags_ok(tags)),
  -- The workspace's own record it was copied from, and that record's version. Never shown publicly.
  source_type      text not null check (source_type in ('form', 'rubric', 'template')),
  source_id        uuid not null,
  source_version   integer not null check (source_version >= 1),
  snapshot         jsonb not null,
  -- What was taken out before it was saved: [{ path, what, reason }], for the author and the moderator.
  stripped         jsonb not null default '[]'::jsonb check (jsonb_typeof(stripped) = 'array'),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by       uuid,
  decided_at       timestamptz,
  decision_reason  text check (decision_reason is null or length(decision_reason) <= 2000),
  item_id          uuid references public.gallery_items (id) on delete set null,
  withdrawn_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (gms.gallery_snapshot_ok(kind, snapshot)),
  check (case kind when 'rubric' then source_type = 'rubric' when 'email_template' then source_type = 'template' else source_type = 'form' end),
  check (status <> 'pending' or (decided_at is null and decided_by is null and item_id is null)),
  check (status not in ('approved', 'rejected') or (decided_at is not null and decided_by is not null)),
  check (status <> 'rejected' or length(btrim(coalesce(decision_reason, ''))) >= 3),
  check ((status = 'withdrawn') = (withdrawn_at is not null))
);
comment on table public.gallery_submissions is 'What a funder workspace shared to the template gallery, and the moderator''s decision. Private to the workspace''s staff.';
create index gallery_submissions_workspace_idx on public.gallery_submissions (workspace_id, created_at desc);
create index gallery_submissions_queue_idx on public.gallery_submissions (created_at) where status = 'pending';
-- One submission of the same record waits at a time.
create unique index gallery_submissions_one_pending_idx on public.gallery_submissions (workspace_id, source_type, source_id) where status = 'pending';

alter table public.gallery_items enable row level security;
alter table public.gallery_submissions enable row level security;
revoke all on public.gallery_items, public.gallery_submissions from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.gallery_items, public.gallery_submissions to service_role;
grant select on public.gallery_items, public.gallery_submissions to authenticated;
-- No anonymous table access at all: the public gallery is the API's.
create policy gallery_items_select on public.gallery_items for select to authenticated
  using (author_workspace_id is not null and gms.is_staff(author_workspace_id));
create policy gallery_submissions_select on public.gallery_submissions for select to authenticated
  using (gms.is_staff(workspace_id));

create trigger gallery_items_touch_updated_at before update on public.gallery_items
  for each row execute function gms.touch_updated_at();
create trigger gallery_submissions_touch_updated_at before update on public.gallery_submissions
  for each row execute function gms.touch_updated_at();
create trigger gallery_items_funder_only before insert or update of author_workspace_id on public.gallery_items
  for each row execute function gms.gallery_funder_only('author_workspace_id');
create trigger gallery_submissions_funder_only before insert or update of workspace_id on public.gallery_submissions
  for each row execute function gms.gallery_funder_only('workspace_id');
create trigger gallery_submissions_workspace_immutable before update of workspace_id on public.gallery_submissions
  for each row execute function gms.workspace_id_immutable();

revoke all on function gms.gallery_funder_only() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The OpenGrants starter library
-- ---------------------------------------------------------------------------------------------
-- GENERATED from apps/api/src/services/gallery-starters.ts by apps/api/scripts/gallery-starters.ts.
-- Edit the TypeScript and re-run the script; a test keeps the two equal.
-- starters:begin
insert into public.gallery_items (id, slug, kind, title, summary, tags, author_workspace_id, version, snapshot, published_at)
select s.id, s.slug, s.kind, s.title, s.summary, s.tags, null, 1, s.snapshot, '2026-11-15T00:00:00Z'::timestamptz
  from pg_catalog.jsonb_to_recordset($starters$
[
 {
  "id": "36000000-0000-7000-8000-000000000001",
  "slug": "common-application",
  "kind": "application_form",
  "title": "Common application",
  "summary": "A complete project application most funders can use as it is: the project, the need, the plan, the budget and who leads the work. About 30 minutes for an applicant who knows the project.",
  "tags": {
   "fieldOfWork": [
    "Any field"
   ],
   "grantSize": [
    "$10,000 to $50,000",
    "$50,000 to $250,000"
   ],
   "audience": [
    "Nonprofits",
    "Community groups"
   ]
  },
  "snapshot": {
   "forms": [
    {
     "title": "Common application",
     "description": "A complete project application most funders can use as it is: the project, the need behind it, the plan, the budget and who will lead the work.",
     "instructions": "Thank you for applying. Answer in plain language, as you would explain your work to a neighbor. Short answers are fine: the word limits are a ceiling, not a target. You can save and come back at any time before you submit.",
     "purpose": "application",
     "jsonSchema": {
      "type": "object",
      "required": [
       "projectTitle",
       "summary",
       "need",
       "plan",
       "whoBenefits",
       "outcomes",
       "startDate",
       "endDate",
       "requestedAmount",
       "projectBudgetTotal",
       "budget",
       "mission",
       "leadership",
       "contactName",
       "contactEmail"
      ],
      "properties": {
       "projectTitle": {
        "type": "string",
        "title": "Project title",
        "maxLength": 200
       },
       "summary": {
        "type": "string",
        "title": "Project summary",
        "x-wordCount": {
         "max": 150
        }
       },
       "need": {
        "type": "string",
        "title": "The need",
        "x-wordCount": {
         "max": 300
        }
       },
       "plan": {
        "type": "string",
        "title": "What you will do",
        "x-wordCount": {
         "max": 300
        }
       },
       "whoBenefits": {
        "type": "string",
        "title": "Who will benefit",
        "x-wordCount": {
         "max": 200
        }
       },
       "outcomes": {
        "type": "string",
        "title": "What will change, and how you will know",
        "x-wordCount": {
         "max": 300
        }
       },
       "startDate": {
        "type": "string",
        "format": "date",
        "title": "Project start date"
       },
       "endDate": {
        "type": "string",
        "format": "date",
        "title": "Project end date"
       },
       "requestedAmount": {
        "type": "object",
        "title": "Amount requested"
       },
       "projectBudgetTotal": {
        "type": "object",
        "title": "Total project cost"
       },
       "otherFunding": {
        "type": "string",
        "title": "Other funding for this project",
        "x-wordCount": {
         "max": 150
        }
       },
       "budget": {
        "type": "object",
        "title": "Project budget"
       },
       "mission": {
        "type": "string",
        "title": "Your mission",
        "x-wordCount": {
         "max": 100
        }
       },
       "leadership": {
        "type": "string",
        "title": "Who will lead this work",
        "x-wordCount": {
         "max": 200
        }
       },
       "communityVoice": {
        "type": "string",
        "title": "How the people you serve shape this work",
        "x-wordCount": {
         "max": 200
        }
       },
       "contactName": {
        "type": "string",
        "title": "Contact name",
        "maxLength": 200
       },
       "contactEmail": {
        "type": "string",
        "format": "email",
        "title": "Contact email"
       },
       "contactPhone": {
        "type": "string",
        "title": "Contact phone"
       }
      }
     },
     "uiSchema": {
      "type": "VerticalLayout",
      "elements": [
       {
        "type": "Group",
        "label": "Your project",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/projectTitle",
          "options": {
           "help": "A short name we can use when we talk about your project."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/summary",
          "options": {
           "help": "In a few sentences: what you will do, for whom, and what will change."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/need",
          "options": {
           "help": "What problem or opportunity does this project respond to? Local facts or stories help more than national figures."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/plan",
          "options": {
           "help": "The main activities, in the order they will happen."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/whoBenefits",
          "options": {
           "help": "Who the project is for, roughly how many people, and where they live."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/outcomes",
          "options": {
           "help": "Two or three results you expect, and how you will track them. Simple measures are welcome."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/startDate"
         },
         {
          "type": "Control",
          "scope": "#/properties/endDate"
         }
        ]
       },
       {
        "type": "Group",
        "label": "Funding",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/requestedAmount",
          "options": {
           "widget": "money",
           "widgetOptions": {
            "currency": "USD"
           }
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/projectBudgetTotal",
          "options": {
           "help": "Include every source, not only this request.",
           "widget": "money",
           "widgetOptions": {
            "currency": "USD"
           }
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/otherFunding",
          "options": {
           "help": "Other grants, earned income or in-kind support, secured or pending."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/budget",
          "options": {
           "help": "Upload a one-page budget as a PDF or spreadsheet. Any clear format works.",
           "widget": "fileRef"
          }
         }
        ]
       },
       {
        "type": "Group",
        "label": "Your organization",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/mission"
         },
         {
          "type": "Control",
          "scope": "#/properties/leadership",
          "options": {
           "help": "The people responsible for the project and the experience they bring."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/communityVoice"
         }
        ]
       },
       {
        "type": "Group",
        "label": "Contact for this application",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/contactName",
          "options": {
           "help": "The person we should talk to about this request."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/contactEmail",
          "options": {
           "pii": true
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/contactPhone",
          "options": {
           "widget": "phone",
           "pii": true
          }
         }
        ]
       }
      ]
     },
     "mappingFromCommonGrants": {},
     "mappingToCommonGrants": {
      "title": {
       "field": "projectTitle"
      },
      "requestedAmount": {
       "field": "requestedAmount"
      }
     },
     "fieldMeta": {}
    }
   ],
   "rubrics": [],
   "emails": []
  }
 },
 {
  "id": "36000000-0000-7000-8000-000000000002",
  "slug": "general-operating-support",
  "kind": "application_form",
  "title": "General operating support application",
  "summary": "Unrestricted support for an organization's whole mission. Asks about the work, last year's results and the year ahead, and uses documents organizations already have.",
  "tags": {
   "fieldOfWork": [
    "Any field"
   ],
   "grantSize": [
    "Any size"
   ],
   "audience": [
    "Nonprofits"
   ]
  },
  "snapshot": {
   "forms": [
    {
     "title": "General operating support application",
     "description": "Unrestricted support for an organization's whole mission, not one project. Asks about the work, last year's results and the year ahead.",
     "instructions": "General operating support funds your organization as a whole: salaries, rent, technology and the work itself. Tell us about the organization, not a single project. Use the documents you already have; we do not need anything written just for us.",
     "purpose": "application",
     "jsonSchema": {
      "type": "object",
      "required": [
       "projectTitle",
       "mission",
       "whoYouServe",
       "lastYear",
       "yearAhead",
       "requestedAmount",
       "operatingBudget",
       "useOfSupport",
       "financials",
       "budget",
       "contactName",
       "contactEmail"
      ],
      "properties": {
       "projectTitle": {
        "type": "string",
        "title": "What should we call this request?",
        "maxLength": 200
       },
       "mission": {
        "type": "string",
        "title": "Your mission and what you do",
        "x-wordCount": {
         "max": 250
        }
       },
       "whoYouServe": {
        "type": "string",
        "title": "Who you serve, and where",
        "x-wordCount": {
         "max": 200
        }
       },
       "lastYear": {
        "type": "string",
        "title": "What you accomplished last year",
        "x-wordCount": {
         "max": 250
        }
       },
       "yearAhead": {
        "type": "string",
        "title": "Your plans for the coming year",
        "x-wordCount": {
         "max": 250
        }
       },
       "challenges": {
        "type": "string",
        "title": "What is hard right now",
        "x-wordCount": {
         "max": 150
        }
       },
       "requestedAmount": {
        "type": "object",
        "title": "Amount requested"
       },
       "operatingBudget": {
        "type": "object",
        "title": "This year's operating budget"
       },
       "useOfSupport": {
        "type": "string",
        "title": "How flexible support would help",
        "x-wordCount": {
         "max": 200
        }
       },
       "financials": {
        "type": "object",
        "title": "Most recent financial statements"
       },
       "budget": {
        "type": "object",
        "title": "Current year budget"
       },
       "contactName": {
        "type": "string",
        "title": "Contact name",
        "maxLength": 200
       },
       "contactEmail": {
        "type": "string",
        "format": "email",
        "title": "Contact email"
       },
       "contactPhone": {
        "type": "string",
        "title": "Contact phone"
       }
      }
     },
     "uiSchema": {
      "type": "VerticalLayout",
      "elements": [
       {
        "type": "Group",
        "label": "Your organization",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/projectTitle",
          "options": {
           "help": "For example, \"2027 operating support\"."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/mission"
         },
         {
          "type": "Control",
          "scope": "#/properties/whoYouServe"
         },
         {
          "type": "Control",
          "scope": "#/properties/lastYear",
          "options": {
           "help": "A few results you are proud of. Numbers, stories or both."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/yearAhead"
         },
         {
          "type": "Control",
          "scope": "#/properties/challenges",
          "options": {
           "help": "Optional. Knowing your challenges helps us be a better partner; it never counts against you."
          }
         }
        ]
       },
       {
        "type": "Group",
        "label": "Funding",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/requestedAmount",
          "options": {
           "widget": "money",
           "widgetOptions": {
            "currency": "USD"
           }
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/operatingBudget",
          "options": {
           "widget": "money",
           "widgetOptions": {
            "currency": "USD"
           }
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/useOfSupport"
         },
         {
          "type": "Control",
          "scope": "#/properties/financials",
          "options": {
           "help": "An audit, a review or your board-approved statements, whichever you have.",
           "widget": "fileRef"
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/budget",
          "options": {
           "widget": "fileRef"
          }
         }
        ]
       },
       {
        "type": "Group",
        "label": "Contact for this application",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/contactName",
          "options": {
           "help": "The person we should talk to about this request."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/contactEmail",
          "options": {
           "pii": true
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/contactPhone",
          "options": {
           "widget": "phone",
           "pii": true
          }
         }
        ]
       }
      ]
     },
     "mappingFromCommonGrants": {},
     "mappingToCommonGrants": {
      "title": {
       "field": "projectTitle"
      },
      "requestedAmount": {
       "field": "requestedAmount"
      }
     },
     "fieldMeta": {}
    }
   ],
   "rubrics": [],
   "emails": []
  }
 },
 {
  "id": "36000000-0000-7000-8000-000000000003",
  "slug": "small-capacity-building",
  "kind": "application_form",
  "title": "Small capacity-building grant application",
  "summary": "A short application for small grants that strengthen how an organization works: fundraising, technology, training, board development or planning.",
  "tags": {
   "fieldOfWork": [
    "Any field"
   ],
   "grantSize": [
    "Under $10,000"
   ],
   "audience": [
    "Small organizations",
    "Nonprofits",
    "Community groups"
   ]
  },
  "snapshot": {
   "forms": [
    {
     "title": "Small capacity-building grant application",
     "description": "A short application for a small grant that strengthens how an organization works: fundraising, technology, training, planning and the like.",
     "instructions": "Capacity-building grants help your organization work better: new systems, skills or plans that will last after the grant ends. This application is short on purpose. Tell us what you want to strengthen and how.",
     "purpose": "application",
     "jsonSchema": {
      "type": "object",
      "required": [
       "projectTitle",
       "area",
       "need",
       "plan",
       "success",
       "requestedAmount",
       "spending",
       "contactName",
       "contactEmail"
      ],
      "properties": {
       "projectTitle": {
        "type": "string",
        "title": "Name of the effort",
        "maxLength": 200
       },
       "area": {
        "type": "string",
        "title": "Main area",
        "enum": [
         "Fundraising",
         "Technology",
         "Staff training",
         "Board development",
         "Finance and accounting",
         "Communications",
         "Strategic planning",
         "Evaluation",
         "Other"
        ]
       },
       "need": {
        "type": "string",
        "title": "Why now",
        "x-wordCount": {
         "max": 200
        }
       },
       "plan": {
        "type": "string",
        "title": "What you will do",
        "x-wordCount": {
         "max": 200
        }
       },
       "helpers": {
        "type": "string",
        "title": "Who will help",
        "x-wordCount": {
         "max": 100
        }
       },
       "success": {
        "type": "string",
        "title": "How you will know it worked",
        "x-wordCount": {
         "max": 150
        }
       },
       "requestedAmount": {
        "type": "object",
        "title": "Amount requested"
       },
       "spending": {
        "type": "string",
        "title": "How you will spend it",
        "x-wordCount": {
         "max": 150
        }
       },
       "quote": {
        "type": "object",
        "title": "A quote or estimate"
       },
       "contactName": {
        "type": "string",
        "title": "Contact name",
        "maxLength": 200
       },
       "contactEmail": {
        "type": "string",
        "format": "email",
        "title": "Contact email"
       },
       "contactPhone": {
        "type": "string",
        "title": "Contact phone"
       }
      }
     },
     "uiSchema": {
      "type": "VerticalLayout",
      "elements": [
       {
        "type": "Group",
        "label": "What you want to strengthen",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/projectTitle",
          "options": {
           "help": "For example, \"New donor database\" or \"Board training\"."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/area"
         },
         {
          "type": "Control",
          "scope": "#/properties/need",
          "options": {
           "help": "What gets in the way today, and what it costs your organization."
          }
         }
        ]
       },
       {
        "type": "Group",
        "label": "Your plan",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/plan"
         },
         {
          "type": "Control",
          "scope": "#/properties/helpers",
          "options": {
           "help": "A consultant, a trainer or a vendor, if you plan to work with one."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/success"
         }
        ]
       },
       {
        "type": "Group",
        "label": "Funding",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/requestedAmount",
          "options": {
           "widget": "money",
           "widgetOptions": {
            "currency": "USD"
           }
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/spending",
          "options": {
           "help": "A simple list is fine: what you will buy or pay for, and roughly what each costs."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/quote",
          "options": {
           "widget": "fileRef"
          }
         }
        ]
       },
       {
        "type": "Group",
        "label": "Contact for this application",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/contactName",
          "options": {
           "help": "The person we should talk to about this request."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/contactEmail",
          "options": {
           "pii": true
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/contactPhone",
          "options": {
           "widget": "phone",
           "pii": true
          }
         }
        ]
       }
      ]
     },
     "mappingFromCommonGrants": {},
     "mappingToCommonGrants": {
      "title": {
       "field": "projectTitle"
      },
      "requestedAmount": {
       "field": "requestedAmount"
      }
     },
     "fieldMeta": {}
    }
   ],
   "rubrics": [],
   "emails": []
  }
 },
 {
  "id": "36000000-0000-7000-8000-000000000004",
  "slug": "five-criterion-rubric",
  "kind": "rubric",
  "title": "Five-criterion rubric",
  "summary": "Need and fit, approach, capacity, budget and community impact, each scored 1 to 5 with guidance for every score, so reviewers score the same way.",
  "tags": {
   "fieldOfWork": [
    "Any field"
   ],
   "grantSize": [
    "Any size"
   ],
   "audience": [
    "Nonprofits",
    "Community groups",
    "Schools"
   ]
  },
  "snapshot": {
   "forms": [],
   "rubrics": [
    {
     "name": "Five-criterion rubric",
     "criteria": [
      {
       "key": "need",
       "label": "Need and fit",
       "weight": 1,
       "scale": {
        "type": "numeric",
        "min": 1,
        "max": 5
       },
       "description": "Is the need clear, and does the project fit this opportunity?",
       "guidance": "5: a clear, local need and a close fit. 3: the need is plausible and the fit is partial. 1: the need is unclear or outside what this opportunity funds."
      },
      {
       "key": "approach",
       "label": "Approach",
       "weight": 1,
       "scale": {
        "type": "numeric",
        "min": 1,
        "max": 5
       },
       "description": "Is the plan realistic and likely to work?",
       "guidance": "5: concrete steps, a sensible timeline, built on what has worked. 3: a reasonable plan with gaps. 1: the activities do not lead to the results described."
      },
      {
       "key": "capacity",
       "label": "Capacity",
       "weight": 1,
       "scale": {
        "type": "numeric",
        "min": 1,
        "max": 5
       },
       "description": "Can the organization do what it proposes?",
       "guidance": "5: experienced people and the systems to deliver. 3: some experience, some risk. 1: no clear way to deliver. Small organizations are not scored down for being small."
      },
      {
       "key": "budget",
       "label": "Budget",
       "weight": 1,
       "scale": {
        "type": "numeric",
        "min": 1,
        "max": 5
       },
       "description": "Is the budget reasonable and tied to the plan?",
       "guidance": "5: every cost follows from the plan and the amounts are realistic. 3: mostly reasonable, some questions. 1: the budget does not match the plan."
      },
      {
       "key": "impact",
       "label": "Community impact",
       "weight": 1,
       "scale": {
        "type": "numeric",
        "min": 1,
        "max": 5
       },
       "description": "Will the project make a real difference for the people it serves?",
       "guidance": "5: meaningful change for people who need it most, shaped with them. 3: some benefit. 1: little lasting difference."
      }
     ],
     "overall": {
      "recommendations": [
       "Fund",
       "Fund with conditions",
       "Do not fund"
      ]
     }
    }
   ],
   "emails": []
  }
 },
 {
  "id": "36000000-0000-7000-8000-000000000005",
  "slug": "interim-report",
  "kind": "report_form",
  "title": "Interim report",
  "summary": "A short mid-grant check-in: progress so far, people served to date, any change of plan and spending to date. Written so grantees can say plans changed.",
  "tags": {
   "fieldOfWork": [
    "Any field"
   ],
   "grantSize": [
    "Any size"
   ],
   "audience": [
    "Nonprofits",
    "Community groups",
    "Schools"
   ]
  },
  "snapshot": {
   "forms": [
    {
     "title": "Interim report",
     "description": "A mid-grant check-in: progress so far, numbers to date, any change of plan and spending to date.",
     "instructions": "This check-in helps us understand how the work is going and whether we can help. It is not a test. If plans have changed, say so: changes are normal, and we would rather hear early.",
     "purpose": "report",
     "jsonSchema": {
      "type": "object",
      "required": [
       "progress",
       "plansChanged",
       "spentToDate"
      ],
      "properties": {
       "progress": {
        "type": "string",
        "title": "Progress so far",
        "x-wordCount": {
         "max": 300
        }
       },
       "peopleServed": {
        "type": "integer",
        "minimum": 0,
        "title": "People served so far"
       },
       "plansChanged": {
        "type": "boolean",
        "title": "Have your plans changed?"
       },
       "changes": {
        "type": "string",
        "title": "What changed, and why",
        "x-wordCount": {
         "max": 200
        }
       },
       "challenges": {
        "type": "string",
        "title": "Challenges",
        "x-wordCount": {
         "max": 200
        }
       },
       "spentToDate": {
        "type": "object",
        "title": "Grant funds spent so far"
       },
       "budgetChanges": {
        "type": "string",
        "title": "Changes to the budget",
        "x-wordCount": {
         "max": 150
        }
       },
       "supportNeeded": {
        "type": "string",
        "title": "Is there anything we can do to help?",
        "x-wordCount": {
         "max": 150
        }
       },
       "attachments": {
        "type": "object",
        "title": "Photos or documents"
       }
      }
     },
     "uiSchema": {
      "type": "VerticalLayout",
      "elements": [
       {
        "type": "Group",
        "label": "Progress",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/progress",
          "options": {
           "help": "What you have done since the grant started."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/peopleServed",
          "options": {
           "help": "Leave it blank if counting people does not fit your work.",
           "outcome": true,
           "unit": "people served"
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/plansChanged"
         },
         {
          "type": "Control",
          "scope": "#/properties/changes"
         },
         {
          "type": "Control",
          "scope": "#/properties/challenges"
         }
        ]
       },
       {
        "type": "Group",
        "label": "Money",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/spentToDate",
          "options": {
           "widget": "money",
           "widgetOptions": {
            "currency": "USD"
           }
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/budgetChanges"
         }
        ]
       },
       {
        "type": "Group",
        "label": "Anything else",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/supportNeeded"
         },
         {
          "type": "Control",
          "scope": "#/properties/attachments",
          "options": {
           "help": "Optional: anything that shows the work.",
           "widget": "fileRef"
          }
         }
        ]
       }
      ]
     },
     "mappingFromCommonGrants": {},
     "mappingToCommonGrants": {},
     "fieldMeta": {}
    }
   ],
   "rubrics": [],
   "emails": []
  }
 },
 {
  "id": "36000000-0000-7000-8000-000000000006",
  "slug": "final-report",
  "kind": "report_form",
  "title": "Final report",
  "summary": "The end-of-grant report: results against the goals, people served, what was learned, how the money was spent and a question about how you could be a better funder.",
  "tags": {
   "fieldOfWork": [
    "Any field"
   ],
   "grantSize": [
    "Any size"
   ],
   "audience": [
    "Nonprofits",
    "Community groups",
    "Schools"
   ]
  },
  "snapshot": {
   "forms": [
    {
     "title": "Final report",
     "description": "The end-of-grant report: what was accomplished, results against the goals, what was learned and how the money was spent.",
     "instructions": "Thank you for the work this grant supported. Tell us what happened, including what did not go to plan: what you learned is as useful to us as what you achieved. Your answers from the application and any interim report are a good starting point.",
     "purpose": "report",
     "jsonSchema": {
      "type": "object",
      "required": [
       "accomplished",
       "goals",
       "learned",
       "totalSpent",
       "budgetVsActual",
       "next"
      ],
      "properties": {
       "accomplished": {
        "type": "string",
        "title": "What you accomplished",
        "x-wordCount": {
         "max": 300
        }
       },
       "goals": {
        "type": "string",
        "title": "How the results compare with your goals",
        "x-wordCount": {
         "max": 300
        }
       },
       "peopleServed": {
        "type": "integer",
        "minimum": 0,
        "title": "People served in all"
       },
       "story": {
        "type": "string",
        "title": "A story of change",
        "x-wordCount": {
         "max": 250
        }
       },
       "learned": {
        "type": "string",
        "title": "What you learned",
        "x-wordCount": {
         "max": 200
        }
       },
       "totalSpent": {
        "type": "object",
        "title": "Grant funds spent in all"
       },
       "budgetVsActual": {
        "type": "object",
        "title": "Budget compared with actual spending"
       },
       "next": {
        "type": "string",
        "title": "What happens next",
        "x-wordCount": {
         "max": 150
        }
       },
       "feedback": {
        "type": "string",
        "title": "How could we have been a better funder?",
        "x-wordCount": {
         "max": 150
        }
       }
      }
     },
     "uiSchema": {
      "type": "VerticalLayout",
      "elements": [
       {
        "type": "Group",
        "label": "Results",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/accomplished"
         },
         {
          "type": "Control",
          "scope": "#/properties/goals"
         },
         {
          "type": "Control",
          "scope": "#/properties/peopleServed",
          "options": {
           "help": "Leave it blank if counting people does not fit your work.",
           "outcome": true,
           "unit": "people served"
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/story",
          "options": {
           "help": "Optional: one person, family or place this work made a difference for. Share only what they agreed to share."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/learned"
         }
        ]
       },
       {
        "type": "Group",
        "label": "Money",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/totalSpent",
          "options": {
           "widget": "money",
           "widgetOptions": {
            "currency": "USD"
           }
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/budgetVsActual",
          "options": {
           "help": "Your project budget with a column for what you actually spent.",
           "widget": "fileRef"
          }
         }
        ]
       },
       {
        "type": "Group",
        "label": "Looking ahead",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/next"
         },
         {
          "type": "Control",
          "scope": "#/properties/feedback"
         }
        ]
       }
      ]
     },
     "mappingFromCommonGrants": {},
     "mappingToCommonGrants": {},
     "fieldMeta": {}
    }
   ],
   "rubrics": [],
   "emails": []
  }
 },
 {
  "id": "36000000-0000-7000-8000-000000000007",
  "slug": "award-letter-email",
  "kind": "email_template",
  "title": "Award letter email",
  "summary": "A warm award email with the amount, what happens next and a link to review and sign. Uses the merge fields the GMS fills in for every award.",
  "tags": {
   "fieldOfWork": [
    "Any field"
   ],
   "grantSize": [
    "Any size"
   ],
   "audience": [
    "Nonprofits",
    "Community groups",
    "Schools"
   ]
  },
  "snapshot": {
   "forms": [],
   "rubrics": [],
   "emails": [
    {
     "name": "Award letter",
     "subject": "Good news: {{funder.name}} is awarding {{award.amount}} for {{award.title}}",
     "body": "Hello {{recipient.name}},\n\nWe are delighted to tell you that {{funder.name}} is awarding **{{award.amount}}** for **{{award.title}}**.\n\nThank you for the care you put into your application. Our reviewers were moved by your work and by what you hope to achieve.\n\nWhat happens next:\n\n1. Review the award and its conditions.\n2. Sign the grant agreement.\n3. Once both sides have signed, we will schedule the first payment.\n\n[Review the award and sign]({{links.award}})\n\nIf anything in the award is unclear, or the timing does not work for you, reply to this email. We would much rather sort it out now.\n\nCongratulations, and thank you for the work you do.\n\n{{funder.name}}"
    }
   ]
  }
 },
 {
  "id": "36000000-0000-7000-8000-000000000008",
  "slug": "decline-email",
  "kind": "email_template",
  "title": "Decline email",
  "summary": "A kind, clear decline: thanks the applicant, says the decision is not a judgment of their work, keeps their application available and offers feedback.",
  "tags": {
   "fieldOfWork": [
    "Any field"
   ],
   "grantSize": [
    "Any size"
   ],
   "audience": [
    "Nonprofits",
    "Community groups",
    "Schools"
   ]
  },
  "snapshot": {
   "forms": [],
   "rubrics": [],
   "emails": [
    {
     "name": "Decline",
     "subject": "Your application to {{funder.name}}",
     "body": "Hello {{recipient.name}},\n\nThank you for applying to {{opportunity.title}} and for the time you gave to **{{application.title}}**.\n\nWe are sorry to tell you that {{funder.name}} is not able to fund it this time. We received many more strong applications than we could support, and this decision is not a judgment of the value of your work.\n\nYour application stays in your records, so you can reuse what you wrote: [View your application]({{links.status}})\n\nWe hope you will apply again. If you would like feedback on your application, reply to this email and we will do our best to help.\n\nWith thanks and best wishes,\n\n{{funder.name}}"
    }
   ]
  }
 },
 {
  "id": "36000000-0000-7000-8000-000000000009",
  "slug": "small-grants-program-kit",
  "kind": "program_kit",
  "title": "Small grants program kit",
  "summary": "Everything to run a first grant round: the common application, the five-criterion rubric, the final report, and the award and decline emails. Copy it and adjust what you need.",
  "tags": {
   "fieldOfWork": [
    "Any field"
   ],
   "grantSize": [
    "Under $10,000",
    "$10,000 to $50,000"
   ],
   "audience": [
    "Nonprofits",
    "Community groups",
    "Small organizations"
   ]
  },
  "snapshot": {
   "forms": [
    {
     "title": "Common application",
     "description": "A complete project application most funders can use as it is: the project, the need behind it, the plan, the budget and who will lead the work.",
     "instructions": "Thank you for applying. Answer in plain language, as you would explain your work to a neighbor. Short answers are fine: the word limits are a ceiling, not a target. You can save and come back at any time before you submit.",
     "purpose": "application",
     "jsonSchema": {
      "type": "object",
      "required": [
       "projectTitle",
       "summary",
       "need",
       "plan",
       "whoBenefits",
       "outcomes",
       "startDate",
       "endDate",
       "requestedAmount",
       "projectBudgetTotal",
       "budget",
       "mission",
       "leadership",
       "contactName",
       "contactEmail"
      ],
      "properties": {
       "projectTitle": {
        "type": "string",
        "title": "Project title",
        "maxLength": 200
       },
       "summary": {
        "type": "string",
        "title": "Project summary",
        "x-wordCount": {
         "max": 150
        }
       },
       "need": {
        "type": "string",
        "title": "The need",
        "x-wordCount": {
         "max": 300
        }
       },
       "plan": {
        "type": "string",
        "title": "What you will do",
        "x-wordCount": {
         "max": 300
        }
       },
       "whoBenefits": {
        "type": "string",
        "title": "Who will benefit",
        "x-wordCount": {
         "max": 200
        }
       },
       "outcomes": {
        "type": "string",
        "title": "What will change, and how you will know",
        "x-wordCount": {
         "max": 300
        }
       },
       "startDate": {
        "type": "string",
        "format": "date",
        "title": "Project start date"
       },
       "endDate": {
        "type": "string",
        "format": "date",
        "title": "Project end date"
       },
       "requestedAmount": {
        "type": "object",
        "title": "Amount requested"
       },
       "projectBudgetTotal": {
        "type": "object",
        "title": "Total project cost"
       },
       "otherFunding": {
        "type": "string",
        "title": "Other funding for this project",
        "x-wordCount": {
         "max": 150
        }
       },
       "budget": {
        "type": "object",
        "title": "Project budget"
       },
       "mission": {
        "type": "string",
        "title": "Your mission",
        "x-wordCount": {
         "max": 100
        }
       },
       "leadership": {
        "type": "string",
        "title": "Who will lead this work",
        "x-wordCount": {
         "max": 200
        }
       },
       "communityVoice": {
        "type": "string",
        "title": "How the people you serve shape this work",
        "x-wordCount": {
         "max": 200
        }
       },
       "contactName": {
        "type": "string",
        "title": "Contact name",
        "maxLength": 200
       },
       "contactEmail": {
        "type": "string",
        "format": "email",
        "title": "Contact email"
       },
       "contactPhone": {
        "type": "string",
        "title": "Contact phone"
       }
      }
     },
     "uiSchema": {
      "type": "VerticalLayout",
      "elements": [
       {
        "type": "Group",
        "label": "Your project",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/projectTitle",
          "options": {
           "help": "A short name we can use when we talk about your project."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/summary",
          "options": {
           "help": "In a few sentences: what you will do, for whom, and what will change."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/need",
          "options": {
           "help": "What problem or opportunity does this project respond to? Local facts or stories help more than national figures."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/plan",
          "options": {
           "help": "The main activities, in the order they will happen."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/whoBenefits",
          "options": {
           "help": "Who the project is for, roughly how many people, and where they live."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/outcomes",
          "options": {
           "help": "Two or three results you expect, and how you will track them. Simple measures are welcome."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/startDate"
         },
         {
          "type": "Control",
          "scope": "#/properties/endDate"
         }
        ]
       },
       {
        "type": "Group",
        "label": "Funding",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/requestedAmount",
          "options": {
           "widget": "money",
           "widgetOptions": {
            "currency": "USD"
           }
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/projectBudgetTotal",
          "options": {
           "help": "Include every source, not only this request.",
           "widget": "money",
           "widgetOptions": {
            "currency": "USD"
           }
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/otherFunding",
          "options": {
           "help": "Other grants, earned income or in-kind support, secured or pending."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/budget",
          "options": {
           "help": "Upload a one-page budget as a PDF or spreadsheet. Any clear format works.",
           "widget": "fileRef"
          }
         }
        ]
       },
       {
        "type": "Group",
        "label": "Your organization",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/mission"
         },
         {
          "type": "Control",
          "scope": "#/properties/leadership",
          "options": {
           "help": "The people responsible for the project and the experience they bring."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/communityVoice"
         }
        ]
       },
       {
        "type": "Group",
        "label": "Contact for this application",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/contactName",
          "options": {
           "help": "The person we should talk to about this request."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/contactEmail",
          "options": {
           "pii": true
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/contactPhone",
          "options": {
           "widget": "phone",
           "pii": true
          }
         }
        ]
       }
      ]
     },
     "mappingFromCommonGrants": {},
     "mappingToCommonGrants": {
      "title": {
       "field": "projectTitle"
      },
      "requestedAmount": {
       "field": "requestedAmount"
      }
     },
     "fieldMeta": {}
    },
    {
     "title": "Final report",
     "description": "The end-of-grant report: what was accomplished, results against the goals, what was learned and how the money was spent.",
     "instructions": "Thank you for the work this grant supported. Tell us what happened, including what did not go to plan: what you learned is as useful to us as what you achieved. Your answers from the application and any interim report are a good starting point.",
     "purpose": "report",
     "jsonSchema": {
      "type": "object",
      "required": [
       "accomplished",
       "goals",
       "learned",
       "totalSpent",
       "budgetVsActual",
       "next"
      ],
      "properties": {
       "accomplished": {
        "type": "string",
        "title": "What you accomplished",
        "x-wordCount": {
         "max": 300
        }
       },
       "goals": {
        "type": "string",
        "title": "How the results compare with your goals",
        "x-wordCount": {
         "max": 300
        }
       },
       "peopleServed": {
        "type": "integer",
        "minimum": 0,
        "title": "People served in all"
       },
       "story": {
        "type": "string",
        "title": "A story of change",
        "x-wordCount": {
         "max": 250
        }
       },
       "learned": {
        "type": "string",
        "title": "What you learned",
        "x-wordCount": {
         "max": 200
        }
       },
       "totalSpent": {
        "type": "object",
        "title": "Grant funds spent in all"
       },
       "budgetVsActual": {
        "type": "object",
        "title": "Budget compared with actual spending"
       },
       "next": {
        "type": "string",
        "title": "What happens next",
        "x-wordCount": {
         "max": 150
        }
       },
       "feedback": {
        "type": "string",
        "title": "How could we have been a better funder?",
        "x-wordCount": {
         "max": 150
        }
       }
      }
     },
     "uiSchema": {
      "type": "VerticalLayout",
      "elements": [
       {
        "type": "Group",
        "label": "Results",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/accomplished"
         },
         {
          "type": "Control",
          "scope": "#/properties/goals"
         },
         {
          "type": "Control",
          "scope": "#/properties/peopleServed",
          "options": {
           "help": "Leave it blank if counting people does not fit your work.",
           "outcome": true,
           "unit": "people served"
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/story",
          "options": {
           "help": "Optional: one person, family or place this work made a difference for. Share only what they agreed to share."
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/learned"
         }
        ]
       },
       {
        "type": "Group",
        "label": "Money",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/totalSpent",
          "options": {
           "widget": "money",
           "widgetOptions": {
            "currency": "USD"
           }
          }
         },
         {
          "type": "Control",
          "scope": "#/properties/budgetVsActual",
          "options": {
           "help": "Your project budget with a column for what you actually spent.",
           "widget": "fileRef"
          }
         }
        ]
       },
       {
        "type": "Group",
        "label": "Looking ahead",
        "elements": [
         {
          "type": "Control",
          "scope": "#/properties/next"
         },
         {
          "type": "Control",
          "scope": "#/properties/feedback"
         }
        ]
       }
      ]
     },
     "mappingFromCommonGrants": {},
     "mappingToCommonGrants": {},
     "fieldMeta": {}
    }
   ],
   "rubrics": [
    {
     "name": "Five-criterion rubric",
     "criteria": [
      {
       "key": "need",
       "label": "Need and fit",
       "weight": 1,
       "scale": {
        "type": "numeric",
        "min": 1,
        "max": 5
       },
       "description": "Is the need clear, and does the project fit this opportunity?",
       "guidance": "5: a clear, local need and a close fit. 3: the need is plausible and the fit is partial. 1: the need is unclear or outside what this opportunity funds."
      },
      {
       "key": "approach",
       "label": "Approach",
       "weight": 1,
       "scale": {
        "type": "numeric",
        "min": 1,
        "max": 5
       },
       "description": "Is the plan realistic and likely to work?",
       "guidance": "5: concrete steps, a sensible timeline, built on what has worked. 3: a reasonable plan with gaps. 1: the activities do not lead to the results described."
      },
      {
       "key": "capacity",
       "label": "Capacity",
       "weight": 1,
       "scale": {
        "type": "numeric",
        "min": 1,
        "max": 5
       },
       "description": "Can the organization do what it proposes?",
       "guidance": "5: experienced people and the systems to deliver. 3: some experience, some risk. 1: no clear way to deliver. Small organizations are not scored down for being small."
      },
      {
       "key": "budget",
       "label": "Budget",
       "weight": 1,
       "scale": {
        "type": "numeric",
        "min": 1,
        "max": 5
       },
       "description": "Is the budget reasonable and tied to the plan?",
       "guidance": "5: every cost follows from the plan and the amounts are realistic. 3: mostly reasonable, some questions. 1: the budget does not match the plan."
      },
      {
       "key": "impact",
       "label": "Community impact",
       "weight": 1,
       "scale": {
        "type": "numeric",
        "min": 1,
        "max": 5
       },
       "description": "Will the project make a real difference for the people it serves?",
       "guidance": "5: meaningful change for people who need it most, shaped with them. 3: some benefit. 1: little lasting difference."
      }
     ],
     "overall": {
      "recommendations": [
       "Fund",
       "Fund with conditions",
       "Do not fund"
      ]
     }
    }
   ],
   "emails": [
    {
     "name": "Award letter",
     "subject": "Good news: {{funder.name}} is awarding {{award.amount}} for {{award.title}}",
     "body": "Hello {{recipient.name}},\n\nWe are delighted to tell you that {{funder.name}} is awarding **{{award.amount}}** for **{{award.title}}**.\n\nThank you for the care you put into your application. Our reviewers were moved by your work and by what you hope to achieve.\n\nWhat happens next:\n\n1. Review the award and its conditions.\n2. Sign the grant agreement.\n3. Once both sides have signed, we will schedule the first payment.\n\n[Review the award and sign]({{links.award}})\n\nIf anything in the award is unclear, or the timing does not work for you, reply to this email. We would much rather sort it out now.\n\nCongratulations, and thank you for the work you do.\n\n{{funder.name}}"
    },
    {
     "name": "Decline",
     "subject": "Your application to {{funder.name}}",
     "body": "Hello {{recipient.name}},\n\nThank you for applying to {{opportunity.title}} and for the time you gave to **{{application.title}}**.\n\nWe are sorry to tell you that {{funder.name}} is not able to fund it this time. We received many more strong applications than we could support, and this decision is not a judgment of the value of your work.\n\nYour application stays in your records, so you can reuse what you wrote: [View your application]({{links.status}})\n\nWe hope you will apply again. If you would like feedback on your application, reply to this email and we will do our best to help.\n\nWith thanks and best wishes,\n\n{{funder.name}}"
    }
   ]
  }
 }
]
$starters$::jsonb) as s(id uuid, slug text, kind text, title text, summary text, tags jsonb, snapshot jsonb)
on conflict do nothing;
-- starters:end
