// Receiver profile 1.0 from the 2026-10-15 handoff. No browser credentials here.
export class ContractError extends Error {}
const uuid = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
const secret = /^[A-Za-z0-9_-]{43}$/;
export const tokenPattern = /^[A-Za-z0-9_-]{43,256}$/;
function fail() { throw new ContractError('INVALID_SCHEMA'); }
function object(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail();
}
function text(value, max) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(); }
function id(value) { if (typeof value !== 'string' || !uuid.test(value)) fail(); }
function integer(value, min, max) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(); }
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail();
  const day = value.slice(0, 10);
  if (new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day) fail();
}
export function validateScoreEvent(value) {
  object(value, ['schema_version','event_id','connection_id','source_workspace_id','source_exam_id','publication_revision','action','batch_index','batch_count','occurred_at','exam','results']);
  if (value.schema_version !== '1.0' || !['publish_results','withdraw_exam'].includes(value.action)) fail();
  for (const key of ['event_id','connection_id','source_workspace_id','source_exam_id']) id(value[key]);
  integer(value.publication_revision, 1, Number.MAX_SAFE_INTEGER);
  integer(value.batch_count, 1, 100); integer(value.batch_index, 0, value.batch_count - 1); timestamp(value.occurred_at);
  object(value.exam, ['title','subject','exam_type','classroom','academic_year','term']);
  for (const [key,max] of [['title',120],['subject',80],['classroom',30]]) { text(value.exam[key], Number.MAX_SAFE_INTEGER); value.exam[key] = value.exam[key].trim(); text(value.exam[key],max); }
  if (value.exam.title.length < 3 || !['เก็บคะแนน','ก่อนเรียน','หลังเรียน','กลางภาค','ปลายภาค'].includes(value.exam.exam_type)) fail();
  integer(value.exam.academic_year, 2500, 2700); integer(value.exam.term, 1, 3);
  if (!Array.isArray(value.results) || value.results.length > 100) fail();
  if (value.action === 'withdraw_exam') {
    if (value.results.length || value.batch_count !== 1 || value.batch_index !== 0) fail();
  } else if (!value.results.length) fail();
  const seen = new Set();
  for (const row of value.results) {
    object(row, ['source_scan_id','source_exam_version_id','student_code','score','max_score','percent','passed','confirmed_at']);
    id(row.source_scan_id); id(row.source_exam_version_id); timestamp(row.confirmed_at);
    if (typeof row.student_code !== 'string' || !/^[0-9]{5}$/.test(row.student_code) || seen.has(row.student_code)) fail();
    seen.add(row.student_code);
    for (const key of ['score','max_score','percent']) if (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0 || row[key] > (key === 'percent' ? 100 : 6000)) fail();
    if (row.max_score <= 0 || row.score > row.max_score || Math.abs(row.percent - row.score / row.max_score * 100) > 0.011) fail();
    if (typeof row.passed !== 'boolean') fail();
  }
  return value;
}
export function validatePairRequest(value) {
  if (!value || !['request','status','revoke'].includes(value.action)) fail();
  const base = ['schema_version','action','request_id','source_workspace_id'];
  object(value, base.concat(value.action === 'request' ? ['workspace_label','request_secret','pairing_code'] : value.action === 'status' ? ['request_secret'] : []),
    value.action === 'revoke' ? ['request_secret','connection_id'] : []);
  if (value.schema_version !== '1.0') fail();
  id(value.request_id); id(value.source_workspace_id);
  if (value.action !== 'revoke' || value.request_secret !== undefined) if (typeof value.request_secret !== 'string' || !secret.test(value.request_secret)) fail();
  if (value.action === 'request') { text(value.workspace_label, 160); if (typeof value.pairing_code !== 'string' || !/^[A-Fa-f0-9]{16}$/.test(value.pairing_code)) fail(); }
  if (value.connection_id !== undefined) id(value.connection_id);
  return value;
}
