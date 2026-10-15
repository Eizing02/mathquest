-- ScanSob receiver profile 1.0. Additive: installation deletes no existing data.
-- Requires 20261015_01_google_login_student_links.sql. Both feature flags start OFF.
begin;
do $$ begin
  if to_regprocedure('public.mq_google_account()') is null then raise exception 'Install the Google login migration first'; end if;
end $$;

create table if not exists mathquest_private.scansob_school (
  singleton boolean primary key default true check(singleton),
  id uuid not null unique default gen_random_uuid(),
  enabled boolean not null default false,
  student_view_enabled boolean not null default false,
  identity_policy_accepted boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into mathquest_private.scansob_school(singleton) values(true) on conflict do nothing;
create table if not exists mathquest_private.scansob_members (
  school_id uuid not null references mathquest_private.scansob_school(id),
  student_id text not null references public.students(id) on delete cascade,
  primary key(school_id,student_id)
);
insert into mathquest_private.scansob_members select c.id,s.id from mathquest_private.scansob_school c cross join public.students s where s.role='STUDENT' on conflict do nothing;
create table if not exists mathquest_private.scansob_codes (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references mathquest_private.scansob_school(id),
  code_hash text not null unique, expires_at timestamptz not null, used_at timestamptz, issued_by uuid not null
);
create table if not exists mathquest_private.scansob_connections (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references mathquest_private.scansob_school(id),
  workspace_id uuid not null, workspace_label text not null,
  token_hash text not null, status text not null check(status in ('active','revoked')),
  scope text not null default 'score:write' check(scope='score:write'),
  approved_by uuid not null, approved_at timestamptz not null default now(), revoked_at timestamptz,
  last_received_at timestamptz
);
create unique index if not exists scansob_active_workspace on mathquest_private.scansob_connections(school_id,workspace_id) where status='active';
create table if not exists mathquest_private.scansob_requests (
  id uuid primary key, school_id uuid not null references mathquest_private.scansob_school(id), workspace_id uuid not null,
  workspace_label text not null, request_hash text not null, delivery_hash text not null,
  code_id uuid not null references mathquest_private.scansob_codes(id),
  status text not null check(status in ('pending_approval','active','rejected','expired','revoked')),
  connection_id uuid references mathquest_private.scansob_connections(id),
  created_at timestamptz not null default now(), expires_at timestamptz not null
);
create table if not exists mathquest_private.scansob_exams (
  id bigint generated always as identity primary key, school_id uuid not null references mathquest_private.scansob_school(id),
  workspace_id uuid not null, source_exam_id uuid not null,
  revision bigint not null check(revision>0), action text not null, metadata jsonb not null,
  batch_count integer not null check(batch_count between 1 and 100), withdrawn boolean not null default false,
  reset_at timestamptz, updated_at timestamptz not null default now(),
  unique(school_id,workspace_id,source_exam_id)
);
create table if not exists mathquest_private.scansob_batches (
  exam_id bigint not null references mathquest_private.scansob_exams(id), revision bigint not null,
  batch_index integer not null, event_id uuid not null unique, primary key(exam_id,revision,batch_index)
);
create table if not exists mathquest_private.scansob_scores (
  id bigint generated always as identity primary key, exam_id bigint not null references mathquest_private.scansob_exams(id),
  student_id text not null references public.students(id) on delete cascade, student_code text not null check(student_code~'^[0-9]{5}$'),
  revision bigint not null, result jsonb not null, updated_at timestamptz not null default now(), unique(exam_id,student_code)
);
create index if not exists scansob_scores_student on mathquest_private.scansob_scores(student_id,id);
create table if not exists mathquest_private.scansob_issues (
  id bigint generated always as identity primary key, exam_id bigint not null references mathquest_private.scansob_exams(id),
  student_code text not null, revision bigint not null, reason text not null, updated_at timestamptz not null default now(),
  unique(exam_id,student_code)
);
create table if not exists mathquest_private.scansob_events (
  event_id uuid primary key, school_id uuid not null, connection_id uuid not null,
  exam_id bigint not null references mathquest_private.scansob_exams(id), raw_hash text not null,
  acknowledgment jsonb not null, received_at timestamptz not null default now()
);
create table if not exists mathquest_private.scansob_closed_terms (
  school_id uuid not null, academic_year integer not null, term integer not null,
  closed_at timestamptz not null default now(), primary key(school_id,academic_year,term)
);
create table if not exists mathquest_private.scansob_limits (
  key text primary key, bucket_start timestamptz not null, attempts integer not null
);
create table if not exists mathquest_private.scansob_audit (
  id bigint generated always as identity primary key, actor uuid, action text not null,
  target_id text, created_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['scansob_school','scansob_members','scansob_codes','scansob_connections','scansob_requests','scansob_exams','scansob_batches','scansob_scores','scansob_issues','scansob_events','scansob_closed_terms','scansob_limits','scansob_audit'] loop
    execute format('alter table mathquest_private.%I enable row level security',t);
    execute format('revoke all on mathquest_private.%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;

create or replace function mathquest_private.scansob_enrol()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if new.role='STUDENT' then insert into mathquest_private.scansob_members select id,new.id from mathquest_private.scansob_school on conflict do nothing; end if;
  return new;
end $$;
drop trigger if exists scansob_enrol on public.students;
create trigger scansob_enrol after insert on public.students for each row execute function mathquest_private.scansob_enrol();
create or replace function mathquest_private.scansob_limit(p_key text,p_max integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$ declare n integer; begin
  insert into mathquest_private.scansob_limits as l values(p_key,clock_timestamp(),1)
  on conflict(key) do update set attempts=case when l.bucket_start<clock_timestamp()-make_interval(secs=>p_seconds) then 1 else l.attempts+1 end,
    bucket_start=case when l.bucket_start<clock_timestamp()-make_interval(secs=>p_seconds) then clock_timestamp() else l.bucket_start end returning attempts into n;
  return n<=p_max;
end $$;
create or replace function mathquest_private.scansob_reply(p_status integer,p_body jsonb)
returns jsonb language sql immutable as $$ select jsonb_build_object('http_status',p_status,'body',p_body) $$;

-- Only the Edge Function service key can execute these two ingress RPCs.
create or replace function public.mq_scansob_pair(p_action text,p_request_id uuid,p_workspace_id uuid,
  p_request_hash text,p_code_hash text,p_workspace_label text,p_delivery_hash text,p_connection_id uuid,p_bearer_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r mathquest_private.scansob_requests%rowtype; c mathquest_private.scansob_codes%rowtype;
  conn mathquest_private.scansob_connections%rowtype; body jsonb; label text;
begin
  perform pg_advisory_xact_lock_shared(6101001);
  if p_action not in ('request','status','revoke') or p_request_id is null or p_workspace_id is null then
    return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end if;
  if not mathquest_private.scansob_limit('pair-global',300,300) then return jsonb_build_object('http_status',429,'retry_after',300,'body',jsonb_build_object('error','RATE_LIMITED')); end if;
  perform pg_advisory_xact_lock(hashtextextended('scansob:workspace:'||p_workspace_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('scansob:request:'||p_request_id::text,0));
  select * into r from mathquest_private.scansob_requests where id=p_request_id for update;
  if r.id is null then
    if p_action<>'request' then return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED')); end if;
    if not mathquest_private.scansob_limit('pair-workspace:'||p_workspace_id::text,10,300) then return jsonb_build_object('http_status',429,'retry_after',300,'body',jsonb_build_object('error','RATE_LIMITED')); end if;
    if p_request_hash!~'^[0-9a-f]{64}$' or p_delivery_hash!~'^[0-9a-f]{64}$' or coalesce(length(btrim(p_workspace_label)),0) not between 1 and 160 then
      return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end if;
    select * into c from mathquest_private.scansob_codes where code_hash=p_code_hash and expires_at>now() and used_at is null for update;
    if c.id is null then return mathquest_private.scansob_reply(403,jsonb_build_object('error','PAIRING_CODE_INVALID')); end if;
    update mathquest_private.scansob_codes set used_at=now() where id=c.id;
    insert into mathquest_private.scansob_requests(id,school_id,workspace_id,workspace_label,request_hash,delivery_hash,code_id,status,expires_at)
      values(p_request_id,c.school_id,p_workspace_id,btrim(p_workspace_label),p_request_hash,p_delivery_hash,c.id,'pending_approval',now()+interval '24 hours') returning * into r;
  else
    if r.workspace_id<>p_workspace_id then return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED')); end if;
    if p_action='revoke' then
      if r.connection_id is not null then
        select * into conn from mathquest_private.scansob_connections where id=r.connection_id for update;
        if conn.token_hash is distinct from p_bearer_hash or (p_connection_id is not null and p_connection_id<>conn.id) then
          return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED')); end if;
      elsif r.request_hash is distinct from p_request_hash then return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED')); end if;
      update mathquest_private.scansob_connections set status='revoked',revoked_at=coalesce(revoked_at,now()) where id=r.connection_id;
      update mathquest_private.scansob_requests set status='revoked' where id=r.id;
      return mathquest_private.scansob_reply(200,jsonb_build_object('schema_version','1.0','request_id',r.id,'status','revoked'));
    end if;
    if r.request_hash is distinct from p_request_hash or r.delivery_hash is distinct from p_delivery_hash
      or (p_action='request' and (r.workspace_label<>btrim(p_workspace_label) or not exists(select 1 from mathquest_private.scansob_codes where id=r.code_id and code_hash=p_code_hash))) then
      return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED')); end if;
  end if;
  if r.status in ('pending_approval','active') and r.expires_at<=now() then
    if r.status='pending_approval' then update mathquest_private.scansob_requests set status='expired' where id=r.id; end if;
    r.status:='expired';
  end if;
  if r.status='active' then
    select * into conn from mathquest_private.scansob_connections where id=r.connection_id;
    if conn.status<>'active' then r.status:='rejected'; end if;
  end if;
  body:=jsonb_build_object('schema_version','1.0','request_id',r.id,'status',case when r.status='revoked' then 'rejected' else r.status end);
  if r.status='active' then
    select coalesce(nullif(value,''),'MathQuest') into label from public.system_settings where key='school_name';
    body:=body||jsonb_build_object('connection',jsonb_build_object('id',conn.id,'destination_school_id',conn.school_id,
      'destination_label',left(coalesce(label,'MathQuest'),120),'scope','score:write'));
  end if;
  return mathquest_private.scansob_reply(200,body);
end $$;

create or replace function public.mq_scansob_ingest(p_payload jsonb,p_raw_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c mathquest_private.scansob_connections%rowtype; cfg mathquest_private.scansob_school%rowtype;
  e mathquest_private.scansob_exams%rowtype; ev mathquest_private.scansob_events%rowtype;
  event_uuid uuid; workspace_uuid uuid; exam_uuid uuid; rev bigint; batch integer; batches integer;
  act text; meta jsonb; row jsonb; code text; student text; reason text; ack jsonb; accepted integer:=0;
  unmatched jsonb:='[]'; invalid jsonb:='[]';
begin
  perform pg_advisory_xact_lock_shared(6101001);
  if jsonb_typeof(p_payload)<>'object' or p_raw_hash!~'^[0-9a-f]{64}$' or p_token_hash!~'^[0-9a-f]{64}$' then
    return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end if;
  begin
    event_uuid:=(p_payload->>'event_id')::uuid; workspace_uuid:=(p_payload->>'source_workspace_id')::uuid;
    exam_uuid:=(p_payload->>'source_exam_id')::uuid; rev:=(p_payload->>'publication_revision')::bigint;
    batch:=(p_payload->>'batch_index')::integer; batches:=(p_payload->>'batch_count')::integer;
    act:=p_payload->>'action'; meta:=p_payload->'exam';
    perform pg_advisory_xact_lock(hashtextextended('scansob:workspace:'||workspace_uuid::text,0));
    select * into c from mathquest_private.scansob_connections where id=(p_payload->>'connection_id')::uuid and token_hash=p_token_hash
      and workspace_id=workspace_uuid and status='active' and scope='score:write' for update;
  exception when invalid_text_representation or numeric_value_out_of_range then return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end;
  if c.id is null then return mathquest_private.scansob_reply(401,jsonb_build_object('error','UNAUTHORIZED')); end if;
  select * into cfg from mathquest_private.scansob_school where id=c.school_id;
  if not cfg.enabled then return mathquest_private.scansob_reply(503,jsonb_build_object('error','INTEGRATION_DISABLED')); end if;
  if not mathquest_private.scansob_limit('ingest:'||c.id::text,180,60) then return jsonb_build_object('http_status',429,'retry_after',60,'body',jsonb_build_object('error','RATE_LIMITED')); end if;
  if p_payload->>'schema_version'<>'1.0' or act not in ('publish_results','withdraw_exam') or rev not between 1 and 9007199254740991
    or batches not between 1 and 100 or batch not between 0 and batches-1 or jsonb_typeof(p_payload->'results')<>'array'
    or jsonb_array_length(p_payload->'results')>100 or meta is null then return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end if;
  if (act='withdraw_exam' and (batch<>0 or batches<>1 or jsonb_array_length(p_payload->'results')<>0))
    or (act='publish_results' and jsonb_array_length(p_payload->'results')=0) then return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end if;
  -- Global event lock precedes the exam lock: cross-exam event-id collisions cannot race.
  perform pg_advisory_xact_lock(hashtextextended('scansob:event:'||event_uuid::text,0));
  select * into ev from mathquest_private.scansob_events where event_id=event_uuid;
  if ev.event_id is not null then
    if ev.connection_id<>c.id or ev.raw_hash<>p_raw_hash then return mathquest_private.scansob_reply(409,jsonb_build_object('error','EVENT_HASH_CONFLICT')); end if;
    return mathquest_private.scansob_reply(200,ev.acknowledgment);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('scansob:exam:'||c.school_id::text||workspace_uuid::text||exam_uuid::text,0));
  select * into e from mathquest_private.scansob_exams where school_id=c.school_id and workspace_id=workspace_uuid and source_exam_id=exam_uuid for update;
  if e.id is not null and rev<e.revision then
    ack:=jsonb_build_object('schema_version','1.0','event_id',event_uuid,'status','stale_ignored','accepted',0,'unmatched','[]'::jsonb,'invalid','[]'::jsonb);
    insert into mathquest_private.scansob_events values(event_uuid,c.school_id,c.id,e.id,p_raw_hash,ack,now());
    return mathquest_private.scansob_reply(200,ack);
  end if;
  if exists(select 1 from mathquest_private.scansob_closed_terms where school_id=c.school_id and academic_year=(meta->>'academic_year')::integer and term=(meta->>'term')::integer) then
    return mathquest_private.scansob_reply(403,jsonb_build_object('error','TERM_CLOSED')); end if;
  if e.id is not null and rev=e.revision and (e.action<>act or e.metadata<>meta or e.batch_count<>batches or e.reset_at is not null) then
    return mathquest_private.scansob_reply(409,jsonb_build_object('error','REVISION_MANIFEST_CONFLICT')); end if;
  if e.id is not null and exists(select 1 from mathquest_private.scansob_batches where exam_id=e.id and revision=rev and batch_index=batch) then
    return mathquest_private.scansob_reply(409,jsonb_build_object('error','BATCH_CONFLICT')); end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'results') r group by r->>'student_code' having count(*)>1) then
    return mathquest_private.scansob_reply(400,jsonb_build_object('error','DUPLICATE_STUDENT_CODE')); end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'results') r where coalesce(r->>'student_code','')!~'^[0-9]{5}$') then
    return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end if;
  if e.id is not null and exists(select 1 from jsonb_array_elements(p_payload->'results') r join mathquest_private.scansob_scores s
    on s.exam_id=e.id and s.student_code=r->>'student_code' and s.revision=rev where s.result<>r) then
    return mathquest_private.scansob_reply(409,jsonb_build_object('error','STUDENT_REVISION_CONFLICT')); end if;
  if e.id is null then
    insert into mathquest_private.scansob_exams(school_id,workspace_id,source_exam_id,revision,action,metadata,batch_count,withdrawn)
      values(c.school_id,workspace_uuid,exam_uuid,rev,act,meta,batches,act='withdraw_exam') returning * into e;
  elsif rev>e.revision then
    update mathquest_private.scansob_exams set revision=rev,action=act,metadata=meta,batch_count=batches,withdrawn=act='withdraw_exam',reset_at=null,updated_at=now() where id=e.id returning * into e;
  end if;
  if act='withdraw_exam' then
    delete from mathquest_private.scansob_scores where exam_id=e.id;
    delete from mathquest_private.scansob_issues where exam_id=e.id;
  else
    for row in select value from jsonb_array_elements(p_payload->'results') loop
      code:=row->>'student_code'; reason:=null; student:=null;
      if jsonb_typeof(row->'score')<>'number' or jsonb_typeof(row->'max_score')<>'number' or jsonb_typeof(row->'percent')<>'number'
        or (row->>'max_score')::numeric<=0 or (row->>'max_score')::numeric>6000 or (row->>'score')::numeric<0
        or (row->>'score')::numeric>(row->>'max_score')::numeric or abs((row->>'percent')::numeric-(row->>'score')::numeric/(row->>'max_score')::numeric*100)>0.011 then
        reason:='INVALID_SCORE';
      elsif not exists(select 1 from public.students where id=code) then reason:='STUDENT_NOT_FOUND';
      elsif not exists(select 1 from public.students s join mathquest_private.scansob_members m on m.student_id=s.id and m.school_id=c.school_id where s.id=code and s.role='STUDENT') then reason:='STUDENT_NOT_ELIGIBLE';
      else student:=code; end if;
      if reason is not null then
        if reason='INVALID_SCORE' then invalid:=invalid||jsonb_build_array(jsonb_build_object('student_code',code,'reason',reason));
        else unmatched:=unmatched||jsonb_build_array(jsonb_build_object('student_code',code,'reason',reason)); end if;
        insert into mathquest_private.scansob_issues(exam_id,student_code,revision,reason) values(e.id,code,rev,reason)
          on conflict(exam_id,student_code) do update set revision=excluded.revision,reason=excluded.reason,updated_at=now();
      else
        insert into mathquest_private.scansob_scores(exam_id,student_id,student_code,revision,result) values(e.id,student,code,rev,row)
          on conflict(exam_id,student_code) do update set student_id=excluded.student_id,revision=excluded.revision,result=excluded.result,updated_at=now();
        delete from mathquest_private.scansob_issues where exam_id=e.id and student_code=code;
        accepted:=accepted+1;
      end if;
    end loop;
  end if;
  insert into mathquest_private.scansob_batches values(e.id,rev,batch,event_uuid);
  ack:=jsonb_build_object('schema_version','1.0','event_id',event_uuid,'status','processed','accepted',accepted,'unmatched',unmatched,'invalid',invalid);
  insert into mathquest_private.scansob_events values(event_uuid,c.school_id,c.id,e.id,p_raw_hash,ack,now());
  update mathquest_private.scansob_connections set last_received_at=now() where id=c.id;
  return mathquest_private.scansob_reply(200,ack);
end $$;

create or replace function public.mq_scansob_admin(p_teacher_token text,p_action text,p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg mathquest_private.scansob_school%rowtype; r mathquest_private.scansob_requests%rowtype;
  actor uuid; code text; target uuid; conn uuid;
begin
  perform mathquest_private.require_teacher(p_teacher_token); actor:=mathquest_private.google_uid();
  perform pg_advisory_xact_lock_shared(6101001);
  select * into cfg from mathquest_private.scansob_school for update;
  if p_action='create_code' then
    code:=upper(left(replace(gen_random_uuid()::text,'-',''),16));
    insert into mathquest_private.scansob_codes(school_id,code_hash,expires_at,issued_by)
      values(cfg.id,encode(sha256(convert_to(code,'UTF8')),'hex'),now()+interval '10 minutes',actor);
    insert into mathquest_private.scansob_audit(actor,action) values(actor,'create_code');
    return jsonb_build_object('code',code,'expires_at',now()+interval '10 minutes');
  elsif p_action in ('approve','reject') then
    target:=(p_args->>'request_id')::uuid;
    select * into r from mathquest_private.scansob_requests where id=target and school_id=cfg.id;
    perform pg_advisory_xact_lock(hashtextextended('scansob:workspace:'||r.workspace_id::text,0));
    select * into r from mathquest_private.scansob_requests where id=target and school_id=cfg.id for update;
    if r.id is null or r.status<>'pending_approval' or r.expires_at<=now() then raise exception 'คำขอหมดอายุหรือถูกดำเนินการแล้ว'; end if;
    if p_action='approve' then
      if exists(select 1 from mathquest_private.scansob_connections where school_id=cfg.id and workspace_id=r.workspace_id and status='active') then raise exception 'Workspace นี้เชื่อมต่อแล้ว กรุณาเพิกถอนรายการเดิมก่อน'; end if;
      insert into mathquest_private.scansob_connections(school_id,workspace_id,workspace_label,token_hash,status,approved_by)
        values(cfg.id,r.workspace_id,r.workspace_label,r.delivery_hash,'active',actor) returning id into conn;
      update mathquest_private.scansob_requests set status='active',connection_id=conn,expires_at=now()+interval '24 hours' where id=r.id;
    else update mathquest_private.scansob_requests set status='rejected' where id=r.id; end if;
    insert into mathquest_private.scansob_audit(actor,action,target_id) values(actor,p_action,target::text);
  elsif p_action='revoke' then
    target:=(p_args->>'connection_id')::uuid;
    select workspace_id into conn from mathquest_private.scansob_connections where id=target and school_id=cfg.id;
    perform pg_advisory_xact_lock(hashtextextended('scansob:workspace:'||conn::text,0));
    update mathquest_private.scansob_connections set status='revoked',revoked_at=now() where id=target and school_id=cfg.id;
    update mathquest_private.scansob_requests set status='revoked' where connection_id=target and school_id=cfg.id;
    insert into mathquest_private.scansob_audit(actor,action,target_id) values(actor,'revoke',target::text);
  elsif p_action='configure' then
    if jsonb_typeof(p_args->'enabled')<>'boolean' or jsonb_typeof(p_args->'student_view_enabled')<>'boolean' then raise exception 'ระบุสถานะให้ครบ'; end if;
    if (p_args->>'student_view_enabled')::boolean and not coalesce((p_args->>'accept_self_claim_risk')::boolean,false) then raise exception 'ยืนยันนโยบายการผูกรหัสนักเรียนก่อนเปิดดูคะแนน'; end if;
    update mathquest_private.scansob_school set enabled=(p_args->>'enabled')::boolean,
      student_view_enabled=(p_args->>'student_view_enabled')::boolean,
      identity_policy_accepted=coalesce((p_args->>'accept_self_claim_risk')::boolean,false),updated_at=now() where singleton;
    insert into mathquest_private.scansob_audit(actor,action) values(actor,'configure');
  elsif p_action<>'status' then raise exception 'คำสั่งไม่ถูกต้อง'; end if;
  select * into cfg from mathquest_private.scansob_school;
  return jsonb_build_object('school_id',cfg.id,'enabled',cfg.enabled,'student_view_enabled',cfg.student_view_enabled,
    'identity_policy_accepted',cfg.identity_policy_accepted,
    'score_count',(select count(*) from mathquest_private.scansob_scores),
    'requests',coalesce((select jsonb_agg(x order by x.created_at desc) from (select id,workspace_id,workspace_label,
      case when status='pending_approval' and expires_at<=now() then 'expired' else status end as status,created_at,expires_at
      from mathquest_private.scansob_requests where school_id=cfg.id order by created_at desc limit 100) x),'[]'),
    'connections',coalesce((select jsonb_agg(x order by x.approved_at desc) from (select id,workspace_id,workspace_label,status,approved_at,last_received_at
      from mathquest_private.scansob_connections where school_id=cfg.id order by approved_at desc limit 100) x),'[]'));
end $$;

create or replace function public.mq_scansob_read(p_kind text,p_exam_id bigint default null,p_after bigint default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare cfg mathquest_private.scansob_school%rowtype; student text; teacher boolean; rows jsonb; more boolean; cursor bigint; snapshot text;
begin
  if mathquest_private.google_uid() is null then raise exception 'GOOGLE_SESSION_REQUIRED'; end if;
  teacher:=mathquest_private.is_google_teacher(); student:=mathquest_private.google_student_id();
  select * into cfg from mathquest_private.scansob_school;
  if not teacher and (student is null or not cfg.student_view_enabled or not cfg.identity_policy_accepted) then
    return jsonb_build_object('enabled',false,'rows','[]'::jsonb,'next_cursor',null); end if;
  if p_limit is null or p_after is null or p_kind is null or p_limit not between 1 and 100 or p_after<0 or p_kind not in ('exams','scores','issues') or (p_kind='issues' and not teacher) then raise exception 'INVALID_QUERY'; end if;
  if p_kind='exams' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into rows from (
      select e.id,e.metadata,e.revision,e.withdrawn,e.updated_at,e.batch_count,
        case when teacher then e.workspace_id end as source_workspace_id,
        (select count(*) from mathquest_private.scansob_batches b where b.exam_id=e.id and b.revision=e.revision) as received_batches,
        (select count(*) from mathquest_private.scansob_scores s where s.exam_id=e.id and (teacher or s.student_id=student)) as student_count
      from mathquest_private.scansob_exams e where e.school_id=cfg.id and e.reset_at is null and e.id>p_after and (teacher or
        (not e.withdrawn and (select count(*) from mathquest_private.scansob_batches b where b.exam_id=e.id and b.revision=e.revision)=e.batch_count
          and exists(select 1 from mathquest_private.scansob_connections c where c.school_id=e.school_id and c.workspace_id=e.workspace_id and c.status='active')
          and exists(select 1 from mathquest_private.scansob_scores s join mathquest_private.scansob_members m on m.student_id=s.student_id and m.school_id=e.school_id where s.exam_id=e.id and s.student_id=student)))
      order by e.id limit p_limit+1) x;
  elsif p_kind='scores' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into rows from (
      select s.id,s.exam_id,s.student_code,s.result,s.revision,s.updated_at,e.metadata,
        case when teacher then e.workspace_id end as source_workspace_id,
        case when teacher then st.name end as student_name,case when teacher then st.grade end as grade
      from mathquest_private.scansob_scores s join mathquest_private.scansob_exams e on e.id=s.exam_id join public.students st on st.id=s.student_id
      join mathquest_private.scansob_members m on m.student_id=s.student_id and m.school_id=e.school_id
      where e.school_id=cfg.id and e.reset_at is null and s.id>p_after and (p_exam_id is null or s.exam_id=p_exam_id) and (teacher or
        (s.student_id=student and not e.withdrawn and
          (select count(*) from mathquest_private.scansob_batches b where b.exam_id=e.id and b.revision=e.revision)=e.batch_count and
          exists(select 1 from mathquest_private.scansob_connections c where c.school_id=e.school_id and c.workspace_id=e.workspace_id and c.status='active')))
      order by s.id limit p_limit+1) x;
  else
    select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into rows from (
      select i.id,i.exam_id,i.student_code,i.reason,i.revision,i.updated_at,e.metadata from mathquest_private.scansob_issues i join mathquest_private.scansob_exams e on e.id=i.exam_id
      where e.school_id=cfg.id and i.id>p_after and (p_exam_id is null or i.exam_id=p_exam_id) order by i.id limit p_limit+1) x;
  end if;
  more:=jsonb_array_length(rows)>p_limit;
  if more then rows:=rows-(jsonb_array_length(rows)-1); end if;
  if more then cursor:=(rows->(jsonb_array_length(rows)-1)->>'id')::bigint; end if;
  select md5(concat(cfg.updated_at::text,':',coalesce((select value from public.system_settings where key='school_data_version'),''),':',
    count(*)::text,':',max(received_at)::text)) into snapshot from mathquest_private.scansob_events where school_id=cfg.id;
  return jsonb_build_object('enabled',true,'rows',rows,'next_cursor',cursor,'version',snapshot);
end $$;

-- Same reset transaction and lock as attendance/shop; revoke before removing receipts.
create or replace function public.mq_reset_student_progress(p_teacher_token text,p_expected_version text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare teacher text; password text; result jsonb; school uuid; n bigint;
begin
  teacher:=mathquest_private.require_teacher(p_teacher_token);
  if not public.mq_google_recent_auth() then raise exception 'GOOGLE_REAUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(6101001);
  select id into school from mathquest_private.scansob_school;
  if exists(select 1 from mathquest_private.scansob_exams e where e.school_id=school and not e.withdrawn and e.reset_at is null
    and exists(select 1 from mathquest_private.scansob_connections c where c.school_id=e.school_id and c.workspace_id=e.workspace_id and c.status='active')) then
    raise exception 'กรุณาถอนการเผยแพร่คะแนนจาก ScanSob ทุกข้อสอบที่ยังเชื่อมต่อให้สำเร็จก่อนล้างข้อมูล';
  end if;
  select count(*) into n from mathquest_private.scansob_scores;
  select s.password into password from public.students s where s.id=teacher;
  result:=public.reset_school_progress(p_teacher_token,password,p_expected_version);
  insert into mathquest_private.scansob_closed_terms(school_id,academic_year,term)
    select school,(metadata->>'academic_year')::integer,(metadata->>'term')::integer from mathquest_private.scansob_exams where school_id=school and metadata?'academic_year' on conflict do nothing;
  insert into mathquest_private.scansob_closed_terms(school_id,academic_year,term)
    select school,y.value::integer,t.value::integer from public.system_settings y cross join public.system_settings t
      where y.key='semester_year' and t.key='semester_number' and y.value~'^[0-9]{4}$' and t.value~'^[123]$' on conflict do nothing;
  update mathquest_private.scansob_connections set status='revoked',revoked_at=coalesce(revoked_at,now()) where school_id=school;
  update mathquest_private.scansob_requests set status='revoked' where school_id=school;
  update mathquest_private.scansob_codes set expires_at=least(expires_at,now()) where school_id=school;
  delete from mathquest_private.scansob_scores where exam_id in (select id from mathquest_private.scansob_exams where school_id=school);
  delete from mathquest_private.scansob_issues where exam_id in (select id from mathquest_private.scansob_exams where school_id=school);
  delete from mathquest_private.scansob_batches where exam_id in (select id from mathquest_private.scansob_exams where school_id=school);
  delete from mathquest_private.scansob_events where school_id=school;
  update mathquest_private.scansob_exams set metadata='{}',withdrawn=true,reset_at=now(),updated_at=now() where school_id=school;
  update mathquest_private.scansob_school set enabled=false,student_view_enabled=false,updated_at=now() where id=school;
  insert into mathquest_private.scansob_audit(actor,action) values(mathquest_private.google_uid(),'reset');
  return result||jsonb_build_object('exam_scores_deleted',n);
end $$;

revoke all on function mathquest_private.scansob_enrol(),mathquest_private.scansob_limit(text,integer,integer),mathquest_private.scansob_reply(integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.mq_scansob_pair(text,uuid,uuid,text,text,text,text,uuid,text),public.mq_scansob_ingest(jsonb,text,text),
  public.mq_scansob_admin(text,text,jsonb),public.mq_scansob_read(text,bigint,bigint,integer) from public,anon,authenticated;
grant execute on function public.mq_scansob_pair(text,uuid,uuid,text,text,text,text,uuid,text),public.mq_scansob_ingest(jsonb,text,text) to service_role;
grant execute on function public.mq_scansob_admin(text,text,jsonb),public.mq_scansob_read(text,bigint,bigint,integer) to authenticated;
notify pgrst,'reload schema';
commit;
