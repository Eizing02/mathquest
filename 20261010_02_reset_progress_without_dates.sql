-- MathQuest: reset all student progress without requiring semester dates.
-- Run AFTER 20261010_01_school_term_reset_otp.sql in Supabase SQL Editor.
-- This migration only replaces functions. It does NOT reset or delete data.
-- Keep safeupdate enabled; every DELETE below has an explicit WHERE clause.
begin;

do $$
begin
  if to_regprocedure('mathquest_private.require_teacher(text)') is null
    or to_regprocedure('public.preview_school_reset(text)') is null then
    raise exception 'Run 20261010_01_school_term_reset_otp.sql before this migration';
  end if;
end;
$$;

create or replace function public.reset_school_progress(p_teacher_token text, p_password text,
  p_expected_version text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_teacher text; v_preview jsonb; v_version text;
begin
  v_teacher := mathquest_private.require_teacher(p_teacher_token);
  if not exists(select 1 from public.students where id=v_teacher and role='TEACHER' and password=p_password) then
    raise exception 'รหัสผ่านครูไม่ถูกต้อง';
  end if;
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
  v_version := gen_random_uuid()::text;
  insert into public.system_settings(key,value) values
    ('pin',''),('pin_expiry',''),('current_grade',''),('session_start',''),('active_session_id',''),
    ('school_data_version',v_version),('school_reset_at',now()::text)
  on conflict(key) do update set value=excluded.value;
  delete from mathquest_private.teacher_sessions ts using public.students s where ts.teacher_id=s.id;
  return jsonb_build_object('status','success','deleted',v_preview,'version',v_version);
end;
$$;

-- Compatibility for a browser using the previous reset form; dates are optional.
create or replace function public.reset_school_for_new_semester(p_teacher_token text, p_password text,
  p_expected_version text, p_number integer, p_year integer, p_start date, p_end date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  perform mathquest_private.validate_semester(p_number,p_year,p_start,p_end);
  v_result := public.reset_school_progress(p_teacher_token,p_password,p_expected_version);
  insert into public.system_settings(key,value) values
    ('semester_number',p_number::text),('semester_year',p_year::text),
    ('semester_start',coalesce(p_start::text,'')),('semester_end',coalesce(p_end::text,''))
  on conflict(key) do update set value=excluded.value;
  return v_result;
end;
$$;

revoke all on function public.reset_school_progress(text,text,text) from public;
revoke all on function public.reset_school_for_new_semester(text,text,text,integer,integer,date,date) from public;
grant execute on function public.reset_school_progress(text,text,text),
  public.reset_school_for_new_semester(text,text,text,integer,integer,date,date) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
