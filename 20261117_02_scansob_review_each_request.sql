-- Requires the code-free pairing migration installed at commit 7e8113a.
-- No rollout flag is switched on during installation.
begin;
select pg_advisory_xact_lock(6101001);
do $$ begin
  if to_regprocedure('public.mq_scansob_prepare_signed(jsonb)') is null
    or to_regclass('mathquest_private.scansob_pairing_teachers') is null
    or not exists(select 1 from information_schema.columns where table_schema='mathquest_private'
      and table_name='scansob_school' and column_name='signed_pairing_window_id')
    or not exists(select 1 from mathquest_private.scansob_school where receiver_profile='1.1') then
    raise exception 'Apply 20261116_01_scansob_code_free_pairing.sql (window ID revision) first';
  end if;
end $$;

alter table mathquest_private.scansob_school add column if not exists signed_pairing_policy text
  not null default 'email_allowlist' check(signed_pairing_policy in ('email_allowlist','review_each_request'));

-- The caller already checked the signed source identity; this selects the admission policy.
create or replace function mathquest_private.scansob_sender_may_request(p_school uuid,p_policy text,p_email text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_policy='review_each_request' or (p_policy='email_allowlist' and exists(
    select 1 from mathquest_private.scansob_pairing_teachers where school_id=p_school and email=p_email));
$$;

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
  select s.signed_pairing_window_id into window_id from mathquest_private.scansob_school s where s.id=school
    and mathquest_private.scansob_sender_may_request(s.id,s.signed_pairing_policy,sender_email);
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
      if not mathquest_private.scansob_sender_may_request(school,cfg.signed_pairing_policy,sender_email) then
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
      select 1 from mathquest_private.scansob_school s where s.id=old.school_id
        and mathquest_private.scansob_sender_may_request(s.id,s.signed_pairing_policy,old.signed_sender_email)) then
      raise exception 'อีเมลผู้ส่งไม่ได้รับอนุญาตแล้ว กรุณาตรวจรายชื่อหรือปฏิเสธคำขอ';
    end if;
  end if;
  return new;
end $$;

create or replace function public.mq_scansob_pairing_inbox(p_teacher_token text,p_action text,p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg mathquest_private.scansob_school%rowtype; snapshot jsonb; amount bigint;
  page integer; mail text; wanted boolean; wanted_policy text; destination text;
  instant timestamptz:=clock_timestamp();
begin
  perform mathquest_private.require_teacher(p_teacher_token);
  select * into cfg from mathquest_private.scansob_school;
  if p_action='configure' then
    perform pg_advisory_xact_lock_shared(6101001);
    select * into cfg from mathquest_private.scansob_school where id=cfg.id for update;
    if jsonb_typeof(p_args->'enabled') is distinct from 'boolean'
      or (p_args->>'revision') is distinct from cfg.signed_pairing_revision::text then
      raise exception 'PAIRING_POLICY_CHANGED';
    end if;
    wanted_policy:=coalesce(p_args->>'policy',cfg.signed_pairing_policy);
    if wanted_policy not in ('email_allowlist','review_each_request') then raise exception 'PAIRING_POLICY_INVALID'; end if;
    wanted:=(p_args->>'enabled')::boolean;
    if wanted_policy='email_allowlist' then
      if p_args?'emails' then
        if jsonb_typeof(p_args->'emails') is distinct from 'array' then raise exception 'PAIRING_EMAILS_INVALID'; end if;
        if jsonb_array_length(p_args->'emails')>100 then raise exception 'PAIRING_EMAILS_INVALID'; end if;
        delete from mathquest_private.scansob_pairing_teachers where school_id=cfg.id;
        for mail in select lower(btrim(value)) from jsonb_array_elements_text(p_args->'emails') loop
          if mail is null or length(mail)>254 or mail !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$' then
            raise exception 'PAIRING_EMAILS_INVALID';
          end if;
          insert into mathquest_private.scansob_pairing_teachers(school_id,email) values(cfg.id,mail) on conflict do nothing;
        end loop;
      end if;
      if wanted and not exists(select 1 from mathquest_private.scansob_pairing_teachers where school_id=cfg.id) then
        raise exception 'PAIRING_EMAILS_INVALID';
      end if;
    end if;
    insert into mathquest_private.scansob_audit(actor,action,target_id)
      values(mathquest_private.google_uid(),case when cfg.signed_pairing_policy<>wanted_policy
        then 'pairing_policy_'||wanted_policy else 'configure_signed_pairing' end,cfg.id::text);
    update mathquest_private.scansob_school set signed_pairing_policy=wanted_policy,
      signed_pairing_window_id=case when not wanted then null
        when cfg.signed_pairing_policy<>wanted_policy then gen_random_uuid()
        else coalesce(cfg.signed_pairing_window_id,gen_random_uuid()) end,
      signed_pairing_revision=cfg.signed_pairing_revision+1 where id=cfg.id returning * into cfg;
  end if;
  if p_action in ('policy','configure') then
    return jsonb_build_object('school_id',cfg.id,'enabled',cfg.signed_pairing_window_id is not null,'revision',cfg.signed_pairing_revision::text,
      'policy',cfg.signed_pairing_policy,'emails',case when cfg.signed_pairing_policy='email_allowlist'
        then coalesce((select jsonb_agg(email order by email) from mathquest_private.scansob_pairing_teachers where school_id=cfg.id),'[]')
        else '[]'::jsonb end);
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
  select left(nullif(btrim(value),''),120) into destination from public.system_settings where key='school_name';
  return jsonb_build_object('school_id',cfg.id,'destination_label',coalesce(destination,'MathQuest'),'count',amount,'requests',snapshot,
    'server_now',instant,'page',page,'page_size',20);
end $$;

create or replace function public.mq_scansob_pair(p_action text,p_request_id uuid,p_workspace_id uuid,
  p_request_hash text,p_code_hash text,p_workspace_label text,p_delivery_hash text,p_connection_id uuid,p_bearer_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r mathquest_private.scansob_requests%rowtype; c mathquest_private.scansob_codes%rowtype;
  conn mathquest_private.scansob_connections%rowtype; cancelled mathquest_private.scansob_cancelled_requests%rowtype;
  body jsonb; label text; challenge_ok boolean; token_ok boolean; pairing_policy text;
begin
  perform pg_advisory_xact_lock_shared(6101001);
  if p_action is null or p_action not in ('request','status','revoke') or p_request_id is null or p_workspace_id is null then
    return mathquest_private.scansob_reply(400,jsonb_build_object('error','INVALID_SCHEMA')); end if;
  if not mathquest_private.scansob_limit('pair-global',300,300) then
    return jsonb_build_object('http_status',429,'retry_after',300,'body',jsonb_build_object('error','RATE_LIMITED')); end if;
  if p_action='request' then
    -- Serialize code admission with a policy switch before taking the Workspace lock.
    select signed_pairing_policy into pairing_policy from mathquest_private.scansob_school where singleton for update;
  end if;
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
    if pairing_policy='review_each_request' then
      return mathquest_private.scansob_reply(409,jsonb_build_object('error','LEGACY_PAIRING_DISABLED'));
    end if;
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

do $$ begin
  if to_regprocedure('public.mq_scansob_admin_v20261116(text,text,jsonb)') is null then
    alter function public.mq_scansob_admin(text,text,jsonb) rename to mq_scansob_admin_v20261116;
  end if;
end $$;
create or replace function public.mq_scansob_admin(p_teacher_token text,p_action text,p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare pairing_policy text;
begin
  if p_action='create_code' then
    perform mathquest_private.require_teacher(p_teacher_token);
    perform pg_advisory_xact_lock_shared(6101001);
    select signed_pairing_policy into pairing_policy from mathquest_private.scansob_school where singleton for update;
    if pairing_policy='review_each_request' then raise exception 'LEGACY_PAIRING_DISABLED'; end if;
  end if;
  return public.mq_scansob_admin_v20261116(p_teacher_token,p_action,p_args);
end $$;

revoke all on function public.mq_scansob_admin_v20261116(text,text,jsonb),
  mathquest_private.scansob_sender_may_request(uuid,text,text),mathquest_private.scansob_check_signed_approval()
  from public,anon,authenticated,service_role;
revoke all on function public.mq_scansob_admin(text,text,jsonb),public.mq_scansob_pairing_inbox(text,text,jsonb),
  public.mq_scansob_prepare_signed(jsonb),public.mq_scansob_request_signed(jsonb,text,text,text),
  public.mq_scansob_pair(text,uuid,uuid,text,text,text,text,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.mq_scansob_admin(text,text,jsonb),public.mq_scansob_pairing_inbox(text,text,jsonb) to authenticated;
grant execute on function public.mq_scansob_prepare_signed(jsonb),public.mq_scansob_request_signed(jsonb,text,text,text),
  public.mq_scansob_pair(text,uuid,uuid,text,text,text,text,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
