-- MathQuest Google cutover. Requires the existing school/reset, pet and report migrations.
-- Configure Google OAuth BEFORE running this file, then deploy the matching frontend.
-- Preserves all students, passwords, photos, progress and school settings.
-- Student links are self-claimed, NOT proof of student-code ownership.
begin;

do $$
begin
  if to_regprocedure('public.reset_school_progress(text,text,text)') is null
    or to_regclass('public.student_pets') is null
    or to_regclass('auth.sessions') is null then
    raise exception 'Install the existing school/pet migrations and Supabase Auth first';
  end if;
  if exists(select 1 from pg_policies where schemaname='public'
    and tablename in ('students','attendance_logs','shop_items','redemption_logs','system_settings','student_pets','student_pet_events','student_free_item_notification_state')
    and policyname not like 'mq_google_%' and policyname not like '%_public_all') then
    raise exception 'Review custom RLS policies before Google cutover; no policies were changed';
  end if;
end;
$$;

create table if not exists mathquest_private.google_login_config (
  singleton boolean primary key default true check(singleton),
  teacher_email text not null check(teacher_email=lower(btrim(teacher_email))),
  teacher_student_id text references public.students(id) on delete restrict
);
insert into mathquest_private.google_login_config(singleton,teacher_email,teacher_student_id)
select true,'piyawatpiwsiri@gmail.com',case when count(*)=1 then min(id) else null end
from public.students where role='TEACHER'
on conflict(singleton) do nothing;

create table if not exists mathquest_private.google_student_links (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  student_id text not null unique references public.students(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists mathquest_private.google_link_audit (
  id bigint generated always as identity primary key,
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  old_student_id text, new_student_id text,
  action text not null check(action in ('claim','switch','teacher_recovery')),
  created_at timestamptz not null default now()
);
create table if not exists mathquest_private.google_auth_limits (
  actor uuid not null, action text not null, bucket_start timestamptz not null,
  attempts integer not null, primary key(actor,action)
);
revoke all on mathquest_private.google_login_config,mathquest_private.google_student_links,
  mathquest_private.google_link_audit,mathquest_private.google_auth_limits from public,anon,authenticated;
revoke all on sequence mathquest_private.google_link_audit_id_seq from public,anon,authenticated;

create or replace function mathquest_private.google_uid()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select u.id from auth.users u
  where u.id=auth.uid() and u.email_confirmed_at is not null
    and u.raw_app_meta_data->>'provider'='google'
    and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google'
      and i.identity_data->>'email_verified'='true'
      and lower(i.identity_data->>'email')=lower(u.email))
    and exists(select 1 from auth.sessions s where s.user_id=u.id and s.id::text=auth.jwt()->>'session_id')
    and exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) m where m->>'method'='oauth');
$$;
create or replace function mathquest_private.is_google_teacher()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from mathquest_private.google_login_config c
    join auth.users u on u.id=mathquest_private.google_uid() and lower(u.email)=c.teacher_email
    join public.students s on s.id=c.teacher_student_id and s.role='TEACHER');
$$;
create or replace function mathquest_private.google_student_id()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select l.student_id from mathquest_private.google_student_links l
    join public.students s on s.id=l.student_id and s.role='STUDENT'
  where l.auth_user_id=mathquest_private.google_uid() and not mathquest_private.is_google_teacher();
$$;
create or replace function mathquest_private.consume_google_limit(p_action text,p_max integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer; v_uid uuid:=mathquest_private.google_uid();
begin
  if v_uid is null then raise exception 'GOOGLE_SESSION_REQUIRED'; end if;
  insert into mathquest_private.google_auth_limits as limits(actor,action,bucket_start,attempts)
  values(v_uid,p_action,clock_timestamp(),1)
  on conflict(actor,action) do update set
    attempts=case when limits.bucket_start<=clock_timestamp()-make_interval(secs=>p_seconds) then 1 else limits.attempts+1 end,
    bucket_start=case when limits.bucket_start<=clock_timestamp()-make_interval(secs=>p_seconds) then clock_timestamp() else limits.bucket_start end
  returning attempts into v_count;
  return v_count<=p_max;
end;
$$;

create or replace function public.mq_google_account()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid:=mathquest_private.google_uid(); v_email text; v_student public.students%rowtype; v_link timestamptz;
begin
  if v_uid is null then raise exception 'GOOGLE_SESSION_REQUIRED'; end if;
  select lower(email) into v_email from auth.users where id=v_uid;
  if exists(select 1 from mathquest_private.google_login_config where teacher_email=v_email) then
    select s.* into v_student from public.students s join mathquest_private.google_login_config c on c.teacher_student_id=s.id where s.role='TEACHER';
    if not found then return jsonb_build_object('state','teacher_setup_required'); end if;
  else
    select s.* into v_student from public.students s join mathquest_private.google_student_links l on l.student_id=s.id
      where l.auth_user_id=v_uid and s.role='STUDENT';
    -- Read the link timestamp separately to keep the rowtype independent of schema additions.
    select updated_at into v_link from mathquest_private.google_student_links where auth_user_id=v_uid;
    if v_student.id is null then return jsonb_build_object('state','unlinked','email',v_email); end if;
  end if;
  return jsonb_build_object('state','linked','id',v_student.id,'name',v_student.name,'grade',v_student.grade,
    'role',v_student.role,'email',v_email,'authMode','google','isFirstLogin',false,
    'linkVersion',coalesce(v_link::text,''),'authSessionId',auth.jwt()->>'session_id');
end;
$$;

create or replace function public.mq_student_link(p_action text,p_student_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid:=mathquest_private.google_uid(); v_old text; v_student public.students%rowtype;
  v_old_grade text; v_grade text; v_action text:=coalesce(p_action,'');
begin
  if v_uid is null then raise exception 'GOOGLE_SESSION_REQUIRED'; end if;
  if exists(select 1 from auth.users u join mathquest_private.google_login_config c on lower(u.email)=c.teacher_email where u.id=v_uid) then
    return jsonb_build_object('ok',false,'code','STUDENT_ONLY');
  end if;
  if v_action not in ('lookup','claim','switch') then return jsonb_build_object('ok',false,'code','INVALID_ACTION'); end if;
  perform pg_advisory_xact_lock_shared(6101001);
  perform pg_advisory_xact_lock(hashtextextended('mq:identity:'||v_uid::text,0));
  if not mathquest_private.consume_google_limit(v_action,case v_action when 'lookup' then 10 when 'claim' then 5 else 2 end,
    case v_action when 'switch' then 86400 else 600 end) then return jsonb_build_object('ok',false,'code','RATE_LIMITED'); end if;
  if p_student_code is null or p_student_code !~ '^[0-9]{5}$' then return jsonb_build_object('ok',false,'code','INVALID_STUDENT_CODE'); end if;
  select student_id into v_old from mathquest_private.google_student_links where auth_user_id=v_uid for update;
  if (v_action='claim' and v_old is not null) or (v_action='switch' and v_old is null) then return jsonb_build_object('ok',false,'code','LINK_STATE_CHANGED'); end if;
  select * into v_student from public.students where id=p_student_code and role='STUDENT' for update;
  if not found then return jsonb_build_object('ok',false,'code','STUDENT_NOT_FOUND'); end if;
  if exists(select 1 from mathquest_private.google_student_links where student_id=p_student_code and auth_user_id<>v_uid) then
    return jsonb_build_object('ok',false,'code','STUDENT_ALREADY_LINKED');
  end if;
  if v_action='lookup' then return jsonb_build_object('ok',true,'student',jsonb_build_object('id',v_student.id,'name',v_student.name,'grade',v_student.grade)); end if;
  if v_action='switch' then
    if v_old=p_student_code then return jsonb_build_object('ok',false,'code','SAME_STUDENT_CODE'); end if;
    select grade into v_old_grade from public.students where id=v_old;
    select value into v_grade from public.system_settings where key='current_grade';
    if exists(select 1 from public.system_settings where key='pin' and value<>'') and
      (v_student.grade=v_grade or v_old_grade=v_grade or v_student.grade like v_grade||'/%' or v_old_grade like v_grade||'/%') then
      return jsonb_build_object('ok',false,'code','ACTIVE_SESSION');
    end if;
  end if;
  begin
    insert into mathquest_private.google_student_links(auth_user_id,student_id) values(v_uid,p_student_code)
    on conflict(auth_user_id) do update set student_id=excluded.student_id,updated_at=clock_timestamp();
    insert into mathquest_private.google_link_audit(actor_auth_user_id,old_student_id,new_student_id,action) values(v_uid,v_old,p_student_code,v_action);
  exception when unique_violation then return jsonb_build_object('ok',false,'code','STUDENT_ALREADY_LINKED'); end;
  return jsonb_build_object('ok',true);
end;
$$;

alter table mathquest_private.teacher_sessions add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;
alter table mathquest_private.teacher_sessions add column if not exists auth_session_id uuid;
create or replace function public.mq_open_teacher_session()
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_token text; v_teacher text;
begin
  perform pg_advisory_xact_lock_shared(6101001);
  if not mathquest_private.is_google_teacher() then raise exception 'TEACHER_GOOGLE_REQUIRED'; end if;
  select teacher_student_id into v_teacher from mathquest_private.google_login_config;
  delete from mathquest_private.teacher_sessions where expires_at<=now();
  v_token:=gen_random_uuid()::text||gen_random_uuid()::text;
  insert into mathquest_private.teacher_sessions(token_hash,teacher_id,expires_at,auth_user_id,auth_session_id)
    values(md5(v_token),v_teacher,now()+interval '8 hours',mathquest_private.google_uid(),(auth.jwt()->>'session_id')::uuid);
  return v_token;
end;
$$;
create or replace function mathquest_private.require_teacher(p_token text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text;
begin
  if not mathquest_private.is_google_teacher() then raise exception 'TEACHER_GOOGLE_REQUIRED'; end if;
  select teacher_id into v_id from mathquest_private.teacher_sessions where token_hash=md5(coalesce(p_token,''))
    and expires_at>now() and auth_user_id=mathquest_private.google_uid() and auth_session_id::text=auth.jwt()->>'session_id';
  if v_id is null then raise exception 'สิทธิ์ครูหมดอายุ กรุณาเข้าสู่ระบบใหม่'; end if;
  return v_id;
end;
$$;
create or replace function public.mq_google_recent_auth()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select mathquest_private.google_uid() is not null and exists(
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) m
    where m->>'method'='oauth' and (m->>'timestamp')::numeric>=extract(epoch from now()-interval '15 minutes'));
$$;
create or replace function public.mq_reset_student_progress(p_teacher_token text,p_expected_version text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_teacher text; v_password text;
begin
  v_teacher:=mathquest_private.require_teacher(p_teacher_token);
  if not public.mq_google_recent_auth() then raise exception 'GOOGLE_REAUTH_REQUIRED'; end if;
  select password into v_password from public.students where id=v_teacher;
  return public.reset_school_progress(p_teacher_token,v_password,p_expected_version);
end;
$$;

-- Reuse the existing game rules, but run student writes under verified identity.
create or replace function mathquest_private.google_write_student(p_expected_version text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text; v_uid uuid:=mathquest_private.google_uid();
begin
  if v_uid is null then raise exception 'GOOGLE_SESSION_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(6101001);
  perform pg_advisory_xact_lock(hashtextextended('mq:identity:'||v_uid::text,0));
  v_id:=mathquest_private.google_student_id();
  if v_id is null then raise exception 'LINKED_STUDENT_REQUIRED'; end if;
  if (select value from public.system_settings where key='school_data_version') is distinct from p_expected_version then
    raise exception 'ข้อมูลถูกรีเซ็ต กรุณาเข้าสู่ระบบใหม่';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mq:wallet:'||v_id,0));
  return v_id;
end;
$$;
create or replace function mathquest_private.google_wallet(p_id text)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select greatest(0,
    coalesce((select sum(points) from public.attendance_logs where student_id=p_id and status='มา'),0)
    -coalesce((select sum(points_used) from public.redemption_logs where student_id=p_id and coalesce(status,'pending')<>'rejected'),0)
    -coalesce((select sum(points_used) from public.student_pet_events where student_id=p_id),0))::bigint;
$$;
create or replace function public.mq_student_check_in(p_pin text,p_expected_version text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text:=mathquest_private.google_write_student(p_expected_version); v_pin text; v_expiry timestamptz;
  v_start timestamptz; v_grade text; v_student_grade text; v_session text; v_day date; v_points integer:=0; v_now timestamptz:=now();
begin
  if not mathquest_private.consume_google_limit('check_in',15,300) then return jsonb_build_object('result','error','msg','ลองเช็คชื่อหลายครั้งเกินไป กรุณารอสักครู่'); end if;
  select value into v_pin from public.system_settings where key='pin';
  if coalesce(v_pin,'')='' then return jsonb_build_object('result','error','msg','ยังไม่มีคาบเรียนที่เปิดอยู่'); end if;
  if btrim(coalesce(p_pin,''))<>v_pin then return jsonb_build_object('result','error','msg','รหัส PIN ไม่ถูกต้อง'); end if;
  select nullif(value,'')::timestamptz into v_expiry from public.system_settings where key='pin_expiry';
  select nullif(value,'')::timestamptz into v_start from public.system_settings where key='session_start';
  select value into v_grade from public.system_settings where key='current_grade';
  select nullif(value,'') into v_session from public.system_settings where key='active_session_id';
  if v_expiry is null or v_start is null or coalesce(v_grade,'')='' then raise exception 'การตั้งค่าคาบเรียนไม่ครบ'; end if;
  if v_now>v_expiry then return jsonb_build_object('result','error','msg','รหัส PIN หมดอายุแล้ว'); end if;
  select grade into v_student_grade from public.students where id=v_id;
  if v_student_grade<>v_grade and v_student_grade not like v_grade||'/%' then return jsonb_build_object('result','error','msg','คาบนี้เปิดสำหรับชั้น '||v_grade); end if;
  v_day:=(v_start at time zone 'Asia/Bangkok')::date;
  if exists(select 1 from public.attendance_logs where student_id=v_id and (timestamp at time zone 'Asia/Bangkok')::date=v_day) then
    return jsonb_build_object('result','duplicate','msg','เช็คชื่อคาบนี้แล้ว');
  end if;
  if v_now<=v_start+interval '5 minutes' then v_points:=5; elsif v_now<=v_start+interval '10 minutes' then v_points:=3; end if;
  insert into public.attendance_logs(student_id,timestamp,status,points,session_id)
    values(v_id,case when (v_now at time zone 'Asia/Bangkok')::date=v_day then v_now else (v_day+time '12:00') at time zone 'Asia/Bangkok' end,'มา',v_points,v_session);
  return jsonb_build_object('result','success','points',v_points,'grade',v_grade);
end;
$$;
create or replace function public.mq_student_buy_item(p_item_id text,p_expected_version text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text:=mathquest_private.google_write_student(p_expected_version); v_item public.shop_items%rowtype; v_wallet bigint;
begin
  select * into v_item from public.shop_items where item_id=p_item_id and is_active;
  if not found or v_item.cost<=0 then return jsonb_build_object('status','fail','msg','สินค้านี้ไม่เปิดให้แลก'); end if;
  v_wallet:=mathquest_private.google_wallet(v_id);
  if v_wallet<v_item.cost then return jsonb_build_object('status','fail','msg','เหรียญไม่เพียงพอ','mathCoins',v_wallet); end if;
  insert into public.redemption_logs(student_id,item_id,item_name,points_used,status) values(v_id,v_item.item_id,v_item.item_name,v_item.cost,'pending');
  return jsonb_build_object('status','success','mathCoins',v_wallet-v_item.cost,'pointsUsed',v_item.cost,'itemName',v_item.item_name,
    'lifetimeExp',coalesce((select sum(points) from public.attendance_logs where student_id=v_id and status='มา'),0));
end;
$$;
create or replace function public.mq_student_pet(p_action text,p_pet_id text,p_name text,p_expected_version text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text:=mathquest_private.google_write_student(p_expected_version); v_old public.student_pets%rowtype;
  v_saved public.student_pets%rowtype; v_cost integer:=0; v_free integer; v_name text;
begin
  select * into v_old from public.student_pets where student_id=v_id for update;
  v_name:=left(btrim(regexp_replace(coalesce(p_name,''),'\s+',' ','g')),18);
  if v_name='' then return jsonb_build_object('status','fail','msg','กรุณาระบุชื่อสัตว์เลี้ยง'); end if;
  if p_action='select' then
    if p_pet_id is null or p_pet_id not in ('thorn','leafy','volt','clover','aqua','ember','snowy','sunny','mystic','rocky','toady','zephyr','fluffy','iron','nebula','scorch','mossy','luna','valor','bramble','cinder') then
      return jsonb_build_object('status','fail','msg','ไม่พบสัตว์เลี้ยง'); end if;
    if v_old.pet_id=p_pet_id then return jsonb_build_object('status','same','msg','ใช้งานสัตว์เลี้ยงตัวนี้อยู่แล้ว','pet',to_jsonb(v_old)); end if;
    v_free:=least(3,greatest(0,coalesce(v_old.free_select_used,0)));
    if v_free>=3 then v_cost:=25; end if;
    if mathquest_private.google_wallet(v_id)<v_cost then return jsonb_build_object('status','fail','msg','เหรียญไม่เพียงพอ'); end if;
    insert into public.student_pets(student_id,pet_id,pet_name,free_select_used,rename_used,selected_at,updated_at)
      values(v_id,p_pet_id,v_name,least(3,v_free+1),0,now(),now())
    on conflict(student_id) do update set pet_id=excluded.pet_id,pet_name=excluded.pet_name,free_select_used=excluded.free_select_used,
      rename_used=0,selected_at=excluded.selected_at,updated_at=excluded.updated_at returning * into v_saved;
  elsif p_action='rename' then
    if v_old.student_id is null or v_old.rename_used>=3 then return jsonb_build_object('status','fail','msg','ยังไม่มีสัตว์เลี้ยงหรือเปลี่ยนชื่อครบแล้ว'); end if;
    if v_old.pet_name=v_name then return jsonb_build_object('status','same','msg','ชื่อเดิมอยู่แล้ว','pet',to_jsonb(v_old)); end if;
    update public.student_pets set pet_name=v_name,rename_used=rename_used+1,updated_at=now() where student_id=v_id returning * into v_saved;
  else return jsonb_build_object('status','fail','msg','คำสั่งไม่ถูกต้อง'); end if;
  insert into public.student_pet_events(student_id,event_type,from_pet_id,to_pet_id,previous_name,new_name,points_used)
    values(v_id,case when p_action='rename' then 'rename' when v_cost>0 then 'paid_change' else 'select' end,
      coalesce(v_old.pet_id,''),v_saved.pet_id,coalesce(v_old.pet_name,''),v_saved.pet_name,v_cost);
  return jsonb_build_object('status','success','pet',to_jsonb(v_saved),'cost',v_cost,'freeSelectUsed',v_saved.free_select_used,
    'remainingFree',3-v_saved.free_select_used,'renameUsed',v_saved.rename_used,'remainingRename',3-v_saved.rename_used,'mathCoins',mathquest_private.google_wallet(v_id));
end;
$$;

-- Replace only known legacy policies; the precheck refuses unknown custom policies.
do $$
declare v_table text; v_policy text;
begin
  foreach v_table in array array['students','attendance_logs','shop_items','redemption_logs','system_settings','student_pets','student_pet_events','student_free_item_notification_state'] loop
    execute format('alter table public.%I enable row level security',v_table);
    for v_policy in select policyname from pg_policies where schemaname='public' and tablename=v_table loop
      execute format('drop policy %I on public.%I',v_policy,v_table);
    end loop;
    execute format('revoke all on public.%I from public,anon,authenticated',v_table);
  end loop;
end;
$$;
grant usage on schema mathquest_private to anon,authenticated;
grant select(id,name,grade,role,photo_url,is_first_login,created_at,updated_at),insert,update(photo_url) on public.students to authenticated;
grant select,insert,update,delete on public.attendance_logs,public.shop_items,public.redemption_logs,public.system_settings to authenticated;
grant select on public.student_pets,public.student_pet_events to authenticated;
grant select,insert,update on public.student_free_item_notification_state to authenticated;
grant select on public.system_settings to anon;
grant usage,select on all sequences in schema public to authenticated;

create policy mq_google_students_read on public.students for select to authenticated
  using(mathquest_private.is_google_teacher() or id=mathquest_private.google_student_id());
create policy mq_google_students_insert on public.students for insert to authenticated
  with check(mathquest_private.is_google_teacher() and role='STUDENT');
create policy mq_google_students_photo on public.students for update to authenticated
  using(mathquest_private.is_google_teacher() or id=mathquest_private.google_student_id())
  with check(mathquest_private.is_google_teacher() or id=mathquest_private.google_student_id());
create policy mq_google_settings_read on public.system_settings for select to anon,authenticated
  using(key in ('app_name','school_name','accent_color','logo_base64','logo_url','semester_number','semester_year','semester_start','semester_end','school_data_version','school_reset_at') or mathquest_private.is_google_teacher());
create policy mq_google_settings_write on public.system_settings for all to authenticated
  using(mathquest_private.is_google_teacher()) with check(mathquest_private.is_google_teacher());
create policy mq_google_shop_read on public.shop_items for select to authenticated
  using(mathquest_private.is_google_teacher() or (mathquest_private.google_student_id() is not null and is_active));
create policy mq_google_shop_write on public.shop_items for all to authenticated
  using(mathquest_private.is_google_teacher()) with check(mathquest_private.is_google_teacher());
do $$
declare v_table text;
begin
  foreach v_table in array array['attendance_logs','redemption_logs','student_pets','student_pet_events','student_free_item_notification_state'] loop
    execute format('create policy mq_google_progress_read on public.%I for select to authenticated using(mathquest_private.is_google_teacher() or student_id=mathquest_private.google_student_id())',v_table);
  end loop;
  foreach v_table in array array['attendance_logs','redemption_logs'] loop
    execute format('create policy mq_google_progress_teacher_write on public.%I for all to authenticated using(mathquest_private.is_google_teacher()) with check(mathquest_private.is_google_teacher())',v_table);
  end loop;
end;
$$;
create policy mq_google_notifications_insert on public.student_free_item_notification_state for insert to authenticated
  with check(student_id=mathquest_private.google_student_id());
create policy mq_google_notifications_update on public.student_free_item_notification_state for update to authenticated
  using(student_id=mathquest_private.google_student_id()) with check(student_id=mathquest_private.google_student_id());

-- Anonymous password endpoints and the old reset entry points are retired.
revoke all on function public.open_teacher_admin_session(text,text),public.request_student_password_reset(text),
  public.verify_student_reset_otp(text,text),public.complete_student_password_reset(text,text,text),
  public.teacher_password_reset_requests(text),public.cancel_student_password_reset(text,bigint),
  public.reset_school_progress(text,text,text),public.reset_school_for_new_semester(text,text,text,integer,integer,date,date)
  from public,anon,authenticated;
revoke all on function mathquest_private.google_uid(),mathquest_private.is_google_teacher(),mathquest_private.google_student_id(),
  mathquest_private.consume_google_limit(text,integer,integer),mathquest_private.google_write_student(text),mathquest_private.google_wallet(text)
  from public,anon,authenticated;
grant execute on function mathquest_private.is_google_teacher(),mathquest_private.google_student_id() to anon,authenticated;
revoke all on function public.mq_google_account(),public.mq_student_link(text,text),public.mq_open_teacher_session(),
  public.mq_google_recent_auth(),public.mq_reset_student_progress(text,text),public.mq_student_check_in(text,text),
  public.mq_student_buy_item(text,text),public.mq_student_pet(text,text,text,text) from public,anon;
grant execute on function public.mq_google_account(),public.mq_student_link(text,text),public.mq_open_teacher_session(),
  public.mq_google_recent_auth(),public.mq_reset_student_progress(text,text),public.mq_student_check_in(text,text),
  public.mq_student_buy_item(text,text),public.mq_student_pet(text,text,text,text) to authenticated;

-- Profile images stay publicly readable, but only the owner or teacher may write.
do $$
declare v_name text;
begin
  if to_regclass('storage.objects') is not null then
    foreach v_name in array array['mathquest_storage_public_insert','mathquest_storage_public_update','mathquest_storage_public_delete',
      'mq_google_storage_insert','mq_google_storage_update','mq_google_storage_delete'] loop
      execute format('drop policy if exists %I on storage.objects',v_name);
    end loop;
    execute $policy$create policy mq_google_storage_insert on storage.objects for insert to authenticated with check(
      bucket_id='mathquest-storage' and (mathquest_private.is_google_teacher() or
        (mathquest_private.google_student_id() is not null and starts_with(name,'students/'||mathquest_private.google_student_id()||'/'))))$policy$;
    execute $policy$create policy mq_google_storage_update on storage.objects for update to authenticated using(
      bucket_id='mathquest-storage' and (mathquest_private.is_google_teacher() or starts_with(name,'students/'||mathquest_private.google_student_id()||'/')))
      with check(bucket_id='mathquest-storage' and (mathquest_private.is_google_teacher() or starts_with(name,'students/'||mathquest_private.google_student_id()||'/')))$policy$;
    execute $policy$create policy mq_google_storage_delete on storage.objects for delete to authenticated using(
      bucket_id='mathquest-storage' and (mathquest_private.is_google_teacher() or starts_with(name,'students/'||mathquest_private.google_student_id()||'/')))$policy$;
  end if;
end;
$$;
notify pgrst,'reload schema';
commit;
