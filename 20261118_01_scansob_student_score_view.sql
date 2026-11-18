-- Run after 20261015_03_scansob_recovery_hardening.sql.
begin;

create index if not exists scansob_scores_student_recent
  on mathquest_private.scansob_scores(student_id, updated_at desc, id desc);

create or replace function public.mq_scansob_student_scores(
  p_subject text default null,
  p_before_at timestamptz default null,
  p_before_id bigint default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  student text;
  cfg mathquest_private.scansob_school%rowtype;
begin
  if mathquest_private.google_uid() is null then
    raise exception 'GOOGLE_SESSION_REQUIRED';
  end if;
  if p_limit is null or p_limit not between 1 and 50
    or (p_before_at is null) <> (p_before_id is null)
    or (p_before_at is not null and (not isfinite(p_before_at) or p_before_id < 1))
    or (p_subject is not null and (char_length(p_subject) not between 1 and 80 or btrim(p_subject) = '')) then
    raise exception 'INVALID_QUERY';
  end if;

  student := mathquest_private.google_student_id();
  select * into cfg from mathquest_private.scansob_school;
  if student is null or cfg.id is null or not cfg.student_view_enabled or not cfg.identity_policy_accepted then
    return jsonb_build_object('enabled', false, 'rows', '[]'::jsonb, 'subjects', '[]'::jsonb,
      'single_term', null, 'total', 0, 'next_cursor', null);
  end if;

  return (
    with visible as materialized (
      select s.id, s.updated_at, e.metadata, s.result
      from mathquest_private.scansob_scores s
      join mathquest_private.scansob_exams e on e.id = s.exam_id
      where s.student_id = student and e.school_id = cfg.id
        and (p_before_at is null or (
          (s.updated_at, s.id) < (p_before_at, p_before_id)
          and (p_subject is null or e.metadata->>'subject' = p_subject)
        ))
        and mathquest_private.scansob_score_visible(s.id)
    ), matching as (
      select * from visible where p_subject is null or metadata->>'subject' = p_subject
    ), page as (
      select * from matching order by updated_at desc, id desc limit p_limit + 1
    ), rendered as (
      select * from page order by updated_at desc, id desc limit p_limit
    ), terms as (
      select distinct metadata->'term' as term, metadata->'academic_year' as academic_year
      from matching
    )
    select jsonb_build_object(
      'enabled', true,
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'metadata', jsonb_build_object(
          'title', metadata->'title', 'subject', metadata->'subject', 'exam_type', metadata->'exam_type',
          'term', metadata->'term', 'academic_year', metadata->'academic_year'
        ),
        'result', jsonb_build_object(
          'score', result->'score', 'max_score', result->'max_score',
          'percent', result->'percent', 'passed', result->'passed'
        ),
        'updated_at', updated_at
      ) order by updated_at desc, id desc) from rendered), '[]'::jsonb),
      'subjects', case when p_before_at is null then coalesce((
        select jsonb_agg(subject order by subject) from (
          select distinct metadata->>'subject' as subject from visible
        ) as subjects
      ), '[]'::jsonb) end,
      'single_term', case when p_before_at is null and (select count(*) from terms) = 1
        then (select to_jsonb(terms) from terms) end,
      'total', case when p_before_at is null then (select count(*) from matching) end,
      'next_cursor', case when (select count(*) from page) > p_limit then (
        select jsonb_build_object('updated_at', updated_at, 'id', id::text)
        from rendered order by updated_at, id limit 1
      ) end
    )
  );
end;
$$;

revoke execute on function public.mq_scansob_student_scores(text,timestamptz,bigint,integer)
  from public, anon, service_role;
grant execute on function public.mq_scansob_student_scores(text,timestamptz,bigint,integer)
  to authenticated;
notify pgrst, 'reload schema';
commit;
