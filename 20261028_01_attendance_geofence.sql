-- MathQuest: mandatory student PIN + location check-in. Install BEFORE the frontend.
-- Run this NEW migration in MathQuest, not ScanSob, with no attendance session open.
-- Does not reset progress or change scoring. Existing attendance rows stay untouched.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $$ begin perform pg_advisory_xact_lock(6101001); end $$;

do $$ begin
  if to_regprocedure('mathquest_private.google_write_student(text)') is null then
    raise exception 'Install the MathQuest Google login migration first';
  end if;
  if exists(select 1 from public.system_settings where key='pin' and coalesce(value,'')<>'') then
    raise exception 'Close or cancel the open attendance session before installing the GPS migration';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='attendance_logs'
    and cmd in ('ALL','INSERT','UPDATE','DELETE') and policyname<>'mq_google_progress_teacher_write') then
    raise exception 'Review custom attendance write policies before enforcing GPS; no permissions were changed';
  end if;
  if exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    where e.extname='postgis' and n.nspname<>'extensions') then
    raise exception 'PostGIS already exists outside extensions; review its installation before continuing';
  end if;
end $$;
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table if not exists mathquest_private.attendance_geofence (
  singleton boolean primary key default true check(singleton),
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  radius_m integer not null check(radius_m between 1 and 1000),
  max_accuracy_m integer not null check(max_accuracy_m between 1 and 50),
  version uuid not null default gen_random_uuid()
);
insert into mathquest_private.attendance_geofence(singleton,latitude,longitude,radius_m,max_accuracy_m)
  values(true,17.131333,102.103092,100,50) on conflict(singleton) do nothing;
alter table public.attendance_logs enable row level security;

create or replace function mathquest_private.attendance_location_policy_version()
returns trigger language plpgsql set search_path='' as $$ begin
  if (new.latitude,new.longitude,new.radius_m,new.max_accuracy_m)
    is distinct from (old.latitude,old.longitude,old.radius_m,old.max_accuracy_m) then new.version:=gen_random_uuid(); end if;
  return new;
end $$;
drop trigger if exists attendance_location_policy_version on mathquest_private.attendance_geofence;
create trigger attendance_location_policy_version before update on mathquest_private.attendance_geofence
  for each row execute function mathquest_private.attendance_location_policy_version();

create table if not exists mathquest_private.attendance_location_requests (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id text not null,
  student_id text not null references public.students(id) on update cascade on delete cascade,
  link_version timestamptz not null,
  session_id text not null, data_version text not null, policy_version uuid not null,
  requested_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '60 seconds',
  attendance_log_id bigint references public.attendance_logs(id) on delete cascade,
  receipt jsonb
);
create index if not exists attendance_location_request_expiry on mathquest_private.attendance_location_requests(expires_at);
create index if not exists attendance_location_request_log on mathquest_private.attendance_location_requests(attendance_log_id);
create index if not exists attendance_location_request_unused on mathquest_private.attendance_location_requests(auth_user_id) where receipt is null;
create table if not exists mathquest_private.attendance_location_checks (
  attendance_log_id bigint primary key references public.attendance_logs(id) on delete cascade,
  method text not null check(method in ('location','teacher')),
  distance_m double precision, accuracy_m double precision,
  checked_at timestamptz not null default clock_timestamp(), policy_version uuid,
  teacher_auth_id uuid,
  check((method='teacher' and distance_m is null and accuracy_m is null) or
    (method='location' and distance_m>=0 and distance_m<'Infinity'::float8
      and accuracy_m>0 and accuracy_m<'Infinity'::float8 and policy_version is not null))
);
alter table mathquest_private.attendance_geofence enable row level security;
alter table mathquest_private.attendance_location_requests enable row level security;
alter table mathquest_private.attendance_location_checks enable row level security;
revoke all on mathquest_private.attendance_geofence,mathquest_private.attendance_location_requests,
  mathquest_private.attendance_location_checks from public,anon,authenticated,service_role;

-- Preserve the installed game rules, but retire every public no-location call.
do $$ begin
  if to_regprocedure('mathquest_private.attendance_check_in_core(text,text)') is null then
    alter function public.mq_student_check_in(text,text) set schema mathquest_private;
    alter function mathquest_private.mq_student_check_in(text,text) rename to attendance_check_in_core;
  end if;
end $$;
revoke all on function mathquest_private.attendance_check_in_core(text,text) from public,anon,authenticated,service_role;
create or replace function public.mq_student_check_in(p_pin text,p_expected_version text)
returns jsonb language sql set search_path='' as $$
  select jsonb_build_object('result','error','code','LOCATION_REQUIRED','msg','กรุณาโหลดหน้าเว็บใหม่ แล้วอนุญาตตำแหน่งเพื่อเช็คชื่อ');
$$;

create or replace function public.mq_prepare_location_check_in(p_pin text,p_expected_version text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  student text:=mathquest_private.google_write_student(p_expected_version);
  cfg mathquest_private.attendance_geofence%rowtype;
  req mathquest_private.attendance_location_requests%rowtype;
  settings jsonb; grade text; link timestamptz;
begin
  if not mathquest_private.consume_google_limit('location_prepare',15,300) then
    return jsonb_build_object('result','error','code','LOCATION_RATE_LIMIT'); end if;
  -- Shared setting locks serialize against teacher close/cancel/open, through commit.
  perform 1 from public.system_settings where key in ('pin','pin_expiry','current_grade','session_start','active_session_id') order by key for share;
  select jsonb_object_agg(key,value) into settings from public.system_settings
    where key in ('pin','pin_expiry','current_grade','session_start','active_session_id');
  if coalesce(settings->>'pin','')='' or coalesce(settings->>'active_session_id','')='' then
    return jsonb_build_object('result','error','code','LOCATION_NO_SESSION'); end if;
  if coalesce(btrim(p_pin),'')<>settings->>'pin' then
    return jsonb_build_object('result','error','code','LOCATION_WRONG_PIN'); end if;
  if coalesce(nullif(settings->>'pin_expiry','')::timestamptz, '-infinity')<clock_timestamp() then
    return jsonb_build_object('result','error','code','LOCATION_PIN_EXPIRED'); end if;
  select s.grade,l.updated_at into grade,link from public.students s
    join mathquest_private.google_student_links l on l.student_id=s.id
    where s.id=student and l.auth_user_id=mathquest_private.google_uid();
  if grade is null or coalesce(settings->>'current_grade','')='' or
    (grade<>settings->>'current_grade' and grade not like (settings->>'current_grade')||'/%') then
    return jsonb_build_object('result','error','code','LOCATION_WRONG_CLASS'); end if;
  select * into cfg from mathquest_private.attendance_geofence where singleton for share;
  if cfg.singleton is null then return jsonb_build_object('result','error','code','LOCATION_NOT_CONFIGURED'); end if;
  delete from mathquest_private.attendance_location_requests where expires_at<clock_timestamp()-interval '1 day';
  -- Keep at most one unused request for this identity; completed receipts remain replayable.
  delete from mathquest_private.attendance_location_requests where auth_user_id=mathquest_private.google_uid() and receipt is null;
  insert into mathquest_private.attendance_location_requests(auth_user_id,auth_session_id,student_id,link_version,session_id,data_version,policy_version)
    values(mathquest_private.google_uid(),auth.jwt()->>'session_id',student,link,settings->>'active_session_id',p_expected_version,cfg.version) returning * into req;
  return jsonb_build_object('result','ready','request_id',req.id,'expires_at',req.expires_at,
    'latitude',cfg.latitude,'longitude',cfg.longitude,'radius_m',cfg.radius_m,'max_accuracy_m',cfg.max_accuracy_m);
end $$;

create or replace function public.mq_student_check_in_at_location(p_request_id uuid,p_pin text,p_expected_version text,
  p_latitude double precision,p_longitude double precision,p_accuracy double precision,p_fix_age_ms double precision)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  student text:=mathquest_private.google_write_student(p_expected_version);
  req mathquest_private.attendance_location_requests%rowtype;
  cfg mathquest_private.attendance_geofence%rowtype;
  link timestamptz; active text; distance double precision; result jsonb; log_id bigint;
begin
  -- Match preparation/close order: setting rows BEFORE request rows. Otherwise a
  -- close trigger deleting a pending request can deadlock against its commit.
  perform 1 from public.system_settings where key in ('pin','pin_expiry','current_grade','session_start','active_session_id') order by key for share;
  select updated_at into link from mathquest_private.google_student_links where auth_user_id=mathquest_private.google_uid();
  select * into req from mathquest_private.attendance_location_requests where id=p_request_id for update;
  if req.id is null or req.auth_user_id<>mathquest_private.google_uid() or req.student_id<>student
    or req.auth_session_id is distinct from auth.jwt()->>'session_id' or req.link_version is distinct from link
    or req.data_version is distinct from p_expected_version then
    return jsonb_build_object('result','error','code','LOCATION_REQUEST_INVALID'); end if;
  if req.receipt is not null then return req.receipt; end if;
  if not mathquest_private.consume_google_limit('location_submit',30,300) then
    return jsonb_build_object('result','error','code','LOCATION_RATE_LIMIT'); end if;
  if req.expires_at<clock_timestamp() then return jsonb_build_object('result','error','code','LOCATION_REQUEST_EXPIRED'); end if;
  select value into active from public.system_settings where key='active_session_id';
  if active is distinct from req.session_id then return jsonb_build_object('result','error','code','LOCATION_SESSION_CHANGED'); end if;
  select * into cfg from mathquest_private.attendance_geofence where singleton for share;
  if cfg.version is distinct from req.policy_version then return jsonb_build_object('result','error','code','LOCATION_REQUEST_EXPIRED'); end if;
  if p_latitude is null or not(p_latitude between -90 and 90) or p_longitude is null or not(p_longitude between -180 and 180)
    or p_accuracy is null or not(p_accuracy>0 and p_accuracy<'Infinity'::float8)
    or p_fix_age_ms is null or not(p_fix_age_ms between 0 and 15000) then
    return jsonb_build_object('result','error','code','LOCATION_INVALID'); end if;
  if p_accuracy>cfg.max_accuracy_m then return jsonb_build_object('result','error','code','LOCATION_INACCURATE','accuracy_m',p_accuracy); end if;
  distance:=extensions.st_distance(
    extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography,
    extensions.st_setsrid(extensions.st_makepoint(cfg.longitude,cfg.latitude),4326)::extensions.geography);
  if distance>cfg.radius_m then
    return jsonb_build_object('result','error','code','LOCATION_OUTSIDE','distance_m',distance,'accuracy_m',p_accuracy); end if;
  if distance+p_accuracy>cfg.radius_m then
    return jsonb_build_object('result','error','code','LOCATION_UNCERTAIN','distance_m',distance,'accuracy_m',p_accuracy); end if;
  result:=mathquest_private.attendance_check_in_core(p_pin,p_expected_version);
  if result->>'result'='success' then
    select id into log_id from public.attendance_logs where student_id=student and session_id=req.session_id order by id desc limit 1;
    if log_id is null then raise exception 'LOCATION_ATTENDANCE_NOT_FOUND'; end if;
    insert into mathquest_private.attendance_location_checks(attendance_log_id,method,distance_m,accuracy_m,policy_version)
      values(log_id,'location',distance,p_accuracy,cfg.version);
    result:=result||jsonb_build_object('distance_m',distance,'accuracy_m',p_accuracy,'check_method','location');
  end if;
  if result->>'result' in ('success','duplicate') then
    update mathquest_private.attendance_location_requests set receipt=result,attendance_log_id=log_id where id=req.id;
  end if;
  return result;
end $$;

-- Teacher edits are allowed, but may never keep a misleading GPS verification.
create or replace function mathquest_private.attendance_location_teacher_edit()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if tg_op='UPDATE' and (new.student_id,new.timestamp,new.status,new.points,new.session_id)
    is not distinct from (old.student_id,old.timestamp,old.status,old.points,old.session_id) then return new; end if;
  if mathquest_private.is_google_teacher() then
    insert into mathquest_private.attendance_location_checks(attendance_log_id,method,teacher_auth_id)
      values(new.id,'teacher',mathquest_private.google_uid()) on conflict(attendance_log_id) do update
      set method='teacher',distance_m=null,accuracy_m=null,policy_version=null,checked_at=clock_timestamp(),teacher_auth_id=excluded.teacher_auth_id;
  elsif tg_op='UPDATE' then
    delete from mathquest_private.attendance_location_checks where attendance_log_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists attendance_location_teacher_edit on public.attendance_logs;
create trigger attendance_location_teacher_edit after insert or update on public.attendance_logs
  for each row execute function mathquest_private.attendance_location_teacher_edit();

create or replace function mathquest_private.attendance_location_invalidate()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if new.value is not distinct from old.value then return new; end if;
  if new.key='school_data_version' then
    delete from mathquest_private.attendance_location_requests where true;
  elsif new.key='active_session_id' then
    delete from mathquest_private.attendance_location_requests where receipt is null and session_id is distinct from new.value;
  end if;
  return new;
end $$;
drop trigger if exists attendance_location_invalidate on public.system_settings;
create trigger attendance_location_invalidate after update on public.system_settings
  for each row execute function mathquest_private.attendance_location_invalidate();

revoke all on function mathquest_private.attendance_location_policy_version(),mathquest_private.attendance_location_teacher_edit(),mathquest_private.attendance_location_invalidate() from public,anon,authenticated,service_role;
revoke all on function public.mq_student_check_in(text,text),public.mq_prepare_location_check_in(text,text),
  public.mq_student_check_in_at_location(uuid,text,text,double precision,double precision,double precision,double precision) from public,anon,service_role;
grant execute on function public.mq_student_check_in(text,text),public.mq_prepare_location_check_in(text,text),
  public.mq_student_check_in_at_location(uuid,text,text,double precision,double precision,double precision,double precision) to authenticated;
notify pgrst, 'reload schema';
commit;
