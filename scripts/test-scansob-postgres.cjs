const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const net=require('node:net');
const {pathToFileURL}=require('node:url');
const {setup,event,hash}=require('./test-scansob.cjs');
async function main(){
  const qa=process.env.SQL_QA_MODULE_ROOT||path.join(os.tmpdir(),'mathquest-sql-qa','node_modules');
  const {default:EmbeddedPostgres}=await import(pathToFileURL(path.join(qa,'embedded-postgres/dist/index.js')));
  const {Client}=require(path.join(qa,'pg'));
  const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
  const cluster=new EmbeddedPostgres({databaseDir:fs.mkdtempSync(path.join(os.tmpdir(),'mathquest-pg-')),user:'postgres',password:crypto.randomBytes(24).toString('hex'),port,persistent:true,
    postgresFlags:['-h','127.0.0.1'],initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
  const clients=[];
  try{
    await cluster.initialise();await cluster.start();const owner=cluster.getPgClient();await owner.connect();clients.push(owner);
    const db={exec:sql=>owner.query(sql),query:(sql,args)=>owner.query(sql,args)};
    const {teacher,actor}=await setup(db);
    await actor(teacher);const token=(await owner.query('select mq_open_teacher_session() as value')).rows[0].value;
    await owner.query("select mq_scansob_admin($1,'configure',$2)",[token,{enabled:true,student_view_enabled:true,accept_self_claim_risk:true}]);
    await owner.query('reset role');
    const school=(await owner.query('select id from mathquest_private.scansob_school')).rows[0].id;
    const workspace=crypto.randomUUID(),connection=crypto.randomUUID(),secret=crypto.randomBytes(32).toString('base64url');
    await owner.query("insert into mathquest_private.scansob_connections(id,school_id,workspace_id,workspace_label,token_hash,status,approved_by) values($1,$2,$3,'Synthetic', $4,'active',$5)",[connection,school,workspace,hash(secret),teacher]);
    for(let i=0;i<4;i++){const c=new Client(owner.connectionParameters);await c.connect();await c.query('set role service_role');clients.push(c);}
    const ingest=(c,payload)=>c.query('select mq_scansob_ingest($1,$2,$3) as value',[payload,hash(JSON.stringify(payload)),hash(secret)]).then(r=>r.rows[0].value);
    const first=event(connection,workspace);
    const duplicates=await Promise.all(clients.slice(1).map(c=>ingest(c,first)));
    assert.ok(duplicates.every(r=>r.http_status===200));assert.ok(duplicates.every(r=>JSON.stringify(r.body)===JSON.stringify(duplicates[0].body)));
    assert.equal((await owner.query('select count(*)::int as n from mathquest_private.scansob_scores')).rows[0].n,1);
    const exam=crypto.randomUUID();
    const old=event(connection,workspace,exam,1),newer=event(connection,workspace,exam,2);newer.results[0].score=20;newer.results[0].percent=80;
    await Promise.all([ingest(clients[1],newer),ingest(clients[2],old)]);
    assert.equal((await owner.query("select result->>'score' as score from mathquest_private.scansob_scores s join mathquest_private.scansob_exams e on s.exam_id=e.id where e.source_exam_id=$1",[exam])).rows[0].score,'20');
    const withdraw={...newer,event_id:crypto.randomUUID(),publication_revision:3,action:'withdraw_exam',results:[]};
    await Promise.all([ingest(clients[1],withdraw),ingest(clients[2],{...newer,event_id:crypto.randomUUID()})]);
    assert.equal((await owner.query('select count(*)::int as n from mathquest_private.scansob_scores s join mathquest_private.scansob_exams e on s.exam_id=e.id where e.source_exam_id=$1',[exam])).rows[0].n,0);
    // More than 1,000 scores across additive batches, using real PostgreSQL locks.
    await owner.query("insert into students(id,name,grade,role,password) select lpad(n::text,5,'0'),'Synthetic '||n,'ม.2/1','STUDENT','fixture' from generate_series(10000,11004) n");
    const largeExam=crypto.randomUUID();let count=0;
    for(let index=10;index>=0;index--){const payload=event(connection,workspace,largeExam,1);payload.batch_index=index;payload.batch_count=11;
      payload.results=Array.from({length:index===10?5:100},(_,j)=>({...payload.results[0],source_scan_id:crypto.randomUUID(),student_code:String(10000+index*100+j)}));
      assert.equal((await ingest(clients[1],payload)).body.accepted,payload.results.length);count+=payload.results.length;}
    assert.equal(count,1005);
    assert.equal((await owner.query('select count(*)::int as n from mathquest_private.scansob_scores s join mathquest_private.scansob_exams e on s.exam_id=e.id where e.source_exam_id=$1',[largeExam])).rows[0].n,1005);
    await actor(teacher);let cursor=0;const seen=new Set();
    do{const page=(await owner.query("select mq_scansob_read('scores',null,$1,100) as value",[cursor])).rows[0].value;
      for(const row of page.rows){assert.ok(!seen.has(row.id));seen.add(row.id);}cursor=page.next_cursor;
    }while(cursor);
    assert.equal(seen.size,1006,'teacher pagination includes all rows beyond 1,000');
    await owner.query('reset role');
    const {createScanSobHandler}=await import(pathToFileURL(path.resolve(__dirname,'../supabase/functions/_shared/scansob-http.mjs')));
    let adminToken=token;
    const admin=async(action,args={})=>{await actor(teacher);return (await owner.query('select mq_scansob_admin($1,$2,$3) as value',[adminToken,action,args])).rows[0].value;};
    const pair=async(client,body)=>{
      const handler=createScanSobHandler('pair',{pairingKey:'real-postgres-fixture-key-never-use-live',rpc:async(name,args)=>
        (await client.query('select '+name+'('+Object.keys(args).map((k,i)=>k+'=>$'+(i+1)).join(',')+') as value',Object.values(args))).rows[0].value});
      const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
      return {status:response.status,body:await response.json()};
    };
    const makeRequest=async(workspaceId=crypto.randomUUID())=>{
      const code=await admin('create_code');
      return {schema_version:'1.0',action:'request',request_id:crypto.randomUUID(),source_workspace_id:workspaceId,
        workspace_label:'Concurrency fixture',request_secret:crypto.randomBytes(32).toString('base64url'),pairing_code:code.code};
    };
    const statusOf=r=>({schema_version:'1.0',action:'status',request_id:r.request_id,source_workspace_id:r.source_workspace_id,request_secret:r.request_secret});
    for(let attempt=0;attempt<3;attempt++){
      const request=await makeRequest();assert.equal((await pair(clients[1],request)).status,200);
      const race=await Promise.allSettled([admin('approve',{request_id:request.request_id}),pair(clients[2],{...statusOf(request),action:'revoke'})]);
      assert.equal(race[1].status,'fulfilled');assert.equal(race[1].value.body.status,'revoked');
      await owner.query('reset role');
      assert.equal((await owner.query('select status from mathquest_private.scansob_requests where id=$1',[request.request_id])).rows[0].status,'revoked');
      assert.equal((await owner.query("select count(*)::int as n from mathquest_private.scansob_connections where workspace_id=$1 and status='active'",[request.source_workspace_id])).rows[0].n,0);
    }
    const unknown=await makeRequest();
    const registration=await Promise.all([pair(clients[1],unknown),pair(clients[2],statusOf(unknown))]);
    assert.ok(registration.every(r=>r.status===200));
    const cancelUnknown={...statusOf(unknown),action:'revoke'};
    const revoked=await Promise.all([pair(clients[1],cancelUnknown),pair(clients[2],cancelUnknown)]);
    assert.deepEqual(revoked[0],revoked[1]);assert.equal(revoked[0].body.status,'revoked');
    assert.notEqual((await pair(clients[1],unknown)).body.status,'active','late request cannot escape cancellation');
    await owner.query('reset role');
    // A deliberately failing late write rolls back exam, score, batch and receipt together.
    await owner.query("create function mathquest_private.fixture_fail_receipt() returns trigger language plpgsql as $$ begin raise exception 'fixture receipt failure'; end $$; create trigger fixture_fail_receipt before insert on mathquest_private.scansob_events for each row execute function mathquest_private.fixture_fail_receipt()");
    const fail=event(connection,workspace);await assert.rejects(()=>ingest(clients[1],fail),/fixture receipt failure/);
    assert.equal((await owner.query('select count(*)::int as n from mathquest_private.scansob_exams where source_exam_id=$1',[fail.source_exam_id])).rows[0].n,0);
    await owner.query('drop trigger fixture_fail_receipt on mathquest_private.scansob_events');
    await admin('revoke',{connection_id:connection});
    await actor(teacher);await owner.query('select mq_reset_student_progress($1,$2)',[adminToken,'fixture-v1']);
    adminToken=(await owner.query('select mq_open_teacher_session() as value')).rows[0].value;
    const nextRequest=await makeRequest(workspace);await pair(clients[1],nextRequest);await admin('approve',{request_id:nextRequest.request_id});
    const nextConnection=(await pair(clients[1],statusOf(nextRequest))).body.connection;
    await admin('configure',{enabled:true,student_view_enabled:false,accept_self_claim_risk:false});
    const proof={...first,event_id:crypto.randomUUID(),connection_id:nextConnection.id,publication_revision:2,action:'withdraw_exam',results:[]};
    const deliver=(client,payload)=>client.query('select mq_scansob_ingest($1,$2,$3) as value',[payload,hash(JSON.stringify(payload)),hash(nextConnection.token)]).then(r=>r.rows[0].value);
    const proofResults=await Promise.all([deliver(clients[1],proof),deliver(clients[2],proof)]);
    assert.ok(proofResults.every(r=>r.http_status===200&&r.body.status==='processed'));
    assert.deepEqual(proofResults[0],proofResults[1]);
    assert.equal((await deliver(clients[1],{...first,event_id:crypto.randomUUID(),connection_id:nextConnection.id,publication_revision:3})).body.error,'TERM_CLOSED');
    await owner.query('reset role');
    assert.equal((await owner.query("select count(*)::int as n from mathquest_private.scansob_audit where action='ack_purged_withdrawal'")).rows[0].n,1);
    assert.equal((await owner.query('select count(*)::int as n from mathquest_private.scansob_scores')).rows[0].n,0);
    console.log('PASS real PostgreSQL: duplicate/revision/withdrawal races, approval/cancel and registration races, purge ACK replay, 1,005 scores, late-failure rollback');
  }finally{for(const c of clients.reverse())await c.end().catch(()=>{});await cluster.stop().catch(()=>{});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
