const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { fixture } = require('./test-google-auth.cjs');
const { PGlite } = require(path.join(process.env.SQL_QA_MODULE_ROOT || path.join(os.tmpdir(),'mathquest-sql-qa','node_modules'),'@electric-sql/pglite'));
const root = path.resolve(__dirname,'..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const uid = () => crypto.randomUUID();
function event(connection,workspace,exam=uid(),revision=1,code='00001') {
  return {schema_version:'1.0',event_id:uid(),connection_id:connection,source_workspace_id:workspace,source_exam_id:exam,
    publication_revision:revision,action:'publish_results',batch_index:0,batch_count:1,occurred_at:'2026-10-15T00:00:00.000Z',
    exam:{title:'ข้อสอบจำลอง',subject:'คณิตศาสตร์',exam_type:'เก็บคะแนน',classroom:'ม.2',academic_year:2569,term:1},
    results:[{source_scan_id:uid(),source_exam_version_id:uid(),student_code:code,score:17.5,max_score:25,percent:70,passed:true,confirmed_at:'2026-10-15T00:00:00.000Z'}]};
}
async function setup(db, { upgrade = true } = {}) {
  await db.exec(fixture);
  for(const file of ['20261010_01_school_term_reset_otp.sql','20261010_02_reset_progress_without_dates.sql','20260915_01_report_bonus_points.sql','20261015_01_google_login_student_links.sql','20261015_02_scansob_receiver.sql'])await db.exec(read(file));
  await db.exec(read('20261015_02_scansob_receiver.sql'));
  if (upgrade) {
    await db.exec(read('20261015_03_scansob_recovery_hardening.sql'));
    await db.exec(read('20261015_03_scansob_recovery_hardening.sql'));
  }
  const teacher=uid(),student=uid(),other=uid(),teacherSession=uid();
  for(const [id,email,session] of [[teacher,'piyawatpiwsiri@gmail.com',teacherSession],[student,'s@fixture.invalid',uid()],[other,'other@fixture.invalid',uid()]]){
    await db.query("insert into auth.users values($1,$2,now(),'{\"provider\":\"google\"}')",[id,email]);
    await db.query("insert into auth.identities(user_id,provider,identity_data) values($1,'google',$2)",[id,JSON.stringify({email,email_verified:true})]);
    await db.query('insert into auth.sessions values($1,$2)',[session,id]);
  }
  await db.query('insert into mathquest_private.google_student_links(auth_user_id,student_id) values($1,$2),($3,$4)',[student,'00001',other,'00002']);
  const actor=async id=>{
    await db.exec('reset role');
    const s=(await db.query('select id from auth.sessions where user_id=$1',[id])).rows[0].id;
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,session_id:s,amr:[{method:'oauth',timestamp:Math.floor(Date.now()/1000)}]})]);
    await db.exec('set role authenticated');
  };
  return {teacher,student,other,actor};
}
async function main() {
  const {createScanSobHandler}=await import(pathToFileURL(path.join(root,'supabase/functions/_shared/scansob-http.mjs')));
  const {validateScoreEvent}=await import(pathToFileURL(path.join(root,'supabase/functions/_shared/scansob-contract.mjs')));
  const sourcePath=process.env.SCANSOB_SOURCE_DIR||path.join(os.tmpdir(),'mathquest-scansob-reference');
  const upstream=fs.existsSync(path.join(sourcePath,'lib/integrations/mathquest/contract.ts')) ? await require('./test-scansob-contract.cjs').loadUpstream() : null;
  const db=new PGlite();
  const rpc=async(name,args)=> (await db.query(`select public.${name}(${Object.keys(args).map((k,i)=>k+'=> $'+(i+1)).join(',')}) as value`,Object.values(args))).rows[0].value;
  try{
    const {teacher,student,other,actor}=await setup(db);
    await actor(teacher);const token=await rpc('mq_open_teacher_session',{});
    const admin=async(action,args={})=>{await actor(teacher);return rpc('mq_scansob_admin',{p_teacher_token:token,p_action:action,p_args:args});};
    let state=await admin('status');assert.equal(state.enabled,false);assert.equal(state.student_view_enabled,false);
    const pairHandler=createScanSobHandler('pair',{pairingKey:'fixture-pair-key-never-use-in-production',rpc:async(name,args)=>{await db.exec('reset role; set role service_role');return rpc(name,args);}});
    const scoreHandler=createScanSobHandler('scores',{rpc:async(name,args)=>{await db.exec('reset role; set role service_role');return rpc(name,args);}});
    const call=async(handler,body,bearer,raw)=>{
      const response=await handler(new Request('https://receiver.fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:raw||JSON.stringify(body)}));
      const result={status:response.status,body:await response.json()};
      if(handler===scoreHandler&&result.status===200&&upstream)upstream.validateAcknowledgment(result.body,upstream.scoreEventSchema.parse(body));
      return result;
    };
    const pair=async()=>{
      const code=await admin('create_code');const request={schema_version:'1.0',action:'request',request_id:uid(),source_workspace_id:uid(),workspace_label:'ครูจำลอง',request_secret:crypto.randomBytes(32).toString('base64url'),pairing_code:code.code};
      const pending=await call(pairHandler,request);assert.equal(pending.body.status,'pending_approval');assert.equal('connection'in pending.body,false);
      assert.deepEqual((await call(pairHandler,request)).body,pending.body,'request replay');
      const stolen=await call(pairHandler,{...request,request_id:uid()});assert.equal(stolen.status,403,'one-use code');
      await admin('approve',{request_id:request.request_id});
      const status={schema_version:'1.0',action:'status',request_id:request.request_id,source_workspace_id:request.source_workspace_id,request_secret:request.request_secret};
      const active=await call(pairHandler,status);assert.equal(active.body.status,'active');
      assert.deepEqual((await call(pairHandler,status)).body,active.body,'lost response delivers the same token');
      assert.equal((await call(pairHandler,{...status,request_secret:'A'.repeat(43)})).status,403);
      return {request,status,connection:active.body.connection};
    };
    const a=await pair(),b=await pair();
    const first=event(a.connection.id,a.request.source_workspace_id);
    assert.equal((await call(scoreHandler,first,a.connection.token)).status,503,'disabled ingress');
    await admin('configure',{enabled:true,student_view_enabled:true,accept_self_claim_risk:true});
    let result=await call(scoreHandler,first,a.connection.token);assert.equal(result.status,200);assert.equal(result.body.accepted,1);
    assert.deepEqual((await call(scoreHandler,first,a.connection.token)).body,result.body,'lost ACK replay');
    assert.equal((await call(scoreHandler,first,a.connection.token,JSON.stringify(first,null,2))).status,409,'hash of exact bytes');
    assert.equal((await call(scoreHandler,{...first,event_id:uid(),source_workspace_id:b.request.source_workspace_id},a.connection.token)).status,401);
    const two=event(b.connection.id,b.request.source_workspace_id);assert.equal((await call(scoreHandler,two,b.connection.token)).body.accepted,1);
    const batch0={...first,event_id:uid(),source_exam_id:uid(),publication_revision:5,batch_count:2};
    const batch1={...batch0,event_id:uid(),batch_index:1,results:[{...batch0.results[0],student_code:'00002'}]};
    assert.equal((await call(scoreHandler,batch1,a.connection.token)).status,200);
    await actor(student);let visible=await rpc('mq_scansob_read',{p_kind:'exams'});assert.equal(visible.rows.some(x=>x.revision===5),false,'incomplete revision hidden');
    assert.equal((await call(scoreHandler,batch0,a.connection.token)).body.accepted,1);
    assert.equal((await call(scoreHandler,{...batch0,event_id:uid()},a.connection.token)).status,409,'same revision batch cannot be replaced');
    assert.equal((await call(scoreHandler,{...batch0,event_id:uid(),batch_index:1,exam:{...batch0.exam,title:'เปลี่ยนชื่อ'}},a.connection.token)).status,409);
    const newer={...first,event_id:uid(),publication_revision:2,results:[{...first.results[0],student_code:'00002'}]};
    assert.equal((await call(scoreHandler,newer,a.connection.token)).body.accepted,1);
    const stale={...first,event_id:uid()};assert.equal((await call(scoreHandler,stale,a.connection.token)).body.status,'stale_ignored');
    await actor(student);visible=await rpc('mq_scansob_read',{p_kind:'scores'});assert.ok(visible.rows.length>=2);assert.ok(visible.rows.every(x=>x.student_code==='00001'),'only own scores, including rows omitted by newer publish');
    await assert.rejects(()=>db.query('select * from mathquest_private.scansob_scores'),/permission denied/);
    await assert.rejects(()=>rpc('mq_scansob_ingest',{p_payload:first,p_raw_hash:hash(JSON.stringify(first)),p_token_hash:hash(a.connection.token)}),/permission denied/);
    await assert.rejects(()=>rpc('mq_scansob_admin',{p_teacher_token:token,p_action:'status'}),/TEACHER_GOOGLE_REQUIRED/);
    await assert.rejects(()=>rpc('mq_scansob_read',{p_kind:null}),/INVALID_QUERY/);
    await assert.rejects(()=>rpc('mq_scansob_read',{p_kind:'issues'}),/INVALID_QUERY/);
    await assert.rejects(()=>rpc('mq_scansob_read',{p_kind:'scores',p_limit:null}),/INVALID_QUERY/);
    await actor(other);visible=await rpc('mq_scansob_read',{p_kind:'scores'});assert.ok(visible.rows.every(x=>x.student_code==='00002'));
    const missing=event(a.connection.id,a.request.source_workspace_id,uid(),1,'00999');
    result=await call(scoreHandler,missing,a.connection.token);assert.equal(result.body.unmatched[0].reason,'STUDENT_NOT_FOUND');
    await db.exec('reset role');await db.exec("insert into students(id,name,grade,role,password) values('00999','ทดสอบเพิ่มใหม่','ม.2/1','STUDENT','old')");
    assert.deepEqual((await call(scoreHandler,missing,a.connection.token)).body,result.body,'mapping fix cannot mutate saved ACK');
    assert.equal((await call(scoreHandler,{...missing,event_id:uid(),publication_revision:2},a.connection.token)).body.accepted,1);
    const withdrawal={...first,event_id:uid(),publication_revision:3,action:'withdraw_exam',results:[]};
    assert.equal((await call(scoreHandler,withdrawal,a.connection.token)).status,200);
    assert.equal((await call(scoreHandler,{...newer,event_id:uid()},a.connection.token)).body.status,'stale_ignored');
    await actor(student);visible=await rpc('mq_scansob_read',{p_kind:'scores'});assert.equal(visible.rows.some(x=>x.metadata.title===first.exam.title&&x.exam_id===1),false);
    assert.throws(()=>validateScoreEvent({...first,extra:'forbidden'}));assert.throws(()=>validateScoreEvent({...first,results:[{...first.results[0],score:26}]}));
    const revoke={schema_version:'1.0',action:'revoke',request_id:b.request.request_id,source_workspace_id:b.request.source_workspace_id,connection_id:b.connection.id};
    assert.equal((await call(pairHandler,revoke,b.connection.token)).body.status,'revoked');
    assert.equal((await call(pairHandler,revoke,b.connection.token)).body.status,'revoked','lost revoke ACK replay');
    assert.equal((await call(scoreHandler,two,b.connection.token)).status,401,'revoked token cannot retrieve saved ACK');
    await db.exec('reset role');const oldLinks=(await db.query('select * from mathquest_private.google_student_links')).rows;
    const before=(await db.query("select sum(points) as points from attendance_logs")).rows;
    assert.deepEqual(before,[{points:100}],'ingestion never changes XP');
    const reset=await admin('status');assert.ok(reset.score_count>0);
    await actor(teacher);await assert.rejects(()=>rpc('mq_reset_student_progress',{p_teacher_token:token,p_expected_version:'fixture-v1'}),/ถอนการเผยแพร่/);
    await db.exec('reset role');
    const remaining=(await db.query("select * from mathquest_private.scansob_exams where workspace_id=$1 and not withdrawn",[a.request.source_workspace_id])).rows;
    for(const exam of remaining){const payload={...first,event_id:uid(),source_exam_id:exam.source_exam_id,publication_revision:Number(exam.revision)+1,action:'withdraw_exam',exam:exam.metadata,results:[]};assert.equal((await call(scoreHandler,payload,a.connection.token)).status,200);}
    await actor(teacher);await rpc('mq_reset_student_progress',{p_teacher_token:token,p_expected_version:'fixture-v1'});
    await db.exec('reset role');assert.equal((await db.query('select count(*) as n from mathquest_private.scansob_scores')).rows[0].n,0);
    assert.deepEqual((await db.query('select * from mathquest_private.google_student_links')).rows,oldLinks);
    assert.equal((await call(scoreHandler,first,a.connection.token)).status,401,'reset revokes old connection');
    await db.exec('reset role');
    assert.equal((await db.query('select metadata from mathquest_private.scansob_exams limit 1')).rows[0].metadata.constructor,Object);
    assert.ok((await db.query('select * from mathquest_private.scansob_closed_terms')).rows.length);
    await actor(teacher);const newToken=await rpc('mq_open_teacher_session',{});
    const code=await rpc('mq_scansob_admin',{p_teacher_token:newToken,p_action:'create_code'});
    const request={schema_version:'1.0',action:'request',request_id:uid(),source_workspace_id:a.request.source_workspace_id,workspace_label:'Re-pair fixture',request_secret:crypto.randomBytes(32).toString('base64url'),pairing_code:code.code};
    assert.equal((await call(pairHandler,request)).body.status,'pending_approval');
    await actor(teacher);await rpc('mq_scansob_admin',{p_teacher_token:newToken,p_action:'approve',p_args:{request_id:request.request_id}});
    const delivered=await call(pairHandler,{schema_version:'1.0',action:'status',request_id:request.request_id,source_workspace_id:request.source_workspace_id,request_secret:request.request_secret});
    await actor(teacher);await rpc('mq_scansob_admin',{p_teacher_token:newToken,p_action:'configure',p_args:{enabled:true,student_view_enabled:false,accept_self_claim_risk:false}});
    const closed={...first,event_id:uid(),connection_id:delivered.body.connection.id,publication_revision:99};
    assert.equal((await call(scoreHandler,closed,delivered.body.connection.token)).status,403,'re-pair cannot restore a reset term even with higher revision');
    const next={...closed,event_id:uid(),exam:{...closed.exam,term:2}};
    assert.equal((await call(scoreHandler,next,delivered.body.connection.token)).body.accepted,1,'next term works after reset without term dates');
    console.log('PASS ScanSob SQL/HTTP: hash-only pairing/recovery, single-use codes, Workspace isolation, exact-byte replay, manifests, reverse batches, stale/withdrawal, own-score authorization, reconciliation by new revision, reset and no XP side effects');
  }finally{await db.close();}
}
module.exports={setup,event,read,hash};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
