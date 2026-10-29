const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
process.env.SQL_QA_MODULE_ROOT ||= path.join(os.tmpdir(),'mathquest-geo-qa','node_modules');
const {PGlite} = require(path.join(process.env.SQL_QA_MODULE_ROOT,'@electric-sql/pglite'));
const {fixture} = require('./test-google-auth.cjs');
const root = path.resolve(__dirname,'..');
const migration = fs.readFileSync(path.join(root,'20261029_01_student_profile_frames.sql'),'utf8');

async function main() {
  const db = new PGlite();
  const scalar = async (sql,args=[]) => (await db.query(sql,args)).rows[0].value;
  const actors = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004'];
  const sessions = actors.map((_,i)=>'20000000-0000-4000-8000-00000000000'+(i+1));
  async function actor(index) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actors[index],session_id:sessions[index],amr:[{method:'oauth',timestamp:Math.floor(Date.now()/1000)}]})]);
    await db.exec('set role authenticated');
  }
  let link;
  const rpc = (action,enabled=null,motion=null,revision=null,version='fixture-v1',linkVersion=link) => scalar(
    'select mq_student_profile_style($1,$2,$3,$4,$5,$6) as value',[action,enabled,motion,version,linkVersion,revision]);
  try {
    await db.exec(fixture);
    for(const name of ['20261010_01_school_term_reset_otp.sql','20261010_02_reset_progress_without_dates.sql','20260915_01_report_bonus_points.sql']) {
      await db.exec(fs.readFileSync(path.join(root,name),'utf8'));
    }
    for(let i=0;i<actors.length;i++) {
      const email = i===0?'piyawatpiwsiri@gmail.com':`style-${i}@fixture.invalid`;
      await db.query("insert into auth.users values($1,$2,now(),'{\"provider\":\"google\"}')",[actors[i],email]);
      await db.query("insert into auth.identities(user_id,provider,identity_data) values($1,'google',$2)",[actors[i],JSON.stringify({email,email_verified:true})]);
      await db.query('insert into auth.sessions values($1,$2)',[sessions[i],actors[i]]);
    }
    await db.exec(fs.readFileSync(path.join(root,'20261015_01_google_login_student_links.sql'),'utf8'));
    const oldStudents = (await db.query('select * from students order by id')).rows;
    const oldProgress = (await db.query('select * from attendance_logs order by id')).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from students order by id')).rows,oldStudents,'install preserves students/photos');
    assert.deepEqual((await db.query('select * from attendance_logs order by id')).rows,oldProgress,'install preserves progress');
    await db.exec('set role anon');
    await assert.rejects(()=>rpc('read'),/permission denied/);
    await actor(0);
    await assert.rejects(()=>rpc('read'),/LINKED_STUDENT_REQUIRED/);
    const token = await scalar('select mq_open_teacher_session() as value');
    await actor(1);
    await scalar("select mq_student_link('claim','00001') as value");
    const account = await scalar('select mq_google_account() as value');
    link = account.linkVersion;
    assert.deepEqual(await rpc('read'),{status:'success',frameEnabled:true,motionEnabled:true,revision:null});
    await assert.rejects(()=>rpc('save',true,false,null,'fixture-v1','wrong-link'),/LINK_STATE_CHANGED/);
    await assert.rejects(()=>rpc('save',null,false),/INVALID_STYLE/);
    await assert.rejects(()=>rpc('unknown'),/INVALID_ACTION/);
    const saved = await rpc('save',false,false);
    assert.equal(saved.status,'success');
    assert.equal(saved.frameEnabled,false);
    assert.ok(saved.revision);
    assert.equal((await rpc('read')).revision,saved.revision,'returning device reads saved choice');
    const conflict = await rpc('save',true,true);
    assert.equal(conflict.status,'conflict','two initial saves cannot silently replace one another');
    assert.equal(conflict.frameEnabled,false);
    const updated = await rpc('save',true,true,saved.revision);
    assert.equal(updated.status,'success');
    assert.notEqual(updated.revision,saved.revision);
    assert.equal((await rpc('save',false,false,saved.revision)).status,'conflict');
    await assert.rejects(()=>db.query('select * from mathquest_private.student_profile_style'),/permission denied/);
    await assert.rejects(()=>db.query("insert into mathquest_private.student_profile_style(student_id) values('00002')"),/permission denied/);
    await actor(2);
    await scalar("select mq_student_link('claim','00002') as value");
    const other = await scalar('select mq_google_account() as value');
    assert.equal((await rpc('read',null,null,null,'fixture-v1',other.linkVersion)).revision,null,'no other student preferences exposed');
    await actor(3);
    await assert.rejects(()=>rpc('read'),/LINKED_STUDENT_REQUIRED/);
    await db.exec('reset role');
    assert.equal(await scalar("select has_table_privilege('service_role','mathquest_private.student_profile_style','SELECT') as value"),false);
    assert.equal(await scalar("select relrowsecurity as value from pg_class where oid='mathquest_private.student_profile_style'::regclass"),true);
    await db.exec(migration);
    assert.equal(await scalar('select count(*)::integer as value from mathquest_private.student_profile_style'),1,'rerun does not reset choices');
    await db.exec("insert into mathquest_private.student_profile_style(student_id) values('00003'); update students set id='00004' where id='00003'");
    assert.equal(await scalar("select student_id as value from mathquest_private.student_profile_style where student_id='00004'"),'00004','new FK follows corrected roster code');
    await db.exec("begin; update system_settings set value='rollback-version' where key='school_data_version'; rollback");
    assert.equal(await scalar('select count(*)::integer as value from mathquest_private.student_profile_style'),2,'failed reset rolls back cosmetics deletion');
    await db.exec("update system_settings set value=value where key='school_data_version'");
    assert.equal(await scalar('select count(*)::integer as value from mathquest_private.student_profile_style'),2,'unchanged version does not clear choices');
    await actor(0);
    const result = await scalar('select mq_reset_student_progress($1,$2) as value',[token,'fixture-v1']);
    assert.equal(result.status,'success');
    await db.exec('reset role');
    assert.equal(await scalar('select count(*)::integer as value from mathquest_private.student_profile_style'),0,'real term reset deletes cosmetics atomically');
    assert.equal(await scalar("select photo_url as value from students where id='00001'"),'old-photo');
    assert.equal(await scalar("select password as value from students where id='00001'"),'old-a');
    await actor(1);
    await assert.rejects(()=>rpc('save',true,true,updated.revision),/ถูกรีเซ็ต/);
    const version = result.version;
    assert.deepEqual(await rpc('read',null,null,null,version),{status:'success',frameEnabled:true,motionEnabled:true,revision:null});
    await db.exec('reset role');
    await db.query('delete from auth.sessions where id=$1',[sessions[1]]);
    await actor(1);
    await assert.rejects(()=>rpc('read',null,null,null,version),/GOOGLE_SESSION_REQUIRED/);
    console.log('PASS profile frame SQL: transactional/rerunnable, verified identity/link/version, RLS/private ACL, cross-student isolation, conflict detection, cascade correction, real reset and rollback; no production database calls');
  } finally {await db.close();}
}
main().catch(error=>{console.error(error.message);if(error.where)console.error(error.where);process.exitCode=1;});
