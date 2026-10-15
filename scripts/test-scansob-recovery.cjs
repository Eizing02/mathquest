const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { setup, event, read } = require('./test-scansob.cjs');
const { PGlite } = require(path.join(process.env.SQL_QA_MODULE_ROOT || path.join(os.tmpdir(), 'mathquest-sql-qa', 'node_modules'), '@electric-sql/pglite'));

async function harness(db, options) {
  const identity = await setup(db, options);
  const { createScanSobHandler } = await import(pathToFileURL(path.resolve(__dirname, '../supabase/functions/_shared/scansob-http.mjs')));
  const source = process.env.SCANSOB_SOURCE_DIR || path.join(os.tmpdir(), 'mathquest-scansob-reference');
  const upstream = fs.existsSync(path.join(source, 'lib/integrations/mathquest/contract.ts')) ? await require('./test-scansob-contract.cjs').loadUpstream() : null;
  const rpc = async (name, args) => (await db.query(`select public.${name}(${Object.keys(args).map((k, i) => k + '=>$' + (i + 1)).join(',')}) as value`, Object.values(args))).rows[0].value;
  await identity.actor(identity.teacher);
  let teacherToken = await rpc('mq_open_teacher_session', {});
  const admin = async (action, args = {}) => {
    await identity.actor(identity.teacher);
    return rpc('mq_scansob_admin', { p_teacher_token: teacherToken, p_action: action, p_args: args });
  };
  const service = async (name, args) => {
    await db.exec('reset role; set role service_role');
    return rpc(name, args);
  };
  const pairHandler = createScanSobHandler('pair', { pairingKey: 'synthetic-recovery-key-not-a-production-secret', rpc: service });
  const scoreHandler = createScanSobHandler('scores', { rpc: service });
  const call = async (handler, body, token) => {
    const response = await handler(new Request('https://fixture.invalid', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body)
    }));
    const result = { status: response.status, body: await response.json() };
    if (handler === scoreHandler && result.status === 200 && upstream) upstream.validateAcknowledgment(result.body, upstream.scoreEventSchema.parse(body));
    return result;
  };
  const statusBody = request => ({ schema_version: '1.0', action: 'status', request_id: request.request_id,
    source_workspace_id: request.source_workspace_id, request_secret: request.request_secret });
  const request = async (workspace = crypto.randomUUID()) => {
    const code = await admin('create_code');
    const body = { schema_version: '1.0', action: 'request', request_id: crypto.randomUUID(), source_workspace_id: workspace,
      workspace_label: 'Synthetic recovery workspace', request_secret: crypto.randomBytes(32).toString('base64url'), pairing_code: code.code };
    assert.equal((await call(pairHandler, body)).body.status, 'pending_approval');
    return body;
  };
  const approve = async (workspace, deliver = true) => {
    const body = await request(workspace);
    await admin('approve', { request_id: body.request_id });
    return { request: body, connection: deliver ? (await call(pairHandler, statusBody(body))).body.connection : null };
  };
  const rows = async (who = identity.student, kind = 'scores') => {
    await identity.actor(who);
    return rpc('mq_scansob_read', { p_kind: kind });
  };
  const reset = async () => {
    await identity.actor(identity.teacher);
    const result = await rpc('mq_reset_student_progress', { p_teacher_token: teacherToken, p_expected_version: 'fixture-v1' });
    await identity.actor(identity.teacher);
    teacherToken = await rpc('mq_open_teacher_session', {});
    return result;
  };
  return { ...identity, rpc, admin, call, statusBody, request, approve, rows, reset, pairHandler, scoreHandler };
}

async function lifecycle() {
  const db = new PGlite();
  try {
    const h = await harness(db);
    const workspace = crypto.randomUUID();
    const first = await h.approve(workspace);
    await h.admin('configure', { enabled: true, student_view_enabled: true, accept_self_claim_risk: true });
    const score = event(first.connection.id, workspace);
    assert.equal((await h.call(h.scoreHandler, score, first.connection.token)).body.accepted, 1);
    assert.equal((await h.rows()).rows.length, 1);
    const before = (await h.rows(h.teacher)).version;
    await h.admin('revoke', { connection_id: first.connection.id });
    assert.notEqual((await h.rows(h.teacher)).version, before, 'revoke invalidates a teacher CSV snapshot');
    assert.equal((await h.rows()).rows.length, 0);
    const second = await h.approve(workspace, false);
    assert.equal((await h.rows()).rows.length, 0, 'approval before token delivery must not resurface old scores');
    assert.equal((await h.rows(h.student, 'exams')).rows.length, 0);
    const held = await h.rows(h.teacher);
    assert.equal(held.rows[0].student_visible, false);
    assert.equal(held.rows[0].visibility_reason, 'connection_revoked');
    const active = (await h.call(h.pairHandler, h.statusBody(second.request))).body.connection;
    const revision = { ...score, event_id: crypto.randomUUID(), connection_id: active.id, publication_revision: 2,
      batch_index: 0, batch_count: 2, results: [{ ...score.results[0], student_code: '00002' }] };
    assert.equal((await h.call(h.scoreHandler, revision, active.token)).body.accepted, 1);
    assert.equal((await h.rows(h.other)).rows.length, 0, 'incomplete revision hidden');
    const last = { ...revision, event_id: crypto.randomUUID(), batch_index: 1, results: [{ ...score.results[0], student_code: '00999' }] };
    assert.equal((await h.call(h.scoreHandler, last, active.token)).body.unmatched.length, 1);
    assert.equal((await h.rows(h.other)).rows.length, 1);
    assert.equal((await h.rows()).rows.length, 0, 'omitted rows from the old connection stay hidden');
    const update = { ...revision, event_id: crypto.randomUUID(), publication_revision: 3, batch_count: 1 };
    assert.equal((await h.call(h.scoreHandler, update, active.token)).body.accepted, 1);
    const omitted = { ...update, event_id: crypto.randomUUID(), publication_revision: 4, results: score.results };
    assert.equal((await h.call(h.scoreHandler, omitted, active.token)).body.accepted, 1);
    assert.equal((await h.rows(h.other)).rows.length, 1, 'additive omission within one active lifecycle still retains scores');
    assert.equal((await h.rows()).rows.length, 1);
    const cancellation = { ...h.statusBody(second.request), action: 'revoke' };
    const ack = await h.call(h.pairHandler, cancellation);
    assert.deepEqual(ack, await h.call(h.pairHandler, cancellation), 'lost cancellation ACK is replayable');
    assert.equal(ack.body.status, 'revoked');
    assert.equal((await h.call(h.scoreHandler, omitted, active.token)).status, 401);
    assert.equal((await h.rows()).rows.length, 0);
    await h.actor(h.student);
    for (const table of ['scansob_exam_purges', 'scansob_cancelled_requests']) {
      await assert.rejects(() => db.query('select * from mathquest_private.' + table), /permission denied/);
    }
    for (const sql of ["select mq_scansob_admin_v02('x','status','{}')", "select mq_reset_student_progress_v02('x','x')",
      'select mathquest_private.scansob_score_visible(1)']) await assert.rejects(() => db.query(sql), /permission denied/);
    await db.exec('reset role; set role service_role');
    await assert.rejects(() => db.query("select mq_scansob_admin_v02('x','status','{}')"), /permission denied/);
    console.log('PASS lifecycle: no reapproval leak, per-row provenance, incomplete batches, additive omission, CSV revoke snapshot, ACLs');
  } finally { await db.close(); }
}

async function cancellation() {
  const db = new PGlite();
  try {
    const h = await harness(db);
    const pending = await h.request();
    const revoke = { ...h.statusBody(pending), action: 'revoke' };
    assert.equal((await h.call(h.pairHandler, revoke)).body.status, 'revoked');
    await assert.rejects(() => h.admin('approve', { request_id: pending.request_id }), /หมดอายุ|ดำเนินการ/);
    const race = await h.request();
    assert.equal((await h.call(h.pairHandler, h.statusBody(race))).body.status, 'pending_approval');
    await h.admin('approve', { request_id: race.request_id });
    assert.equal((await h.call(h.pairHandler, { ...h.statusBody(race), action: 'revoke' })).body.status, 'revoked', 'approval between status and revoke');
    const expired = await h.approve(undefined, false);
    await db.exec('reset role');
    await db.query("update mathquest_private.scansob_requests set expires_at=now()-interval '1 hour' where id=$1", [expired.request.request_id]);
    assert.equal((await h.call(h.pairHandler, h.statusBody(expired.request))).body.status, 'expired');
    const expiredRevoke = { ...h.statusBody(expired.request), action: 'revoke' };
    assert.equal((await h.call(h.pairHandler, expiredRevoke)).body.status, 'revoked');
    assert.equal((await h.call(h.pairHandler, { ...expiredRevoke, request_secret: crypto.randomBytes(32).toString('base64url') })).status, 403);
    assert.equal((await h.call(h.pairHandler, { ...expiredRevoke, source_workspace_id: crypto.randomUUID() })).status, 403);
    const missing = { schema_version: '1.0', action: 'status', request_id: crypto.randomUUID(), source_workspace_id: crypto.randomUUID(), request_secret: crypto.randomBytes(32).toString('base64url') };
    const terminal = await h.call(h.pairHandler, missing);
    assert.deepEqual(terminal.body, { schema_version: '1.0', request_id: missing.request_id, status: 'expired' });
    const missingRevoke = { ...missing, action: 'revoke' };
    assert.equal((await h.call(h.pairHandler, { ...missingRevoke, connection_id: crypto.randomUUID() })).status, 403, 'unknown request cannot certify revocation of an asserted connection');
    const done = await h.call(h.pairHandler, missingRevoke);
    assert.equal(done.body.status, 'revoked');
    assert.deepEqual(await h.call(h.pairHandler, missingRevoke), done);
    assert.equal((await h.call(h.pairHandler, { ...missing, request_secret: crypto.randomBytes(32).toString('base64url') })).status, 403);
    const code = await h.admin('create_code');
    assert.equal((await h.call(h.pairHandler, { ...missing, action: 'request', workspace_label: 'Late request', pairing_code: code.code })).body.status, 'expired');
    const direct = { ...missing, request_id: crypto.randomUUID(), action: 'revoke' };
    assert.equal((await h.call(h.pairHandler, direct)).body.status, 'revoked');
    await db.exec('reset role');
    const found = await db.query('select count(*) as n from mathquest_private.scansob_connections where workspace_id=$1', [missing.source_workspace_id]);
    assert.equal(Number(found.rows[0].n), 0, 'closed unknown request never creates a connection');
    await db.query("insert into mathquest_private.scansob_limits values('pair-unregistered',clock_timestamp(),30) on conflict(key) do update set attempts=30,bucket_start=clock_timestamp()");
    assert.equal((await h.call(h.pairHandler, { ...missing, request_id: crypto.randomUUID() })).status, 429, 'unregistered storage is rate bounded');
    await db.exec('reset role');
    await db.query("update mathquest_private.scansob_limits set attempts=0 where key='pair-unregistered'");
    await db.query("insert into mathquest_private.scansob_cancelled_requests(request_id,workspace_id,request_hash) select gen_random_uuid(),gen_random_uuid(),repeat('0',64) from generate_series(1,10000)");
    assert.equal((await h.call(h.pairHandler, { ...missing, request_id: crypto.randomUUID() })).status, 429, 'unregistered tombstones have a hard storage bound');
    const registered = await h.request();
    assert.equal((await h.call(h.pairHandler, { ...h.statusBody(registered), action: 'revoke' })).body.status, 'revoked', 'storage cap does not block registered cancellation');
    console.log('PASS cancellation: approval races, expired token window, absent-request tombstones, delayed requests, exact ACK replay and rate bounds');
  } finally { await db.close(); }
}

async function purges() {
  const db = new PGlite();
  try {
    const h = await harness(db);
    const workspace = crypto.randomUUID();
    const first = await h.approve(workspace);
    await h.admin('configure', { enabled: true, student_view_enabled: true, accept_self_claim_risk: true });
    const score = event(first.connection.id, workspace);
    await h.call(h.scoreHandler, score, first.connection.token);
    await assert.rejects(() => h.reset(), /ถอนการเผยแพร่/);
    await h.admin('revoke', { connection_id: first.connection.id });
    await h.reset();
    const second = await h.approve(workspace);
    await h.admin('configure', { enabled: true, student_view_enabled: true, accept_self_claim_risk: true });
    const base = { ...score, event_id: crypto.randomUUID(), connection_id: second.connection.id, publication_revision: 2 };
    assert.equal((await h.call(h.scoreHandler, base, second.connection.token)).body.error, 'TERM_CLOSED');
    const withdrawal = { ...base, action: 'withdraw_exam', results: [] };
    await db.exec('reset role');
    await db.exec("create function mathquest_private.fail_purge_ack() returns trigger language plpgsql as $$ begin raise exception 'synthetic late failure'; end $$; create trigger fail_purge_ack before insert on mathquest_private.scansob_events for each row execute function mathquest_private.fail_purge_ack()");
    assert.equal((await h.call(h.scoreHandler, withdrawal, second.connection.token)).status, 503);
    await db.exec('reset role');
    assert.equal((await db.query('select acknowledged_revision from mathquest_private.scansob_exam_purges')).rows[0].acknowledged_revision, null, 'failed ACK rolls back purge evidence mutation');
    assert.equal(Number((await db.query("select count(*) as n from mathquest_private.scansob_audit where action='ack_purged_withdrawal'")).rows[0].n), 0);
    await db.exec('drop trigger fail_purge_ack on mathquest_private.scansob_events');
    const proof = await h.call(h.scoreHandler, withdrawal, second.connection.token);
    assert.deepEqual(proof.body, { schema_version: '1.0', event_id: withdrawal.event_id, status: 'processed', accepted: 0, unmatched: [], invalid: [] });
    assert.deepEqual(await h.call(h.scoreHandler, withdrawal, second.connection.token), proof);
    assert.equal((await h.rows()).rows.length, 0);
    assert.equal((await h.call(h.scoreHandler, { ...withdrawal, event_id: crypto.randomUUID() }, second.connection.token)).status, 409);
    const unknown = { ...withdrawal, event_id: crypto.randomUUID(), source_exam_id: crypto.randomUUID() };
    assert.equal((await h.call(h.scoreHandler, unknown, second.connection.token)).body.error, 'TERM_CLOSED', 'closure alone is not purge evidence');
    const other = await h.approve();
    assert.equal((await h.call(h.scoreHandler, { ...withdrawal, event_id: crypto.randomUUID(), connection_id: other.connection.id, source_workspace_id: other.request.source_workspace_id }, other.connection.token)).status, 403);
    const stale = { ...withdrawal, event_id: crypto.randomUUID(), publication_revision: 1 };
    assert.equal((await h.call(h.scoreHandler, stale, second.connection.token)).body.status, 'stale_ignored');
    const open = { ...base, event_id: crypto.randomUUID(), source_exam_id: crypto.randomUUID(), exam: { ...base.exam, term: 2 } };
    assert.equal((await h.call(h.scoreHandler, open, second.connection.token)).body.accepted, 1, 'another term stays open');
    assert.equal((await h.call(h.scoreHandler, { ...withdrawal, event_id: crypto.randomUUID(), source_exam_id: open.source_exam_id, publication_revision: 3 }, second.connection.token)).status, 403, 'a forged closed-term withdrawal cannot certify retained open-term scores');
    assert.equal((await h.rows()).rows.length, 1);
    await db.exec('reset role');
    const marker = (await db.query('select * from mathquest_private.scansob_exam_purges')).rows[0];
    assert.equal(Number(marker.acknowledged_revision), 2);
    assert.ok(!['student_code', 'student_id', 'result', 'score', 'metadata'].some(key => Object.hasOwn(marker, key)));
    assert.equal(Number((await db.query("select count(*) as n from mathquest_private.scansob_audit where action='ack_purged_withdrawal'")).rows[0].n), 1);
    assert.deepEqual((await db.query('select metadata,reset_at,revision from mathquest_private.scansob_exams where source_exam_id=$1', [score.source_exam_id])).rows[0].metadata, {});
    console.log('PASS purge: preserved accounts, authenticated higher withdrawal ACK, replay, no invented proof, closed/open-term isolation and no retained score data');
  } finally { await db.close(); }
}

async function backfill() {
  const db = new PGlite();
  try {
    const h = await harness(db, { upgrade: false });
    const workspace = crypto.randomUUID();
    const first = await h.approve(workspace);
    await h.admin('configure', { enabled: true, student_view_enabled: true, accept_self_claim_risk: true });
    const old = event(first.connection.id, workspace);
    await h.call(h.scoreHandler, old, first.connection.token);
    const mixed = { ...event(first.connection.id, workspace), batch_count: 2 };
    await h.call(h.scoreHandler, mixed, first.connection.token);
    await h.admin('revoke', { connection_id: first.connection.id });
    const second = await h.approve(workspace);
    await h.call(h.scoreHandler, { ...mixed, event_id: crypto.randomUUID(), connection_id: second.connection.id, batch_index: 1, results: [{ ...mixed.results[0], student_code: '00002' }] }, second.connection.token);
    const current = event(second.connection.id, workspace);
    await h.call(h.scoreHandler, current, second.connection.token);
    await db.exec('reset role');
    await db.exec(read('20261015_03_scansob_recovery_hardening.sql'));
    await db.exec(read('20261015_03_scansob_recovery_hardening.sql'));
    const visible = await h.rows();
    assert.equal(visible.rows.length, 1, 'only the proven current connection survives migration');
    const all = await h.rows(h.teacher);
    assert.equal(all.rows.filter(row => row.visibility_reason === 'unverified_origin').length, 2, 'ambiguous batches fail closed');
    assert.equal(all.rows.filter(row => row.visibility_reason === 'connection_revoked').length, 1);
    assert.equal((await h.admin('status')).receiver_profile, '1.1');
    console.log('PASS migration: rerunnable, verified provenance backfill, ambiguous history hidden, current data preserved');
  } finally { await db.close(); }
}

async function legacyPurge() {
  const db = new PGlite();
  try {
    const h = await harness(db, { upgrade: false });
    const first = await h.approve();
    await h.admin('configure', { enabled: true, student_view_enabled: false, accept_self_claim_risk: false });
    const score = event(first.connection.id, first.request.source_workspace_id);
    await h.call(h.scoreHandler, score, first.connection.token);
    await h.admin('revoke', { connection_id: first.connection.id });
    await h.reset();
    await db.exec('reset role');
    await db.exec(read('20261015_03_scansob_recovery_hardening.sql'));
    const second = await h.approve(first.request.source_workspace_id);
    await h.admin('configure', { enabled: true, student_view_enabled: false, accept_self_claim_risk: false });
    const payload = { ...score, event_id: crypto.randomUUID(), connection_id: second.connection.id, publication_revision: 2, action: 'withdraw_exam', results: [] };
    assert.equal((await h.call(h.scoreHandler, payload, second.connection.token)).body.status, 'processed');
    console.log('PASS legacy purge: a verified empty pre-03 reset can reconcile without restoring student data');
  } finally { await db.close(); }
}

async function main() { await lifecycle(); await cancellation(); await purges(); await backfill(); await legacyPurge(); }
module.exports = { harness };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
