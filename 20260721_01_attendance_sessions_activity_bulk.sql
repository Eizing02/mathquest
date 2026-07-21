-- Attendance session identity, activity status, and transactional bulk editing.
-- Run this migration before deploying the matching frontend.

begin;

alter table public.attendance_logs
  add column if not exists session_id text;

create index if not exists attendance_logs_session_id_idx
  on public.attendance_logs(session_id)
  where session_id is not null;

alter table public.attendance_logs
  drop constraint if exists attendance_logs_status_check;

alter table public.attendance_logs
  add constraint attendance_logs_status_check
  check (status in ('มา', 'ขาด', 'ลา', 'กิจกรรม'));

insert into public.system_settings (key, value)
values ('active_session_id', '')
on conflict (key) do nothing;

create or replace function public.cancel_attendance_session(p_session_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_active_session_id text;
  v_deleted_count integer := 0;
begin
  if nullif(btrim(p_session_id), '') is null then
    raise exception 'session_id is required';
  end if;

  select value
    into v_active_session_id
    from public.system_settings
   where key = 'active_session_id'
   for update;

  if coalesce(v_active_session_id, '') <> p_session_id then
    raise exception 'The session is no longer active';
  end if;

  delete from public.attendance_logs
   where session_id = p_session_id;
  get diagnostics v_deleted_count = row_count;

  update public.system_settings
     set value = ''
   where key in ('pin', 'pin_expiry', 'current_grade', 'session_start', 'active_session_id');

  return jsonb_build_object(
    'session_id', p_session_id,
    'deleted_count', v_deleted_count
  );
end;
$$;

create or replace function public.bulk_set_attendance(
  p_student_ids text[],
  p_dates date[],
  p_status text,
  p_points integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_student_id text;
  v_date date;
  v_student_count integer;
  v_date_count integer;
  v_existing_count integer;
  v_inserted_count integer := 0;
  v_updated_count integer := 0;
  v_duplicate_count integer := 0;
  v_new_points integer;
begin
  if p_status not in ('มา', 'ขาด', 'ลา', 'กิจกรรม') then
    raise exception 'Invalid attendance status';
  end if;

  if p_status <> 'มา' and p_points is not null then
    raise exception 'Points can only be specified for present attendance';
  end if;

  if p_points is not null and p_points not in (0, 3, 5) then
    raise exception 'Points must be 0, 3, 5, or null';
  end if;

  select count(distinct student_id)
    into v_student_count
    from unnest(coalesce(p_student_ids, array[]::text[])) as ids(student_id)
   where nullif(btrim(student_id), '') is not null;

  select count(distinct attendance_date)
    into v_date_count
    from unnest(coalesce(p_dates, array[]::date[])) as dates(attendance_date)
   where attendance_date is not null;

  if v_student_count = 0 or v_date_count = 0 then
    raise exception 'At least one student and one date are required';
  end if;

  if v_student_count * v_date_count > 5000 then
    raise exception 'A bulk edit cannot exceed 5000 student-date pairs';
  end if;

  if (
    select count(distinct s.id)
      from public.students s
     where s.id = any(p_student_ids)
       and s.role = 'STUDENT'
  ) <> v_student_count then
    raise exception 'One or more student IDs are invalid';
  end if;

  for v_student_id in
    select distinct btrim(student_id)
      from unnest(p_student_ids) as ids(student_id)
     where nullif(btrim(student_id), '') is not null
     order by 1
  loop
    for v_date in
      select distinct attendance_date
        from unnest(p_dates) as dates(attendance_date)
       where attendance_date is not null
       order by 1
    loop
      select count(*)
        into v_existing_count
        from public.attendance_logs
       where student_id = v_student_id
         and (timestamp at time zone 'Asia/Bangkok')::date = v_date;

      if v_existing_count > 0 then
        if p_status = 'มา' and p_points is null then
          update public.attendance_logs
             set status = 'มา'
           where student_id = v_student_id
             and (timestamp at time zone 'Asia/Bangkok')::date = v_date;
        else
          v_new_points := case when p_status = 'มา' then p_points else 0 end;
          update public.attendance_logs
             set status = p_status,
                 points = v_new_points
           where student_id = v_student_id
             and (timestamp at time zone 'Asia/Bangkok')::date = v_date;
        end if;

        v_updated_count := v_updated_count + 1;
        v_duplicate_count := v_duplicate_count + greatest(v_existing_count - 1, 0);
      else
        v_new_points := case
          when p_status = 'มา' and p_points is not null then p_points
          else 0
        end;

        insert into public.attendance_logs (
          timestamp,
          student_id,
          status,
          points,
          session_id
        ) values (
          (v_date::timestamp + time '12:00') at time zone 'Asia/Bangkok',
          v_student_id,
          p_status,
          v_new_points,
          null
        );

        v_inserted_count := v_inserted_count + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'student_count', v_student_count,
    'date_count', v_date_count,
    'inserted_count', v_inserted_count,
    'updated_count', v_updated_count,
    'duplicate_count', v_duplicate_count
  );
end;
$$;

grant execute on function public.cancel_attendance_session(text) to anon, authenticated;
grant execute on function public.bulk_set_attendance(text[], date[], text, integer) to anon, authenticated;

commit;
