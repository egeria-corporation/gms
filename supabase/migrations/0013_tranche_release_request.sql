-- What a facilitated release asked Passport for, kept so an unconfirmed release can be reconciled.
--
-- Passport replays a disbursement only when the same Idempotency-Key arrives with the same
-- request. A tranche stuck in `releasing` (Passport did not answer, or the Worker stopped between
-- the two writes) is resolved by repeating exactly that request, so the parts of it that are not
-- already on the tranche are stored here: the rail and the payee credential id and version.
-- No bank data: a credential id and a version number identify nothing outside Passport.
alter table public.tranches add column release_request jsonb;

comment on column public.tranches.release_request is 'Rail and payee credential id/version sent with the facilitated release; used to repeat the identical request under the same Idempotency-Key. Never bank data.';
