-- MathQuest: optional pet-themed profile frames. Run AFTER the Google login migration.
-- Installs preferences only; does not change photos, pets, points, attendance or scores.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$ begin
  perform pg_advisory_xact_lock(6101001);
  if to_regprocedure('mathquest_private.google_write_student(text)') is null then
    raise exception 'Install 20261015_01_google_login_student_links.sql first';
  end if;
end $$;

create table if not exists mathquest_private.student_profile_style (
  student_id text primary key references public.students(id) on update cascade on delete cascade,
  frame_enabled boolean not null default true,
  motion_enabled boolean not null default true,
  revision uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table mathquest_private.student_profile_style enable row level security;
revoke all on mathquest_private.student_profile_style from public, anon, authenticated, service_role;

create or replace function public.mq_student_profile_style(
  p_action text, p_frame_enabled boolean default null, p_motion_enabled boolean default null,
  p_expected_version text default null, p_link_version text default null, p_revision uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text; v_link text; v_style mathquest_private.student_profile_style%rowtype;
begin
  if p_action not in ('read','save') or p_action is null then raise exception 'INVALID_ACTION'; end if;
  -- Same lock order as student identity switches and the existing term reset.
  v_id := mathquest_private.google_write_student(p_expected_version);
  select updated_at::text into v_link from mathquest_private.google_student_links
    where auth_user_id=mathquest_private.google_uid();
  if v_link is distinct from p_link_version then raise exception 'LINK_STATE_CHANGED'; end if;
  select * into v_style from mathquest_private.student_profile_style where student_id=v_id for update;
  if p_action='save' then
    if p_frame_enabled is null or p_motion_enabled is null then raise exception 'INVALID_STYLE'; end if;
    if v_style.revision is distinct from p_revision then
      return jsonb_build_object('status','conflict','frameEnabled',coalesce(v_style.frame_enabled,true),
        'motionEnabled',coalesce(v_style.motion_enabled,true),'revision',v_style.revision);
    end if;
    if not mathquest_private.consume_google_limit('profile_style',30,300) then
      return jsonb_build_object('status','fail','code','RATE_LIMITED');
    end if;
    insert into mathquest_private.student_profile_style(student_id,frame_enabled,motion_enabled)
      values(v_id,p_frame_enabled,p_motion_enabled)
    on conflict(student_id) do update set frame_enabled=excluded.frame_enabled,
      motion_enabled=excluded.motion_enabled,revision=gen_random_uuid(),updated_at=clock_timestamp()
    returning * into v_style;
  end if;
  return jsonb_build_object('status','success','frameEnabled',coalesce(v_style.frame_enabled,true),
    'motionEnabled',coalesce(v_style.motion_enabled,true),'revision',v_style.revision);
end $$;
revoke all on function public.mq_student_profile_style(text,boolean,boolean,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.mq_student_profile_style(text,boolean,boolean,text,text,uuid) to authenticated;

-- The existing reset advances this version in its transaction. Clear cosmetics in that same transaction.
create or replace function mathquest_private.reset_student_profile_style()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.key='school_data_version' and old.value is distinct from new.value then
    delete from mathquest_private.student_profile_style where student_id is not null;
  end if;
  return new;
end $$;
revoke all on function mathquest_private.reset_student_profile_style() from public,anon,authenticated,service_role;
drop trigger if exists mq_reset_student_profile_style on public.system_settings;
create trigger mq_reset_student_profile_style after update on public.system_settings
  for each row when (new.key='school_data_version')
  execute function mathquest_private.reset_student_profile_style();

notify pgrst, 'reload schema';
commit;
