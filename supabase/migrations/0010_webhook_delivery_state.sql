-- 0010_webhook_delivery_state: the delivery worker needs to tell a delivery that is waiting for its
-- first attempt from one that failed and is waiting to retry, and from one that ran out of
-- attempts; and operators need the reason the last attempt failed. `attempt` becomes the number of
-- attempts made so far, so a delivery that has not been tried yet is 0.

alter table public.webhook_deliveries
  add column status text not null default 'pending'
    check (status in ('pending', 'delivered', 'failed', 'exhausted')),
  add column last_error text check (last_error is null or length(last_error) <= 500);

alter table public.webhook_deliveries drop constraint webhook_deliveries_attempt_check;
alter table public.webhook_deliveries alter column attempt set default 0;
alter table public.webhook_deliveries add constraint webhook_deliveries_attempt_check check (attempt >= 0);

comment on column public.webhook_deliveries.attempt is 'Attempts made so far (0 before the first).';
comment on column public.webhook_deliveries.status is 'pending | delivered | failed (will retry at next_attempt_at) | exhausted (no more retries).';
comment on column public.webhook_deliveries.last_error is 'Why the last attempt failed: a short reason, never a response body.';

-- Rows written before this migration: derive the state from what was recorded.
update public.webhook_deliveries
   set status = case when delivered_at is not null then 'delivered'
                     when next_attempt_at is null then 'exhausted'
                     when status_code is not null then 'failed'
                     else 'pending' end;

drop index if exists public.webhook_deliveries_undelivered_idx;
create index webhook_deliveries_due_idx on public.webhook_deliveries (next_attempt_at) where status in ('pending', 'failed');
