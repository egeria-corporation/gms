-- 0019_passport_access_token.sql
-- Keep the Passport access token with the consent it belongs to.
--
-- The API runs as many short-lived workers. Each used to start with no access token and spend the
-- link's refresh token to get one: about sixty refreshes in seventeen minutes for a single link on
-- the hosted site (2026-11-11), which only held together because Passport forgives a refresh token
-- presented twice within seconds. From here on a worker reads the stored access token and
-- refreshes only when it is about to expire.
--
-- access_token_enc is AES-GCM ciphertext under CREDENTIALS_ENCRYPTION_KEY, like refresh_token_enc
-- beside it, and is no more sensitive: it expires in minutes and the refresh token can mint one.
-- token_version counts writes of the token columns. A worker stores new tokens only if the
-- version is still the one it read, so two workers refreshing at once cannot overwrite each other
-- and no ciphertext has to appear in a query filter.

alter table public.passport_links
  add column access_token_enc        text,
  add column access_token_expires_at timestamptz,
  add column token_version           integer not null default 0,
  add constraint passport_links_access_token_pair check ((access_token_enc is null) = (access_token_expires_at is null));

comment on column public.passport_links.access_token_enc is 'AES-GCM ciphertext of the current Passport access token for an applicant consent; null when none is stored.';
comment on column public.passport_links.token_version is 'Incremented on every write of the token columns; the compare-and-swap key for concurrent refreshes.';
