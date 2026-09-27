-- SPDX-License-Identifier: AGPL-3.0-only
-- Blind review hides identifying answers even when the form author didn't flag them.
--
-- Before: gms.reviewer_submission removed only fields flagged `blind` in the form. EINs, contact details,
-- attestation signatures and attachment file names still reached blind reviewers.
-- Now a field is hidden on a blind stage when it is flagged `blind`, OR its type identifies someone
-- (name, address, email, phone, ein, uei, attestation), OR it maps to an identifying CommonGrants path.
-- Attachments stay available but their file names are replaced with neutral ones.
-- The same rule lives in packages/forms/src/blind.ts (hiddenInBlindReview) for the renderer's labels.

create or replace function gms_private.blind_hidden(meta jsonb) returns boolean
language sql immutable as $$
  select coalesce((meta ->> 'blind')::boolean, false)
      or coalesce(meta ->> 'type', '') in ('name', 'address', 'email', 'phone', 'ein', 'uei', 'attestation')
      or coalesce(meta ->> 'cgMapping', '') in (
        'organization.name', 'organization.ein', 'organization.uei', 'organization.address', 'organization.website',
        'organization.phone', 'organization.email', 'organization.fiscalSponsor.name',
        'contact.name', 'contact.email', 'contact.phone')
$$;

-- Replaces the `name` of each file reference under the given top-level keys ("Attachment 1.pdf", …).
create or replace function gms_private.blind_file_names(doc jsonb, file_keys text[]) returns jsonb
language plpgsql immutable as $$
declare
  k text;
  v jsonb;
  out jsonb := doc;
  renamed jsonb;
  i int;
  ext text;
begin
  if doc is null or file_keys is null then
    return doc;
  end if;
  foreach k in array file_keys loop
    v := out -> k;
    if v is null then
      continue;
    end if;
    if jsonb_typeof(v) = 'object' then
      v := jsonb_build_array(v);
    end if;
    if jsonb_typeof(v) <> 'array' then
      continue;
    end if;
    renamed := '[]'::jsonb;
    for i in 0 .. jsonb_array_length(v) - 1 loop
      ext := substring(coalesce(v -> i ->> 'name', '') from '(\.[A-Za-z0-9]{1,8})$');
      renamed := renamed || jsonb_build_array(
        case when jsonb_typeof(v -> i) = 'object'
          then (v -> i) || jsonb_build_object('name', 'Attachment ' || (i + 1) || coalesce(ext, ''))
          else v -> i end);
    end loop;
    out := jsonb_set(out, array[k], case when jsonb_typeof(doc -> k) = 'object' then renamed -> 0 else renamed end);
  end loop;
  return out;
end
$$;

create or replace function gms.reviewer_submission(app uuid)
returns table (application_id uuid, submitted_at timestamptz, responses jsonb, org_profile jsonb, blind boolean)
language sql stable security definer set search_path = '' as $$
  with a as (
    select ra.application_id, bool_or(rs.blind) as blind
    from public.review_assignments ra
    join public.review_stages rs on rs.id = ra.stage_id
    join public.coi_declarations d on d.assignment_id = ra.id
    where ra.application_id = app and ra.reviewer_id = gms.uid() and ra.status <> 'recused' and d.has_conflict = false
    group by ra.application_id
  ), s as (
    select sub.* from public.application_submissions sub
    where sub.application_id = app
    order by sub.submitted_at desc limit 1
  ), meta as (
    select fm.key, fm.meta
    from s, jsonb_array_elements(s.form_versions) fv,
      public.form_versions v,
      jsonb_each(v.field_meta) fm(key, meta)
    where v.id = (fv ->> 'formVersionId')::uuid
  ), blind_paths as (
    select array_agg(distinct key) filter (where gms_private.blind_hidden(meta)) as paths,
           array_agg(distinct key) filter (where meta ->> 'type' = 'file_upload') as files
    from meta
  )
  select s.application_id, s.submitted_at,
    case when a.blind then (
      select jsonb_object_agg(
        r.key,
        gms_private.blind_file_names(
          gms_private.mask_blind(r.value, (select paths from blind_paths)),
          (select files from blind_paths)))
      from jsonb_each(s.responses) r
    ) else s.responses end,
    case when a.blind then '{}'::jsonb else s.org_profile end,
    a.blind
  from a join s on s.application_id = a.application_id
$$;
grant execute on function gms.reviewer_submission(uuid) to gms_authenticated;
revoke all on function gms_private.blind_hidden(jsonb) from public;
revoke all on function gms_private.blind_file_names(jsonb, text[]) from public;
