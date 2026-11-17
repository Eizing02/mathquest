/* Live events invalidate the inbox; only the teacher RPC supplies its contents. */
var scanSobInbox = null;
var scanSobPolicy = null;
var scanSobPolicyBusy = false;
var scanSobToastTimer = null;

function scanSobInboxRpc(action, args) {
  var query = getSupabase().rpc('mq_scansob_pairing_inbox', Object.assign(teacherTokenArgs(),
    { p_action: action, p_args: args || {} }));
  return runQuery(typeof query.abortSignal === 'function' && typeof AbortSignal.timeout === 'function'
    ? query.abortSignal(AbortSignal.timeout(12000)) : query);
}

function activeScanSobInbox(run) {
  return !!run && run === scanSobInbox && CU.role === 'TEACHER' && isGoogleLoginActive() && run.token === teacherAdminToken;
}

function refreshScanSobSettings() {
  loadScanSobSettings();
  refreshScanSobInbox();
  loadScanSobPolicy();
}

function startScanSobInbox() {
  stopScanSobInbox();
  if (CU.role !== 'TEACHER' || !isGoogleLoginActive() || !teacherAdminToken) return;
  var run = { token: teacherAdminToken, page: 0, rendered: null, data: null, head: null, seen: new Set() };
  scanSobInbox = run;
  document.addEventListener('visibilitychange', refreshScanSobInboxOnReturn);
  window.addEventListener('online', refreshScanSobInboxOnReturn);
  run.poll = setInterval(refreshScanSobInboxOnReturn, 35000);
  refreshScanSobInbox();
}

function stopScanSobInbox() {
  var run = scanSobInbox;
  scanSobInbox = null;
  if (run) {
    clearInterval(run.poll);
    clearTimeout(run.debounce);
    if (run.channel) Promise.resolve(run.client.removeChannel(run.channel)).catch(function() {});
    if (run.data) document.getElementById('scansobRequests').replaceChildren();
  }
  document.removeEventListener('visibilitychange', refreshScanSobInboxOnReturn);
  window.removeEventListener('online', refreshScanSobInboxOnReturn);
  scanSobPolicy = null;
  scanSobPolicyBusy = false;
  document.getElementById('scansobPolicyEmails').value = '';
  document.getElementById('scansobPolicyEnabled').checked = false;
  document.getElementById('scansobSignedPolicy').hidden = true;
  document.getElementById('scansobInboxBell').hidden = true;
  document.getElementById('scansobInboxPagination').hidden = true;
  setScanSobInboxStatus('', false);
  dismissScanSobInboxToast(false);
}

function refreshScanSobInboxOnReturn() {
  if (!document.hidden) refreshScanSobInbox();
}

async function subscribeScanSobInbox(run, schoolId) {
  if (run.channel || run.subscribing || !/^[0-9a-f-]{36}$/.test(schoolId)) return;
  var client = getSupabase();
  if (typeof client.channel !== 'function') return;
  run.client = client;
  run.subscribing = true;
  try {
    if (client.realtime && typeof client.realtime.setAuth === 'function') await client.realtime.setAuth();
    if (!activeScanSobInbox(run)) return;
    run.channel = client.channel('mq:scansob:inbox:' + schoolId, { config: { private: true } })
      .on('broadcast', { event: 'requests_changed' }, function() { queueScanSobInbox(run); })
      .subscribe(function(status) { if (status === 'SUBSCRIBED') queueScanSobInbox(run); });
  } catch (_) {
    // The visible-tab polling path does not depend on Realtime.
  } finally { run.subscribing = false; }
}

function queueScanSobInbox(run) {
  if (!activeScanSobInbox(run) || document.hidden) return;
  clearTimeout(run.debounce);
  run.debounce = setTimeout(function() { if (activeScanSobInbox(run)) refreshScanSobInbox(); }, 160);
}

async function refreshScanSobInbox() {
  var run = scanSobInbox;
  if (!activeScanSobInbox(run) || document.hidden) return;
  if (run.loading) { run.again = true; return; }
  run.loading = true;
  try {
    var head = await scanSobInboxRpc('inbox', {page: 0});
    if (!activeScanSobInbox(run)) return;
    if (!head || !Array.isArray(head.requests) || !Number.isSafeInteger(head.count) || head.page_size !== 20) return;
    var prior = run.head;
    run.head = head;
    updateScanSobInboxBadge(head.count);
    subscribeScanSobInbox(run, head.school_id);
    if (prior && !document.hidden) {
      var added = head.requests.filter(function(row) {
        return !run.seen.has(row.id) && (head.count > prior.count || Date.parse(row.created_at) >= Date.parse(prior.server_now));
      });
      if (added.length) showScanSobInboxToast(added);
      if (!head.count) dismissScanSobInboxToast(false);
    }
    head.requests.forEach(function(row) { run.seen.add(row.id); });
    while (run.seen.size > 512) run.seen.delete(run.seen.values().next().value);
    var page = Math.min(run.page, Math.max(0, Math.ceil(head.count / head.page_size) - 1));
    run.page = page;
    var data = page ? await scanSobInboxRpc('inbox', {page: page}) : head;
    if (!activeScanSobInbox(run) || run.page !== page) return;
    run.data = data;
    renderScanSobInbox(run);
  } catch (error) {
    if (activeScanSobInbox(run) && run.data) setScanSobInboxStatus('โหลดคำขอล่าสุดไม่สำเร็จ กรุณารีเฟรช', true);
  } finally {
    run.loading = false;
    if (run.again && activeScanSobInbox(run)) { run.again = false; queueScanSobInbox(run); }
  }
}

function updateScanSobInboxBadge(count) {
  var bell = document.getElementById('scansobInboxBell');
  var badge = document.getElementById('scansobInboxBadge');
  bell.hidden = false;
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? '99+' : String(count);
  bell.setAttribute('aria-label', 'คำขอเชื่อมต่อ ScanSob' + (count ? ' รออนุมัติ ' + count + ' รายการ' : ' ไม่มีคำขอรออนุมัติ'));
}

function setScanSobInboxStatus(message, error) {
  var status = document.getElementById('scansobInboxStatus');
  if (!message && status.textContent === '') return;
  if (status.textContent !== message) status.textContent = message;
  status.classList.toggle('scansob-error', !!error);
  status.hidden = !message;
}

function scanSobRequestDestination() {
  var data = scanSobInbox && scanSobInbox.data;
  return resolveAppName((data && data.destination_label) || document.getElementById('tHdrSchool').textContent);
}

function renderScanSobInbox(run) {
  var data = run.data;
  var list = document.getElementById('scansobRequests');
  setScanSobInboxStatus(data.count ? 'รออนุมัติ ' + data.count + ' รายการ' : '');
  var destination = scanSobRequestDestination();
  var key = JSON.stringify([destination, data.requests]);
  if (key !== run.rendered) {
    var focus = list.contains(document.activeElement) ? document.activeElement : null;
    var focusId = focus && focus.dataset.requestId;
    var focusAction = focus && focus.dataset.requestAction;
    list.innerHTML = data.requests.length ? data.requests.map(function(row) {
      var id = escHtml(row.id);
      var sender = row.sender_email ? (row.sender_name ? escHtml(row.sender_name) + ' · ' : '') + escHtml(row.sender_email) : 'คำขอด้วยรหัสจับคู่';
      return '<div class="scansob-connection"><div class="scansob-connection-copy"><strong>' + escHtml(row.workspace_label) + '</strong><small>' + sender +
        '</small><small>Workspace ' + escHtml(row.workspace_id) + '</small><small>ปลายทาง: ' + escHtml(destination) +
        '</small><small>ส่ง ' + escHtml(scanSobDate(row.created_at)) + ' · หมดอายุ ' + escHtml(scanSobDate(row.expires_at)) +
        '</small></div><div class="scansob-row-actions"><button type="button" class="btn btn-primary-action" data-request-id="' + id + '" data-request-action="approve">อนุมัติ</button>' +
        '<button type="button" class="btn btn-outline-secondary" data-request-id="' + id + '" data-request-action="reject">ปฏิเสธ</button></div></div>';
    }).join('') : scanSobEmpty('ไม่มีคำขอรออนุมัติ');
    list.querySelectorAll('[data-request-id]').forEach(function(button) {
      button.disabled = scanSobBusy;
      button.onclick = function() {
        decideScanSobRequest(button.dataset.requestId, button.dataset.requestAction === 'approve');
      };
      if (focusId === button.dataset.requestId && focusAction === button.dataset.requestAction) button.focus();
    });
    if (focus && !list.contains(document.activeElement) && !document.getElementById('tab-settings').hidden) {
      document.getElementById('scansobInboxTitle').focus({preventScroll: true});
    }
    run.rendered = key;
  }
  var pages = Math.max(1, Math.ceil(data.count / data.page_size));
  document.getElementById('scansobInboxPagination').hidden = pages < 2;
  document.getElementById('scansobInboxPageText').textContent = 'หน้า ' + (data.page + 1) + ' / ' + pages;
  document.getElementById('scansobInboxPrev').disabled = data.page <= 0;
  document.getElementById('scansobInboxNext').disabled = data.page >= pages - 1;
}

function changeScanSobInboxPage(delta) {
  var run = scanSobInbox;
  if (!activeScanSobInbox(run) || !run.data || run.loading) return;
  run.page = Math.max(0, run.data.page + delta);
  refreshScanSobInbox();
}

function showScanSobInboxToast(rows) {
  var toast = document.getElementById('scansobInboxToast');
  var text = rows.length > 1 ? 'มี ' + rows.length + ' คำขอใหม่' : rows[0].sender_name || rows[0].workspace_label;
  document.getElementById('scansobInboxToastText').textContent = text;
  document.getElementById('scansobInboxAnnouncement').textContent = 'คำขอเชื่อมต่อ ScanSob ใหม่: ' + text;
  toast.hidden = false;
  clearTimeout(scanSobToastTimer);
  scanSobToastTimer = setTimeout(function() {
    if (!window.matchMedia('(max-width: 768px)').matches && !toast.contains(document.activeElement)) dismissScanSobInboxToast(false);
  }, 11000);
}

function dismissScanSobInboxToast(restoreFocus) {
  clearTimeout(scanSobToastTimer);
  var toast = document.getElementById('scansobInboxToast');
  var inside = toast.contains(document.activeElement);
  toast.hidden = true;
  document.getElementById('scansobInboxToastText').textContent = '';
  document.getElementById('scansobInboxAnnouncement').textContent = '';
  if (restoreFocus && inside) document.getElementById('scansobInboxBell').focus();
}

function openScanSobInbox() {
  if (!activeScanSobInbox(scanSobInbox)) return;
  dismissScanSobInboxToast(false);
  scanSobInbox.page = 0;
  switchTab('settings');
  var heading = document.getElementById('scansobInboxTitle');
  heading.focus({preventScroll: true});
  heading.scrollIntoView({block: 'start'});
}

function renderScanSobPolicy(data) {
  scanSobPolicy = data;
  var review = data.policy === 'review_each_request';
  document.getElementById('scansobSignedPolicy').hidden = false;
  document.getElementById('scansobPolicyState').textContent = data.enabled ? 'เปิดรับ' : 'ปิดรับ';
  document.getElementById('scansobPolicyMode').textContent = review ? 'อนุมัติรายคำขอ' : 'จำกัดตามรายชื่อเดิม';
  document.getElementById('scansobPolicyEnabled').checked = data.enabled;
  var legacy = document.getElementById('scansobLegacyPolicy');
  legacy.hidden = review;
  if (review) legacy.open = false;
  document.getElementById('scansobPolicyEmails').value = review ? '' : data.emails.join('\n');
  document.getElementById('scansobPolicyUseReview').hidden = data.policy !== 'email_allowlist';
  document.getElementById('scansobPolicyReload').hidden = true;
}

function scanSobPolicyStatus(message, error) {
  scanSobStatus('scansobPolicyStatus', message, error);
  document.getElementById('scansobPolicyStatus').hidden = !message;
}

function setScanSobPolicyBusy(busy) {
  scanSobPolicyBusy = busy;
  ['scansobPolicySave','scansobPolicyReload','scansobPolicyEnabled','scansobPolicyEmails','scansobPolicyUseReview'].forEach(function(id) {
    document.getElementById(id).disabled = busy;
  });
}

async function loadScanSobPolicy(force) {
  var run = scanSobInbox;
  if (!activeScanSobInbox(run) || scanSobPolicyBusy || (scanSobPolicy && !force)) return;
  setScanSobPolicyBusy(true);
  try {
    var data = await scanSobInboxRpc('policy');
    if (!activeScanSobInbox(run) || !data || !Array.isArray(data.emails)) return;
    renderScanSobPolicy(data);
    scanSobPolicyStatus('', false);
  } catch (error) {
    if (activeScanSobInbox(run) && scanSobPolicy) scanSobPolicyStatus('โหลดค่าล่าสุดไม่สำเร็จ กรุณาลองอีกครั้ง', true);
  } finally { if (activeScanSobInbox(run)) setScanSobPolicyBusy(false); }
}

async function saveScanSobPolicy(event) {
  event.preventDefault();
  var run = scanSobInbox;
  if (!activeScanSobInbox(run) || !scanSobPolicy || scanSobPolicyBusy) return;
  var enabled = document.getElementById('scansobPolicyEnabled').checked;
  var args = {enabled: enabled, revision: scanSobPolicy.revision};
  if (scanSobPolicy.policy === 'review_each_request') {
    await persistScanSobPolicy(run, args, 'บันทึกการรับคำขอแล้ว');
    return;
  }
  var emails = Array.from(new Set(document.getElementById('scansobPolicyEmails').value.split(/\r?\n/).map(function(email) {
    return email.trim().toLowerCase();
  }).filter(Boolean)));
  if ((enabled && !emails.length) || emails.length > 100 || emails.some(function(email) {
    return email.length > 254 || !/^[^@\s\p{Cc}]+@[^@\s\p{Cc}]+\.[^@\s\p{Cc}]+$/u.test(email);
  })) {
    scanSobPolicyStatus('ตรวจอีเมลครูอีกครั้ง ระบุได้ไม่เกิน 100 อีเมล และต้องมีอย่างน้อยหนึ่งอีเมลเมื่อเปิดรับ', true);
    return;
  }
  args.emails = emails;
  await persistScanSobPolicy(run, args, 'บันทึกการรับคำขอแล้ว');
}

async function switchScanSobPolicyToReview() {
  var run = scanSobInbox;
  var policy = scanSobPolicy;
  if (!activeScanSobInbox(run) || !policy || policy.policy !== 'email_allowlist' || scanSobPolicyBusy) return;
  var answer = await Swal.fire({
    icon: 'question',
    title: 'เปลี่ยนเป็นอนุมัติรายคำขอ?',
    text: 'ไม่ต้องลงรายชื่ออีเมลล่วงหน้า และจะสร้างหรือใช้รหัสเปิดคำขอใหม่ไม่ได้ ระบบจะพักรับคำขอใหม่ไว้ก่อน การเชื่อมต่อเดิมยังใช้งานได้',
    showCancelButton: true, confirmButtonText: 'เปลี่ยนวิธีรับคำขอ', cancelButtonText: 'ยกเลิก'
  });
  if (!answer.isConfirmed || !activeScanSobInbox(run) || policy !== scanSobPolicy || scanSobPolicyBusy) return;
  if (await persistScanSobPolicy(run, {enabled: false, policy: 'review_each_request', revision: policy.revision},
    'เปลี่ยนเป็นอนุมัติรายคำขอแล้ว ขณะนี้ปิดรับคำขอใหม่')) {
    document.getElementById('scansobPolicyEnabled').focus();
  }
}

async function persistScanSobPolicy(run, args, message) {
  setScanSobPolicyBusy(true);
  try {
    var data = await scanSobInboxRpc('configure', args);
    if (!activeScanSobInbox(run)) return;
    renderScanSobPolicy(data);
    scanSobPolicyStatus(message, false);
    return true;
  } catch (error) {
    if (!activeScanSobInbox(run)) return;
    var conflict = (error.message || '').includes('PAIRING_POLICY_CHANGED');
    document.getElementById('scansobPolicyReload').hidden = !conflict;
    scanSobPolicyStatus(conflict ? 'การตั้งค่าถูกเปลี่ยนแล้ว กรุณาโหลดค่าล่าสุดก่อนบันทึกอีกครั้ง' : 'บันทึกการรับคำขอไม่สำเร็จ กรุณาลองใหม่', true);
  } finally { if (activeScanSobInbox(run)) setScanSobPolicyBusy(false); }
}
