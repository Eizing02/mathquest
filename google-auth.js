/* Google authenticates the account. A student-code link is self-claimed, not ownership proof. */
var googleAccount = null;
var googleAuthBusy = false;
var googleLinkBusy = false;
var googleLinkPreview = null;
var googleLinkChanging = false;
var googleGuardTimer = null;
var googleAuthSubscription = null;

function isGoogleLoginActive() { return !!(CU && CU.authMode === 'google' && !CU.isGuest); }

function normalizeGoogleStudentCode(value) {
  return String(value || '').trim().normalize('NFKC').replace(/[๐-๙]/g, function(digit) {
    return String(digit.charCodeAt(0) - 3664);
  });
}

function googleAuthMessage(error) {
  var message = error && (error.message || error.code) || String(error || '');
  var messages = {
    INVALID_STUDENT_CODE: 'กรอกรหัสนักเรียนเป็นตัวเลข 5 หลัก รวมเลข 0 ด้านหน้า',
    STUDENT_NOT_FOUND: 'ไม่พบรหัสนักเรียนนี้ในทะเบียน กรุณาตรวจรหัสอีกครั้ง',
    STUDENT_ALREADY_LINKED: 'รหัสนี้เชื่อมกับบัญชีอื่นแล้ว หากเป็นรหัสของคุณ กรุณาติดต่อครู',
    SAME_STUDENT_CODE: 'รหัสนี้เป็นรหัสที่ใช้งานอยู่แล้ว',
    LINK_STATE_CHANGED: 'ข้อมูลบัญชีเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่',
    STUDENT_ONLY: 'บัญชีนี้เป็นบัญชีครู ไม่สามารถเชื่อมรหัสนักเรียนได้',
    RATE_LIMITED: 'ลองหลายครั้งเกินไป กรุณารอแล้วลองใหม่',
    ACTIVE_SESSION: 'ยังมีคาบเปิดสำหรับรหัสเดิมหรือรหัสใหม่ กรุณารอให้ครูปิดคาบก่อน',
    GOOGLE_SESSION_REQUIRED: 'เซสชัน Google หมดอายุ กรุณาเข้าสู่ระบบใหม่',
    LINKED_STUDENT_REQUIRED: 'กรุณาเชื่อมรหัสนักเรียนก่อนเข้าใช้งาน',
    TEACHER_GOOGLE_REQUIRED: 'บัญชี Google นี้ไม่มีสิทธิ์ครู',
    GOOGLE_REAUTH_REQUIRED: 'กรุณาเข้าสู่ระบบ Google อีกครั้งก่อนล้างข้อมูล'
  };
  var key = Object.keys(messages).find(function(code) { return message.indexOf(code) !== -1; });
  if (key) return messages[key];
  if ((error && error.code === 'PGRST202') || /Could not find the function|permission denied for schema/.test(message)) {
    return 'ยังไม่ได้อัปเดตระบบ Google กรุณารัน 20261015_01_google_login_student_links.sql';
  }
  if (/provider.*not.*enabled|Unsupported provider/i.test(message)) return 'ยังไม่ได้เปิด Google Provider ใน Supabase กรุณาให้ครูตั้งค่าก่อน';
  if (/fetch|network|timeout/i.test(message)) return 'เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง';
  return 'เข้าใช้งานไม่สำเร็จ กรุณาลองใหม่หรือติดต่อครู';
}

async function googleRpc(name, args) {
  try { return await runQuery(getSupabase().rpc(name, args || {})); }
  catch (error) {
    var wrapped = new Error(googleAuthMessage(error));
    wrapped.authCode = error && error.message || '';
    throw wrapped;
  }
}

function setGoogleLoginStatus(message, error) {
  var el = document.getElementById('googleLoginStatus');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('is-error', !!error);
  el.hidden = !message;
}

async function signInWithGoogle() {
  if (googleAuthBusy) return;
  googleAuthBusy = true;
  var button = document.getElementById('googleLoginBtn');
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  setGoogleLoginStatus('กำลังเปิด Google...');
  try {
    clearGuestSession();
    var result = await getSupabase().auth.signInWithOAuth({
      provider: 'google', options: {
        redirectTo: window.location.origin + window.location.pathname,
        queryParams: { prompt: 'select_account' }
      }
    });
    if (result.error) throw result.error;
  } catch (error) { setGoogleLoginStatus(googleAuthMessage(error), true); }
  finally {
    googleAuthBusy = false;
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}

function hideGoogleAppViews() {
  ['studentSection', 'teacherSection', 'googleLinkSection'].forEach(function(id) {
    document.getElementById(id).classList.add('hidden');
  });
}

function renderGoogleLinkForm(changing) {
  if (typeof cancelAttendanceLocation === 'function') cancelAttendanceLocation();
  googleLinkChanging = !!changing;
  googleLinkPreview = null;
  hideGoogleAppViews();
  document.getElementById('loginSection').classList.add('hidden');
  document.getElementById('googleLinkSection').classList.remove('hidden');
  document.getElementById('googleAccountEmail').textContent = googleAccount.email || '';
  document.getElementById('googleLinkTitle').textContent = changing ? 'เปลี่ยนรหัสนักเรียนที่เชื่อมไว้' : 'เชื่อมรหัสนักเรียน';
  document.getElementById('googleStudentCode').value = '';
  document.getElementById('googleLinkInput').hidden = false;
  document.getElementById('googleLinkPreview').hidden = true;
  document.getElementById('googleLinkChangeNote').hidden = !changing;
  document.getElementById('googleLinkCancel').hidden = !changing;
  document.getElementById('googleLinkError').hidden = true;
  document.getElementById('googleLinkSubmitText').textContent = 'ตรวจสอบรหัส';
  document.getElementById('googleStudentCode').focus();
}

function editGoogleStudentCode() {
  if (googleLinkBusy) return;
  googleLinkPreview = null;
  document.getElementById('googleLinkInput').hidden = false;
  document.getElementById('googleLinkPreview').hidden = true;
  document.getElementById('googleLinkSubmitText').textContent = 'ตรวจสอบรหัส';
  document.getElementById('googleLinkError').hidden = true;
  document.getElementById('googleStudentCode').focus();
}

async function submitGoogleStudentLink(event) {
  if (event) event.preventDefault();
  if (googleLinkBusy) return;
  var code = googleLinkPreview ? googleLinkPreview.id : normalizeGoogleStudentCode(document.getElementById('googleStudentCode').value);
  var errorEl = document.getElementById('googleLinkError');
  errorEl.hidden = true;
  if (!/^[0-9]{5}$/.test(code)) {
    errorEl.textContent = googleAuthMessage('INVALID_STUDENT_CODE'); errorEl.hidden = false; return;
  }
  googleLinkBusy = true;
  var button = document.getElementById('googleLinkSubmit');
  button.disabled = true;
  document.getElementById('googleLinkForm').setAttribute('aria-busy', 'true');
  try {
    var result = await googleRpc('mq_student_link', {
      p_action: googleLinkPreview ? (googleLinkChanging ? 'switch' : 'claim') : 'lookup', p_student_code: code
    });
    if (!result.ok) throw new Error(googleAuthMessage(result.code));
    if (!googleLinkPreview) {
      googleLinkPreview = result.student;
      document.getElementById('googlePreviewCode').textContent = result.student.id;
      document.getElementById('googlePreviewName').textContent = result.student.name;
      document.getElementById('googlePreviewGrade').textContent = result.student.grade;
      document.getElementById('googleLinkInput').hidden = true;
      document.getElementById('googleLinkPreview').hidden = false;
      document.getElementById('googleLinkSubmitText').textContent = googleLinkChanging ? 'ยืนยันเปลี่ยนรหัส' : 'ยืนยันและเข้าใช้งาน';
      button.focus();
    } else {
      // A fresh document discards all profile, wallet, report and realtime caches.
      window.location.replace(window.location.origin + window.location.pathname);
    }
  } catch (error) { errorEl.textContent = error.message; errorEl.hidden = false; }
  finally { googleLinkBusy = false; button.disabled = false; document.getElementById('googleLinkForm').removeAttribute('aria-busy'); }
}

async function openGoogleAccount() {
  if (!isGoogleLoginActive()) return;
  var result = await Swal.fire({
    title: 'บัญชีที่เชื่อมไว้',
    html: '<div class="google-account-details"><p>' + escHtml(googleAccount.email) + '</p><strong>'
      + escHtml(CU.name) + '</strong><p>รหัส ' + escHtml(CU.id) + ' · ' + escHtml(CU.grade) + '</p></div>',
    showCancelButton: true, confirmButtonText: 'เปลี่ยนรหัสนักเรียน', cancelButtonText: 'ปิด'
  });
  if (result.isConfirmed) renderGoogleLinkForm(true);
}

async function enterGoogleAccount(account) {
  if (typeof cancelAttendanceLocation === 'function') cancelAttendanceLocation();
  googleAccount = account;
  if (account.state === 'unlinked') { renderGoogleLinkForm(false); return; }
  if (account.state === 'teacher_setup_required') {
    hideGoogleAppViews();
    document.getElementById('loginSection').classList.remove('hidden');
    setGoogleLoginStatus('พบหลายบัญชีครูหรือยังไม่มีบัญชีครู กรุณากำหนด teacher_student_id ตามคู่มือ SQL', true);
    document.getElementById('googleSignedOutAction').hidden = false;
    return;
  }
  if (account.state !== 'linked') throw new Error('บัญชีนี้ยังเข้าใช้งานไม่ได้');
  CU = Object.assign({ status: 'success' }, account);
  hideGoogleAppViews();
  document.getElementById('loginSection').classList.add('hidden');
  applyAppSettings(await getAppSettingsDb());
  startSchoolSync();
  if (account.role === 'TEACHER') {
    teacherAdminToken = await googleRpc('mq_open_teacher_session');
    await refreshSchoolRooms();
    document.getElementById('teacherSection').classList.remove('hidden');
    document.getElementById('tNameDisp').textContent = account.name;
    document.getElementById('printTeacher').textContent = account.name;
    document.getElementById('printSchoolName').textContent = appSettings.schoolName || '';
    document.getElementById('teacher-tab-reset').hidden = true;
    document.getElementById('studentNavCount').hidden = true;
    await loadCurrentSession(); await loadSettings(); await loadTeacherShopItems();
    startShopOrderNotifications();
  } else {
    document.getElementById('googleStudentAccountButton').hidden = false;
    document.getElementById('studentExamButton').hidden = false;
    await enterStudentApp(CU);
  }
  startGoogleAccountGuard();
}

function stopGoogleAccountGuard() {
  if (googleGuardTimer) clearInterval(googleGuardTimer);
  googleGuardTimer = null;
}

async function checkGoogleAccountGuard() {
  if (!isGoogleLoginActive() || googleAuthBusy || googleLinkBusy || document.hidden || schoolResetBusy) return;
  try {
    var account = await googleRpc('mq_google_account');
    if (account.state !== 'linked' || account.id !== CU.id || account.authSessionId !== googleAccount.authSessionId || account.linkVersion !== googleAccount.linkVersion) {
      stopGoogleAccountGuard();
      window.location.replace(window.location.origin + window.location.pathname);
    }
  } catch (error) {
    // A network failure does not sign out a valid account; RLS still checks every request.
    if (/GOOGLE_SESSION_REQUIRED|LINKED_STUDENT_REQUIRED/.test(error.authCode || '')) {
      stopGoogleAccountGuard();
      window.location.replace(window.location.origin + window.location.pathname);
    }
  }
}

function startGoogleAccountGuard() {
  stopGoogleAccountGuard();
  googleGuardTimer = setInterval(checkGoogleAccountGuard, 30000);
}

async function ensureGoogleResetAuth() {
  if (await googleRpc('mq_google_recent_auth')) return true;
  var result = await Swal.fire({ icon: 'info', title: 'ยืนยันบัญชี Google อีกครั้ง',
    text: 'ก่อนล้างข้อมูลนักเรียน ต้องเข้าสู่ระบบ Google ใหม่ จากนั้นตรวจสอบและยืนยันการลบอีกครั้ง',
    showCancelButton: true, confirmButtonText: 'เข้าสู่ระบบ Google', cancelButtonText: 'ยกเลิก' });
  if (result.isConfirmed) await signInWithGoogle();
  return false;
}

async function bootstrapGoogleLogin() {
  if (isGuestMode() || googleAuthBusy) return;
  var client, result;
  try { client = getSupabase(); result = await client.auth.getSession(); }
  catch (error) { setGoogleLoginStatus('โหลดระบบเข้าสู่ระบบไม่สำเร็จ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง', true); return; }
  if (isGuestMode()) return;
  if (result.error) { setGoogleLoginStatus(googleAuthMessage(result.error), true); return; }
  if (!result.data.session) return;
  googleAuthBusy = true;
  setGoogleLoginStatus('กำลังตรวจสอบบัญชี Google...');
  try {
    // This RPC derives identity from the verified JWT, never the client session's user object.
    var account = await googleRpc('mq_google_account');
    if (!isGuestMode()) await enterGoogleAccount(account);
    setGoogleLoginStatus('');
  } catch (error) {
    stopSchoolSync(); stopStudentGiftNotifications(); stopShopOrderNotifications();
    stopGoogleAccountGuard(); teacherAdminToken = '';
    hideGoogleAppViews(); CU = {}; googleAccount = null;
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('googleSignedOutAction').hidden = false;
    setGoogleLoginStatus(error.message, true);
  } finally { googleAuthBusy = false; }
}

async function signOutGoogleAccount() {
  if (typeof cancelAttendanceLocation === 'function') cancelAttendanceLocation();
  stopGoogleAccountGuard();
  if (googleAuthSubscription) googleAuthSubscription.unsubscribe();
  googleAuthSubscription = null;
  try { await getSupabase().auth.signOut({ scope: 'local' }); }
  finally {
    // Clear only this app's auth cache, including failed/offline sign-out recovery.
    localStorage.removeItem('mathquest-google-auth-v1');
    localStorage.removeItem('mathquest-google-auth-v1-code-verifier');
    googleAccount = null;
  }
}

window.addEventListener('load', function() {
  if (!isSupabaseConfigured()) return;
  if (!window.supabase || !window.supabase.createClient) return;
  var subscription = getSupabase().auth.onAuthStateChange(function(event) {
    if ((event === 'SIGNED_OUT' || event === 'USER_DELETED') && isGoogleLoginActive()) {
      setTimeout(function() { window.location.replace(window.location.origin + window.location.pathname); }, 0);
    }
  });
  googleAuthSubscription = subscription.data.subscription;
});
document.addEventListener('visibilitychange', function() { if (!document.hidden) checkGoogleAccountGuard(); });
