/* Imported exams never add XP, attendance, coins or shop bonuses. */
var scanSobState = null;
var scanSobBusy = false;
var scanSobExamCursor = null;
var scanSobExamRows = [];
var scanSobLoadVersion = 0;
var scanSobStudentCursor = null;
var scanSobStudentRows = [];
var scanSobStudentLoading = false;
var scanSobStudentVersion = 0;

async function scanSobRpc(name, args) {
  try { return await runQuery(getSupabase().rpc(name, args || {})); }
  catch (error) {
    if (error.code === 'PGRST202' || /Could not find the function/.test(error.message || '')) throw new Error(CU.role === 'TEACHER' ? 'ยังไม่ได้ติดตั้งระบบคะแนนสอบ กรุณารัน 20261015_02_scansob_receiver.sql' : 'คะแนนสอบยังไม่พร้อมใช้งาน กรุณาติดต่อครู');
    throw error;
  }
}
function scanSobAdmin(action, args) { return scanSobRpc('mq_scansob_admin', Object.assign(teacherTokenArgs(), { p_action: action, p_args: args || {} })); }
function scanSobIdentity() { return CU.id + ':' + ((googleAccount && googleAccount.linkVersion) || '') + ':' + schoolSemester.version; }
function scanSobDate(value) { return value ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : 'ยังไม่มีข้อมูล'; }
function scanSobEmpty(text) { return '<div class="scansob-empty">' + escHtml(text) + '</div>'; }
function scanSobStatus(id, text, error) { var el = document.getElementById(id); if (el) { el.textContent = text; el.classList.toggle('scansob-error', !!error); } }
function scanSobSetBusy(busy) {
  scanSobBusy = busy;
  document.querySelectorAll('#scansobSave,#scansobCreate,#scansobIngestToggle,#scansobViewToggle,.scansob-row-actions button').forEach(function(el) { el.disabled = busy || !scanSobState; });
}
async function loadScanSobSettings() {
  if (CU.role !== 'TEACHER' || scanSobBusy) return;
  scanSobSetBusy(true);
  try {
    scanSobState = await scanSobAdmin('status');
    document.getElementById('scansobIngestToggle').checked = scanSobState.enabled;
    document.getElementById('scansobViewToggle').checked = scanSobState.student_view_enabled;
    scanSobStatus('scansobSettingsStatus', (scanSobState.enabled ? 'เปิดรับคะแนน' : 'ปิดรับคะแนน') + ' · ' + (scanSobState.student_view_enabled ? 'นักเรียนดูคะแนนได้' : 'ยังไม่เปิดให้นักเรียนดู') + ' · คะแนนสอบ ' + scanSobState.score_count + ' รายการ');
    var pending = scanSobState.requests.filter(function(row) { return row.status === 'pending_approval'; });
    document.getElementById('scansobRequests').innerHTML = pending.length ? pending.map(function(row) {
      return '<div class="scansob-connection"><div class="scansob-connection-copy"><strong>' + escHtml(row.workspace_label) + '</strong><small>Workspace ' + escHtml(row.workspace_id)
        + '</small><small>หมดอายุ ' + escHtml(scanSobDate(row.expires_at)) + '</small></div><div class="scansob-row-actions"><button type="button" class="btn btn-primary-action" onclick="decideScanSobRequest(\'' + row.id + '\',true)">อนุมัติ</button><button type="button" class="btn btn-outline-secondary" onclick="decideScanSobRequest(\'' + row.id + '\',false)">ปฏิเสธ</button></div></div>';
    }).join('') : scanSobEmpty('ไม่มีคำขอรออนุมัติ');
    document.getElementById('scansobConnections').innerHTML = scanSobState.connections.length ? scanSobState.connections.map(function(row) {
      return '<div class="scansob-connection"><div class="scansob-connection-copy"><strong>' + escHtml(row.workspace_label) + '</strong><small>Workspace ' + escHtml(row.workspace_id)
        + '</small><small>' + (row.status === 'active' ? 'เชื่อมต่ออยู่ · รับข้อมูลล่าสุด ' + escHtml(scanSobDate(row.last_received_at)) : 'เพิกถอนแล้ว')
        + '</small></div>' + (row.status === 'active' ? '<div class="scansob-row-actions"><button type="button" class="btn btn-outline-danger" onclick="revokeScanSobConnection(\'' + row.id + '\')">เพิกถอน</button></div>' : '') + '</div>';
    }).join('') : scanSobEmpty('ยังไม่มี Workspace ที่เชื่อมต่อ');
  } catch (error) { scanSobState = null; scanSobStatus('scansobSettingsStatus', error.message, true); }
  finally { scanSobSetBusy(false); }
}
async function saveScanSobSettings() {
  if (scanSobBusy || !scanSobState) return;
  var enabled = document.getElementById('scansobIngestToggle').checked;
  var view = document.getElementById('scansobViewToggle').checked;
  if (view && !scanSobState.identity_policy_accepted) {
    var answer = await Swal.fire({ icon: 'warning', title: 'เปิดให้นักเรียนดูคะแนนสอบ?', text: 'นักเรียนผูกรหัสด้วยตนเอง หากผูกรหัสผิดอาจเห็นคะแนนของรหัสนั้น ครูต้องยอมรับนโยบายนี้ก่อนเปิดใช้', showCancelButton: true, confirmButtonText: 'ยอมรับและเปิดดูคะแนน', cancelButtonText: 'ยกเลิก' });
    if (!answer.isConfirmed) return;
  }
  scanSobSetBusy(true);
  try { await scanSobAdmin('configure', { enabled: enabled, student_view_enabled: view, accept_self_claim_risk: view }); }
  catch (error) { onErr(error); }
  finally { scanSobSetBusy(false); await loadScanSobSettings(); }
}
async function createScanSobCode() {
  if (scanSobBusy) return;
  scanSobSetBusy(true);
  try {
    var result = await scanSobAdmin('create_code');
    await Swal.fire({ title: 'รหัสจับคู่ ScanSob', html: '<code class="scansob-code">' + escHtml(result.code) + '</code><p>ใช้ได้ครั้งเดียว หมดอายุ ' + escHtml(scanSobDate(result.expires_at)) + '</p>', confirmButtonText: 'ปิด' });
  } catch (error) { onErr(error); }
  finally { scanSobSetBusy(false); }
}
async function decideScanSobRequest(id, approve) {
  if (scanSobBusy) return;
  var request = scanSobState.requests.find(function(row) { return row.id === id; });
  if (!request) return;
  var answer = await Swal.fire({ icon: 'question', title: approve ? 'อนุมัติ Workspace นี้?' : 'ปฏิเสธคำขอนี้?', text: request.workspace_label + ' · ' + request.workspace_id, showCancelButton: true, confirmButtonText: approve ? 'อนุมัติ' : 'ปฏิเสธ', cancelButtonText: 'ยกเลิก' });
  if (!answer.isConfirmed) return;
  scanSobSetBusy(true);
  try { await scanSobAdmin(approve ? 'approve' : 'reject', { request_id: id }); } catch (error) { onErr(error); }
  finally { scanSobSetBusy(false); await loadScanSobSettings(); }
}
async function revokeScanSobConnection(id) {
  if (scanSobBusy) return;
  var answer = await Swal.fire({ icon: 'warning', title: 'เพิกถอนการเชื่อมต่อ?', text: 'ควรถอนการเผยแพร่จาก ScanSob ให้สำเร็จก่อน หากเพิกถอนทันที Workspace จะส่งคะแนนไม่ได้ นักเรียนจะไม่เห็นคะแนน และอาจต้องให้ผู้ดูแล ScanSob กู้สถานะก่อนเชื่อมใหม่', showCancelButton: true, confirmButtonText: 'เพิกถอน', cancelButtonText: 'ยกเลิก', confirmButtonColor: UI_COLOR_DANGER });
  if (!answer.isConfirmed) return;
  scanSobSetBusy(true);
  try { await scanSobAdmin('revoke', { connection_id: id }); } catch (error) { onErr(error); }
  finally { scanSobSetBusy(false); await loadScanSobSettings(); }
}
async function loadTeacherExams() {
  if (CU.role !== 'TEACHER') return;
  var select = document.getElementById('externalExamSelect'); var previous = select.value;
  scanSobStatus('externalExamStatus', 'กำลังโหลดข้อสอบ...'); select.disabled = true;
  try {
    var rows = [], after = 0;
    do {
      var page = await scanSobRpc('mq_scansob_read', { p_kind: 'exams', p_after: after, p_limit: 100 });
      rows = rows.concat(page.rows); after = page.next_cursor;
      if (rows.length >= 10000 && after) throw new Error('มีข้อสอบเกินขอบเขต กรุณาติดต่อผู้ดูแล');
    } while (after);
    select.innerHTML = '<option value="">ทุกข้อสอบ</option>' + rows.map(function(row) {
      return '<option value="' + row.id + '">' + escHtml(row.metadata.subject + ' · ' + row.metadata.title + ' · ' + row.metadata.term + '/' + row.metadata.academic_year + (row.source_workspace_id ? ' · Workspace ' + row.source_workspace_id : '')
        + (row.withdrawn ? ' (ถอนคะแนน)' : row.received_batches < row.batch_count ? ' (รับ ' + row.received_batches + '/' + row.batch_count + ' ชุด)' : '')) + '</option>';
    }).join('');
    if (rows.some(function(row) { return String(row.id) === previous; })) select.value = previous;
    await loadTeacherExamRows(false);
  } catch (error) { scanSobStatus('externalExamStatus', error.message, true); document.getElementById('externalExamRows').innerHTML = ''; }
  finally { select.disabled = false; }
}
function teacherExamMode() { return document.querySelector('[name="externalExamMode"]:checked').value; }
async function loadTeacherExamRows(more) {
  if (CU.role !== 'TEACHER') return;
  var sequence = ++scanSobLoadVersion; var identity = scanSobIdentity();
  if (!more) { scanSobExamCursor = null; scanSobExamRows = []; document.getElementById('externalExamRows').innerHTML = ''; }
  var button = document.getElementById('externalExamMore'); button.disabled = true;
  scanSobStatus('externalExamStatus', 'กำลังโหลด...');
  try {
    var mode = teacherExamMode(); var exam = document.getElementById('externalExamSelect').value;
    var result = await scanSobRpc('mq_scansob_read', { p_kind: mode, p_exam_id: exam ? Number(exam) : null, p_after: more ? scanSobExamCursor : 0, p_limit: 50 });
    if (sequence !== scanSobLoadVersion || identity !== scanSobIdentity()) return;
    scanSobExamCursor = result.next_cursor; scanSobExamRows = scanSobExamRows.concat(result.rows);
    scanSobStatus('externalExamStatus', 'แสดง ' + scanSobExamRows.length + ' รายการ' + (scanSobExamCursor ? ' · ยังมีรายการเพิ่มเติม' : ''));
    button.hidden = !scanSobExamCursor;
    document.getElementById('externalExamRows').innerHTML = renderTeacherExamRows(scanSobExamRows, mode);
  } catch (error) { if (sequence === scanSobLoadVersion) { scanSobStatus('externalExamStatus', error.message, true); button.hidden = true; } }
  finally { button.disabled = false; }
}
function renderTeacherExamRows(rows, mode) {
  if (!rows.length) return scanSobEmpty(mode === 'issues' ? 'ไม่มีรหัสที่ต้องตรวจสอบ' : 'ยังไม่มีคะแนนสอบ');
  var heads = mode === 'issues' ? ['รหัสนักเรียน','ข้อสอบ','สาเหตุ','Revision'] : ['รหัส / ชื่อ–นามสกุล','วิชา / ข้อสอบ','ภาคเรียน','คะแนน','ร้อยละ','ผล'];
  var reasons = { STUDENT_NOT_FOUND: 'ไม่พบรหัสในทะเบียน', STUDENT_NOT_ELIGIBLE: 'รหัสไม่อยู่ในขอบเขตโรงเรียน', INVALID_SCORE: 'คะแนนไม่ถูกต้อง', IDENTITY_MAPPING_REQUIRED: 'ต้องตรวจสอบการจับคู่รหัส' };
  return '<div class="scansob-table-wrap" tabindex="0" role="region" aria-label="ตารางคะแนนสอบ"><table class="scansob-table"><thead><tr>' + heads.map(function(h) { return '<th scope="col">' + h + '</th>'; }).join('') + '</tr></thead><tbody>'
    + rows.map(function(row) { var cells = mode === 'issues' ? [escHtml(row.student_code),escHtml(row.metadata.title),escHtml(reasons[row.reason] || row.reason),row.revision]
      : [escHtml(row.student_code) + '<small>' + escHtml(row.student_name || '') + ' · ' + escHtml(row.grade || '') + '</small>',escHtml(row.metadata.subject) + '<small>' + escHtml(row.metadata.title) + '</small>' + (row.source_workspace_id ? '<small>Workspace ' + escHtml(row.source_workspace_id) + '</small>' : ''),escHtml(row.metadata.term + '/' + row.metadata.academic_year),escHtml(row.result.score + ' / ' + row.result.max_score),escHtml(row.result.percent + '%'),row.result.passed ? 'ผ่าน' : 'ไม่ผ่าน'];
      return '<tr>' + cells.map(function(value, index) { return '<td' + (mode !== 'issues' && [3,4].includes(index) ? ' class="score-number"' : '') + '>' + value + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
}
async function openStudentExamScores() {
  if (!isGoogleLoginActive() || CU.role !== 'STUDENT') return;
  scanSobStudentRows = []; scanSobStudentCursor = null;
  scanSobStudentVersion++; scanSobStudentLoading = false;
  await Swal.fire({ title: 'คะแนนสอบของฉัน', html: '<p id="studentExamStatus" role="status" aria-live="polite">กำลังโหลดคะแนน...</p><div id="studentExamScores" class="scansob-mobile-scores"></div><button id="studentExamMore" class="btn btn-outline-secondary" type="button" onclick="loadStudentExamScores(true)" hidden>โหลดเพิ่ม</button>', width: 720, confirmButtonText: 'ปิด', didOpen: function() { loadStudentExamScores(false); } });
}
async function loadStudentExamScores(more) {
  if (scanSobStudentLoading) return;
  scanSobStudentLoading = true; var identity = scanSobIdentity(); var version = scanSobStudentVersion;
  var button = document.getElementById('studentExamMore'); if (button) button.disabled = true;
  try {
    var result = await scanSobRpc('mq_scansob_read', { p_kind: 'scores', p_after: more ? scanSobStudentCursor : 0, p_limit: 30 });
    if (version !== scanSobStudentVersion || identity !== scanSobIdentity() || !document.getElementById('studentExamScores')) return;
    scanSobStudentRows = scanSobStudentRows.concat(result.rows); scanSobStudentCursor = result.next_cursor;
    scanSobStatus('studentExamStatus', result.enabled ? (scanSobStudentRows.length ? 'แสดง ' + scanSobStudentRows.length + ' รายการ' : 'ยังไม่มีคะแนนที่เผยแพร่ถึงคุณ') : 'ครูยังไม่เปิดให้ดูคะแนนสอบ');
    document.getElementById('studentExamScores').innerHTML = scanSobStudentRows.map(function(row) {
      return '<article class="scansob-student-result"><h3>' + escHtml(row.metadata.title) + '</h3><p>' + escHtml(row.metadata.subject + ' · ' + row.metadata.exam_type + ' · ภาคเรียน ' + row.metadata.term + '/' + row.metadata.academic_year)
        + '</p><div class="scansob-student-score"><strong>' + escHtml(row.result.score + ' / ' + row.result.max_score) + '</strong><span>' + escHtml(row.result.percent + '% · ' + (row.result.passed ? 'ผ่าน' : 'ไม่ผ่าน')) + '</span></div><p>อัปเดต ' + escHtml(scanSobDate(row.updated_at)) + '</p></article>';
    }).join('');
    button.hidden = !scanSobStudentCursor;
  } catch (error) { if (identity === scanSobIdentity()) scanSobStatus('studentExamStatus', error.message, true); }
  finally { if (version === scanSobStudentVersion) { scanSobStudentLoading = false; if (button) button.disabled = false; } }
}
async function exportExternalScores() {
  if (CU.role !== 'TEACHER' || schoolResetBusy || reportExportBusy) return;
  var button = document.getElementById('externalScoreExport'); if (button.disabled) return; button.disabled = true;
  reportExportBusy = true;
  var identity = scanSobIdentity(); var exam = document.getElementById('externalExamSelect').value;
  try {
    var rows = [], after = 0, version = null;
    do {
      var page = await scanSobRpc('mq_scansob_read', { p_kind: 'scores', p_exam_id: exam ? Number(exam) : null, p_after: after, p_limit: 100 });
      if (!page.version || (version !== null && version !== page.version)) throw new Error('คะแนนเปลี่ยนระหว่างส่งออก กรุณาลองใหม่');
      version = page.version;
      if (identity !== scanSobIdentity()) throw new Error('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนส่งออก');
      rows = rows.concat(page.rows); after = page.next_cursor;
      if (rows.length >= 10000 && after) throw new Error('ข้อมูลเกิน 10,000 รายการ กรุณาเลือกข้อสอบก่อนส่งออก');
    } while (after);
    var latest = await scanSobRpc('mq_scansob_read', { p_kind: 'scores', p_exam_id: exam ? Number(exam) : null, p_after: 0, p_limit: 1 });
    if (latest.version !== version || identity !== scanSobIdentity()) throw new Error('ข้อมูลเปลี่ยนแล้ว กรุณาลองส่งออกใหม่');
    var data = [['รหัสนักเรียน','ชื่อ–นามสกุล','ห้อง','วิชา','ข้อสอบ','ภาคเรียน','ปีการศึกษา','คะแนน','คะแนนเต็ม','ร้อยละ','ผล','Workspace']].concat(rows.map(function(r) { return [r.student_code,r.student_name,r.grade,r.metadata.subject,r.metadata.title,r.metadata.term,r.metadata.academic_year,r.result.score,r.result.max_score,r.result.percent,r.result.passed ? 'ผ่าน' : 'ไม่ผ่าน',r.source_workspace_id || '']; }));
    var url = URL.createObjectURL(new Blob(['\uFEFF' + data.map(function(row) { return row.map(reportCsvCell).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    var link = document.createElement('a'); link.href = url; link.download = 'ScanSob_scores_' + dateKeyBangkok(new Date()) + '.csv'; link.click(); setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  } catch (error) { onErr(error); }
  finally { button.disabled = false; reportExportBusy = false; }
}
