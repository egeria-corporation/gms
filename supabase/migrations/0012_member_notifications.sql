-- 0012_member_notifications: per-member notification state. No new tables.
--
-- Notifications are not stored: they are derived from the ledger and from application events when
-- a member asks for them. What is stored is the member's own state: which ones they have read, and
-- which categories they want in the app and by email.

alter table public.workspace_members
  add column notification_preferences jsonb not null default '{}'::jsonb,
  add column notifications_read_at timestamptz,
  add column notifications_read_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(notifications_read_ids) = 'array' and jsonb_array_length(notifications_read_ids) <= 500);

comment on column public.workspace_members.notification_preferences is '{ digest, channels: { <category>: { inApp, email } } }. Missing categories are on.';
comment on column public.workspace_members.notifications_read_at is 'Everything at or before this time is read ("mark all read").';
comment on column public.workspace_members.notifications_read_ids is 'Ids of notifications read one by one since notifications_read_at (newest 500).';
