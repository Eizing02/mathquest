begin;

create table if not exists public.student_free_item_notification_state (
  student_id             text        primary key references public.students(id) on delete cascade,
  last_seen_redemption_id bigint      not null default 0 check (last_seen_redemption_id >= 0),
  seen_at                timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists set_student_free_item_notification_state_updated_at
  on public.student_free_item_notification_state;
create trigger set_student_free_item_notification_state_updated_at
  before update on public.student_free_item_notification_state
  for each row execute function public.set_current_timestamp_updated_at();

create or replace function public.initialize_student_free_item_notification_state()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.role = 'STUDENT' then
    insert into public.student_free_item_notification_state (
      student_id,
      last_seen_redemption_id
    )
    select new.id, coalesce(max(id), 0)::bigint
    from public.redemption_logs
    on conflict (student_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists initialize_student_free_item_notification_state
  on public.students;
create trigger initialize_student_free_item_notification_state
  after insert or update of role on public.students
  for each row execute function public.initialize_student_free_item_notification_state();

alter table public.student_free_item_notification_state enable row level security;

drop policy if exists "student_free_item_notification_state_public_all"
  on public.student_free_item_notification_state;
create policy "student_free_item_notification_state_public_all"
  on public.student_free_item_notification_state
  for all to public using (true) with check (true);

grant select, insert, update on table public.student_free_item_notification_state
  to anon, authenticated;

-- Existing students start with only their latest free-grant group unread.
with current_max as (
  select coalesce(max(id), 0)::bigint as max_id
  from public.redemption_logs
),
latest_grant as (
  select distinct on (student_id)
    student_id,
    timestamp,
    item_id,
    item_name
  from public.redemption_logs
  where points_used = 0
    and status = 'approved'
  order by student_id, timestamp desc, id desc
),
latest_group as (
  select
    latest_grant.student_id,
    min(redemption_logs.id)::bigint as first_id
  from latest_grant
  join public.redemption_logs
    on redemption_logs.student_id = latest_grant.student_id
   and redemption_logs.timestamp = latest_grant.timestamp
   and redemption_logs.item_id is not distinct from latest_grant.item_id
   and redemption_logs.item_name = latest_grant.item_name
   and redemption_logs.points_used = 0
   and redemption_logs.status = 'approved'
  group by latest_grant.student_id
)
insert into public.student_free_item_notification_state (
  student_id,
  last_seen_redemption_id
)
select
  students.id,
  case
    when latest_group.first_id is null then current_max.max_id
    else greatest(latest_group.first_id - 1, 0)
  end
from public.students
cross join current_max
left join latest_group on latest_group.student_id = students.id
where students.role = 'STUDENT'
on conflict (student_id) do nothing;

create or replace function public.mark_student_free_item_notifications_seen(
  p_student_id text,
  p_last_seen_redemption_id bigint
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_last_seen bigint;
begin
  if nullif(trim(p_student_id), '') is null then
    raise exception 'student_id is required';
  end if;

  if coalesce(p_last_seen_redemption_id, 0) < 0 then
    raise exception 'last_seen_redemption_id must be zero or greater';
  end if;

  insert into public.student_free_item_notification_state as notification_state (
    student_id,
    last_seen_redemption_id,
    seen_at
  )
  values (
    trim(p_student_id),
    coalesce(p_last_seen_redemption_id, 0),
    now()
  )
  on conflict (student_id) do update
  set
    last_seen_redemption_id = greatest(
      notification_state.last_seen_redemption_id,
      excluded.last_seen_redemption_id
    ),
    seen_at = now()
  returning last_seen_redemption_id into v_last_seen;

  return v_last_seen;
end;
$$;

grant execute on function public.mark_student_free_item_notifications_seen(text, bigint)
  to anon, authenticated;

commit;
