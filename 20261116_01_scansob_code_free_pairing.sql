-- Additive to ScanSob receiver 03. Signed requests start disabled.
begin;
select pg_advisory_xact_lock(6101001);
do $$ begin
  if to_regclass('mathquest_private.scansob_cancelled_requests') is null
    or not exists(select 1 from mathquest_private.scansob_school where receiver_profile='1.1') then
    raise exception 'Apply 20261015_03_scansob_recovery_hardening.sql first';
  end if;
end $$;

alter table mathquest_private.scansob_school
  add column if not exists signed_pairing_window_id uuid,
  add column if not exists signed_pairing_revision bigint not null default 0;
create table if not exists mathquest_private.scansob_pairing_teachers (
  school_id uuid not null references mathquest_private.scansob_school(id),
  email text not null check(length(email) between 3 and 254 and email=lower(btrim(email))),
  primary key(school_id,email)
);
alter table mathquest_private.scansob_pairing_teachers enable row level security;
revoke all on mathquest_private.scansob_pairing_teachers from public,anon,authenticated,service_role;

alter table mathquest_private.scansob_requests
  alter column code_id drop not null,
  add column if not exists signed_raw_hash text,
  add column if not exists signed_sender_id uuid,
  add column if not exists signed_sender_email text,
  add column if not exists signed_sender_name text;
alter table mathquest_private.scansob_requests drop constraint if exists scansob_request_origin;
alter table mathquest_private.scansob_requests add constraint scansob_request_origin check (
  (code_id is not null and signed_raw_hash is null and signed_sender_id is null
    and signed_sender_email is null and signed_sender_name is null)
  or (code_id is null and signed_raw_hash is not null and signed_raw_hash~'^[0-9a-f]{64}$'
    and signed_sender_id is not null and signed_sender_email is not null)
);
create index if not exists scansob_pending_requests
  on mathquest_private.scansob_requests(school_id,created_at desc,id desc) where status='pending_approval';

create or replace function mathquest_private.scansob_pairing_slot_busy(p_school uuid,p_workspace uuid,p_at timestamptz)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from mathquest_private.scansob_requests
    where school_id=p_school and workspace_id=p_workspace and status='pending_approval' and expires_at>p_at)
  or exists(select 1 from mathquest_private.scansob_connections
    where school_id=p_school and workspace_id=p_workspace and status='active');
$$;

-- Keep the receiver 03 status/revoke and legacy replay contract intact.
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
    -- Both ingress paths hold the same Workspace lock before looking at the slot.
    if mathquest_private.scansob_pairing_slot_busy(c.school_id,p_workspace_id,clock_timestamp()) then
      return mathquest_private.scansob_reply(409,jsonb_build_object('error','PAIRING_WORKSPACE_BUSY'));
    end if;
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

create or replace function public.mq_scansob_prepare_signed(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  req uuid := (p_payload->>'request_id')::uuid;
  workspace uuid := (p_payload->>'source_workspace_id')::uuid;
  school uuid := (p_payload->>'destination_school_id')::uuid;
  sender uuid := (p_payload->>'sender_auth_id')::uuid;
  sender_email text := lower(btrim(p_payload->>'sender_verified_email'));
  window_id uuid;
begin
  if req is null or workspace is null or school is null or sender is null or coalesce(length(sender_email),0) not between 3 and 254 then
    return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA'));
  end if;
  perform pg_advisory_xact_lock_shared(6101001);
  if not mathquest_private.scansob_limit('pair-signed-prepare-global',300,300) then
    return jsonb_build_object('http_status',429,'retry_after',300,'body',jsonb_build_object('error','RATE_LIMITED'));
  end if;
  select s.signed_pairing_window_id into window_id from mathquest_private.scansob_school s
    join mathquest_private.scansob_pairing_teachers t on t.school_id=s.id and t.email=sender_email where s.id=school;
  if not found then return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED')); end if;
  if window_id is null then return mathquest_private.scansob_reply(503,jsonb_build_object('error','SIGNED_PAIRING_DISABLED')); end if;
  if not mathquest_private.scansob_limit('pair-signed-prepare-sender:'||sender::text,20,300) then
    return jsonb_build_object('http_status',429,'retry_after',300,'body',jsonb_build_object('error','RATE_LIMITED'));
  end if;
  return mathquest_private.scansob_reply(200,jsonb_build_object('schema_version','1.0','action','prepare_signed',
    'request_id',req,'destination_school_id',school,'pairing_window_id',window_id));
end $$;

create or replace function public.mq_scansob_request_signed(
  p_payload jsonb,p_raw_hash text,p_request_hash text,p_delivery_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  req uuid := (p_payload->>'request_id')::uuid;
  workspace uuid := (p_payload->>'source_workspace_id')::uuid;
  school uuid := (p_payload->>'destination_school_id')::uuid;
  sender uuid := (p_payload->>'sender_auth_id')::uuid;
  sender_email text := lower(btrim(p_payload->>'sender_verified_email'));
  workspace_label text := btrim(p_payload->>'workspace_label');
  sender_name text := nullif(btrim(p_payload->>'sender_display_name'),'');
  window_id uuid := (p_payload->>'pairing_window_id')::uuid;
  cfg mathquest_private.scansob_school%rowtype;
  r mathquest_private.scansob_requests%rowtype;
  terminal mathquest_private.scansob_cancelled_requests%rowtype;
  c mathquest_private.scansob_connections%rowtype;
  payload jsonb; current_status text; instant timestamptz;
begin
  if req is null or workspace is null or school is null or sender is null or window_id is null
    or coalesce(length(sender_email),0) not between 3 and 254
    or coalesce(length(workspace_label),0) not between 1 and 160 or length(sender_name)>120
    or not coalesce(p_raw_hash~'^[0-9a-f]{64}$' and p_request_hash~'^[0-9a-f]{64}$' and p_delivery_hash~'^[0-9a-f]{64}$',false) then
    return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA'));
  end if;
  perform pg_advisory_xact_lock_shared(6101001);
  if not mathquest_private.scansob_limit('pair-signed-global',300,300) then
    return jsonb_build_object('http_status',429,'retry_after',300,'body',jsonb_build_object('error','RATE_LIMITED'));
  end if;
  select * into cfg from mathquest_private.scansob_school where id=school for update;
  if not found then return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED')); end if;
  perform pg_advisory_xact_lock(hashtextextended('scansob:workspace:'||workspace::text,0));
  perform pg_advisory_xact_lock(hashtextextended('scansob:request:'||req::text,0));
  instant:=clock_timestamp();
  select * into r from mathquest_private.scansob_requests where id=req for update;
  if found then
    if r.school_id<>school or r.workspace_id<>workspace or r.signed_raw_hash is distinct from p_raw_hash
      or not mathquest_private.scansob_hash_matches(r.request_hash,p_request_hash)
      or not mathquest_private.scansob_hash_matches(r.delivery_hash,p_delivery_hash) then
      return mathquest_private.scansob_reply(409,jsonb_build_object('error','PAIRING_REQUEST_CONFLICT'));
    end if;
    current_status:=case when r.status in ('pending_approval','active') and r.expires_at<=instant then 'expired'
      when r.status='revoked' then 'rejected' else r.status end;
  else
    select * into terminal from mathquest_private.scansob_cancelled_requests where request_id=req;
    if found then
      if terminal.workspace_id<>workspace or not mathquest_private.scansob_hash_matches(terminal.request_hash,p_request_hash) then
        return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED'));
      end if;
      current_status:='expired';
    else
      if not exists(select 1 from mathquest_private.scansob_pairing_teachers t where t.school_id=school and t.email=sender_email) then
        return mathquest_private.scansob_reply(403,jsonb_build_object('error','UNAUTHORIZED'));
      end if;
      if cfg.signed_pairing_window_id is null then
        return mathquest_private.scansob_reply(503,jsonb_build_object('error','SIGNED_PAIRING_DISABLED'));
      end if;
      if cfg.signed_pairing_window_id<>window_id then
        return mathquest_private.scansob_reply(409,jsonb_build_object('error','PAIRING_WINDOW_CHANGED'));
      end if;
      if not mathquest_private.scansob_limit('pair-signed-sender:'||sender::text,5,900)
        or not mathquest_private.scansob_limit('pair-signed-workspace:'||workspace::text,5,900) then
        return jsonb_build_object('http_status',429,'retry_after',900,'body',jsonb_build_object('error','RATE_LIMITED'));
      end if;
      if mathquest_private.scansob_pairing_slot_busy(school,workspace,instant) then
        return mathquest_private.scansob_reply(409,jsonb_build_object('error','PAIRING_WORKSPACE_BUSY'));
      end if;
      insert into mathquest_private.scansob_requests(id,school_id,workspace_id,workspace_label,request_hash,delivery_hash,
        status,created_at,expires_at,signed_raw_hash,signed_sender_id,signed_sender_email,signed_sender_name)
      values(req,school,workspace,workspace_label,p_request_hash,p_delivery_hash,'pending_approval',instant,
        instant+interval '24 hours',p_raw_hash,sender,sender_email,sender_name);
      insert into mathquest_private.scansob_audit(actor,action,target_id) values(sender,'request_signed',req::text);
      current_status:='pending_approval';
    end if;
  end if;
  if current_status='active' then
    select * into c from mathquest_private.scansob_connections where id=r.connection_id and status='active';
    if not found then current_status:='rejected'; end if;
  end if;
  payload:=jsonb_build_object('schema_version','1.0','request_id',req,'status',current_status);
  if current_status='active' then
    payload:=payload||jsonb_build_object('connection',jsonb_build_object('id',c.id,'destination_school_id',school,
      'destination_label',left(coalesce((select nullif(value,'') from public.system_settings where key='school_name'),'MathQuest'),120),
      'scope','score:write'));
  end if;
  return mathquest_private.scansob_reply(200,payload);
end $$;

create or replace function mathquest_private.scansob_check_signed_approval()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- The existing admin RPC holds the school and Workspace locks while activating.
  if old.status='pending_approval' and new.status='active' then
    if old.expires_at<=clock_timestamp() then raise exception 'คำขอหมดอายุแล้ว'; end if;
    if exists(select 1 from mathquest_private.scansob_requests where school_id=old.school_id and workspace_id=old.workspace_id
      and id<>old.id and status='pending_approval' and expires_at>clock_timestamp()) then
      raise exception 'Workspace นี้มีคำขอรออยู่มากกว่าหนึ่งรายการ กรุณาปฏิเสธคำขอซ้ำก่อนอนุมัติ';
    end if;
    if old.signed_raw_hash is not null and not exists(
      select 1 from mathquest_private.scansob_pairing_teachers where school_id=old.school_id and email=old.signed_sender_email) then
      raise exception 'อีเมลผู้ส่งไม่ได้รับอนุญาตแล้ว กรุณาตรวจรายชื่อหรือปฏิเสธคำขอ';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists scansob_check_signed_approval on mathquest_private.scansob_requests;
create trigger scansob_check_signed_approval before update of status on mathquest_private.scansob_requests
  for each row execute function mathquest_private.scansob_check_signed_approval();

create or replace function public.mq_scansob_pairing_inbox(p_teacher_token text,p_action text,p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg mathquest_private.scansob_school%rowtype; snapshot jsonb; amount bigint;
  page integer; mail text; wanted boolean; instant timestamptz:=clock_timestamp();
begin
  perform mathquest_private.require_teacher(p_teacher_token);
  select * into cfg from mathquest_private.scansob_school;
  if p_action='configure' then
    perform pg_advisory_xact_lock_shared(6101001);
    select * into cfg from mathquest_private.scansob_school where id=cfg.id for update;
    if jsonb_typeof(p_args->'enabled') is distinct from 'boolean'
      or jsonb_typeof(p_args->'emails') is distinct from 'array'
      or (p_args->>'revision') is distinct from cfg.signed_pairing_revision::text then
      raise exception 'PAIRING_POLICY_CHANGED';
    end if;
    if jsonb_array_length(p_args->'emails')>100 then raise exception 'PAIRING_EMAILS_INVALID'; end if;
    wanted:=(p_args->>'enabled')::boolean;
    if wanted and jsonb_array_length(p_args->'emails')=0 then raise exception 'PAIRING_EMAILS_INVALID'; end if;
    delete from mathquest_private.scansob_pairing_teachers where school_id=cfg.id;
    for mail in select lower(btrim(value)) from jsonb_array_elements_text(p_args->'emails') loop
      if mail is null or length(mail)>254 or mail !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$' then
        raise exception 'PAIRING_EMAILS_INVALID';
      end if;
      insert into mathquest_private.scansob_pairing_teachers(school_id,email) values(cfg.id,mail) on conflict do nothing;
    end loop;
    update mathquest_private.scansob_school set
      signed_pairing_window_id=case when wanted then coalesce(cfg.signed_pairing_window_id,gen_random_uuid()) end,
      signed_pairing_revision=cfg.signed_pairing_revision+1 where id=cfg.id returning * into cfg;
    insert into mathquest_private.scansob_audit(actor,action,target_id)
      values(mathquest_private.google_uid(),'configure_signed_pairing',cfg.id::text);
  end if;
  if p_action in ('policy','configure') then
    return jsonb_build_object('school_id',cfg.id,'enabled',cfg.signed_pairing_window_id is not null,'revision',cfg.signed_pairing_revision::text,
      'emails',coalesce((select jsonb_agg(email order by email) from mathquest_private.scansob_pairing_teachers where school_id=cfg.id),'[]'));
  end if;
  if p_action is distinct from 'inbox' then raise exception 'INVALID_QUERY'; end if;
  page:=coalesce((p_args->>'page')::integer,0);
  if page not between 0 and 5000 then raise exception 'INVALID_QUERY'; end if;
  with pending as (
    select id,workspace_id,workspace_label,created_at,expires_at,signed_sender_email as sender_email,
      signed_sender_name as sender_name
    from mathquest_private.scansob_requests where school_id=cfg.id and status='pending_approval' and expires_at>instant
  )
  select (select count(*) from pending),coalesce((select jsonb_agg(x order by x.created_at desc,x.id desc)
    from (select * from pending order by created_at desc,id desc limit 20 offset page*20) x),'[]'::jsonb)
  into amount,snapshot;
  return jsonb_build_object('school_id',cfg.id,'count',amount,'requests',snapshot,
    'server_now',instant,'page',page,'page_size',20);
end $$;

create or replace function mathquest_private.scansob_reset_signed_pairing()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update mathquest_private.scansob_school set signed_pairing_window_id=null,
    signed_pairing_revision=signed_pairing_revision+1 where singleton;
  return new;
end $$;
drop trigger if exists scansob_reset_signed_pairing on mathquest_private.scansob_audit;
create trigger scansob_reset_signed_pairing after insert on mathquest_private.scansob_audit
  for each row when (new.action='reset') execute function mathquest_private.scansob_reset_signed_pairing();

create or replace function mathquest_private.scansob_pairing_topic_allowed(p_topic text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select mathquest_private.is_google_teacher() and exists(
    select 1 from mathquest_private.scansob_school where p_topic='mq:scansob:inbox:'||id::text);
$$;
create or replace function mathquest_private.scansob_notify_inbox()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' then
    if old.status=new.status or (old.status<>'pending_approval' and new.status<>'pending_approval') then return new; end if;
  end if;
  perform realtime.send('{}'::jsonb,'requests_changed','mq:scansob:inbox:'||new.school_id::text,true);
  return new;
exception when others then
  -- Inbox polling still reads committed state if Realtime is unavailable.
  raise warning 'ScanSob inbox broadcast unavailable (%)',sqlstate;
  return new;
end $$;
do $$ begin
  if to_regclass('realtime.messages') is not null and to_regprocedure('realtime.topic()') is not null
    and to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    drop policy if exists mq_scansob_inbox_read on realtime.messages;
    drop policy if exists mq_scansob_inbox_scope_read on realtime.messages;
    drop policy if exists mq_scansob_inbox_no_client_send on realtime.messages;
    create policy mq_scansob_inbox_read on realtime.messages for select to authenticated
      using (extension='broadcast' and mathquest_private.scansob_pairing_topic_allowed((select realtime.topic())));
    create policy mq_scansob_inbox_scope_read on realtime.messages as restrictive for select to anon,authenticated
      using ((coalesce((select realtime.topic()),'') not like 'mq:scansob:inbox:%' and coalesce(topic,'') not like 'mq:scansob:inbox:%')
        or (extension='broadcast' and topic=(select realtime.topic())
          and mathquest_private.scansob_pairing_topic_allowed((select realtime.topic()))));
    create policy mq_scansob_inbox_no_client_send on realtime.messages as restrictive for insert to anon,authenticated
      with check (coalesce((select realtime.topic()),'') not like 'mq:scansob:inbox:%'
        and coalesce(topic,'') not like 'mq:scansob:inbox:%');
    drop trigger if exists scansob_notify_inbox on mathquest_private.scansob_requests;
    create trigger scansob_notify_inbox after insert or update of status on mathquest_private.scansob_requests
      for each row execute function mathquest_private.scansob_notify_inbox();
  end if;
end $$;

revoke all on function public.mq_scansob_prepare_signed(jsonb),public.mq_scansob_request_signed(jsonb,text,text,text),
  public.mq_scansob_pair(text,uuid,uuid,text,text,text,text,uuid,text),
  public.mq_scansob_pairing_inbox(text,text,jsonb),mathquest_private.scansob_pairing_topic_allowed(text),
  mathquest_private.scansob_pairing_slot_busy(uuid,uuid,timestamptz),
  mathquest_private.scansob_check_signed_approval(),mathquest_private.scansob_reset_signed_pairing(),
  mathquest_private.scansob_notify_inbox() from public,anon,authenticated,service_role;
grant execute on function public.mq_scansob_prepare_signed(jsonb),public.mq_scansob_request_signed(jsonb,text,text,text) to service_role;
grant execute on function public.mq_scansob_pair(text,uuid,uuid,text,text,text,text,uuid,text) to service_role;
grant execute on function public.mq_scansob_pairing_inbox(text,text,jsonb) to authenticated;
grant execute on function mathquest_private.scansob_pairing_topic_allowed(text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
