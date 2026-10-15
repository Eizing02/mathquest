const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { PGlite } = require(path.join(process.env.SQL_QA_MODULE_ROOT || path.join(os.tmpdir(),'mathquest-sql-qa','node_modules'),'@electric-sql/pglite'));
const root = path.resolve(__dirname,'..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const fixture = `
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb);
create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),provider text,identity_data jsonb);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
grant usage on schema auth to anon,authenticated;
create table students(id text primary key,name text not null,grade text not null,role text not null,password text not null,
  photo_url text,is_first_login boolean default false,created_at timestamptz default now(),updated_at timestamptz default now());
create table system_settings(key text primary key,value text);
create table attendance_logs(id bigint generated always as identity primary key,student_id text references students(id),points integer,status text,timestamp timestamptz default now(),session_id text);
create table shop_items(item_id text primary key,item_name text,cost integer,is_active boolean,description text,image_url text,bonus_points numeric default 0);
create table redemption_logs(id bigint generated always as identity primary key,student_id text references students(id),item_id text references shop_items(item_id),item_name text,points_used integer,status text,timestamp timestamptz default now(),bonus_points numeric);
create table student_pets(student_id text primary key references students(id),pet_id text,pet_name text,free_select_used integer default 0,rename_used integer default 0,selected_at timestamptz,updated_at timestamptz);
create table student_pet_events(id bigint generated always as identity primary key,student_id text references students(id),event_type text,from_pet_id text,to_pet_id text,previous_name text,new_name text,points_used integer,created_at timestamptz default now());
create table student_free_item_notification_state(student_id text primary key references students(id),last_seen_redemption_id bigint default 0,seen_at timestamptz);
create table password_reset_requests(id bigint generated always as identity primary key,student_id text references students(id),student_name text,grade text,reset_code text,status text default 'pending',created_at timestamptz default now(),expires_at timestamptz,used_at timestamptz);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create policy mathquest_storage_public_insert on storage.objects for insert to public with check(true);
create policy mathquest_storage_public_update on storage.objects for update to public using(true) with check(true);
create policy mathquest_storage_public_delete on storage.objects for delete to public using(true);
create policy mathquest_storage_public_read on storage.objects for select to public using(true);
grant usage on schema storage to authenticated,anon;
grant select,insert,update,delete on storage.objects to authenticated,anon;
insert into students(id,name,grade,role,password,photo_url) values
 ('teacher','ครูทดสอบ','-','TEACHER','fixture-old-password','teacher-photo'),
 ('00001','นักเรียน ก','ม.2/1','STUDENT','old-a','old-photo'),
 ('00002','นักเรียน ข','ม.2/2','STUDENT','old-b','photo-b'),
 ('00003','นักเรียน ค','ม.2/1','STUDENT','old-c','photo-c');
insert into system_settings values('school_name','โรงเรียนทดสอบ'),('pin',''),('school_data_version','fixture-v1');
insert into attendance_logs(student_id,points,status,timestamp) values('00001',100,'มา','2024-01-01');
insert into shop_items values('bonus','แต้มพิเศษ',10,true,'','',1);
grant all on all tables in schema public to anon,authenticated;
`;

async function main() {
  const db = new PGlite();
  const scalar = async (sql,args=[]) => (await db.query(sql,args)).rows[0]?.value;
  const rpc = (name,args=[]) => scalar(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args);
  const rejected = (sql,args,pattern) => assert.rejects(()=>db.query(sql,args),pattern);
  const actors = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004'];
  const sessions = actors.map((_,i)=>'20000000-0000-4000-8000-00000000000'+(i+1));
  async function actor(index,age=0,extra={}) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actors[index],session_id:sessions[index],amr:[{method:'oauth',timestamp:Math.floor(Date.now()/1000)-age}],...extra})]);
    await db.exec('set role authenticated');
  }
  try {
    await db.exec(fixture);
    await db.exec(read('20261010_01_school_term_reset_otp.sql'));
    await db.exec(read('20261010_02_reset_progress_without_dates.sql'));
    await db.exec(read('20260915_01_report_bonus_points.sql'));
    for(let i=0;i<actors.length;i++) {
      const email=i===0?'piyawatpiwsiri@gmail.com':`student-${i}@fixture.invalid`;
      await db.query("insert into auth.users values($1,$2,now(),'{\"provider\":\"google\"}')",[actors[i],email]);
      await db.query("insert into auth.identities(user_id,provider,identity_data) values($1,'google',$2)",[actors[i],JSON.stringify({email,email_verified:true})]);
      await db.query('insert into auth.sessions values($1,$2)',[sessions[i],actors[i]]);
    }
    const before = (await db.query('select * from students order by id')).rows;
    const migration=read('20261015_01_google_login_student_links.sql');
    for(const statement of migration.match(/\bdelete\s+from\b[^;]*;/gi)||[]) assert.match(statement,/\bwhere\b/i,'safeupdate-compatible DELETE');
    await db.exec(migration); await db.exec(migration);
    assert.deepEqual((await db.query('select * from students order by id')).rows,before,'migration preserves all original accounts');
    assert.equal(await scalar('select count(*)::integer as value from attendance_logs'),1,'migration preserves progress');
    await db.exec('set role anon');
    await rejected('select id from students',[],/permission denied/);
    await rejected('select mq_google_account()',[],/permission denied/);
    assert.equal((await db.query("select * from system_settings where key='pin'")).rows.length,0,'PIN not publicly exposed');
    assert.equal((await db.query("select * from system_settings where key='school_name'")).rows.length,1,'public branding works');
    await actor(0);
    assert.equal((await rpc('mq_google_account')).role,'TEACHER');
    const token=await rpc('mq_open_teacher_session');
    assert.ok(token.length>40);
    await actor(1);
    assert.equal((await rpc('mq_google_account')).state,'unlinked');
    assert.equal((await rpc('mq_student_link',['lookup','123'])).code,'INVALID_STUDENT_CODE');
    assert.equal((await rpc('mq_student_link',['lookup','00001'])).student.name,'นักเรียน ก');
    assert.equal((await rpc('mq_student_link',['claim','00001'])).ok,true);
    assert.equal((await rpc('mq_google_account')).id,'00001');
    assert.deepEqual((await db.query('select id from students')).rows.map(x=>x.id),['00001'],'student sees only linked roster row');
    await rejected('select password from students',[],/permission denied/);
    await rejected("update students set role='TEACHER' where id='00001'",[],/permission denied/);
    await rejected("insert into attendance_logs(student_id,status,points) values('00001','มา',999)",[],/row-level security/);
    await rejected('select * from mathquest_private.google_student_links',[],/permission denied/);
    await db.exec("update students set photo_url='new-own-photo' where id='00001'");
    assert.equal((await db.query("update students set photo_url='stolen' where id='00002' returning id")).rows.length,0);
    await db.exec("insert into storage.objects(bucket_id,name) values('mathquest-storage','students/00001/a.png')");
    await rejected("insert into storage.objects(bucket_id,name) values('mathquest-storage','students/00002/a.png')",[],/row-level security/);
    await actor(2,0,{user_metadata:{email:'piyawatpiwsiri@gmail.com',role:'TEACHER'}});
    assert.equal((await rpc('mq_student_link',['claim','00001'])).code,'STUDENT_ALREADY_LINKED');
    assert.equal((await rpc('mq_student_link',['claim','00002'])).ok,true);
    await rejected('select mq_open_teacher_session()',[],/TEACHER_GOOGLE_REQUIRED/);
    assert.equal((await rpc('mq_student_buy_item',['bonus','fixture-v1'])).status,'fail','cannot spend another student wallet');
    await actor(0);
    await db.exec("update system_settings set value='1234' where key='pin'; insert into system_settings values('current_grade','ม.2/1'),('session_start',now()::text),('pin_expiry',(now()+interval '40 minutes')::text),('active_session_id','test-session') on conflict(key) do update set value=excluded.value");
    await actor(1);
    assert.equal((await rpc('mq_student_check_in',['0000','fixture-v1'])).result,'error');
    assert.equal((await rpc('mq_student_check_in',['1234','fixture-v1'])).points,5);
    assert.equal((await rpc('mq_student_check_in',['1234','fixture-v1'])).result,'duplicate');
    assert.equal((await rpc('mq_student_buy_item',['bonus','fixture-v1'])).mathCoins,95);
    assert.equal(Number(await scalar("select bonus_points as value from redemption_logs where item_id='bonus'")),1,'bonus snapshot trigger preserved');
    for(const id of ['leafy','volt','aqua'])assert.equal((await rpc('mq_student_pet',['select',id,'ชื่อทดสอบ','fixture-v1'])).cost,0);
    assert.equal((await rpc('mq_student_pet',['select','ember','ชื่อทดสอบ','fixture-v1'])).cost,25);
    for(const name of ['หนึ่ง','สอง','สาม'])assert.equal((await rpc('mq_student_pet',['rename',null,name,'fixture-v1'])).status,'success');
    assert.equal((await rpc('mq_student_pet',['rename',null,'สี่','fixture-v1'])).status,'fail');
    assert.equal((await rpc('mq_student_link',['switch','00003'])).code,'ACTIVE_SESSION');
    await actor(0); await db.exec("update system_settings set value='' where key='pin'");
    await actor(1);
    assert.equal((await rpc('mq_student_link',['switch','00003'])).ok,true);
    assert.deepEqual((await db.query('select id from students')).rows.map(x=>x.id),['00003']);
    assert.equal((await db.query('select * from attendance_logs')).rows.length,0,'switch does not transfer old progress');
    assert.equal((await rpc('mq_student_link',['switch','00001'])).code,'RATE_LIMITED');
    await actor(3);
    for(let i=0;i<10;i++)await rpc('mq_student_link',['lookup','99999']);
    assert.equal((await rpc('mq_student_link',['lookup','99999'])).code,'RATE_LIMITED');
    await actor(0,3600);
    await rejected('select mq_reset_student_progress($1,$2)',[token,'fixture-v1'],/GOOGLE_REAUTH_REQUIRED/);
    await rejected('select reset_school_progress($1,$2,$3)',[token,'fixture-old-password','fixture-v1'],/permission denied/);
    await actor(0);
    await rejected('select mq_reset_student_progress($1,$2)',[token,'fixture-v1'],/ออเดอร์/);
    await db.exec("update redemption_logs set status='approved' where status='pending'");
    await db.exec('reset role');
    const links=(await db.query('select * from mathquest_private.google_student_links order by student_id')).rows;
    const accounts=(await db.query('select * from students order by id')).rows;
    await actor(0);
    assert.equal((await rpc('mq_reset_student_progress',[token,'fixture-v1'])).status,'success');
    await db.exec('reset role');
    assert.deepEqual((await db.query('select * from mathquest_private.google_student_links order by student_id')).rows,links,'term reset preserves Google links');
    assert.deepEqual((await db.query('select * from students order by id')).rows,accounts,'reset keeps original credentials and photos');
    assert.equal(await scalar('select count(*)::integer as value from attendance_logs'),0);
    await actor(1);
    assert.equal((await rpc('mq_google_account')).id,'00003','returning Google account needs no new code after reset');
    await rejected('select mq_student_buy_item($1,$2)',['bonus','fixture-v1'],/ถูกรีเซ็ต/);
    await db.exec('reset role'); await db.query('delete from auth.sessions where id=$1',[sessions[1]]); await actor(1);
    await rejected('select mq_google_account()',[],/GOOGLE_SESSION_REQUIRED/);
    console.log('PASS Google SQL: Gmail-only teacher, verified Google session, self-claim/unique links, rate limits, RLS isolation, password denial, owned images, server-side PIN/shop/pets, bonus snapshots, fresh-auth reset and persistent links');
  } finally { await db.close(); }
}
module.exports = { fixture };
if (require.main === module) main().catch(error=>{console.error(error.message);if(error.where)console.error(error.where);process.exitCode=1;});
