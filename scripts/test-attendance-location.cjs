const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const qa = process.env.GEO_QA_MODULE_ROOT || path.join(os.tmpdir(), 'mathquest-geo-qa', 'node_modules');
process.env.SQL_QA_MODULE_ROOT ||= qa;
const { setup } = require('./test-scansob.cjs');
const { PGlite } = require(path.join(qa, '@electric-sql/pglite'));
const { postgis } = require(path.join(qa, '@electric-sql/pglite-postgis'));
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, '20261028_01_attendance_geofence.sql'), 'utf8');
const verify = fs.readFileSync(path.join(root, 'supabase/diagnostics/verify_attendance_geofence.sql'), 'utf8');
async function main() {
  const db = new PGlite({ extensions: { postgis } });
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;
  const rpc = (name, args = []) => scalar(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as value`, args);
  try {
    const { teacher, student, other, actor } = await setup(db);
    assert.equal((await db.query(verify)).rows[0].status, 'GPS_SQL_NOT_COMPLETE', 'diagnostic works before installation without missing-table errors');
    await db.exec(fs.readFileSync(path.join(root, '20260721_01_attendance_sessions_activity_bulk.sql'), 'utf8'));
    const original = (await db.query('select * from attendance_logs order by id')).rows;
    await db.query("update system_settings set value='1234' where key='pin'");
    await assert.rejects(() => db.exec(migration), /Close or cancel/);
    await db.exec('rollback');
    await db.query("update system_settings set value='' where key='pin'");
    await db.exec('create policy fixture_bad_write on attendance_logs for insert to authenticated with check(true)');
    await assert.rejects(() => db.exec(migration), /Review custom attendance/);
    await db.exec('rollback; drop policy fixture_bad_write on attendance_logs');
    await db.exec(migration); await db.exec(migration);
    const verified = (await db.query(verify)).rows[0];
    assert.equal(verified.status, 'GPS_SQL_INSTALLED');
    assert.ok(Object.entries(verified).filter(([key]) => key !== 'status').every(([, value]) => value === true));
    assert.deepEqual((await db.query('select * from attendance_logs order by id')).rows, original);
    assert.equal(await scalar("select extensions.postgis_version() as value").then(Boolean), true, 'real PostGIS extension, not a distance stub');
    const config = await scalar('select to_jsonb(c) as value from mathquest_private.attendance_geofence c');
    assert.deepEqual([config.latitude, config.longitude, config.radius_m, config.max_accuracy_m], [17.131333, 102.103092, 100, 50]);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(await scalar("select has_function_privilege($1,'mathquest_private.attendance_check_in_core(text,text)','execute') as value", [role]), false);
    }
    async function open(minutes = 0, days = 0) {
      await db.exec('reset role');
      await db.query("delete from mathquest_private.google_auth_limits where action in ('location_prepare','location_submit')");
      await db.query("delete from attendance_logs where session_id is not null");
      const session = crypto.randomUUID();
      await db.query(`insert into system_settings(key,value) values('pin','1234'),('pin_expiry',(clock_timestamp()+interval '40 minutes')::text),
        ('session_start',(clock_timestamp()-make_interval(mins=>$1,days=>$2))::text),('active_session_id',$3),('current_grade',$4)
        on conflict(key) do update set value=excluded.value`, [minutes, days, session, '\u0e21.2/1']);
      await actor(student);
      return session;
    }
    const prepare = () => rpc('mq_prepare_location_check_in', ['1234', 'fixture-v1']);
    const submit = (request, lat = config.latitude, lon = config.longitude, accuracy = 10, age = 0, pin = '1234') =>
      rpc('mq_student_check_in_at_location', [request.request_id, pin, 'fixture-v1', lat, lon, accuracy, age]);
    async function atDistance(meters) {
      await db.exec('reset role');
      const point = await scalar(`select jsonb_build_object('lat',extensions.st_y(p::extensions.geometry),'lon',extensions.st_x(p::extensions.geometry)) as value
        from (select extensions.st_project(extensions.st_setsrid(extensions.st_makepoint($1,$2),4326)::extensions.geography,$3::float8,0::float8) as p) x`, [config.longitude, config.latitude, meters]);
      await actor(student); return point;
    }
    await open();
    assert.equal((await rpc('mq_student_check_in', ['1234', 'fixture-v1'])).code, 'LOCATION_REQUIRED');
    await assert.rejects(() => db.query("insert into attendance_logs(student_id,status,points) values('00001','present',999)"), /row-level security/);
    await assert.rejects(() => rpc('bulk_set_attendance', [['00001'], ['2026-10-28'], '\u0e21\u0e32', 5]), /row-level security|permission denied/, 'legacy invoker bulk endpoint cannot bypass student RLS');
    assert.equal((await rpc('mq_prepare_location_check_in', ['9999', 'fixture-v1'])).code, 'LOCATION_WRONG_PIN');
    await actor(other); assert.equal((await prepare()).code, 'LOCATION_WRONG_CLASS');
    await actor(student); let request = await prepare(); assert.equal(request.result, 'ready');
    await actor(other); assert.equal((await submit(request)).code, 'LOCATION_REQUEST_INVALID');
    await actor(student);
    for (const [lat, lon, accuracy, age] of [[91, 102, 10, 0], [17, 181, 10, 0], [17, 102, 0, 0], [17, 102, 'NaN', 0], [17, 102, 'Infinity', 0], [17, 102, 10, 15001], [null, 102, 10, 0]]) {
      assert.equal((await submit(request, lat, lon, accuracy, age)).code, 'LOCATION_INVALID');
    }
    assert.equal((await submit(request, config.latitude, config.longitude, 51)).code, 'LOCATION_INACCURATE');
    let p = await atDistance(100.01); assert.equal((await submit(request, p.lat, p.lon, 1)).code, 'LOCATION_OUTSIDE');
    p = await atDistance(80.01); assert.equal((await submit(request, p.lat, p.lon, 20)).code, 'LOCATION_UNCERTAIN');
    p = await atDistance(79.99); const success = await submit(request, p.lat, p.lon, 20);
    assert.equal(success.result, 'success'); assert.equal(success.points, 5);
    assert.deepEqual(await submit(request), success, 'lost ACK replay returns frozen success, not a second award');
    await db.exec('reset role');
    assert.equal(await scalar('select count(*)::int as value from mathquest_private.attendance_location_checks'), 1);
    assert.equal(await scalar("select count(*)::int as value from attendance_logs where session_id is not null"), 1);
    assert.ok(!JSON.stringify((await db.query('select * from mathquest_private.attendance_location_checks')).rows).includes('latitude'), 'no raw student coordinates retained');
    await actor(student);
    await assert.rejects(() => db.query('select * from mathquest_private.attendance_location_requests'), /permission denied/);
    await assert.rejects(() => db.query("update mathquest_private.attendance_geofence set radius_m=1000"), /permission denied/);
    await open(); request = await prepare();
    await db.exec('reset role'); await db.query("update mathquest_private.attendance_location_requests set expires_at=clock_timestamp()-interval '1 second' where id=$1", [request.request_id]);
    await actor(student); assert.equal((await submit(request)).code, 'LOCATION_REQUEST_EXPIRED');
    request = await prepare();
    await db.exec('reset role'); await db.query('update mathquest_private.google_student_links set updated_at=clock_timestamp() where auth_user_id=$1', [student]);
    await actor(student); assert.equal((await submit(request)).code, 'LOCATION_REQUEST_INVALID', 'link changes invalidate outstanding requests');
    request = await prepare();
    await db.exec('reset role'); await db.query("update system_settings set value='' where key='active_session_id'");
    await actor(student); assert.equal((await submit(request)).code, 'LOCATION_REQUEST_INVALID');
    await open(); request = await prepare();
    await db.exec('reset role; begin');
    await db.query('update mathquest_private.attendance_geofence set max_accuracy_m=40 where singleton');
    await actor(student); assert.equal((await submit(request)).code, 'LOCATION_REQUEST_EXPIRED', 'policy edits invalidate issued nonces');
    await db.exec('rollback');
    await open(); request = await prepare();
    assert.notEqual((await submit(request, undefined, undefined, 10, 0, '9999')).result, 'success', 'PIN rechecked at commit');
    await db.exec('reset role');
    await db.exec("create function mathquest_private.fixture_geo_failure() returns trigger language plpgsql as $$ begin raise exception 'fixture evidence failure'; end $$; create trigger fixture_geo_failure before insert on mathquest_private.attendance_location_checks for each row execute function mathquest_private.fixture_geo_failure()");
    await actor(student); await assert.rejects(() => submit(request), /fixture evidence failure/);
    await db.exec('reset role');
    assert.equal(await scalar("select count(*)::int as value from attendance_logs where session_id is not null"), 0, 'evidence failure rolls back attendance');
    assert.equal(await scalar('select receipt as value from mathquest_private.attendance_location_requests where id=$1', [request.request_id]), null);
    await db.exec('drop trigger fixture_geo_failure on mathquest_private.attendance_location_checks');
    await actor(student); assert.equal((await submit(request)).result, 'success');
    await actor(teacher);
    await db.query("update attendance_logs set points=3 where session_id is not null");
    await db.exec('reset role');
    const evidence = (await db.query('select * from mathquest_private.attendance_location_checks')).rows[0];
    assert.equal(evidence.method, 'teacher'); assert.equal(evidence.accuracy_m, null); assert.equal(evidence.distance_m, null);
    for (const [minutes, points] of [[7, 3], [11, 0]]) {
      await open(minutes); request = await prepare(); const result = await submit(request); assert.equal(result.points, points);
    }
    await open(0, 1); request = await prepare(); assert.equal((await submit(request)).result, 'success');
    await db.exec('reset role');
    assert.equal(await scalar("select ((timestamp at time zone 'Asia/Bangkok')::date=(clock_timestamp() at time zone 'Asia/Bangkok')::date-1) as value from attendance_logs where session_id is not null"), true, 'opening-date convention unchanged');
    await open(); request = await prepare(); await db.exec('reset role');
    await db.query("update system_settings set value='fixture-v2' where key='school_data_version'");
    assert.equal(await scalar('select count(*)::int as value from mathquest_private.attendance_location_requests'), 0, 'reset version clears requests');
    assert.deepEqual(await scalar('select to_jsonb(c) as value from mathquest_private.attendance_geofence c'), config, 'reset retains geofence');
    await db.exec('set role anon');
    await assert.rejects(() => prepare(), /permission denied/);
    console.log('PASS actual PostGIS/PGlite: exact site/radius, migration rerun/no-data-change, GPS/PIN/identity/RLS enforcement, boundary uncertainty, freshness/expiry, replay, rollback, teacher provenance, 5/3/0 points, Bangkok opening date, reset invalidation');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
