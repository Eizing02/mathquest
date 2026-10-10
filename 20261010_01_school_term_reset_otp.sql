-- MathQuest: current semester, permanent progress reset, sequential password reset.
-- Run this NEW migration once in Supabase SQL Editor BEFORE deploying the new UI.
-- Running this file does NOT reset or delete attendance/shop/pet data.
-- Existing account IDs, passwords, names, grades and profile storage are untouched.
begin;

create schema if not exists mathquest_private;
revoke all on schema mathquest_private from public, anon, authenticated;

create table if not exists mathquest_private.teacher_sessions (
  token_hash text primary key,
  teacher_id text not null references public.students(id) on delete cascade,
  expires_at timestamptz not null
);
revoke all on mathquest_private.teacher_sessions from public, anon, authenticated;

insert into public.system_settings(key, value) values
  ('semester_number', '1'), ('semester_year', '2569'),
  ('semester_start', ''), ('semester_end', ''),
  ('school_data_version', gen_random_uuid()::text)
on conflict (key) do nothing;

create or replace function mathquest_private.require_teacher(p_token text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text;
begin
  select ts.teacher_id into v_id
  from mathquest_private.teacher_sessions ts
  join public.students s on s.id = ts.teacher_id and s.role = 'TEACHER'
  where ts.token_hash = md5(coalesce(p_token, '')) and ts.expires_at > now();
  if v_id is null then raise exception 'สิทธิ์ครูหมดอายุ กรุณาเข้าสู่ระบบใหม่'; end if;
  return v_id;
end;
$$;
revoke all on function mathquest_private.require_teacher(text) from public;

create or replace function public.open_teacher_admin_session(p_teacher_id text, p_password text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_token text;
begin
  perform pg_advisory_xact_lock_shared(6101001);
  if not exists(select 1 from public.students where id = trim(p_teacher_id)
    and role = 'TEACHER' and password = p_password) then
    raise exception 'รหัสผ่านครูไม่ถูกต้อง';
  end if;
  delete from mathquest_private.teacher_sessions where expires_at <= now();
  v_token := gen_random_uuid()::text || gen_random_uuid()::text;
  insert into mathquest_private.teacher_sessions values(md5(v_token), trim(p_teacher_id), now() + interval '8 hours');
  return v_token;
end;
$$;

create or replace function mathquest_private.validate_semester(p_number integer, p_year integer, p_start date, p_end date)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  if p_number is null or p_number not in (1,2) or p_year is null or p_year not between 2500 and 2800 then
    raise exception 'ภาคเรียนหรือปีการศึกษาไม่ถูกต้อง';
  end if;
  if (p_start is null) <> (p_end is null) or p_start > p_end then
    raise exception 'วันเริ่มและวันสิ้นสุดภาคเรียนไม่ถูกต้อง';
  end if;
end;
$$;
revoke all on function mathquest_private.validate_semester(integer,integer,date,date) from public;

create or replace function public.set_school_semester(p_teacher_token text, p_number integer, p_year integer,
  p_start date, p_end date, p_expected_version text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform mathquest_private.require_teacher(p_teacher_token);
  perform mathquest_private.validate_semester(p_number,p_year,p_start,p_end);
  perform pg_advisory_xact_lock(6101001);
  if (select value from public.system_settings where key='school_data_version') is distinct from p_expected_version then
    raise exception 'ข้อมูลภาคเรียนเปลี่ยนแล้ว กรุณาโหลดใหม่';
  end if;
  insert into public.system_settings(key,value) values
    ('semester_number',p_number::text),('semester_year',p_year::text),
    ('semester_start',coalesce(p_start::text,'')),('semester_end',coalesce(p_end::text,''))
  on conflict(key) do update set value=excluded.value;
end;
$$;

create or replace function public.preview_school_reset(p_teacher_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pets bigint := 0; v_events bigint := 0;
begin
  perform mathquest_private.require_teacher(p_teacher_token);
  if to_regclass('public.student_pets') is not null then
    execute 'select count(*) from public.student_pets p join public.students s on s.id=p.student_id where s.role=''STUDENT''' into v_pets;
  end if;
  if to_regclass('public.student_pet_events') is not null then
    execute 'select count(*) from public.student_pet_events p join public.students s on s.id=p.student_id where s.role=''STUDENT''' into v_events;
  end if;
  return jsonb_build_object(
    'version',(select value from public.system_settings where key='school_data_version'),
    'students',(select count(*) from public.students where role='STUDENT'),
    'attendance',(select count(*) from public.attendance_logs a join public.students s on s.id=a.student_id where s.role='STUDENT'),
    'orders',(select count(*) from public.redemption_logs r join public.students s on s.id=r.student_id where s.role='STUDENT'),
    'pending_orders',(select count(*) from public.redemption_logs r join public.students s on s.id=r.student_id where s.role='STUDENT' and r.status='pending'),
    'pets',v_pets,'pet_events',v_events,
    'active_session',coalesce((select value<>'' from public.system_settings where key='pin'),false));
end;
$$;

create or replace function public.open_school_attendance_session(p_teacher_token text, p_grade text, p_expected_version text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pin text; v_session text; v_start timestamptz := now();
begin
  perform mathquest_private.require_teacher(p_teacher_token);
  perform pg_advisory_xact_lock(6101001);
  lock table public.system_settings in share row exclusive mode;
  if (select value from public.system_settings where key='school_data_version') is distinct from p_expected_version then
    raise exception 'ข้อมูลเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่';
  end if;
  if not exists(select 1 from public.students where role='STUDENT' and grade=trim(p_grade)) then
    raise exception 'ห้องนี้ไม่มีนักเรียนในระบบ กรุณาเลือกห้องจริง';
  end if;
  if coalesce((select value from public.system_settings where key='pin'),'')<>'' then
    return jsonb_build_object('status','active','message','มีคาบเปิดอยู่ กรุณาปิดหรือยกเลิกคาบเดิมก่อน');
  end if;
  v_pin := ((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint % 9000)+1000)::text;
  v_session := gen_random_uuid()::text;
  insert into public.system_settings(key,value) values
    ('pin',v_pin),('pin_expiry',(v_start+interval '40 minutes')::text),
    ('current_grade',trim(p_grade)),('session_start',v_start::text),('active_session_id',v_session)
  on conflict(key) do update set value=excluded.value;
  return jsonb_build_object('status','success','pin',v_pin,'sessionId',v_session,
    'startedAt',v_start,'expiresAt',v_start+interval '40 minutes');
end;
$$;

create or replace function public.reset_school_for_new_semester(p_teacher_token text, p_password text,
  p_expected_version text, p_number integer, p_year integer, p_start date, p_end date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_teacher text; v_preview jsonb; v_version text;
begin
  v_teacher := mathquest_private.require_teacher(p_teacher_token);
  if not exists(select 1 from public.students where id=v_teacher and role='TEACHER' and password=p_password) then
    raise exception 'รหัสผ่านครูไม่ถูกต้อง';
  end if;
  perform mathquest_private.validate_semester(p_number,p_year,p_start,p_end);
  if p_start is null or p_end is null then raise exception 'ระบุวันเริ่มและวันสิ้นสุดเทอมใหม่ให้ครบ'; end if;
  perform pg_advisory_xact_lock(6101001);
  -- Hold writes while checking preconditions and deleting all progress in one transaction.
  lock table public.students, public.system_settings, public.attendance_logs,
    public.redemption_logs, public.password_reset_requests, public.student_free_item_notification_state in share row exclusive mode;
  if to_regclass('public.student_pets') is not null then execute 'lock table public.student_pets in share row exclusive mode'; end if;
  if to_regclass('public.student_pet_events') is not null then execute 'lock table public.student_pet_events in share row exclusive mode'; end if;
  v_preview := public.preview_school_reset(p_teacher_token);
  if v_preview->>'version' is distinct from p_expected_version then raise exception 'ข้อมูลเปลี่ยนแล้วหรือรีเซ็ตไปแล้ว กรุณาโหลดใหม่'; end if;
  if (v_preview->>'active_session')::boolean then raise exception 'กรุณาปิดคาบก่อนเริ่มเทอมใหม่'; end if;
  if (v_preview->>'pending_orders')::bigint > 0 then raise exception 'กรุณาจัดการออเดอร์รอดำเนินการก่อน'; end if;
  delete from public.attendance_logs a using public.students s where a.student_id=s.id and s.role='STUDENT';
  delete from public.redemption_logs r using public.students s where r.student_id=s.id and s.role='STUDENT';
  if to_regclass('public.student_pet_events') is not null then
    execute 'delete from public.student_pet_events p using public.students s where p.student_id=s.id and s.role=''STUDENT''';
  end if;
  if to_regclass('public.student_pets') is not null then
    execute 'delete from public.student_pets p using public.students s where p.student_id=s.id and s.role=''STUDENT''';
  end if;
  delete from public.password_reset_requests r using public.students s where r.student_id=s.id and s.role='STUDENT';
  delete from public.student_free_item_notification_state n using public.students s where n.student_id=s.id and s.role='STUDENT';
  perform public.set_school_semester(p_teacher_token,p_number,p_year,p_start,p_end,p_expected_version);
  v_version := gen_random_uuid()::text;
  insert into public.system_settings(key,value) values
    ('pin',''),('pin_expiry',''),('current_grade',''),('session_start',''),('active_session_id',''),
    ('school_data_version',v_version),('school_reset_at',now()::text)
  on conflict(key) do update set value=excluded.value;
  delete from mathquest_private.teacher_sessions;
  return jsonb_build_object('status','success','deleted',v_preview,'version',v_version);
end;
$$;

-- OTP data is now readable only through teacher-authorized RPCs, never by students.
alter table public.password_reset_requests add column if not exists failed_attempts integer not null default 0;
alter table public.password_reset_requests add column if not exists verified_token_hash text;
alter table public.password_reset_requests add column if not exists verified_until timestamptz;
alter table public.password_reset_requests drop constraint if exists password_reset_requests_status_check;
alter table public.password_reset_requests add constraint password_reset_requests_status_check
  check(status in ('pending','verified','used','expired','cancelled'));
drop policy if exists password_reset_requests_public_all on public.password_reset_requests;
revoke all on public.password_reset_requests from public, anon, authenticated;

create or replace function public.request_student_password_reset(p_student_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_student public.students%rowtype; v_req public.password_reset_requests%rowtype; v_code text;
begin
  perform pg_advisory_xact_lock_shared(6101001);
  select * into v_student from public.students where id=trim(p_student_id) and role='STUDENT';
  if v_student.id is null then return jsonb_build_object('status','fail','message','ไม่พบรหัสนักเรียนนี้ในระบบ'); end if;
  perform pg_advisory_xact_lock(hashtext('password-reset:'||v_student.id));
  delete from public.password_reset_requests where student_id=v_student.id
    and (expires_at<=now() or status<>'pending');
  select * into v_req from public.password_reset_requests where student_id=v_student.id and status='pending' and expires_at>now();
  if v_req.id is not null then
    return jsonb_build_object('status','existing','studentId',v_student.id,'studentName',v_student.name,'grade',v_student.grade,'expiresAt',v_req.expires_at);
  end if;
  -- Random UUID entropy rather than a browser-generated code.
  v_code := lpad(((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint % 900000)+100000)::text,6,'0');
  insert into public.password_reset_requests(student_id,student_name,grade,reset_code,status,expires_at)
    values(v_student.id,v_student.name,v_student.grade,v_code,'pending',now()+interval '15 minutes') returning * into v_req;
  return jsonb_build_object('status','success','studentId',v_student.id,'studentName',v_student.name,'grade',v_student.grade,'expiresAt',v_req.expires_at);
end;
$$;

create or replace function public.verify_student_reset_otp(p_student_id text, p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_req public.password_reset_requests%rowtype; v_token text;
begin
  perform pg_advisory_xact_lock_shared(6101001);
  select * into v_req from public.password_reset_requests
    where student_id=trim(p_student_id) and status='pending' and expires_at>now() for update;
  if v_req.id is null then return jsonb_build_object('status','fail','message','ไม่มีคำขอที่ใช้งานได้ กรุณาขอรหัสจากครูใหม่'); end if;
  if v_req.failed_attempts>=5 then return jsonb_build_object('status','fail','message','กรอกรหัสผิดครบ 5 ครั้งแล้ว กรุณาให้ครูลบคำขอและขอรหัสใหม่'); end if;
  if p_code is null or p_code !~ '^[0-9]{6}$' or v_req.reset_code<>p_code then
    update public.password_reset_requests set failed_attempts=failed_attempts+1 where id=v_req.id;
    return jsonb_build_object('status','fail','message','รหัส OTP ไม่ถูกต้อง กรุณาตรวจรหัสกับครู');
  end if;
  v_token := gen_random_uuid()::text || gen_random_uuid()::text;
  update public.password_reset_requests set status='verified', verified_token_hash=md5(v_token),
    verified_until=least(expires_at,now()+interval '5 minutes') where id=v_req.id;
  return jsonb_build_object('status','success','studentId',v_req.student_id,'token',v_token);
end;
$$;

create or replace function public.complete_student_password_reset(p_student_id text, p_reset_token text, p_new_password text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_req public.password_reset_requests%rowtype;
begin
  perform pg_advisory_xact_lock_shared(6101001);
  if p_new_password is null or length(trim(p_new_password))<6 or trim(p_new_password)=trim(p_student_id) then
    return jsonb_build_object('status','fail','message','รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษรและไม่ซ้ำกับรหัสนักเรียน');
  end if;
  select * into v_req from public.password_reset_requests where student_id=trim(p_student_id)
    and status='verified' and verified_token_hash=md5(coalesce(p_reset_token,'')) and verified_until>now() for update;
  if v_req.id is null then return jsonb_build_object('status','fail','message','สิทธิ์เปลี่ยนรหัสหมดอายุหรือถูกใช้แล้ว กรุณาขอ OTP ใหม่'); end if;
  update public.students set password=trim(p_new_password), is_first_login=false where id=v_req.student_id and role='STUDENT';
  delete from public.password_reset_requests where id=v_req.id;
  return jsonb_build_object('status','success','studentId',v_req.student_id,'studentName',v_req.student_name);
end;
$$;

create or replace function public.teacher_password_reset_requests(p_teacher_token text)
returns setof public.password_reset_requests language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock_shared(6101001);
  perform mathquest_private.require_teacher(p_teacher_token);
  delete from public.password_reset_requests where expires_at<=now();
  return query select * from public.password_reset_requests where status='pending' order by created_at desc;
end;
$$;

create or replace function public.cancel_student_password_reset(p_teacher_token text, p_request_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock_shared(6101001);
  perform mathquest_private.require_teacher(p_teacher_token);
  delete from public.password_reset_requests where id=p_request_id;
end;
$$;

-- Explicit grants: helper functions and private tables are never exposed.
revoke all on function public.open_school_attendance_session(text,text,text) from public;
revoke all on function public.open_teacher_admin_session(text,text) from public;
revoke all on function public.set_school_semester(text,integer,integer,date,date,text) from public;
revoke all on function public.preview_school_reset(text) from public;
revoke all on function public.reset_school_for_new_semester(text,text,text,integer,integer,date,date) from public;
revoke all on function public.request_student_password_reset(text) from public;
revoke all on function public.verify_student_reset_otp(text,text) from public;
revoke all on function public.complete_student_password_reset(text,text,text) from public;
revoke all on function public.teacher_password_reset_requests(text) from public;
revoke all on function public.cancel_student_password_reset(text,bigint) from public;
grant execute on function public.open_teacher_admin_session(text,text),
  public.open_school_attendance_session(text,text,text),
  public.set_school_semester(text,integer,integer,date,date,text), public.preview_school_reset(text),
  public.reset_school_for_new_semester(text,text,text,integer,integer,date,date),
  public.request_student_password_reset(text), public.verify_student_reset_otp(text,text),
  public.complete_student_password_reset(text,text,text), public.teacher_password_reset_requests(text),
  public.cancel_student_password_reset(text,bigint) to anon, authenticated;

-- Refuse delayed requests from a browser left open before a permanent reset.
-- SQL Editor maintenance has no HTTP request headers and is not affected.
create or replace function mathquest_private.check_progress_version()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_headers text; v_version text; v_sent text; v_reset text;
begin
  v_headers := current_setting('request.headers',true);
  if v_headers is not null and v_headers<>'' then
    v_sent := v_headers::jsonb->>'x-school-data-version';
    select value into v_version from public.system_settings where key='school_data_version';
    select value into v_reset from public.system_settings where key='school_reset_at';
    if (v_sent is not null or coalesce(v_reset,'')<>'') and v_sent is distinct from v_version then
      raise exception 'ระบบเริ่มเทอมใหม่แล้ว กรุณาโหลดหน้าเว็บและเข้าสู่ระบบใหม่';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function mathquest_private.check_progress_version() from public;
do $$
declare v_table text;
begin
  foreach v_table in array array['attendance_logs','redemption_logs','student_pets','student_pet_events'] loop
    if to_regclass('public.'||v_table) is not null then
      execute format('drop trigger if exists school_progress_version on public.%I',v_table);
      execute format('create trigger school_progress_version before insert or update or delete on public.%I for each row execute function mathquest_private.check_progress_version()',v_table);
    end if;
  end loop;
end;
$$;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and
    not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='system_settings') then
    alter publication supabase_realtime add table public.system_settings;
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
