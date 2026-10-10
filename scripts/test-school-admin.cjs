const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const moduleRoot = process.env.SQL_QA_MODULE_ROOT || path.join(os.tmpdir(), 'mathquest-sql-qa', 'node_modules');
const { PGlite } = require(path.join(moduleRoot, '@electric-sql/pglite'));
const migration = fs.readFileSync(path.join(root, '20261010_01_school_term_reset_otp.sql'), 'utf8');
const resetPatch = fs.readFileSync(path.join(root, '20261010_02_reset_progress_without_dates.sql'), 'utf8');

function resetSqlChecks() {
  for (const sql of [migration, resetPatch]) {
    for (const statement of sql.match(/\bdelete\s+from\b[^;]*;/gi) || []) {
      assert.match(statement, /\bwhere\b/i, 'DELETE must include a WHERE clause for safeupdate');
    }
    assert.doesNotMatch(sql, /\b(?:set|set_config)\b[^;]*safeupdate\.enabled/i, 'never disable safeupdate');
  }
  for (const name of ['reset_school_progress', 'reset_school_for_new_semester']) {
    const pattern = new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\$\\$;');
    assert.equal(migration.match(pattern)?.[0], resetPatch.match(pattern)?.[0], name+' matches fresh-install migration');
  }
}
const fixture = `
create role anon; create role authenticated;
create table students(id text primary key,name text,grade text,role text,password text,photo_url text,is_first_login boolean);
create table system_settings(key text primary key,value text);
create table attendance_logs(id bigint generated always as identity primary key,student_id text references students(id),points integer,status text,timestamp timestamptz default now());
create table redemption_logs(id bigint generated always as identity primary key,student_id text references students(id),points_used integer,status text);
create table student_pets(student_id text primary key references students(id),pet_id text,free_select_used integer,rename_used integer);
create table student_pet_events(id bigint generated always as identity primary key,student_id text references students(id),points_used integer);
create table student_free_item_notification_state(student_id text primary key references students(id),last_seen_redemption_id bigint);
create table password_reset_requests(id bigint generated always as identity primary key,student_id text references students(id),student_name text,grade text,reset_code text,status text default 'pending' check(status in('pending','used','expired','cancelled')),created_at timestamptz default now(),expires_at timestamptz,used_at timestamptz);
create unique index password_reset_requests_one_pending_idx on password_reset_requests(student_id) where status='pending';
create table shop_items(item_id text primary key,item_name text,cost integer);
insert into students values('teacher','ครูทดสอบ','-','TEACHER','teacher-secret','teacher-photo',false),('02001','นักเรียน ก','ม.2/1','STUDENT','student-secret','profile-photo',false),('02002','นักเรียน ข','ม.2/2','STUDENT','other-secret','other-photo',true);
insert into attendance_logs(student_id,points,status) values('02001',30,'มา'),('teacher',5,'มา');
insert into redemption_logs(student_id,points_used,status) values('02001',5,'pending');
insert into student_pets values('02001','cat',3,2);
insert into student_pet_events(student_id,points_used) values('02001',25);
insert into student_free_item_notification_state values('02001',1);
insert into shop_items values('bonus','แต้มพิเศษ 1 คะแนน',25);
insert into system_settings values('logo_url','school-logo'),('school_name','โรงเรียนทดสอบ'),('pin','');`;

async function sqlTests() {
  const db = new PGlite();
  const value = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
  const rejected = async (sql, args, pattern) => assert.rejects(() => db.query(sql, args), pattern);
  try {
    await db.exec(fixture);
    await assert.rejects(()=>db.exec(resetPatch),/Run 20261010_01_school_term_reset_otp.sql/,'patch checks prerequisites');
    await db.exec('rollback');
    await db.exec(migration);
    await db.exec(migration);
    const beforePatch = (await db.query('select * from students order by id')).rows;
    const settingsBeforePatch = (await db.query('select * from system_settings order by key')).rows;
    // Model an already-deployed database with only the old seven-argument RPC.
    await db.exec(`drop function reset_school_progress(text,text,text);
      create or replace function reset_school_for_new_semester(p_teacher_token text,p_password text,
        p_expected_version text,p_number integer,p_year integer,p_start date,p_end date)
      returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
      begin
        if p_start is null or p_end is null then raise exception 'legacy date requirement'; end if;
        delete from mathquest_private.teacher_sessions;
        return '{}'::jsonb;
      end; $$;`);
    await db.exec(resetPatch);
    await db.exec(resetPatch);
    assert.deepEqual((await db.query('select * from students order by id')).rows,beforePatch,'patch never modifies accounts');
    assert.deepEqual((await db.query('select * from system_settings order by key')).rows,settingsBeforePatch,'patch never changes semester/version');
    assert.equal(await value('select count(*)::integer as value from attendance_logs'), 2, 'migration never resets data');
    await rejected('select open_teacher_admin_session($1,$2)', ['02001','student-secret'], /รหัสผ่านครู/);
    let token = await value('select open_teacher_admin_session($1,$2) as value', ['teacher','teacher-secret']);
    await rejected('select preview_school_reset($1)', ['wrong-token'], /สิทธิ์ครู/);
    let preview = await value('select preview_school_reset($1) as value', [token]);
    assert.equal(preview.students, 2); assert.equal(preview.attendance, 1);
    await value('select set_school_semester($1,$2,$3,$4,$5,$6) as value',[token,1,2569,'2026-05-16','2026-10-15',preview.version]);
    assert.equal(await value('select count(*)::integer as value from attendance_logs'),2,'saving semester never deletes progress');
    const args = () => [token,'teacher-secret',preview.version];
    const reset = 'select reset_school_progress($1,$2,$3) as value';
    const legacyReset = 'select reset_school_for_new_semester($1,$2,$3,$4,$5,$6,$7) as value';
    await rejected(reset, args(), /ออเดอร์/);
    assert.equal(await value('select count(*)::integer as value from attendance_logs'), 2, 'failed reset rolled back');
    await db.exec("update redemption_logs set status='approved'");
    await rejected('select open_school_attendance_session($1,$2,$3)', [token,'ม.2/3',preview.version], /ห้องจริง/);
    const opened = await value('select open_school_attendance_session($1,$2,$3) as value', [token,'ม.2/1',preview.version]);
    assert.equal(opened.status,'success'); assert.match(opened.pin,/^\d{4}$/);
    await rejected(reset, args(), /ปิดคาบ/);
    await db.exec("update system_settings set value='' where key='pin'");
    await rejected(reset, [token,'wrong-password',preview.version], /รหัสผ่านครู/);
    await rejected(reset, [token,'teacher-secret','stale'], /ข้อมูลเปลี่ยน/);
    await rejected(legacyReset, [...args(),2,2569,'2027-03-31','2026-11-01'], /วันเริ่ม/);
    await db.exec("insert into attendance_logs(student_id,points,status,timestamp) values('02001',3,'มา','2024-01-01'),('02002',5,'มา','2027-04-01')");
    const termBeforeReset = (await db.query("select * from system_settings where key like 'semester_%' order by key")).rows;
    // A late failure must roll back earlier deletes and the changed data version.
    await db.exec(`create function fail_session_delete() returns trigger language plpgsql as $$
      begin raise exception 'forced session cleanup failure'; end; $$;
      create trigger fail_session_delete before delete on mathquest_private.teacher_sessions
        for each statement execute function fail_session_delete();`);
    await rejected(reset,args(),/forced session cleanup failure/);
    assert.equal(await value('select count(*)::integer as value from attendance_logs'),4,'late failure rolls back all attendance deletes');
    assert.equal(await value('select count(*)::integer as value from redemption_logs'),1,'late failure rolls back shop deletes');
    assert.equal(await value("select value from system_settings where key='school_data_version'"),preview.version,'late failure rolls back data version');
    assert.equal(await value('select count(*)::integer as value from mathquest_private.teacher_sessions'),1,'late failure preserves session');
    await db.exec('drop trigger fail_session_delete on mathquest_private.teacher_sessions; drop function fail_session_delete()');
    const resetDefinition = await value("select pg_get_functiondef('public.reset_school_progress(text,text,text)'::regprocedure) as value");
    assert.match(resetDefinition,/delete from mathquest_private\.teacher_sessions[\s\S]*?where ts\.teacher_id=s\.id/i,'explicit account-scoped session cleanup');
    const accounts = (await db.query('select * from students order by id')).rows;
    const done = await value(reset, args()); assert.equal(done.status,'success');
    assert.equal(done.deleted.attendance,3,'reset includes records before/after semester range');
    assert.deepEqual((await db.query('select * from students order by id')).rows, accounts, 'accounts/photos/passwords/first-login untouched');
    for (const table of ['redemption_logs','student_pets','student_pet_events','password_reset_requests','student_free_item_notification_state']) {
      assert.equal(await value(`select count(*)::integer as value from ${table}`),0,table+' emptied');
    }
    assert.equal(await value("select count(*)::integer as value from attendance_logs where student_id='02001'"),0);
    assert.equal(await value("select count(*)::integer as value from attendance_logs where student_id='02002'"),0,'all rooms and dates cleared');
    assert.equal(await value("select count(*)::integer as value from attendance_logs where student_id='teacher'"),1);
    assert.deepEqual((await db.query("select * from system_settings where key like 'semester_%' order by key")).rows,termBeforeReset,'reset does not require or change semester dates/label');
    assert.equal(await value('select count(*)::integer as value from mathquest_private.teacher_sessions'),0,'sessions cleared with WHERE clause');
    assert.equal(await value('select count(*)::integer as value from shop_items'),1);
    assert.equal(await value("select value from system_settings where key='logo_url'"),'school-logo');
    await rejected('select preview_school_reset($1)',[token],/สิทธิ์ครู/);
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-school-data-version':preview.version})]);
    await rejected("insert into attendance_logs(student_id,points,status) values('02001',5,'มา')",[],/เข้าสู่ระบบใหม่/);
    await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-school-data-version':done.version})]);
    await db.exec("insert into attendance_logs(student_id,points,status) values('02001',5,'มา')");
    token = await value('select open_teacher_admin_session($1,$2) as value',['teacher','teacher-secret']);
    const requested = await value('select request_student_password_reset($1) as value',['02001']);
    assert.equal(requested.status,'success'); assert.equal(requested.reset_code,undefined);
    const again = await value('select request_student_password_reset($1) as value',['02001']); assert.equal(again.status,'existing');
    let requests = (await db.query('select * from teacher_password_reset_requests($1)',[token])).rows;
    const code = requests[0].reset_code;
    const wrong = code==='111111' ? '222222' : '111111';
    assert.equal((await value('select verify_student_reset_otp($1,$2) as value',['02001',wrong])).status,'fail');
    assert.equal(await value("select failed_attempts as value from password_reset_requests where student_id='02001'"),1);
    const verified = await value('select verify_student_reset_otp($1,$2) as value',['02001',code]); assert.equal(verified.status,'success');
    assert.equal(await value("select password as value from students where id='02001'"),'student-secret','OTP alone never changes password');
    assert.equal((await value('select verify_student_reset_otp($1,$2) as value',['02001',code])).status,'fail','OTP is single-use');
    assert.equal((await value('select complete_student_password_reset($1,$2,$3) as value',['02001','wrong','new-secret'])).status,'fail');
    assert.equal((await value('select complete_student_password_reset($1,$2,$3) as value',['02001',verified.token,'short'])).status,'fail');
    assert.equal((await value('select complete_student_password_reset($1,$2,$3) as value',['02001',verified.token,'new-secret'])).status,'success');
    assert.equal((await value('select complete_student_password_reset($1,$2,$3) as value',['02001',verified.token,'second-secret'])).status,'fail');
    assert.equal(await value("select photo_url as value from students where id='02001'"),'profile-photo');
    await value('select request_student_password_reset($1) as value',['02002']);
    requests=(await db.query('select * from teacher_password_reset_requests($1)',[token])).rows;
    const expired = await value('select verify_student_reset_otp($1,$2) as value',['02002',requests[0].reset_code]);
    await db.exec("update password_reset_requests set verified_until=now()-interval '1 second'");
    assert.equal((await value('select complete_student_password_reset($1,$2,$3) as value',['02002',expired.token,'changed-secret'])).status,'fail');
    await value('select request_student_password_reset($1) as value',['02002']);
    for(let i=0;i<5;i++)await value('select verify_student_reset_otp($1,$2) as value',['02002','bad-code']);
    requests=(await db.query('select * from teacher_password_reset_requests($1)',[token])).rows;
    assert.equal((await value('select verify_student_reset_otp($1,$2) as value',['02002',requests[0].reset_code])).status,'fail','attempt limit');
    await db.exec('set role anon');
    await rejected(reset, ['wrong-token','teacher-secret',done.version], /สิทธิ์ครู/);
    await rejected('select reset_code from password_reset_requests',[],/permission denied/);
    await rejected('select * from mathquest_private.teacher_sessions',[],/permission denied/);
    assert.equal((await value('select request_student_password_reset($1) as value',['02001'])).status,'success','public request RPC works');
    await db.exec('reset role');
    await db.exec('drop table student_pets; drop table student_pet_events');
    assert.equal((await value('select preview_school_reset($1) as value',[token])).pets,0,'optional pet tables');
    preview=await value('select preview_school_reset($1) as value',[token]);
    await value('select set_school_semester($1,$2,$3,$4,$5,$6) as value',[token,2,2569,null,null,preview.version]);
    assert.equal((await value(reset,args())).status,'success','no semester dates; optional pet tables');
    assert.equal(await value("select value from system_settings where key='semester_number'"),'2');
    assert.equal(await value("select value from system_settings where key='semester_start'"),'');
    token=await value('select open_teacher_admin_session($1,$2) as value',['teacher','teacher-secret']);
    preview=await value('select preview_school_reset($1) as value',[token]);
    assert.equal((await value(legacyReset,[...args(),1,2570,null,null])).status,'success','legacy RPC also accepts no dates');
    assert.equal(await value("select value from system_settings where key='semester_year'"),'2570');
    assert.equal(await value("select count(*)::integer as value from attendance_logs where student_id='02001'"),0);
    console.log('PASS SQL: migration/patch rerun, explicit DELETE WHERE, reset without dates across all rooms/dates, preserved semester/accounts, late-failure rollback, legacy RPC, authorization, stale writes and OTP');
  } finally { await db.close(); }
}

function helperTests() {
  const sandbox=vm.createContext({console,Date,Set,Array,document:{addEventListener(){}},normalizeGrade:s=>String(s||'').trim(),escHtml:s=>String(s)});
  vm.runInContext(fs.readFileSync(path.join(root,'school-admin.js'),'utf8'),sandbox);
  sandbox.schoolRooms=['ม.2/2','ม.2/1','ม.4'];
  const actual=sandbox.roomOptions(false).map(x=>x.value);
  assert.equal(actual.join(','),'ม.2/1,ม.2/2,ม.4');
  assert.ok(!actual.includes('ม.2/3')); assert.ok(!actual.includes('ม.2'));
  assert.ok(sandbox.roomOptions(true).some(x=>x.value==='ม.2' && x.label.includes('ทุกห้อง')));
  assert.equal(sandbox.validSchoolDate('2026-02-30'),false); assert.equal(sandbox.validSchoolDate('2028-02-29'),true);
  assert.equal(sandbox.semesterLabel({number:'2',year:'2569'}),'2/2569');
  console.log('PASS helpers: actual rooms, aggregates, dates, semester labels');
}

resetSqlChecks();
sqlTests().then(helperTests).catch(error=>{console.error(error);process.exitCode=1;});
