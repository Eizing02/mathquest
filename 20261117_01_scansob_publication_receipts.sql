-- Standalone teacher report upgrade. Does not change pairing or score ingestion.
begin;
select pg_advisory_xact_lock(6101001);
do $$ begin
  if to_regclass('mathquest_private.scansob_exam_purges') is null
    or not exists(select 1 from mathquest_private.scansob_school where receiver_profile='1.1') then
    raise exception 'Apply 20261015_03_scansob_recovery_hardening.sql first';
  end if;
end $$;

create or replace function public.mq_scansob_publication_receipt(p_teacher_token text,p_exam_id bigint)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  perform mathquest_private.require_teacher(p_teacher_token);
  select jsonb_build_object(
    'exam_id',e.id,'source_exam_id',e.source_exam_id,'source_workspace_id',e.workspace_id,
    'revision',e.revision::text,'withdrawn',e.withdrawn,'expected_batches',e.batch_count,
    'verified_batches',a.batches,'accepted',a.accepted,'unmatched',a.unmatched,'invalid',a.invalid)
  into result
  from mathquest_private.scansob_exams e
  join mathquest_private.scansob_school school on school.id=e.school_id
  cross join lateral (
    select count(*) as batches,coalesce(sum((v.acknowledgment->>'accepted')::integer),0) as accepted,
      coalesce(sum(jsonb_array_length(v.acknowledgment->'unmatched')),0) as unmatched,
      coalesce(sum(jsonb_array_length(v.acknowledgment->'invalid')),0) as invalid
    from mathquest_private.scansob_batches b
    join mathquest_private.scansob_events v on v.event_id=b.event_id and v.exam_id=e.id and v.school_id=e.school_id
      and v.connection_id=e.publication_connection_id and v.acknowledgment->>'status'='processed'
    where b.exam_id=e.id and b.revision=e.revision
  ) a
  where e.id=p_exam_id and e.reset_at is null;
  return result;
end $$;

revoke all on function public.mq_scansob_publication_receipt(text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.mq_scansob_publication_receipt(text,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
