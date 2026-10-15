-- Run after 20261015_02_scansob_receiver.sql. No HTTP or student-data reset.
-- Wire schema stays 1.0; receiver lifecycle profile becomes 1.1.
begin;
select pg_advisory_xact_lock(6101001);
do $$ begin
  if to_regclass('mathquest_private.scansob_events') is null then
    raise exception 'Install 20261015_02_scansob_receiver.sql first';
  end if;
end $$;

alter table mathquest_private.scansob_school add column if not exists receiver_profile text not null default '1.0';
alter table mathquest_private.scansob_exams add column if not exists publication_connection_id uuid references mathquest_private.scansob_connections(id);
alter table mathquest_private.scansob_scores add column if not exists connection_id uuid references mathquest_private.scansob_connections(id);
create index if not exists scansob_scores_connection on mathquest_private.scansob_scores(connection_id);

-- A closed, never-registered request ID cannot be activated by a delayed request.
create table if not exists mathquest_private.scansob_cancelled_requests (
  request_id uuid primary key, workspace_id uuid not null,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
-- No scores, names, titles or student codes are retained in purge evidence.
create table if not exists mathquest_private.scansob_exam_purges (
  exam_id bigint primary key references mathquest_private.scansob_exams(id),
  reset_id uuid not null, revision bigint not null, purged_at timestamptz not null,
  acknowledged_revision bigint, manifest_hash text
);
alter table mathquest_private.scansob_cancelled_requests enable row level security;
alter table mathquest_private.scansob_exam_purges enable row level security;
revoke all on mathquest_private.scansob_cancelled_requests,mathquest_private.scansob_exam_purges from public,anon,authenticated,service_role;

do $$ begin
  if exists(select 1 from mathquest_private.scansob_school where receiver_profile='1.0') then
    -- Backfill only when committed batches prove one publishing connection.
    update mathquest_private.scansob_scores s set connection_id=p.connection_id
      from (select b.exam_id,b.revision,(array_agg(distinct ev.connection_id))[1] as connection_id
        from mathquest_private.scansob_batches b join mathquest_private.scansob_events ev on ev.event_id=b.event_id
        where ev.exam_id=b.exam_id group by b.exam_id,b.revision having count(distinct ev.connection_id)=1) p
      where s.exam_id=p.exam_id and s.revision=p.revision and s.connection_id is null;
    update mathquest_private.scansob_exams e set publication_connection_id=p.connection_id
      from (select b.exam_id,b.revision,(array_agg(distinct ev.connection_id))[1] as connection_id
        from mathquest_private.scansob_batches b join mathquest_private.scansob_events ev on ev.event_id=b.event_id
        where ev.exam_id=b.exam_id group by b.exam_id,b.revision having count(distinct ev.connection_id)=1) p
      where e.id=p.exam_id and e.revision=p.revision and e.publication_connection_id is null;
    -- An old reset is eligible only if its preserved tombstone is actually empty.
    insert into mathquest_private.scansob_exam_purges(exam_id,reset_id,revision,purged_at)
      select e.id,gen_random_uuid(),e.revision,e.reset_at from mathquest_private.scansob_exams e
      where e.reset_at is not null and e.withdrawn and e.metadata='{}'::jsonb
        and not exists(select 1 from mathquest_private.scansob_scores s where s.exam_id=e.id)
        and not exists(select 1 from mathquest_private.scansob_issues i where i.exam_id=e.id)
        and not exists(select 1 from mathquest_private.scansob_batches b where b.exam_id=e.id)
      on conflict(exam_id) do nothing;
    update mathquest_private.scansob_school set receiver_profile='1.1',updated_at=now();
    insert into mathquest_private.scansob_audit(action,target_id) values('upgrade_receiver','1.1');
  end if;
end $$;

create or replace function mathquest_private.scansob_hash_matches(a text,b text)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare x bytea; y bytea; difference integer:=0; i integer;
begin
  if a is null or b is null or a!~'^[0-9a-f]{64}$' or b!~'^[0-9a-f]{64}$' then return false; end if;
  x:=decode(a,'hex'); y:=decode(b,'hex');
  for i in 0..31 loop difference:=difference | (get_byte(x,i) # get_byte(y,i)); end loop;
  return difference=0;
end $$;

create or replace function mathquest_private.scansob_score_visible(p_score_id bigint)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from mathquest_private.scansob_scores s
    join mathquest_private.scansob_exams e on e.id=s.exam_id
    join mathquest_private.scansob_connections c on c.id=s.connection_id
    join mathquest_private.scansob_members m on m.school_id=e.school_id and m.student_id=s.student_id
    where s.id=p_score_id and e.reset_at is null and not e.withdrawn
      and e.publication_connection_id=c.id and c.status='active'
      and c.school_id=e.school_id and c.workspace_id=e.workspace_id
      and (select count(*) from mathquest_private.scansob_batches b where b.exam_id=e.id and b.revision=e.revision)=e.batch_count)
$$;

create or replace function public.mq_scansob_pair(p_action text,p_request_id uuid,p_workspace_id uuid,
  p_request_hash text,p_code_hash text,p_workspace_label text,p_delivery_hash text,p_connection_id uuid,p_bearer_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r mathquest_private.scansob_requests%rowtype; c mathquest_private.scansob_codes%rowtype;
  conn mathquest_private.scansob_connections%rowtype; cancelled mathquest_private.scansob_cancelled_requests%rowtype;
  body jsonb; label text; challenge_ok boolean; token_ok boolean;
begin
  perform pg_advisory_xact_lock_shared(6101001);
  if p_action is null or p_action not in ('request','status','revoke') or p_request_id is null or p_workspace_id is null then
    return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end if;
  if not mathquest_private.scansob_limit('pair-global',300,300) then
    return jsonb_build_object('http_status',429,'retry_after',300,'body',jsonb_build_object('error','RATE_LIMITED')); end if;
  perform pg_advisory_xact_lock(hashtextextended('scansob:workspace:'||p_workspace_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('scansob:request:'||p_request_id::text,0));
  select * into r from mathquest_private.scansob_requests where id=p_request_id for update;
  if r.id is null then
    if p_connection_id is not null or coalesce(p_bearer_hash,'')<>'' or not mathquest_private.scansob_hash_matches(p_request_hash,p_request_hash) then
      return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED')); end if;
    select * into cancelled from mathquest_private.scansob_cancelled_requests where request_id=p_request_id;
    if cancelled.request_id is not null then
      if cancelled.workspace_id<>p_workspace_id or not mathquest_private.scansob_hash_matches(cancelled.request_hash,p_request_hash) then
        return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED')); end if;
    elsif p_action<>'request' then
      -- Bound storage and request rates; never age out IDs and allow late activation.
      if not mathquest_private.scansob_limit('pair-unregistered',30,3600)
        or not mathquest_private.scansob_limit('pair-unregistered:'||p_workspace_id::text,5,300)
        or (select count(*) from mathquest_private.scansob_cancelled_requests)>=10000 then
        return jsonb_build_object('http_status',429,'retry_after',3600,'body',jsonb_build_object('error','RATE_LIMITED')); end if;
      insert into mathquest_private.scansob_cancelled_requests(request_id,workspace_id,request_hash)
        values(p_request_id,p_workspace_id,p_request_hash);
      insert into mathquest_private.scansob_audit(action,target_id) values('close_unregistered_request',p_request_id::text);
    end if;
    if cancelled.request_id is not null or p_action<>'request' then
      return mathquest_private.scansob_reply(200,jsonb_build_object('schema_version','1.0','request_id',p_request_id,
        'status',case when p_action='revoke' then 'revoked' else 'expired' end)); end if;
    if not mathquest_private.scansob_limit('pair-workspace:'||p_workspace_id::text,10,300) then
      return jsonb_build_object('http_status',429,'retry_after',300,'body',jsonb_build_object('error','RATE_LIMITED')); end if;
    if not mathquest_private.scansob_hash_matches(p_delivery_hash,p_delivery_hash) or coalesce(length(btrim(p_workspace_label)),0) not between 1 and 160 then
      return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end if;
    select * into c from mathquest_private.scansob_codes where code_hash=p_code_hash and expires_at>now() and used_at is null for update;
    if c.id is null then return mathquest_private.scansob_reply(403,jsonb_build_object('error','PAIRING_CODE_INVALID')); end if;
    update mathquest_private.scansob_codes set used_at=now() where id=c.id;
    insert into mathquest_private.scansob_requests(id,school_id,workspace_id,workspace_label,request_hash,delivery_hash,code_id,status,expires_at)
      values(p_request_id,c.school_id,p_workspace_id,btrim(p_workspace_label),p_request_hash,p_delivery_hash,c.id,'pending_approval',now()+interval '24 hours') returning * into r;
  else
    if r.workspace_id<>p_workspace_id then return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED')); end if;
    challenge_ok:=mathquest_private.scansob_hash_matches(r.request_hash,p_request_hash);
    if r.connection_id is not null then select * into conn from mathquest_private.scansob_connections where id=r.connection_id for update; end if;
    if p_action='revoke' then
      token_ok:=conn.id is not null and mathquest_private.scansob_hash_matches(conn.token_hash,p_bearer_hash);
      if (p_connection_id is not null and p_connection_id is distinct from r.connection_id) or not (challenge_ok or token_ok) then
        return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED')); end if;
      update mathquest_private.scansob_connections set status='revoked',revoked_at=coalesce(revoked_at,now()) where id=r.connection_id;
      update mathquest_private.scansob_requests set status='revoked' where id=r.id;
      if r.status<>'revoked' then insert into mathquest_private.scansob_audit(action,target_id) values('source_revoke',r.id::text); end if;
      return mathquest_private.scansob_reply(200,jsonb_build_object('schema_version','1.0','request_id',r.id,'status','revoked'));
    end if;
    if not challenge_ok or not mathquest_private.scansob_hash_matches(r.delivery_hash,p_delivery_hash)
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

-- Ingress and read functions are replaced below; old migrations stay unchanged.

create or replace function public.mq_scansob_ingest(p_payload jsonb,p_raw_hash text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c mathquest_private.scansob_connections%rowtype; cfg mathquest_private.scansob_school%rowtype;
  e mathquest_private.scansob_exams%rowtype; ev mathquest_private.scansob_events%rowtype;
  purge mathquest_private.scansob_exam_purges%rowtype;
  event_uuid uuid; workspace_uuid uuid; exam_uuid uuid; rev bigint; batch integer; batches integer;
  act text; meta jsonb; row jsonb; code text; student text; reason text; ack jsonb; accepted integer:=0;
  unmatched jsonb:='[]'; invalid jsonb:='[]'; closed boolean; manifest text;
begin
  perform pg_advisory_xact_lock_shared(6101001);
  if jsonb_typeof(p_payload) is distinct from 'object' or not mathquest_private.scansob_hash_matches(p_raw_hash,p_raw_hash)
    or not mathquest_private.scansob_hash_matches(p_token_hash,p_token_hash) then
    return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end if;
  begin
    event_uuid:=(p_payload->>'event_id')::uuid; workspace_uuid:=(p_payload->>'source_workspace_id')::uuid;
    exam_uuid:=(p_payload->>'source_exam_id')::uuid; rev:=(p_payload->>'publication_revision')::bigint;
    batch:=(p_payload->>'batch_index')::integer; batches:=(p_payload->>'batch_count')::integer;
    act:=p_payload->>'action'; meta:=p_payload->'exam';
    perform pg_advisory_xact_lock(hashtextextended('scansob:workspace:'||workspace_uuid::text,0));
    select * into c from mathquest_private.scansob_connections where id=(p_payload->>'connection_id')::uuid
      and workspace_id=workspace_uuid and status='active' and scope='score:write' for update;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end;
  if c.id is null or not mathquest_private.scansob_hash_matches(c.token_hash,p_token_hash) then
    return mathquest_private.scansob_reply(401,jsonb_build_object('error','UNAUTHORIZED')); end if;
  select * into cfg from mathquest_private.scansob_school where id=c.school_id;
  if not cfg.enabled then return mathquest_private.scansob_reply(503,jsonb_build_object('error','INTEGRATION_DISABLED')); end if;
  if not mathquest_private.scansob_limit('ingest:'||c.id::text,180,60) then
    return jsonb_build_object('http_status',429,'retry_after',60,'body',jsonb_build_object('error','RATE_LIMITED')); end if;
  if p_payload->>'schema_version' is distinct from '1.0' or act is null or act not in ('publish_results','withdraw_exam')
    or rev is null or rev not between 1 and 9007199254740991 or batches is null or batches not between 1 and 100
    or batch is null or batch not between 0 and batches-1 or jsonb_typeof(p_payload->'results') is distinct from 'array'
    or jsonb_array_length(p_payload->'results')>100 or jsonb_typeof(meta) is distinct from 'object' then
    return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end if;
  if (act='withdraw_exam' and (batch<>0 or batches<>1 or jsonb_array_length(p_payload->'results')<>0))
    or (act='publish_results' and jsonb_array_length(p_payload->'results')=0) then
    return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end if;
  perform pg_advisory_xact_lock(hashtextextended('scansob:event:'||event_uuid::text,0));
  select * into ev from mathquest_private.scansob_events where event_id=event_uuid;
  if ev.event_id is not null then
    if ev.connection_id<>c.id or ev.raw_hash<>p_raw_hash then
      return mathquest_private.scansob_reply(409,jsonb_build_object('error','EVENT_HASH_CONFLICT')); end if;
    return mathquest_private.scansob_reply(200,ev.acknowledgment);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('scansob:exam:'||c.school_id::text||workspace_uuid::text||exam_uuid::text,0));
  select * into e from mathquest_private.scansob_exams where school_id=c.school_id and workspace_id=workspace_uuid and source_exam_id=exam_uuid for update;
  if e.id is not null and rev<e.revision then
    ack:=jsonb_build_object('schema_version','1.0','event_id',event_uuid,'status','stale_ignored','accepted',0,'unmatched','[]'::jsonb,'invalid','[]'::jsonb);
    insert into mathquest_private.scansob_events values(event_uuid,c.school_id,c.id,e.id,p_raw_hash,ack,now());
    return mathquest_private.scansob_reply(200,ack);
  end if;
  closed:=exists(select 1 from mathquest_private.scansob_closed_terms where school_id=c.school_id
    and academic_year=(meta->>'academic_year')::integer and term=(meta->>'term')::integer);
  if closed then
    -- An authenticated withdrawal may confirm a real, audited purge. Never publish
    -- into a closed term, infer deletion from TERM_CLOSED, or expose reset metadata.
    select * into purge from mathquest_private.scansob_exam_purges where exam_id=e.id for update;
    if act<>'withdraw_exam' or purge.exam_id is null or e.reset_at is null or not e.withdrawn
      or e.metadata<>'{}'::jsonb or e.reset_at is distinct from purge.purged_at or e.revision<purge.revision
      or exists(select 1 from mathquest_private.scansob_scores s where s.exam_id=e.id)
      or exists(select 1 from mathquest_private.scansob_issues i where i.exam_id=e.id) then
      return mathquest_private.scansob_reply(403,jsonb_build_object('error','TERM_CLOSED')); end if;
    manifest:=encode(sha256(convert_to(meta::text,'UTF8')),'hex');
    if rev=e.revision and (purge.acknowledged_revision is distinct from rev or purge.manifest_hash is distinct from manifest
      or e.publication_connection_id is distinct from c.id) then
      return mathquest_private.scansob_reply(409,jsonb_build_object('error','REVISION_MANIFEST_CONFLICT')); end if;
    if exists(select 1 from mathquest_private.scansob_batches where exam_id=e.id and revision=rev) then
      return mathquest_private.scansob_reply(409,jsonb_build_object('error','BATCH_CONFLICT')); end if;
    update mathquest_private.scansob_exams set revision=rev,action=act,withdrawn=true,batch_count=1,
      publication_connection_id=c.id,updated_at=now() where id=e.id;
    update mathquest_private.scansob_exam_purges set acknowledged_revision=rev,manifest_hash=manifest where exam_id=e.id;
    insert into mathquest_private.scansob_audit(action,target_id) values('ack_purged_withdrawal',event_uuid::text);
  else
    if e.id is not null and rev=e.revision and (e.action<>act or e.metadata<>meta or e.batch_count<>batches
      or e.reset_at is not null or e.publication_connection_id is distinct from c.id) then
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
      insert into mathquest_private.scansob_exams(school_id,workspace_id,source_exam_id,revision,action,metadata,batch_count,withdrawn,publication_connection_id)
        values(c.school_id,workspace_uuid,exam_uuid,rev,act,meta,batches,act='withdraw_exam',c.id) returning * into e;
    elsif rev>e.revision then
      update mathquest_private.scansob_exams set revision=rev,action=act,metadata=meta,batch_count=batches,
        withdrawn=act='withdraw_exam',reset_at=null,publication_connection_id=c.id,updated_at=now() where id=e.id returning * into e;
    end if;
    if act='withdraw_exam' then
      delete from mathquest_private.scansob_scores where exam_id=e.id;
      delete from mathquest_private.scansob_issues where exam_id=e.id;
    else
      for row in select value from jsonb_array_elements(p_payload->'results') loop
        code:=row->>'student_code'; reason:=null; student:=null;
        if jsonb_typeof(row->'score') is distinct from 'number' or jsonb_typeof(row->'max_score') is distinct from 'number'
          or jsonb_typeof(row->'percent') is distinct from 'number' or (row->>'max_score')::numeric<=0
          or (row->>'max_score')::numeric>6000 or (row->>'score')::numeric<0 or (row->>'score')::numeric>(row->>'max_score')::numeric
          or abs((row->>'percent')::numeric-(row->>'score')::numeric/(row->>'max_score')::numeric*100)>0.011 then reason:='INVALID_SCORE';
        elsif not exists(select 1 from public.students where id=code) then reason:='STUDENT_NOT_FOUND';
        elsif not exists(select 1 from public.students s join mathquest_private.scansob_members m on m.student_id=s.id and m.school_id=c.school_id
          where s.id=code and s.role='STUDENT') then reason:='STUDENT_NOT_ELIGIBLE';
        else student:=code; end if;
        if reason is not null then
          if reason='INVALID_SCORE' then invalid:=invalid||jsonb_build_array(jsonb_build_object('student_code',code,'reason',reason));
          else unmatched:=unmatched||jsonb_build_array(jsonb_build_object('student_code',code,'reason',reason)); end if;
          insert into mathquest_private.scansob_issues(exam_id,student_code,revision,reason) values(e.id,code,rev,reason)
            on conflict(exam_id,student_code) do update set revision=excluded.revision,reason=excluded.reason,updated_at=now();
        else
          insert into mathquest_private.scansob_scores(exam_id,student_id,student_code,revision,result,connection_id)
            values(e.id,student,code,rev,row,c.id) on conflict(exam_id,student_code) do update
              set student_id=excluded.student_id,revision=excluded.revision,result=excluded.result,connection_id=excluded.connection_id,updated_at=now();
          delete from mathquest_private.scansob_issues where exam_id=e.id and student_code=code;
          accepted:=accepted+1;
        end if;
      end loop;
    end if;
  end if;
  insert into mathquest_private.scansob_batches values(e.id,rev,batch,event_uuid);
  ack:=jsonb_build_object('schema_version','1.0','event_id',event_uuid,'status','processed','accepted',accepted,'unmatched',unmatched,'invalid',invalid);
  insert into mathquest_private.scansob_events values(event_uuid,c.school_id,c.id,e.id,p_raw_hash,ack,now());
  update mathquest_private.scansob_connections set last_received_at=now() where id=c.id;
  return mathquest_private.scansob_reply(200,ack);
end $$;

create or replace function public.mq_scansob_read(p_kind text,p_exam_id bigint default null,p_after bigint default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare cfg mathquest_private.scansob_school%rowtype; student text; teacher boolean; rows jsonb; more boolean; cursor bigint; snapshot text;
begin
  if mathquest_private.google_uid() is null then raise exception 'GOOGLE_SESSION_REQUIRED'; end if;
  teacher:=mathquest_private.is_google_teacher(); student:=mathquest_private.google_student_id();
  select * into cfg from mathquest_private.scansob_school;
  if not teacher and (student is null or not cfg.student_view_enabled or not cfg.identity_policy_accepted) then
    return jsonb_build_object('enabled',false,'rows','[]'::jsonb,'next_cursor',null,'receiver_profile','1.1'); end if;
  if p_limit is null or p_after is null or p_kind is null or p_limit not between 1 and 100 or p_after<0
    or p_kind not in ('exams','scores','issues') or (p_kind='issues' and not teacher) then raise exception 'INVALID_QUERY'; end if;
  if p_kind='exams' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into rows from (
      select e.id,e.metadata,e.revision,e.withdrawn,e.updated_at,e.batch_count,
        case when teacher then e.workspace_id end as source_workspace_id,
        (select count(*) from mathquest_private.scansob_batches b where b.exam_id=e.id and b.revision=e.revision) as received_batches,
        (select count(*) from mathquest_private.scansob_scores s where s.exam_id=e.id and (teacher or s.student_id=student)) as student_count,
        (select count(*) from mathquest_private.scansob_scores s where s.exam_id=e.id and (teacher or s.student_id=student)
          and mathquest_private.scansob_score_visible(s.id)) as visible_student_count
      from mathquest_private.scansob_exams e where e.school_id=cfg.id and e.reset_at is null and e.id>p_after and (teacher or
        exists(select 1 from mathquest_private.scansob_scores s where s.exam_id=e.id and s.student_id=student and mathquest_private.scansob_score_visible(s.id)))
      order by e.id limit p_limit+1) x;
  elsif p_kind='scores' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into rows from (
      select s.id,s.exam_id,s.student_code,s.result,s.revision,s.updated_at,e.metadata,
        case when teacher then e.workspace_id end as source_workspace_id,
        case when teacher then st.name end as student_name,case when teacher then st.grade end as grade,
        case when teacher then mathquest_private.scansob_score_visible(s.id) end as student_visible,
        case when teacher then case
          when e.withdrawn then 'withdrawn'
          when s.connection_id is null or e.publication_connection_id is null then 'unverified_origin'
          when not exists(select 1 from mathquest_private.scansob_connections c where c.id=s.connection_id and c.status='active') then 'connection_revoked'
          when s.connection_id<>e.publication_connection_id then 'previous_connection'
          when (select count(*) from mathquest_private.scansob_batches b where b.exam_id=e.id and b.revision=e.revision)<e.batch_count then 'incomplete'
          else 'current' end end as visibility_reason
      from mathquest_private.scansob_scores s join mathquest_private.scansob_exams e on e.id=s.exam_id join public.students st on st.id=s.student_id
      join mathquest_private.scansob_members m on m.student_id=s.student_id and m.school_id=e.school_id
      where e.school_id=cfg.id and e.reset_at is null and s.id>p_after and (p_exam_id is null or s.exam_id=p_exam_id)
        and (teacher or (s.student_id=student and mathquest_private.scansob_score_visible(s.id)))
      order by s.id limit p_limit+1) x;
  else
    select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into rows from (
      select i.id,i.exam_id,i.student_code,i.reason,i.revision,i.updated_at,e.metadata
      from mathquest_private.scansob_issues i join mathquest_private.scansob_exams e on e.id=i.exam_id
      where e.school_id=cfg.id and i.id>p_after and (p_exam_id is null or i.exam_id=p_exam_id) order by i.id limit p_limit+1) x;
  end if;
  more:=jsonb_array_length(rows)>p_limit;
  if more then rows:=rows-(jsonb_array_length(rows)-1); cursor:=(rows->(jsonb_array_length(rows)-1)->>'id')::bigint; end if;
  select md5(concat(cfg.updated_at::text,':',coalesce((select value from public.system_settings where key='school_data_version'),''),':',
    count(*)::text,':',max(received_at)::text,':',
    (select string_agg(c.id::text||':'||c.status,',' order by c.id) from mathquest_private.scansob_connections c where c.school_id=cfg.id)))
    into snapshot from mathquest_private.scansob_events where school_id=cfg.id;
  return jsonb_build_object('enabled',true,'rows',rows,'next_cursor',cursor,'version',snapshot,'receiver_profile','1.1');
end $$;

do $$ begin
  if to_regprocedure('public.mq_reset_student_progress_v02(text,text)') is null then
    alter function public.mq_reset_student_progress(text,text) rename to mq_reset_student_progress_v02;
  end if;
  if to_regprocedure('public.mq_scansob_admin_v02(text,text,jsonb)') is null then
    alter function public.mq_scansob_admin(text,text,jsonb) rename to mq_scansob_admin_v02;
  end if;
end $$;
revoke all on function public.mq_reset_student_progress_v02(text,text),public.mq_scansob_admin_v02(text,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.mq_reset_student_progress(p_teacher_token text,p_expected_version text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; reset_uuid uuid:=gen_random_uuid();
begin
  perform mathquest_private.require_teacher(p_teacher_token);
  perform pg_advisory_xact_lock(6101001);
  result:=public.mq_reset_student_progress_v02(p_teacher_token,p_expected_version);
  insert into mathquest_private.scansob_exam_purges(exam_id,reset_id,revision,purged_at)
    select e.id,reset_uuid,e.revision,e.reset_at from mathquest_private.scansob_exams e
    where e.reset_at is not null and e.withdrawn and e.metadata='{}'::jsonb
      and not exists(select 1 from mathquest_private.scansob_scores s where s.exam_id=e.id)
      and not exists(select 1 from mathquest_private.scansob_issues i where i.exam_id=e.id)
      and not exists(select 1 from mathquest_private.scansob_batches b where b.exam_id=e.id)
    on conflict(exam_id) do update set reset_id=excluded.reset_id,revision=excluded.revision,purged_at=excluded.purged_at,
      acknowledged_revision=null,manifest_hash=null;
  insert into mathquest_private.scansob_audit(actor,action,target_id)
    values(mathquest_private.google_uid(),'record_exam_purge',reset_uuid::text);
  return result;
end $$;

create or replace function public.mq_scansob_admin(p_teacher_token text,p_action text,p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; held bigint;
begin
  result:=public.mq_scansob_admin_v02(p_teacher_token,p_action,p_args);
  if p_action='create_code' then return result; end if;
  select count(*) into held from mathquest_private.scansob_scores s where not mathquest_private.scansob_score_visible(s.id);
  return result||jsonb_build_object('receiver_profile','1.1','held_score_count',held,
    'requests',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select r.id,r.workspace_id,r.workspace_label,r.created_at,r.expires_at,
        case when r.status='pending_approval' and r.expires_at<=now() then 'expired' else r.status end as status,
        (select count(*) from mathquest_private.scansob_scores s join mathquest_private.scansob_exams e on e.id=s.exam_id
          where e.school_id=r.school_id and e.workspace_id=r.workspace_id and not mathquest_private.scansob_score_visible(s.id)) as held_score_count
      from mathquest_private.scansob_requests r where r.school_id=(result->>'school_id')::uuid order by r.created_at desc limit 100) x),'[]'::jsonb));
end $$;

revoke all on function mathquest_private.scansob_hash_matches(text,text),mathquest_private.scansob_score_visible(bigint) from public,anon,authenticated,service_role;
revoke all on function public.mq_scansob_pair(text,uuid,uuid,text,text,text,text,uuid,text),public.mq_scansob_ingest(jsonb,text,text),
  public.mq_scansob_admin(text,text,jsonb),public.mq_scansob_read(text,bigint,bigint,integer),public.mq_reset_student_progress(text,text) from public,anon,authenticated,service_role;
grant execute on function public.mq_scansob_pair(text,uuid,uuid,text,text,text,text,uuid,text),public.mq_scansob_ingest(jsonb,text,text) to service_role;
grant execute on function public.mq_scansob_admin(text,text,jsonb),public.mq_scansob_read(text,bigint,bigint,integer),public.mq_reset_student_progress(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
