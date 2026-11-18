/* Imported exams never add XP, attendance, coins or shop bonuses. */
var scanSobState = null;
var scanSobBusy = false;
var scanSobExamCursor = null;
var scanSobExamRows = [];
var scanSobLoadVersion = 0;
var scanSobReceiptVersion = 0;
var scanSobStudentPage = null;

async function scanSobRpc(name, args) {
  try {
    var result = await runQuery(getSupabase().rpc(name, args || {}));
    if ((name === 'mq_scansob_read' || (name === 'mq_scansob_admin' && (args || {}).p_action !== 'create_code')) && (!result || result.receiver_profile !== '1.1')) {
      throw new Error(CU.role === 'TEACHER' ? 'กรุณาติดตั้ง 20261015_03_scansob_recovery_hardening.sql ก่อนใช้คะแนนสอบ' : 'คะแนนสอบยังไม่พร้อมใช้งาน กรุณาติดต่อครู');
    }
    return result;
  }
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
  document.querySelectorAll('#scansobSave,#scansobCreate,#scansobIngestToggle,#scansobViewToggle,.scansob-row-actions button').forEach(function(el) {
    el.disabled = busy || (!scanSobState && !el.dataset.requestId);
  });
}
async function loadScanSobSettings() {
  if (CU.role !== 'TEACHER' || scanSobBusy) return;
  scanSobSetBusy(true);
  try {
    scanSobState = await scanSobAdmin('status');
    document.getElementById('scansobIngestToggle').checked = scanSobState.enabled;
    document.getElementById('scansobViewToggle').checked = scanSobState.student_view_enabled;
    scanSobStatus('scansobSettingsStatus', (scanSobState.enabled ? 'เปิดรับคะแนน' : 'ปิดรับคะแนน') + ' · ' + (scanSobState.student_view_enabled ? 'นักเรียนดูคะแนนได้' : 'ยังไม่เปิดให้นักเรียนดู') + ' · คะแนนสอบ ' + scanSobState.score_count + ' รายการ' + (scanSobState.held_score_count ? ' · ซ่อนจากรอบเผยแพร่ ' + scanSobState.held_score_count + ' รายการ' : ''));
    var pending = scanSobState.requests.filter(function(row) { return row.status === 'pending_approval'; });
    if (!(scanSobInbox && scanSobInbox.data)) document.getElementById('scansobRequests').innerHTML = pending.length ? pending.map(function(row) {
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
  if (scanSobBusy || !scanSobPolicy || scanSobPolicy.policy === 'review_each_request') return;
  scanSobSetBusy(true);
  try {
    var result = await scanSobAdmin('create_code');
    await Swal.fire({ title: 'รหัสจับคู่ ScanSob', html: '<code class="scansob-code">' + escHtml(result.code) + '</code><p>ใช้ได้ครั้งเดียว หมดอายุ ' + escHtml(scanSobDate(result.expires_at)) + '</p>', confirmButtonText: 'ปิด' });
  } catch (error) {
    if ((error.message || '').includes('LEGACY_PAIRING_DISABLED')) await loadScanSobPolicy(true);
    else onErr(error);
  }
  finally { scanSobSetBusy(false); }
}
async function decideScanSobRequest(id, approve) {
  if (scanSobBusy) return;
  var inboxRows = scanSobInbox && scanSobInbox.data && scanSobInbox.data.requests;
  var request = (inboxRows || (scanSobState && scanSobState.requests) || []).find(function(row) { return row.id === id; });
  if (!request) return;
  var contextToken = teacherAdminToken;
  var sender = request.sender_email ? '<p>' + escHtml(request.sender_name || request.sender_email) +
    (request.sender_name ? '<br>' + escHtml(request.sender_email) : '') + '</p>' : '';
  var school = scanSobRequestDestination();
  var consent = approve ? '<p>สิทธิ์: ส่งคะแนนจาก Workspace นี้ไปยัง ' + escHtml(school) + ' เท่านั้น</p>' : '';
  var history = approve && request.held_score_count ? '<p>มีคะแนนค้าง ' + escHtml(request.held_score_count) + ' รายการ คะแนนจากการเชื่อมต่อเดิมจะยังถูกซ่อนไว้</p>' : '';
  var answer = await Swal.fire({ icon: 'question', title: approve ? 'อนุมัติการเชื่อมต่อ?' : 'ปฏิเสธคำขอนี้?',
    html: '<div class="scansob-decision">' + sender + '<p><strong>' + escHtml(request.workspace_label) +
      '</strong><br>Workspace ' + escHtml(request.workspace_id) + '</p>' + consent + history + '</div>',
    showCancelButton: true, confirmButtonText: approve ? 'อนุมัติ' : 'ปฏิเสธ', cancelButtonText: 'ยกเลิก' });
  if (!answer.isConfirmed || scanSobBusy || CU.role !== 'TEACHER' || teacherAdminToken !== contextToken) return;
  scanSobSetBusy(true);
  try { await scanSobAdmin(approve ? 'approve' : 'reject', { request_id: id }); } catch (error) { onErr(error); }
  finally {
    scanSobSetBusy(false);
    await refreshScanSobInbox();
    await loadScanSobSettings();
  }
}
async function revokeScanSobConnection(id) {
  if (scanSobBusy) return;
  var answer = await Swal.fire({ icon: 'warning', title: 'เพิกถอนการเชื่อมต่อ?', text: 'Workspace นี้จะส่งคะแนนไม่ได้ และคะแนนจากรอบนี้จะถูกซ่อนจากนักเรียน การจับคู่ใหม่จะไม่เปิดคะแนนเก่าคืน ต้องกู้คืนและถอนคะแนนเดิมใน ScanSob ก่อนเผยแพร่ใหม่', showCancelButton: true, confirmButtonText: 'เพิกถอน', cancelButtonText: 'ยกเลิก', confirmButtonColor: UI_COLOR_DANGER });
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
        + (row.withdrawn ? ' (ถอนคะแนน)' : row.received_batches < row.batch_count ? ' (รับ ' + row.received_batches + '/' + row.batch_count + ' ชุด)' : row.student_count > row.visible_student_count ? ' (มีคะแนนซ่อนไว้)' : '')) + '</option>';
    }).join('');
    if (rows.some(function(row) { return String(row.id) === previous; })) select.value = previous;
    await loadTeacherExamRows(false);
  } catch (error) { scanSobStatus('externalExamStatus', error.message, true); document.getElementById('externalExamRows').innerHTML = ''; loadScanSobReceipt(''); }
  finally { select.disabled = false; }
}
function teacherExamMode() { return document.querySelector('[name="externalExamMode"]:checked').value; }
async function loadScanSobReceipt(exam) {
  var version = ++scanSobReceiptVersion;
  var identity = scanSobIdentity();
  var region = document.getElementById('scansobReceipt');
  var details = document.getElementById('scansobReceiptData');
  details.hidden = true;
  region.hidden = !exam;
  if (!exam) return;
  scanSobStatus('scansobReceiptStatus', 'กำลังโหลดใบตอบรับ...', false);
  var current = function() {
    return version === scanSobReceiptVersion && identity === scanSobIdentity() && CU.role === 'TEACHER';
  };
  try {
    var receipt = await runQuery(getSupabase().rpc('mq_scansob_publication_receipt',
      Object.assign(teacherTokenArgs(), {p_exam_id: exam})));
    if (!current()) return;
    if (!receipt || String(receipt.exam_id) !== exam || !receipt.revision) {
      scanSobStatus('scansobReceiptStatus', 'ไม่พบรอบเผยแพร่ของข้อสอบนี้', false);
      return;
    }
    var heading = 'รอบ ' + receipt.revision;
    if (!receipt.verified_batches) {
      scanSobStatus('scansobReceiptStatus', heading + ' · ยังไม่มีใบตอบรับที่ตรวจสอบได้', false);
      return;
    }
    scanSobStatus('scansobReceiptStatus', heading + ' · ' + (receipt.withdrawn ? 'ถอนคะแนนแล้ว' :
      'รับ ' + receipt.verified_batches + ' / ' + receipt.expected_batches + ' ชุด'), false);
    document.getElementById('scansobReceiptAccepted').textContent = receipt.accepted;
    document.getElementById('scansobReceiptUnmatched').textContent = receipt.unmatched;
    document.getElementById('scansobReceiptInvalid').textContent = receipt.invalid;
    document.getElementById('scansobReceiptExam').textContent = receipt.source_exam_id;
    document.getElementById('scansobReceiptWorkspace').textContent = receipt.source_workspace_id;
    details.hidden = false;
  } catch (error) {
    if (!current()) return;
    if (error && (error.code === 'PGRST202' || /Could not find the function/.test(error.message || ''))) region.hidden = true;
    else scanSobStatus('scansobReceiptStatus', 'โหลดใบตอบรับไม่สำเร็จ กรุณารีเฟรชคะแนนสอบ', true);
  }
}
async function loadTeacherExamRows(more) {
  if (CU.role !== 'TEACHER') return;
  var sequence = ++scanSobLoadVersion; var identity = scanSobIdentity();
  if (!more) {
    scanSobExamCursor = null;
    scanSobExamRows = [];
    document.getElementById('externalExamRows').innerHTML = '';
    loadScanSobReceipt(document.getElementById('externalExamSelect').value);
  }
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
  var heads = mode === 'issues' ? ['รหัสนักเรียน','ข้อสอบ','สาเหตุ','Revision'] : ['รหัส / ชื่อ–นามสกุล','วิชา / ข้อสอบ','ภาคเรียน','คะแนน','ร้อยละ','ผล','การเผยแพร่'];
  var reasons = { STUDENT_NOT_FOUND: 'ไม่พบรหัสในทะเบียน', STUDENT_NOT_ELIGIBLE: 'รหัสไม่อยู่ในขอบเขตโรงเรียน', INVALID_SCORE: 'คะแนนไม่ถูกต้อง', IDENTITY_MAPPING_REQUIRED: 'ต้องตรวจสอบการจับคู่รหัส' };
  return '<div class="scansob-table-wrap" tabindex="0" role="region" aria-label="ตารางคะแนนสอบ"><table class="scansob-table"><thead><tr>' + heads.map(function(h) { return '<th scope="col">' + h + '</th>'; }).join('') + '</tr></thead><tbody>'
    + rows.map(function(row) { var cells = mode === 'issues' ? [escHtml(row.student_code),escHtml(row.metadata.title),escHtml(reasons[row.reason] || row.reason),row.revision]
      : [escHtml(row.student_code) + '<small>' + escHtml(row.student_name || '') + ' · ' + escHtml(row.grade || '') + '</small>',escHtml(row.metadata.subject) + '<small>' + escHtml(row.metadata.title) + '</small>' + (row.source_workspace_id ? '<small>Workspace ' + escHtml(row.source_workspace_id) + '</small>' : ''),escHtml(row.metadata.term + '/' + row.metadata.academic_year),escHtml(row.result.score + ' / ' + row.result.max_score),escHtml(row.result.percent + '%'),row.result.passed ? 'ผ่าน' : 'ไม่ผ่าน',
        '<span class="scansob-visibility' + (row.student_visible ? '' : ' is-held') + '"><i class="fa-solid ' + (row.student_visible ? 'fa-eye' : 'fa-eye-slash') + '" aria-hidden="true"></i>' + escHtml(scanSobVisibilityLabel(row)) + '</span>'];
      return '<tr>' + cells.map(function(value, index) { return '<td' + (mode !== 'issues' && [3,4].includes(index) ? ' class="score-number"' : '') + '>' + value + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
}
function scanSobVisibilityLabel(row) {
  if (row.student_visible) return 'พร้อมแสดง';
  return { connection_revoked: 'เพิกถอนแล้ว', previous_connection: 'รอเผยแพร่ใหม่', unverified_origin: 'รอตรวจประวัติ', incomplete: 'รอรับข้อมูลครบ', withdrawn: 'ถอนคะแนนแล้ว' }[row.visibility_reason] || 'ซ่อนไว้';
}
function resetStudentExamView() {
  var view = document.getElementById('studentExamView');
  var wasOpen = !view.hidden;
  scanSobStudentPage = null;
  view.hidden = true;
  document.getElementById('studentHomeView').hidden = false;
  document.getElementById('studentExamButton').removeAttribute('aria-current');
  document.querySelector('.student-home-link').setAttribute('aria-current', 'page');
  if (wasOpen) {
    setStudentExamSubjects([], '');
    clearStudentExamResults();
    scanSobStatus('studentExamStatus', '');
  }
  return wasOpen;
}
function setStudentExamSubjects(subjects, selected) {
  var select = document.getElementById('studentExamSubject');
  select.options.length = 1;
  subjects.forEach(function(name) { select.add(new Option(name, name)); });
  if (selected && !subjects.includes(selected)) select.add(new Option(selected, selected));
  select.value = selected;
  document.getElementById('studentExamFilters').hidden = !subjects.length && !selected;
}
function clearStudentExamResults() {
  var list = document.getElementById('studentExamScores');
  list.replaceChildren();
  list.setAttribute('aria-busy', 'false');
  document.getElementById('studentExamTerm').hidden = true;
  var button = document.getElementById('studentExamMore');
  button.hidden = true;
  button.removeAttribute('aria-disabled');
  scanSobStatus('studentExamPageStatus', '');
}
function openStudentExamScores() {
  if (!isGoogleLoginActive() || CU.role !== 'STUDENT') return;
  var view = document.getElementById('studentExamView');
  window.scrollTo(0, 0);
  if (!view.hidden) {
    document.getElementById('studentExamTitle').focus({preventScroll:true});
    return;
  }
  view.hidden = false;
  document.getElementById('studentHomeView').hidden = true;
  document.querySelector('.student-home-link').removeAttribute('aria-current');
  document.getElementById('studentExamButton').setAttribute('aria-current', 'page');
  document.getElementById('studentExamTitle').focus({preventScroll:true});
  if (typeof updateStudentInstallVisibility === 'function') updateStudentInstallVisibility();
  filterStudentExamScores('');
}
function filterStudentExamScores(subject) {
  if (document.getElementById('studentExamView').hidden || !isGoogleLoginActive() || CU.role !== 'STUDENT') return;
  scanSobStudentPage = {identity:scanSobIdentity(),subject:subject,cursor:null,total:0,count:0,singleTerm:null,busy:false};
  clearStudentExamResults();
  return continueStudentExamScores();
}
function studentExamRow(row, singleTerm) {
  var exam = row.metadata, result = row.result;
  var term = 'ภาคเรียน ' + exam.term + '/' + exam.academic_year;
  var meta = exam.exam_type + (singleTerm ? '' : ' · ' + term) + ' · อัปเดต ' + scanSobDate(row.updated_at);
  return '<article class="scansob-student-result" tabindex="-1"><p class="student-exam-subject">' + escHtml(exam.subject)
    + '</p><h2>' + escHtml(exam.title) + '</h2><div class="scansob-student-score"><strong>'
    + escHtml(result.score + ' / ' + result.max_score)
    + '</strong><span class="student-exam-outcome" data-passed="' + (result.passed ? 'true' : 'false') + '">'
    + escHtml(result.percent + '% · ' + (result.passed ? 'ผ่าน' : 'ไม่ผ่าน'))
    + '</span></div><p class="student-exam-meta">' + escHtml(meta) + '</p></article>';
}
async function continueStudentExamScores() {
  var page = scanSobStudentPage;
  if (!page || page.busy || page.identity !== scanSobIdentity()) return;
  var cursor = page.cursor, more = !!cursor;
  var list = document.getElementById('studentExamScores');
  var button = document.getElementById('studentExamMore');
  var select = document.getElementById('studentExamSubject');
  var title = document.getElementById('studentExamTitle');
  function current() {
    return page === scanSobStudentPage && CU.role === 'STUDENT' && page.identity === scanSobIdentity();
  }
  page.busy = true;
  button.setAttribute('aria-disabled', 'true');
  list.setAttribute('aria-busy', 'true');
  scanSobStatus(more ? 'studentExamPageStatus' : 'studentExamStatus', more ? 'กำลังโหลดคะแนนเพิ่มเติม…' : 'กำลังโหลดคะแนน…');
  try {
    var result = await runQuery(getSupabase().rpc('mq_scansob_student_scores', {
      p_subject:page.subject || null, p_before_at:more ? cursor.updated_at : null,
      p_before_id:more ? cursor.id : null, p_limit:30
    }));
    if (!current()) return;
    if (!result || typeof result.enabled !== 'boolean' || !Array.isArray(result.rows)) throw new Error('INVALID_SCORE_PAGE');
    if (!result.enabled) {
      page.cursor = null;
      page.count = 0;
      if (document.activeElement === button || document.activeElement === select) title.focus();
      setStudentExamSubjects([], '');
      clearStudentExamResults();
      scanSobStatus('studentExamStatus', 'ครูยังไม่เปิดให้ดูคะแนนสอบ');
      return;
    }
    if (!more) {
      setStudentExamSubjects(result.subjects, page.subject);
      page.total = result.total;
      page.singleTerm = result.single_term;
      var term = document.getElementById('studentExamTerm');
      if (page.singleTerm) term.textContent = 'ภาคเรียน ' + page.singleTerm.term + '/' + page.singleTerm.academic_year;
      term.hidden = !page.singleTerm;
    }
    page.cursor = result.next_cursor;
    var start = list.children.length;
    list.insertAdjacentHTML('beforeend', result.rows.map(function(row){ return studentExamRow(row, page.singleTerm); }).join(''));
    page.count += result.rows.length;
    var focusWasOnButton = document.activeElement === button;
    if (focusWasOnButton && (list.children[start] || !page.cursor)) (list.children[start] || title).focus();
    button.hidden = !page.cursor;
    button.textContent = 'โหลดเพิ่ม';
    scanSobStatus('studentExamPageStatus', '');
    scanSobStatus('studentExamStatus', page.count ? 'แสดง ' + page.count
      + (page.cursor && page.total > page.count ? ' จาก ' + page.total : '') + ' รายการ'
      : (page.subject ? 'ยังไม่มีผลสอบในวิชานี้' : 'ยังไม่มีคะแนนที่เผยแพร่ถึงคุณ'));
  } catch (error) {
    if (!current()) return;
    scanSobStatus(more ? 'studentExamPageStatus' : 'studentExamStatus',
      error.code === 'PGRST202' || error.code === '42883' ? 'คะแนนสอบยังไม่พร้อมใช้งาน กรุณาติดต่อครู'
        : (more ? 'โหลดคะแนนเพิ่มเติมไม่สำเร็จ' : 'โหลดคะแนนไม่สำเร็จ'), true);
    button.textContent = 'ลองอีกครั้ง';
    button.hidden = false;
  } finally {
    if (current()) {
      page.busy = false;
      button.removeAttribute('aria-disabled');
      list.setAttribute('aria-busy', 'false');
    }
  }
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
    var data = [['รหัสนักเรียน','ชื่อ–นามสกุล','ห้อง','วิชา','ข้อสอบ','ภาคเรียน','ปีการศึกษา','คะแนน','คะแนนเต็ม','ร้อยละ','ผล','การเผยแพร่','Workspace']].concat(rows.map(function(r) { return [r.student_code,r.student_name,r.grade,r.metadata.subject,r.metadata.title,r.metadata.term,r.metadata.academic_year,r.result.score,r.result.max_score,r.result.percent,r.result.passed ? 'ผ่าน' : 'ไม่ผ่าน',scanSobVisibilityLabel(r),r.source_workspace_id || '']; }));
    var url = URL.createObjectURL(new Blob(['\uFEFF' + data.map(function(row) { return row.map(reportCsvCell).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    var link = document.createElement('a'); link.href = url; link.download = 'ScanSob_scores_' + dateKeyBangkok(new Date()) + '.csv'; link.click(); setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  } catch (error) { onErr(error); }
  finally { button.disabled = false; reportExportBusy = false; }
}
