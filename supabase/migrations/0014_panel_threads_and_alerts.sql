-- Panel discussion notes live in an internal thread on the competition, and funding alerts are
-- saved searches. Both reuse existing tables; only the allowed values widen.
alter table public.threads drop constraint if exists threads_subject_type_check;
alter table public.threads add constraint threads_subject_type_check check (subject_type in ('application', 'award', 'requirement', 'competition'));

alter table public.discover_saved drop constraint if exists discover_saved_source_check;
alter table public.discover_saved add constraint discover_saved_source_check check (source in ('gms', 'opengrants', 'alert'));
