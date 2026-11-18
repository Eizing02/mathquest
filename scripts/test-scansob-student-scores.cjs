const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {setup,event,read,hash} = require('./test-scansob.cjs');
const {PGlite} = require(path.join(process.env.SQL_QA_MODULE_ROOT || path.join(os.tmpdir(),'mathquest-sql-qa','node_modules'),'@electric-sql/pglite'));

async function main() {
  const db = new PGlite();
  try {
    const {teacher,student,other,actor} = await setup(db);
    const migration = read('20261118_01_scansob_student_score_view.sql');
    await db.exec(migration);
    await db.exec(migration);
    const value = async(sql,args=[]) => (await db.query(sql,args)).rows[0].value;
    const scores = (subject=null, cursor=null, limit=30) => value(
      'select public.mq_scansob_student_scores($1,$2,$3,$4) as value',
      [subject,cursor?.updated_at??null,cursor?.id??null,limit]);
    for (const role of ['anon','service_role']) {
      await db.exec('reset role; set role '+role);
      await assert.rejects(()=>scores(),/permission denied/);
    }
    await actor(teacher);
    assert.equal((await scores()).enabled,false,'teachers cannot use the student view');
    const token = await value('select mq_open_teacher_session() as value');
    await value("select mq_scansob_admin($1,'configure',$2) as value",
      [token,{enabled:true,student_view_enabled:true,accept_self_claim_risk:true}]);
    await db.exec('reset role');
    const school = await value('select id as value from mathquest_private.scansob_school');
    const connection = randomUUID(), workspace = randomUUID();
    const keyHash = hash('fixture-only-key');
    await db.query(`insert into mathquest_private.scansob_connections
      (id,school_id,workspace_id,workspace_label,token_hash,status,approved_by)
      values($1,$2,$3,'Synthetic',$4,'active',$5)`,[connection,school,workspace,keyHash,teacher]);
    const subjects = {base:'คณิตศาสตร์', late:'วิทยาศาสตร์', other:'ภาษาไทย', incomplete:'ประวัติศาสตร์'};
    async function publish(index,subject,code='00001',batchCount=1,term=2) {
      const payload = event(connection,workspace,randomUUID(),1,code);
      payload.exam.title = 'Fixture '+index;
      payload.exam.subject = subject;
      payload.exam.term = term;
      payload.batch_count = batchCount;
      await db.exec('set role service_role');
      try {
        const response = await value('select mq_scansob_ingest($1,$2,$3) as value',
          [payload,hash(JSON.stringify(payload)),keyHash]);
        assert.equal(response.body.accepted,1);
      } finally { await db.exec('reset role'); }
    }
    for (let i=1;i<=37;i++) await publish(i,i===37?subjects.late:subjects.base,'00001',1,i===37?1:2);
    await publish(38,subjects.other,'00002');
    await publish(39,subjects.incomplete,'00001',2);
    // Collapse most timestamps onto one value to exercise the bigint tie-breaker.
    await db.exec(`update mathquest_private.scansob_scores s
      set updated_at = case when e.metadata->>'title'='Fixture 1' then timestamptz '2026-11-18 09:00Z'
        when e.metadata->>'title'='Fixture 37' then timestamptz '2026-10-18 09:00Z'
        else timestamptz '2026-11-17 08:00Z' end
      from mathquest_private.scansob_exams e where e.id=s.exam_id`);
    await actor(student);
    const first = await scores();
    assert.equal(first.enabled,true);
    assert.equal(first.total,37);
    assert.equal(first.rows.length,30);
    assert.equal(first.rows[0].metadata.title,'Fixture 1','latest update ranks ahead of newer IDs');
    assert.deepEqual(new Set(first.subjects),new Set([subjects.base,subjects.late]));
    assert.equal(first.single_term,null,'mixed terms must retain row labels');
    assert.equal(typeof first.next_cursor.id,'string');
    assert.deepEqual(Object.keys(first.rows[0].result).sort(),['max_score','passed','percent','score']);
    const next = await scores(null,first.next_cursor);
    assert.equal(next.rows.length,7);
    assert.equal(next.next_cursor,null);
    assert.equal(next.rows.at(-1).metadata.title,'Fixture 37');
    assert.equal(new Set([...first.rows,...next.rows].map(row=>row.metadata.title)).size,37);
    const filtered = await scores(subjects.late);
    assert.equal(filtered.total,1);
    assert.deepEqual(filtered.single_term,{term:1,academic_year:2569});
    assert.equal(filtered.rows[0].metadata.title,'Fixture 37','filter reaches rows outside the first page');
    assert.equal((await scores(subjects.other)).total,0,'cannot look up another student by subject');
    const mixedCursor = () => value("select mq_scansob_student_scores(null,'2026-01-01',null,30) as value");
    await assert.rejects(mixedCursor,/INVALID_QUERY/);
    await assert.rejects(()=>scores(null,null,51),/INVALID_QUERY/);
    await actor(other);
    assert.deepEqual((await scores()).subjects,[subjects.other]);
    await db.exec('reset role');
    await db.exec("update mathquest_private.scansob_connections set status='revoked'");
    await actor(student);
    assert.deepEqual((await scores()).subjects,[],'revoked results cannot show up as facets');
    await actor(teacher);
    await value("select mq_scansob_admin($1,'configure',$2) as value",
      [token,{enabled:true,student_view_enabled:false,accept_self_claim_risk:false}]);
    await actor(student);
    assert.equal((await scores()).enabled,false);
    console.log('PASS student score SQL: latest-first pagination including ties, global subject filter, term summary, visibility and grants');
  } finally { await db.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
