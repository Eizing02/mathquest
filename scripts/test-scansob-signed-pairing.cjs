const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHmac } = require('node:crypto');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setup, event, read } = require('./test-scansob.cjs');
const { PGlite } = require(path.join(process.env.SQL_QA_MODULE_ROOT || path.join(tmpdir(), 'mathquest-sql-qa', 'node_modules'), '@electric-sql/pglite'));

const endpoint = '/functions/v1/pair-scansob-workspace';
const keyId = 'test-key';
const key = randomBytes(32);
const email = 'teacher@fixture.invalid';

async function main() {
  const { createScanSobHandler } = await import(pathToFileURL(path.resolve(__dirname, '../supabase/functions/_shared/scansob-http.mjs')));
  const db = new PGlite();
  try {
    const {teacher,student,actor} = await setup(db);
    const rpc = async (name,args) => (await db.query(`select public.${name}(${Object.keys(args).map((arg,i) => arg+'=> $'+(i+1)).join(',')}) as value`, Object.values(args))).rows[0].value;
    await actor(teacher);
    let token = await rpc('mq_open_teacher_session',{});
    const teacherRpc = async (name,action,args) => {
      await actor(teacher);
      return rpc(name,{p_teacher_token:token,p_action:action,p_args:args || {}});
    };
    const admin = (action,args) => teacherRpc('mq_scansob_admin',action,args);
    const inbox = (action,args) => teacherRpc('mq_scansob_pairing_inbox',action,args);
    const school = (await admin('status')).school_id;
    const fromEdge = async (name,args) => {
      assert.equal(Object.hasOwn(args.p_payload || {},'request_secret'),false);
      await db.exec('reset role; set role service_role');
      return rpc(name,args);
    };
    const pairHandler = createScanSobHandler('pair',{rpc:fromEdge,pairingKey:'test-delivery-key-not-for-production',signingKey:key.toString('base64url'),
      signingKeyId:keyId,signingSchoolId:school});
    const scoreHandler = createScanSobHandler('scores',{rpc:fromEdge});
    const headers = (raw, stamp = Math.floor(Date.now()/1000), signingKey = key) => ({
      'X-ScanSob-Key-Id':keyId, 'X-ScanSob-Timestamp':String(stamp),
      'X-ScanSob-Signature':createHmac('sha256',signingKey).update(`mq-scansob-pair-v1\nPOST\n${endpoint}\n${keyId}\n${stamp}\n`).update(raw).digest('base64url')
    });
    const call = async (handler, body, extra, raw = JSON.stringify(body)) => {
      const response = await handler(new Request('https://fixture.invalid'+endpoint,{method:'POST',
        headers:{'Content-Type':'application/json',...extra},body:raw}));
      return { status:response.status, body:await response.json() };
    };
    const send = body => call(pairHandler,body,headers(JSON.stringify(body)));
    let windowId = randomUUID();
    const request = (extra = {}) => ({schema_version:'1.0',action:'request_signed',request_id:randomUUID(),
      source_workspace_id:randomUUID(),destination_school_id:school,workspace_label:'พื้นที่ทดสอบ',
      sender_auth_id:randomUUID(),sender_verified_email:email,sender_display_name:'ครูทดสอบ',
      pairing_window_id:windowId,requested_at:new Date().toISOString(),request_secret:randomBytes(32).toString('base64url'),...extra});
    const prepareBody = body => Object.fromEntries(['schema_version','request_id','source_workspace_id','destination_school_id',
      'sender_auth_id','sender_verified_email'].map(name => [name,body[name]]).concat([['action','prepare_signed']]));
    const bound = (body, action='status') => ({schema_version:'1.0',action,request_id:body.request_id,
      source_workspace_id:body.source_workspace_id,request_secret:body.request_secret});
    const codeRequest = async (workspace=randomUUID()) => ({schema_version:'1.0',action:'request',
      request_id:randomUUID(),source_workspace_id:workspace,workspace_label:'legacy',
      request_secret:randomBytes(32).toString('base64url'),pairing_code:(await admin('create_code')).code});
    const legacy = await codeRequest();
    assert.equal((await call(pairHandler,legacy)).body.status,'pending_approval');
    await admin('approve',{request_id:legacy.request_id});
    const existing = await call(pairHandler,bound(legacy));
    assert.equal(existing.body.status,'active');
    await db.exec('reset role');
    await db.exec(`
      create schema realtime;
      create table realtime.messages(topic text,extension text,event text,payload jsonb,private boolean);
      alter table realtime.messages enable row level security;
      grant usage on schema realtime to authenticated,anon;
      grant select,insert on realtime.messages to authenticated,anon;
      create policy broad_fixture_access on realtime.messages for all to authenticated,anon using (true) with check (true);
      create function realtime.topic() returns text language sql stable as $$select current_setting('fixture.topic',true)$$;
      create function realtime.send(p jsonb,e text,t text,v boolean) returns void language sql as $$
        insert into realtime.messages values(t,'broadcast',e,p,v)
      $$;
    `);
    const migration = read('20261116_01_scansob_code_free_pairing.sql');
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(read('20261117_01_scansob_publication_receipts.sql'));
    await db.exec(read('20261117_01_scansob_publication_receipts.sql'));
    assert.deepEqual(await call(pairHandler,bound(legacy)),existing,'existing connection and token survive migration');

    const before = request();
    let policy = await inbox('policy');
    assert.deepEqual(policy.emails,[]);
    policy = await inbox('configure',{enabled:false,emails:[email],revision:policy.revision});
    assert.equal((await send(before)).body.error,'SIGNED_PAIRING_DISABLED');
    assert.equal((await send(prepareBody(before))).body.error,'SIGNED_PAIRING_DISABLED');
    policy = await inbox('configure',{enabled:true,emails:['  TEACHER@fixture.invalid '],revision:policy.revision});
    assert.deepEqual(policy.emails,[email]);
    await assert.rejects(() => inbox('configure',{enabled:false,emails:[],revision:'0'}),/PAIRING_POLICY_CHANGED/);
    assert.equal((await send(before)).body.error,'PAIRING_WINDOW_CHANGED');
    assert.equal((await call(pairHandler,prepareBody(before))).status,401);
    assert.equal((await send(prepareBody(request({sender_verified_email:'not-allowed@fixture.invalid'})))).status,403);
    assert.equal((await send(prepareBody(request({destination_school_id:randomUUID()})))).status,403);
    const started = request({requested_at:new Date(Date.now()+3600000).toISOString()});
    const prepared = await send(prepareBody(started));
    windowId = prepared.body.pairing_window_id;
    assert.match(windowId,/^[0-9a-f-]{36}$/);
    assert.deepEqual(prepared,{status:200,body:{schema_version:'1.0',action:'prepare_signed',
      request_id:started.request_id,destination_school_id:school,pairing_window_id:windowId}});
    assert.equal((await inbox('inbox')).count,0,'prepare never creates a request or token');
    assert.equal((await send(request({sender_verified_email:'not-allowed@fixture.invalid'}))).status,403);
    assert.equal((await send(request({destination_school_id:randomUUID()}))).status,403);
    const first = {...started,pairing_window_id:windowId};
    const raw = JSON.stringify(first);
    assert.equal((await call(pairHandler,first)).status,401,'unsigned new route is never treated as legacy');
    assert.equal((await call(pairHandler,first,headers(raw,Math.floor(Date.now()/1000)-301))).status,401);
    assert.equal((await call(pairHandler,first,headers(raw,undefined,randomBytes(32)))).status,401);
    assert.equal((await call(pairHandler,first,headers(raw),raw+' ')).status,401,'signature covers exact bytes');
    assert.equal((await send(request({workspace_label:null}))).status,400);
    const accepted = await send(first);
    assert.deepEqual(accepted, {status:200,body:{schema_version:'1.0',request_id:first.request_id,status:'pending_approval'}});
    assert.deepEqual(await send(first),accepted);
    assert.equal((await send({...first,workspace_label:'different content'})).status,409);
    assert.equal((await send(request({source_workspace_id:first.source_workspace_id}))).status,409);
    const other = request();
    assert.equal((await send(other)).body.status,'pending_approval');
    const pending = await inbox('inbox');
    assert.equal(pending.count,2);
    assert.equal(pending.requests[0].sender_email,email);
    assert.equal(pending.requests.some(row => 'signed_raw_hash' in row || 'request_hash' in row),false);
    assert.equal((await inbox('inbox',{page:1})).requests.length,0);

    const topic = 'mq:scansob:inbox:'+school;
    const setTopic = value => db.query("select set_config('fixture.topic',$1,false)",[value]);
    await setTopic(topic);
    const broadcasts = (await db.query('select event,payload,private from realtime.messages')).rows;
    assert.deepEqual(broadcasts,[{ event:'requests_changed',payload:{},private:true },{ event:'requests_changed',payload:{},private:true }]);
    await assert.rejects(() => db.query("insert into realtime.messages values($1,'broadcast','requests_changed','{}',true)",[topic]),/row-level security/);
    await actor(student);
    await assert.rejects(() => rpc('mq_scansob_pairing_inbox',{p_teacher_token:token,p_action:'inbox'}),/TEACHER_GOOGLE_REQUIRED/);
    await assert.rejects(() => rpc('mq_scansob_request_signed',{p_payload:{},p_raw_hash:'',p_request_hash:'',p_delivery_hash:''}),/permission denied/);
    await assert.rejects(() => rpc('mq_scansob_prepare_signed',{p_payload:{}}),/permission denied/);
    assert.deepEqual((await db.query('select * from realtime.messages')).rows,[]);
    await setTopic('unrelated-channel');
    assert.deepEqual((await db.query('select * from realtime.messages')).rows,[]);
    await db.exec('reset role; set role anon');
    assert.deepEqual((await db.query('select * from realtime.messages')).rows,[]);
    await actor(teacher);
    await setTopic('mq:scansob:inbox:'+randomUUID());
    assert.deepEqual((await db.query('select * from realtime.messages')).rows,[]);

    const legacyOnSigned = await codeRequest(first.source_workspace_id);
    assert.deepEqual(await call(pairHandler,legacyOnSigned),{status:409,body:{error:'PAIRING_WORKSPACE_BUSY'}});
    const useUnspentCode = {...legacyOnSigned,request_id:randomUUID(),source_workspace_id:randomUUID()};
    assert.equal((await call(pairHandler,useUnspentCode)).body.status,'pending_approval','409 does not consume a legacy code');
    assert.equal((await send(request({source_workspace_id:useUnspentCode.source_workspace_id}))).body.error,'PAIRING_WORKSPACE_BUSY');
    await admin('reject',{request_id:useUnspentCode.request_id});
    const legacyOnActive = await codeRequest(legacy.source_workspace_id);
    assert.equal((await call(pairHandler,legacyOnActive)).body.error,'PAIRING_WORKSPACE_BUSY');
    assert.equal((await send(request({source_workspace_id:legacy.source_workspace_id}))).body.error,'PAIRING_WORKSPACE_BUSY');

    policy = await inbox('configure',{enabled:false,emails:[],revision:policy.revision});
    await assert.rejects(() => admin('approve',{request_id:other.request_id}),/ไม่ได้รับอนุญาต/);
    assert.equal((await call(pairHandler,bound(other))).body.status,'pending_approval');
    await admin('reject',{request_id:other.request_id});
    assert.equal((await call(pairHandler,bound(other))).body.status,'rejected');
    assert.equal((await call(pairHandler,bound(other,'revoke'))).body.status,'revoked');
    assert.equal((await send(other)).body.status,'rejected','revoked ID cannot create a new request');
    policy = await inbox('configure',{enabled:false,emails:[email],revision:policy.revision});
    await admin('approve',{request_id:first.request_id});
    await assert.rejects(() => admin('reject',{request_id:first.request_id}),/ดำเนินการแล้ว/);
    const delivered = await call(pairHandler,bound(first));
    assert.equal(delivered.body.status,'active');
    assert.deepEqual(await send(first),delivered,'signed replay and protected status deliver the same scoped token');
    assert.equal((await inbox('inbox')).count,0);
    await admin('configure',{enabled:true,student_view_enabled:false,accept_self_claim_risk:false});
    const connection = delivered.body.connection;
    const score = {...event(connection.id,first.source_workspace_id),batch_count:2};
    const unmatched = {...event(connection.id,first.source_workspace_id,score.source_exam_id,1,'00999'),
      exam:score.exam,batch_index:1,batch_count:2};
    const authorization = {Authorization:'Bearer '+connection.token};
    assert.equal((await call(scoreHandler,unmatched,authorization)).body.unmatched[0].student_code,'00999');
    await actor(teacher);
    const exam = (await rpc('mq_scansob_read',{p_kind:'exams'})).rows[0];
    const receipt = async () => {
      await actor(teacher);
      return rpc('mq_scansob_publication_receipt',{p_teacher_token:token,p_exam_id:exam.id});
    };
    const expected = {exam_id:exam.id,source_exam_id:score.source_exam_id,source_workspace_id:first.source_workspace_id,
      revision:'1',withdrawn:false,expected_batches:2,verified_batches:1,accepted:0,unmatched:1,invalid:0};
    assert.deepEqual(await receipt(),expected,'partial receipt counts ACKs from that revision');
    assert.equal((await call(scoreHandler,score,authorization)).body.accepted,1);
    assert.equal((await call(scoreHandler,score,authorization)).body.accepted,1);
    assert.deepEqual(await receipt(),{...expected,verified_batches:2,accepted:1},'replay does not increment totals');
    await actor(student);
    await assert.rejects(() => rpc('mq_scansob_publication_receipt',{p_teacher_token:token,p_exam_id:exam.id}),/TEACHER_GOOGLE_REQUIRED/);
    const nextRevision = {...unmatched,event_id:randomUUID(),publication_revision:2,batch_count:1,batch_index:0};
    assert.equal((await call(scoreHandler,nextRevision,authorization)).status,200);
    assert.deepEqual(await receipt(),{...expected,revision:'2',expected_batches:1},'prior scored rows are not counted');
    const withdrawal = {...score,event_id:randomUUID(),publication_revision:3,batch_count:1,action:'withdraw_exam',results:[]};
    assert.equal((await call(scoreHandler,withdrawal,authorization)).status,200);
    assert.deepEqual(await receipt(),{...expected,revision:'3',expected_batches:1,unmatched:0,withdrawn:true});

    policy = await inbox('configure',{enabled:true,emails:[email],revision:policy.revision});
    const reopened = await send(prepareBody(request()));
    assert.notEqual(reopened.body.pairing_window_id,windowId,'temporary close rotates the admission window');
    windowId = reopened.body.pairing_window_id;
    const unseen = request();
    assert.equal((await call(pairHandler,bound(unseen,'revoke'))).body.status,'revoked');
    assert.equal((await send(unseen)).body.status,'expired','late original cannot resurrect a tombstoned ID');
    const expired = request();
    assert.equal((await send(expired)).body.status,'pending_approval');
    await db.exec('reset role');
    await db.query("update mathquest_private.scansob_requests set expires_at=now()-interval '1 hour' where id=$1",[expired.request_id]);
    assert.equal((await inbox('inbox')).count,0,'expiry does not rely on a status write');
    assert.equal((await send(expired)).body.status,'expired');
    await assert.rejects(() => admin('approve',{request_id:expired.request_id}),/หมดอายุ/);
    const stillPending = request();
    assert.equal((await send(stillPending)).body.status,'pending_approval');
    const oldUnsent = request({requested_at:new Date(Date.now()+3600000).toISOString()});
    await actor(teacher);
    await rpc('mq_reset_student_progress',{p_teacher_token:token,p_expected_version:'fixture-v1'});
    token = await rpc('mq_open_teacher_session',{});
    assert.equal((await inbox('policy')).enabled,false,'reset disarms new signed intake');
    assert.equal((await inbox('inbox')).count,0);
    assert.equal((await send(stillPending)).body.status,'rejected');
    assert.equal(await receipt(),null,'purged exams do not reappear in receipts');
    policy = await inbox('policy');
    await inbox('configure',{enabled:true,emails:[email],revision:policy.revision});
    assert.equal((await send(oldUnsent)).body.error,'PAIRING_WINDOW_CHANGED','future-looking sender time cannot revive an old window');
    assert.equal((await inbox('inbox')).count,0);
    console.log('PASS ScanSob: signed prepare, two-way admission guard, preserved legacy, private inbox, ACK totals, revoke and reset window');
  } finally { await db.close(); }
}
main().catch(error => {console.error(error);process.exitCode=1;});
