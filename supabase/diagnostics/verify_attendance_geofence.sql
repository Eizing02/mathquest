-- READ ONLY: run in a NEW MathQuest SQL Editor query as postgres.
-- This checks installation objects and permissions, not device GPS or live attendance.
-- Safe to run while classes are open. Do not rerun the installer just to check status.
with functions as (
  select
    to_regprocedure('public.mq_prepare_location_check_in(text,text)')::oid as prepare,
    to_regprocedure('public.mq_student_check_in_at_location(uuid,text,text,double precision,double precision,double precision,double precision)')::oid as check_in,
    to_regprocedure('public.mq_student_check_in(text,text)')::oid as legacy,
    to_regprocedure('mathquest_private.attendance_check_in_core(text,text)')::oid as core
), checks as (
  select
    exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
      where e.extname='postgis' and n.nspname='extensions') as postgis_installed,
    (select count(*)=3 from pg_class where relrowsecurity and oid in (
      to_regclass('mathquest_private.attendance_geofence'),
      to_regclass('mathquest_private.attendance_location_requests'),
      to_regclass('mathquest_private.attendance_location_checks'))) as private_tables_installed,
    prepare is not null and check_in is not null and core is not null as functions_installed,
    coalesce(position('LOCATION_REQUIRED' in pg_get_functiondef(legacy))>0,false) as pin_only_blocked,
    coalesce(has_function_privilege('authenticated',prepare,'EXECUTE')
      and has_function_privilege('authenticated',check_in,'EXECUTE')
      and not has_function_privilege('anon',prepare,'EXECUTE')
      and not has_function_privilege('anon',check_in,'EXECUTE')
      and not has_function_privilege('authenticated',core,'EXECUTE')
      and not has_function_privilege('anon',core,'EXECUTE')
      and not has_function_privilege('service_role',core,'EXECUTE'),false) as function_permissions_ok,
    exists(select 1 from pg_trigger where tgrelid=to_regclass('public.attendance_logs')
      and tgname='attendance_location_teacher_edit' and tgenabled='O' and not tgisinternal)
    and exists(select 1 from pg_trigger where tgrelid=to_regclass('public.system_settings')
      and tgname='attendance_location_invalidate' and tgenabled='O' and not tgisinternal)
    and exists(select 1 from pg_trigger where tgrelid=to_regclass('mathquest_private.attendance_geofence')
      and tgname='attendance_location_policy_version' and tgenabled='O' and not tgisinternal) as triggers_installed
  from functions
)
select case when postgis_installed and private_tables_installed and functions_installed
    and pin_only_blocked and function_permissions_ok and triggers_installed
  then 'GPS_SQL_INSTALLED' else 'GPS_SQL_NOT_COMPLETE' end as status,
  checks.* from checks;
