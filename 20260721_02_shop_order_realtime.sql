begin;

-- Keep pending-order badge refreshes fast as redemption history grows.
create index if not exists redemption_logs_pending_timestamp_idx
  on public.redemption_logs(timestamp desc)
  where status = 'pending';

-- Supabase Realtime only emits Postgres changes for tables in this publication.
do $migration$
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'Supabase Realtime publication was not found';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'redemption_logs'
  ) then
    alter publication supabase_realtime add table public.redemption_logs;
  end if;
end
$migration$;

commit;
