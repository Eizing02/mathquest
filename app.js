/* ══ Supabase Config ═══════════════════════════════════ */
var SUPABASE_URL = window.SUPABASE_URL || 'https://jckuqyohylttctzcaekg.supabase.co';
var SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impja3VxeW9oeWx0dGN0emNhZWtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyODY2MzQsImV4cCI6MjA5Mjg2MjYzNH0.1YgqnE3VBUOJrK6xDIDgXVwylttSaD4ti47A_0Tarvg';
var STORAGE_BUCKET = 'mathquest-storage';
var BANGKOK_TZ = 'Asia/Bangkok';
var supabaseClient = null;
var configAlertShown = false;

/* ══ State ════════════════════════════════════════════ */
var CU = {}, cDonut = null, cBar = null;
var statsLoaded = false, statsCache = null;
var refreshCooldown = false;
var settingsLogoUrl = '', settingsColor = '#4f46e5';
var appSettings = {
  appName: 'ระบบเช็คชื่อนักเรียน',
  schoolName: 'กุงแก้ววิทยาคาร',
  accentColor: '#4f46e5',
  logoBase64: '',
  logoUrl: ''
};

// Teacher Shop State
var tShopItems = null;
var tShopOrders = null;
var tOrderFilter = 'all';
var itemImageUrl = '';
var rewardReportCache = null;
var PASSWORD_RESET_TTL_MINUTES = 15;
var passwordResetRequests = [];
var passwordResetCountdownTimer = null;
var passwordResetReloadTimer = null;

// Student Shop State
var shopItems = null, shopWallet = null, shopTabCurrent = 'shop';

var TH_MO_S = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
var TH_MO_L = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
               'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/* ── Grade list (ครอบคลุม sub-class ม.X/Y) ── */
var GRADE_LIST = [
  'ม.1','ม.1/1','ม.1/2','ม.1/3',
  'ม.2','ม.2/1','ม.2/2','ม.2/3',
  'ม.3','ม.3/1','ม.3/2','ม.3/3',
  'ม.4','ม.4/1','ม.4/2','ม.4/3',
  'ม.5','ม.5/1','ม.5/2','ม.5/3',
  'ม.6','ม.6/1','ม.6/2','ม.6/3'
];

/**
 * ป้องกัน grade string ที่มี "/" ไม่ให้แตกเมื่อ trim หรือ compare
 * ใช้แทน String(grade).trim() ทุกจุดที่ส่งค่าเข้า DB
 */
function normalizeGrade(g) {
  return String(g || '').trim();
}

function isStudentInSessionGrade(studentGrade, sessionGrade) {
  var st = normalizeGrade(studentGrade);
  var ss = normalizeGrade(sessionGrade);
  if (!st || !ss) return false;
  if (st === ss) return true;
  return ss.indexOf('/') === -1 && st.indexOf(ss + '/') === 0;
}

function isSupabaseConfigured() {
  return SUPABASE_URL && SUPABASE_ANON_KEY &&
    SUPABASE_URL.indexOf('YOUR_') === -1 &&
    SUPABASE_ANON_KEY.indexOf('YOUR_') === -1;
}

function showConfigAlert() {
  if (configAlertShown) return;
  configAlertShown = true;
  Swal.fire({
    icon: 'info',
    title: 'ยังไม่ได้ตั้งค่า Supabase',
    html: 'กรุณาแก้ค่า <code>SUPABASE_URL</code> และ <code>SUPABASE_ANON_KEY</code> ในไฟล์ <code>app.js</code> ก่อนใช้งาน',
    confirmButtonColor: '#4f46e5'
  });
}

function createSupabaseClient() {
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('โหลดไลบรารี Supabase ไม่สำเร็จ');
  }
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function getSupabase() {
  if (!isSupabaseConfigured()) {
    showConfigAlert();
    throw new Error('ยังไม่ได้ตั้งค่า Supabase URL และ Anon Key');
  }
  if (!supabaseClient) supabaseClient = createSupabaseClient();
  return supabaseClient;
}

/* ══ Error / Loading ═════════════════════════════════ */
function onErr(e) {
  Swal.close();
  Swal.fire({
    icon: 'error',
    title: 'เกิดข้อผิดพลาด',
    text: e ? (e.message || String(e)) : 'ไม่สามารถเชื่อมต่อระบบได้',
    confirmButtonColor: '#4f46e5'
  });
}

function loading(t) {
  Swal.fire({
    title: t || 'กำลังโหลด...',
    allowOutsideClick: false,
    didOpen: function() { Swal.showLoading(); }
  });
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

function toNumber(v, fallback) {
  var n = Number(v);
  return isNaN(n) ? (fallback == null ? 0 : fallback) : n;
}

function safeDate(v) {
  if (!v) return null;
  var d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function getDateParts(value) {
  var d = safeDate(value);
  if (!d) return null;
  var parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  var map = {};
  parts.forEach(function(p) {
    if (p.type !== 'literal') map[p.type] = p.value;
  });
  return map;
}

function dateKeyBangkok(value) {
  var p = getDateParts(value);
  return p ? (p.year + '-' + p.month + '-' + p.day) : '';
}

function monthKeyBangkok(value) {
  var p = getDateParts(value);
  return p ? (p.year + '-' + p.month) : '';
}

function monthNumberBangkok(value) {
  var p = getDateParts(value);
  return p ? String(Number(p.month)) : '';
}

function formatDate(value) {
  var d = safeDate(value);
  return d ? d.toLocaleDateString('en-GB', { timeZone: BANGKOK_TZ }) : '';
}

function formatDateTime(value) {
  var d = safeDate(value);
  if (!d) return '';
  return d.toLocaleString('en-GB', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).replace(',', '');
}

function formatThaiLongDate(value) {
  var d = safeDate(value);
  return d ? d.toLocaleDateString('th-TH', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : '';
}

function formatTime(value) {
  var d = safeDate(value);
  return d ? d.toLocaleTimeString('en-GB', {
    timeZone: BANGKOK_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }) : '';
}

function toNoonIso(dateStr) {
  return new Date(dateStr + 'T12:00:00+07:00').toISOString();
}

function sanitizeFilename(name) {
  return String(name || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function matchesMonth(value, targetMonth) {
  if (!targetMonth || targetMonth === 'all') return true;
  return monthNumberBangkok(value) === String(targetMonth);
}

async function runQuery(promise) {
  var res = await promise;
  if (res.error) throw res.error;
  return res.data;
}

async function getServerNowDb(client) {
  try {
    var value = await runQuery(client.rpc('get_server_now'));
    var serverNow = safeDate(value);
    if (serverNow) return serverNow;
  } catch (e) {}
  return new Date();
}

function mapShopItem(row) {
  return {
    rowIndex: row.id,
    itemId: row.item_id,
    itemName: row.item_name,
    cost: Number(row.cost) || 0,
    description: row.description || '',
    image: row.image_url || '',
    imageUrl: row.image_url || '',
    active: !!row.is_active
  };
}

/* ══ Storage Helpers ═════════════════════════════════ */
function compressImageFile(file, maxW, maxH, quality) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var w = img.width, h = img.height;
        var ratio = Math.min(maxW / w, maxH / h, 1);
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function(blob) {
          if (!blob) {
            reject(new Error('ไม่สามารถบีบอัดรูปภาพได้'));
            return;
          }
          resolve(blob);
        }, 'image/jpeg', quality || 0.75);
      };
      img.onerror = function() { reject(new Error('ไม่สามารถอ่านรูปภาพได้')); };
      img.src = e.target.result;
    };
    reader.onerror = function() { reject(new Error('ไม่สามารถอ่านไฟล์ได้')); };
    reader.readAsDataURL(file);
  });
}

async function uploadCompressedImage(file, options) {
  var opt = options || {};
  var folder = opt.folder || 'uploads';
  var maxWidth = opt.maxWidth || 200;
  var maxHeight = opt.maxHeight || 200;
  var quality = opt.quality || 0.75;
  var client = getSupabase();
  var blob = await compressImageFile(file, maxWidth, maxHeight, quality);
  var baseName = sanitizeFilename(file.name || 'image.jpg').replace(/\.[^.]+$/, '') || 'image';
  var path = folder + '/' + Date.now() + '-' + baseName + '.jpg';
  await runQuery(client.storage.from(STORAGE_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true
  }));
  var pub = client.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return {
    path: path,
    publicUrl: pub.data.publicUrl
  };
}

/* ══ Database Layer ══════════════════════════════════ */
async function getSettingsMap(keys) {
  var client = getSupabase();
  var query = client.from('system_settings').select('key,value');
  if (keys && keys.length) query = query.in('key', keys);
  var rows = await runQuery(query);
  var out = {};
  (rows || []).forEach(function(row) {
    out[row.key] = row.value == null ? '' : String(row.value);
  });
  return out;
}

async function upsertSettings(entries) {
  var client = getSupabase();
  var rows = Object.keys(entries).map(function(key) {
    return { key: key, value: entries[key] == null ? '' : String(entries[key]) };
  });
  if (!rows.length) return;
  await runQuery(client.from('system_settings').upsert(rows, { onConflict: 'key' }));
}

async function getAppSettingsDb() {
  var s = await getSettingsMap(['app_name', 'school_name', 'accent_color', 'logo_url']);
  var logoUrl = s.logo_url || '';
  return {
    appName: s.app_name || 'ระบบเช็คชื่อนักเรียน',
    schoolName: s.school_name || 'กุงแก้ววิทยาคาร',
    accentColor: s.accent_color || '#4f46e5',
    logoBase64: logoUrl,
    logoUrl: logoUrl
  };
}

async function saveAppSettingsDb(settings) {
  await upsertSettings({
    app_name: settings.appName || 'ระบบเช็คชื่อนักเรียน',
    school_name: settings.schoolName || 'กุงแก้ววิทยาคาร',
    accent_color: settings.accentColor || '#4f46e5',
    logo_url: settings.logoUrl || ''
  });
  return { status: 'success' };
}

async function verifyLoginDb(username, password) {
  var client = getSupabase();
  var u = String(username || '').trim();
  var p = String(password || '').trim();
  var row = await runQuery(client.from('students')
    .select('id,name,grade,role,is_first_login')
    .eq('id', u)
    .eq('password', p)
    .maybeSingle());
  if (!row) {
    return { status: 'fail', message: 'รหัสประจำตัวหรือรหัสผ่านไม่ถูกต้อง' };
  }
  return {
    status: 'success',
    role: row.role === 'TEACHER' ? 'TEACHER' : 'STUDENT',
    name: row.name || '',
    grade: row.grade || '',
    id: row.id,
    isFirstLogin: row.is_first_login === true
  };
}

/* ══ First-Time Password Change ═════════════════════ */
async function changeFirstTimePasswordDb(studentId, newPassword) {
  var client = getSupabase();
  var cid = String(studentId).trim();
  await runQuery(client.from('students')
    .update({ password: newPassword, is_first_login: false })
    .eq('id', cid)
    .select('id'));
  return { status: 'success' };
}

/**
 * แสดง SweetAlert2 บังคับตั้งรหัสผ่านใหม่ (allowOutsideClick:false)
 * ห้ามปิดจนกว่าจะเปลี่ยนสำเร็จ — ใช้หลัง login สำเร็จและพบ is_first_login = true
 */
async function forceChangePassword(studentId) {
  while (true) {
    var result = await Swal.fire({
      title: '🔐 ตั้งรหัสผ่านใหม่',
      html: '<p style="color:#64748b;font-size:.87rem;margin-bottom:16px">นี่คือการเข้าสู่ระบบครั้งแรกของคุณ<br>กรุณาตั้งรหัสผ่านใหม่ เพื่อความปลอดภัย</p>'
        + '<input id="swal-np1" type="password" class="swal2-input" placeholder="รหัสผ่านใหม่" autocomplete="new-password">'
        + '<input id="swal-np2" type="password" class="swal2-input" placeholder="ยืนยันรหัสผ่านใหม่" autocomplete="new-password">'
        + '<p id="swal-pw-err" style="color:#ef4444;font-size:.8rem;margin:6px 0 0;min-height:1.1em"></p>',
      confirmButtonText: '✅ บันทึกรหัสผ่าน',
      confirmButtonColor: '#4f46e5',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showCancelButton: false,
      focusConfirm: false,
      didOpen: function() {
        /* กด Enter ที่ field ที่ 2 ก็ submit */
        var f2 = document.getElementById('swal-np2');
        if (f2) f2.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') Swal.clickConfirm();
        });
      },
      preConfirm: function() {
        var np1 = (document.getElementById('swal-np1').value || '').trim();
        var np2 = (document.getElementById('swal-np2').value || '').trim();
        var errEl = document.getElementById('swal-pw-err');
        if (!np1) {
          errEl.textContent = 'กรุณากรอกรหัสผ่านใหม่';
          return false;
        }
        if (np1.length < 6) {
          errEl.textContent = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
          return false;
        }
        if (np1 === String(studentId).trim()) {
          errEl.textContent = '❌ รหัสผ่านต้องไม่ซ้ำกับรหัสประจำตัว';
          return false;
        }
        if (np1 !== np2) {
          errEl.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
          return false;
        }
        return np1;
      }
    });

    if (!result.isConfirmed || !result.value) continue; /* กด X ไม่ได้, loop ต่อ */

    loading('กำลังบันทึกรหัสผ่าน...');
    try {
      await changeFirstTimePasswordDb(studentId, result.value);
      Swal.fire({
        icon: 'success',
        title: 'ตั้งรหัสผ่านสำเร็จ! 🎉',
        text: 'รหัสผ่านใหม่ของคุณถูกบันทึกแล้ว',
        confirmButtonColor: '#10b981',
        timer: 2000,
        timerProgressBar: true
      });
      return; /* ออกจาก loop เมื่อสำเร็จ */
    } catch (e) {
      Swal.fire({
        icon: 'error',
        title: 'บันทึกไม่สำเร็จ',
        text: e.message || 'กรุณาลองใหม่',
        confirmButtonColor: '#ef4444'
      });
      /* loop กลับไปถามใหม่ */
    }
  }
}

/* Password Reset Requests */
function generatePasswordResetCode() {
  if (window.crypto && window.crypto.getRandomValues) {
    var values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    return String(100000 + (values[0] % 900000));
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeResetCode(code) {
  return String(code || '').replace(/\D/g, '').slice(0, 6);
}

function formatResetRemaining(expiresAt) {
  var expires = safeDate(expiresAt);
  if (!expires) return 'ไม่ทราบเวลา';
  var ms = expires.getTime() - Date.now();
  if (ms <= 0) return 'หมดอายุแล้ว';
  var totalSec = Math.ceil(ms / 1000);
  var min = Math.floor(totalSec / 60);
  var sec = totalSec % 60;
  return min + ':' + String(sec).padStart(2, '0') + ' นาที';
}

function resetRemainingMinutes(expiresAt) {
  var expires = safeDate(expiresAt);
  if (!expires) return 0;
  return Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 60000));
}

async function cleanupExpiredPasswordResetRequestsDb(client) {
  var db = client || getSupabase();
  var now = (await getServerNowDb(db)).toISOString();
  await runQuery(db.from('password_reset_requests')
    .delete()
    .eq('status', 'pending')
    .lte('expires_at', now)
    .select('id'));
  return now;
}

async function getActivePasswordResetRequestDb(studentId, client) {
  var db = client || getSupabase();
  var now = (await getServerNowDb(db)).toISOString();
  return runQuery(db.from('password_reset_requests')
    .select('id,student_id,student_name,grade,reset_code,status,created_at,expires_at')
    .eq('student_id', String(studentId || '').trim())
    .eq('status', 'pending')
    .gt('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle());
}

async function createPasswordResetRequestDb(studentId) {
  var client = getSupabase();
  var sid = String(studentId || '').trim();
  if (!sid) throw new Error('กรุณากรอกรหัสประจำตัวนักเรียน');

  await cleanupExpiredPasswordResetRequestsDb(client);

  var student = await runQuery(client.from('students')
    .select('id,name,grade,role')
    .eq('id', sid)
    .maybeSingle());
  if (!student || student.role === 'TEACHER') {
    return { status: 'fail', message: 'ไม่พบรหัสนักเรียนนี้ในระบบ' };
  }

  var existing = await getActivePasswordResetRequestDb(sid, client);
  if (existing) {
    return {
      status: 'existing',
      studentId: existing.student_id,
      studentName: existing.student_name,
      grade: existing.grade,
      expiresAt: existing.expires_at
    };
  }

  var now = await getServerNowDb(client);
  var expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60000).toISOString();
  var payload = {
    student_id: student.id,
    student_name: student.name || '',
    grade: student.grade || '',
    reset_code: generatePasswordResetCode(),
    status: 'pending',
    expires_at: expiresAt
  };

  try {
    var created = await runQuery(client.from('password_reset_requests')
      .insert(payload)
      .select('id,student_id,student_name,grade,created_at,expires_at,status')
      .single());
    return {
      status: 'success',
      studentId: created.student_id,
      studentName: created.student_name,
      grade: created.grade,
      expiresAt: created.expires_at
    };
  } catch (e) {
    if (e && e.code === '23505') {
      var active = await getActivePasswordResetRequestDb(sid, client);
      if (active) {
        return {
          status: 'existing',
          studentId: active.student_id,
          studentName: active.student_name,
          grade: active.grade,
          expiresAt: active.expires_at
        };
      }
    }
    throw e;
  }
}

async function verifyPasswordResetCodeDb(studentId, code, newPassword) {
  var client = getSupabase();
  var sid = String(studentId || '').trim();
  var resetCode = normalizeResetCode(code);
  var password = String(newPassword || '').trim();
  if (!sid) return { status: 'fail', message: 'กรุณากรอกรหัสประจำตัวนักเรียน' };
  if (resetCode.length !== 6) return { status: 'fail', message: 'กรุณากรอกรหัสรีเซ็ต 6 หลัก' };
  if (password.length < 6) return { status: 'fail', message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร' };
  if (password === sid) return { status: 'fail', message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสประจำตัวนักเรียน' };

  await cleanupExpiredPasswordResetRequestsDb(client);
  var now = (await getServerNowDb(client)).toISOString();
  var req = await runQuery(client.from('password_reset_requests')
    .select('id,student_id,student_name,grade,reset_code,expires_at,status')
    .eq('student_id', sid)
    .eq('reset_code', resetCode)
    .eq('status', 'pending')
    .gt('expires_at', now)
    .maybeSingle());
  if (!req) {
    return { status: 'fail', message: 'รหัสรีเซ็ตไม่ถูกต้อง หรือหมดอายุแล้ว' };
  }

  await runQuery(client.from('students')
    .update({ password: password, is_first_login: false })
    .eq('id', sid)
    .select('id'));
  await runQuery(client.from('password_reset_requests')
    .delete()
    .eq('id', req.id)
    .select('id'));

  return {
    status: 'success',
    studentId: req.student_id,
    studentName: req.student_name
  };
}

async function getPasswordResetRequestsDb() {
  var client = getSupabase();
  await cleanupExpiredPasswordResetRequestsDb(client);
  var rows = await runQuery(client.from('password_reset_requests')
    .select('id,student_id,student_name,grade,reset_code,status,created_at,expires_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false }));
  return rows || [];
}

async function deletePasswordResetRequestDb(requestId) {
  var client = getSupabase();
  await runQuery(client.from('password_reset_requests')
    .delete()
    .eq('id', requestId)
    .select('id'));
  return { status: 'success' };
}

function openPasswordResetCodeFromRequestModal() {
  var idEl = document.getElementById('resetReqStudentId');
  var sid = idEl ? idEl.value : '';
  Swal.close();
  setTimeout(function() { openPasswordResetConfirmModal(sid); }, 80);
}

async function openPasswordResetRequestModal() {
  var currentId = document.getElementById('username') ? document.getElementById('username').value.trim() : '';
  var result = await Swal.fire({
    title: 'ขอเปลี่ยนรหัสผ่าน',
    html: '<div class="reset-modal-copy">กรอกรหัสนักเรียนเพื่อส่งคำขอให้ครู ระบบจะสร้างรหัสรีเซ็ต 6 หลักที่ใช้ได้ 15 นาที</div>'
      + '<input id="resetReqStudentId" class="swal2-input reset-swal-input" inputmode="numeric" autocomplete="username" placeholder="เช่น 02125" value="' + escHtml(currentId) + '">'
      + '<button type="button" class="swal-inline-link" onclick="openPasswordResetCodeFromRequestModal()">มีรหัส 6 หลักแล้ว</button>',
    confirmButtonText: 'ส่งคำขอ',
    cancelButtonText: 'ยกเลิก',
    showCancelButton: true,
    showLoaderOnConfirm: true,
    focusConfirm: false,
    confirmButtonColor: '#1d4ed8',
    didOpen: function() {
      var idEl = document.getElementById('resetReqStudentId');
      if (idEl) {
        idEl.focus();
        idEl.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') Swal.clickConfirm();
        });
      }
    },
    preConfirm: async function() {
      var sid = (document.getElementById('resetReqStudentId').value || '').trim();
      if (!sid) {
        Swal.showValidationMessage('กรุณากรอกรหัสประจำตัวนักเรียน');
        return false;
      }
      try {
        var res = await createPasswordResetRequestDb(sid);
        if (res.status === 'fail') {
          Swal.showValidationMessage(res.message || 'ไม่สามารถส่งคำขอได้');
          return false;
        }
        return res;
      } catch (e) {
        Swal.showValidationMessage(e.message || 'ส่งคำขอไม่สำเร็จ');
        return false;
      }
    },
    allowOutsideClick: function() { return !Swal.isLoading(); }
  });

  if (!result.isConfirmed || !result.value) return;
  var res = result.value;
  var remaining = resetRemainingMinutes(res.expiresAt);
  var title = res.status === 'existing' ? 'มีคำขออยู่แล้ว' : 'ส่งคำขอแล้ว';
  var text = 'แจ้งครูให้ดูคำขอของ ' + res.studentName + ' (' + res.grade + ') เหลือเวลาอีกประมาณ ' + remaining + ' นาที';
  var next = await Swal.fire({
    icon: res.status === 'existing' ? 'info' : 'success',
    title: title,
    text: text,
    confirmButtonText: 'กรอกรหัส 6 หลัก',
    cancelButtonText: 'ปิด',
    showCancelButton: true,
    confirmButtonColor: '#1d4ed8'
  });
  if (next.isConfirmed) openPasswordResetConfirmModal(res.studentId);
}

async function openPasswordResetConfirmModal(prefillStudentId) {
  var currentId = prefillStudentId || (document.getElementById('username') ? document.getElementById('username').value.trim() : '');
  var result = await Swal.fire({
    title: 'ตั้งรหัสผ่านใหม่',
    html: '<div class="reset-modal-copy">กรอกรหัสนักเรียน รหัสรีเซ็ต 6 หลักจากครู และรหัสผ่านใหม่</div>'
      + '<input id="resetStudentId" class="swal2-input reset-swal-input" inputmode="numeric" autocomplete="username" placeholder="รหัสนักเรียน" value="' + escHtml(currentId) + '">'
      + '<input id="resetCode" class="swal2-input reset-swal-input reset-code-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="รหัสรีเซ็ต 6 หลัก">'
      + '<input id="resetNewPassword" type="password" class="swal2-input reset-swal-input" autocomplete="new-password" placeholder="รหัสผ่านใหม่ อย่างน้อย 6 ตัวอักษร">'
      + '<input id="resetNewPassword2" type="password" class="swal2-input reset-swal-input" autocomplete="new-password" placeholder="ยืนยันรหัสผ่านใหม่">',
    confirmButtonText: 'เปลี่ยนรหัสผ่าน',
    cancelButtonText: 'ยกเลิก',
    showCancelButton: true,
    showLoaderOnConfirm: true,
    focusConfirm: false,
    confirmButtonColor: '#1d4ed8',
    didOpen: function() {
      var codeEl = document.getElementById('resetCode');
      var pass2 = document.getElementById('resetNewPassword2');
      if (codeEl) {
        codeEl.addEventListener('input', function() { codeEl.value = normalizeResetCode(codeEl.value); });
      }
      if (pass2) {
        pass2.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') Swal.clickConfirm();
        });
      }
    },
    preConfirm: async function() {
      var sid = (document.getElementById('resetStudentId').value || '').trim();
      var code = normalizeResetCode(document.getElementById('resetCode').value);
      var p1 = (document.getElementById('resetNewPassword').value || '').trim();
      var p2 = (document.getElementById('resetNewPassword2').value || '').trim();
      if (!sid) {
        Swal.showValidationMessage('กรุณากรอกรหัสประจำตัวนักเรียน');
        return false;
      }
      if (code.length !== 6) {
        Swal.showValidationMessage('กรุณากรอกรหัสรีเซ็ต 6 หลัก');
        return false;
      }
      if (p1.length < 6) {
        Swal.showValidationMessage('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
        return false;
      }
      if (p1 !== p2) {
        Swal.showValidationMessage('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
        return false;
      }
      try {
        var res = await verifyPasswordResetCodeDb(sid, code, p1);
        if (res.status !== 'success') {
          Swal.showValidationMessage(res.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
          return false;
        }
        return res;
      } catch (e) {
        Swal.showValidationMessage(e.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
        return false;
      }
    },
    allowOutsideClick: function() { return !Swal.isLoading(); }
  });

  if (!result.isConfirmed || !result.value) return;
  if (document.getElementById('username')) document.getElementById('username').value = result.value.studentId || '';
  if (document.getElementById('password')) document.getElementById('password').value = '';
  await Swal.fire({
    icon: 'success',
    title: 'เปลี่ยนรหัสผ่านสำเร็จ',
    text: 'เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย',
    confirmButtonColor: '#047857'
  });
}

function renderPasswordResetRequests(rows) {
  var wrap = document.getElementById('resetRequestList');
  var countEl = document.getElementById('resetRequestCount');
  if (!wrap) return;
  passwordResetRequests = rows || [];
  if (countEl) countEl.textContent = String(passwordResetRequests.length);
  if (!passwordResetRequests.length) {
    wrap.innerHTML = '<div class="reset-empty"><i class="fa-regular fa-circle-check"></i><div><strong>ยังไม่มีคำขอรีเซ็ตรหัสผ่าน</strong><span>ถ้ามีนักเรียนส่งคำขอ รายการจะขึ้นตรงนี้อัตโนมัติ</span></div></div>';
    return;
  }

  wrap.innerHTML = passwordResetRequests.map(function(row) {
    var id = Number(row.id);
    return '<article class="reset-request-card" data-reset-id="' + id + '">'
      + '<div class="reset-request-main">'
      + '<div class="reset-student-name">' + escHtml(row.student_name || '-') + '</div>'
      + '<div class="reset-student-meta"><span>' + escHtml(row.student_id || '-') + '</span><span>' + escHtml(row.grade || '-') + '</span><span>ขอเมื่อ ' + escHtml(formatDateTime(row.created_at)) + '</span></div>'
      + '</div>'
      + '<div class="reset-code-wrap">'
      + '<span class="reset-code-label">รหัสรีเซ็ต</span>'
      + '<strong class="reset-code-value">' + escHtml(row.reset_code || '') + '</strong>'
      + '</div>'
      + '<div class="reset-time-wrap">'
      + '<span class="reset-code-label">เหลือเวลา</span>'
      + '<strong class="reset-countdown" data-reset-expires="' + escHtml(row.expires_at || '') + '">' + escHtml(formatResetRemaining(row.expires_at)) + '</strong>'
      + '</div>'
      + '<button class="reset-delete-btn" onclick="deletePasswordResetRequest(' + id + ')" aria-label="ลบคำขอของ ' + escHtml(row.student_name || row.student_id || '') + '"><i class="fa-solid fa-trash"></i></button>'
      + '</article>';
  }).join('');
  updatePasswordResetCountdowns();
}

function updatePasswordResetCountdowns() {
  var shouldReload = false;
  document.querySelectorAll('[data-reset-expires]').forEach(function(el) {
    var expires = safeDate(el.getAttribute('data-reset-expires'));
    if (!expires) return;
    var ms = expires.getTime() - Date.now();
    el.textContent = formatResetRemaining(expires);
    el.classList.toggle('is-urgent', ms > 0 && ms <= 3 * 60000);
    el.classList.toggle('is-expired', ms <= 0);
    if (ms <= 0) shouldReload = true;
  });
  if (shouldReload) {
    setTimeout(function() { loadPasswordResetRequests(); }, 600);
  }
}

async function loadPasswordResetRequests() {
  var wrap = document.getElementById('resetRequestList');
  if (!wrap) return;
  try {
    var rows = await getPasswordResetRequestsDb();
    renderPasswordResetRequests(rows);
  } catch (e) {
    wrap.innerHTML = '<div class="reset-empty reset-empty-error"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>โหลดคำขอรีเซ็ตไม่ได้</strong><span>' + escHtml(e.message || 'กรุณาตรวจสอบว่าอัปเดตฐานข้อมูลแล้ว') + '</span></div></div>';
  }
}

function startPasswordResetDashboard() {
  stopPasswordResetDashboard();
  loadPasswordResetRequests();
  passwordResetCountdownTimer = setInterval(updatePasswordResetCountdowns, 1000);
  passwordResetReloadTimer = setInterval(loadPasswordResetRequests, 30000);
}

function stopPasswordResetDashboard() {
  if (passwordResetCountdownTimer) clearInterval(passwordResetCountdownTimer);
  if (passwordResetReloadTimer) clearInterval(passwordResetReloadTimer);
  passwordResetCountdownTimer = null;
  passwordResetReloadTimer = null;
}

async function deletePasswordResetRequest(requestId) {
  var row = passwordResetRequests.find(function(item) { return Number(item.id) === Number(requestId); });
  var name = row ? (row.student_name || row.student_id) : 'รายการนี้';
  var ok = await Swal.fire({
    icon: 'warning',
    title: 'ลบคำขอรีเซ็ต?',
    text: 'คำขอของ ' + name + ' จะถูกลบออกจากหน้าครูทันที',
    confirmButtonText: 'ลบคำขอ',
    cancelButtonText: 'ยกเลิก',
    showCancelButton: true,
    confirmButtonColor: '#b91c1c'
  });
  if (!ok.isConfirmed) return;
  try {
    await deletePasswordResetRequestDb(requestId);
    await loadPasswordResetRequests();
    Swal.fire({ icon: 'success', title: 'ลบคำขอแล้ว', timer: 1300, showConfirmButton: false });
  } catch (e) {
    onErr(e);
  }
}

async function getStudentPointsAndLevelDb(studentId) {
  var client = getSupabase();
  var logs = await runQuery(client.from('attendance_logs')
    .select('status,points')
    .eq('student_id', String(studentId).trim()));
  var pts = 0, cnt = 0;
  (logs || []).forEach(function(log) {
    if (String(log.status).trim() === 'มา') {
      cnt++;
      pts += Number(log.points) || 0;
    }
  });
  return {
    totalPoints: pts,
    level: Math.floor(pts / 5),
    pointsInLevel: pts % 5,
    checkCount: cnt
  };
}

async function getStudentProfileDb(studentId) {
  var client = getSupabase();
  var cid = String(studentId).trim();
  var row = await runQuery(client.from('students')
    .select('id,name,grade,role,photo_url')
    .eq('id', cid)
    .maybeSingle());
  if (!row) return null;
  var lv = await getStudentPointsAndLevelDb(cid);
  return {
    id: cid,
    name: row.name || '',
    grade: row.grade || '',
    photo: row.photo_url || null,
    photo_url: row.photo_url || null,
    level: lv.level,
    totalPoints: lv.totalPoints,
    pointsInLevel: lv.pointsInLevel,
    checkCount: lv.checkCount
  };
}

async function saveProfilePictureDb(studentId, photoUrl) {
  var client = getSupabase();
  await runQuery(client.from('students')
    .update({ photo_url: photoUrl || '' })
    .eq('id', String(studentId).trim())
    .select('id'));
  return { status: 'success' };
}

async function getStudentsInGradeDb(grade) {
  var client = getSupabase();
  var rows = await runQuery(client.from('students')
    .select('id,name')
    .eq('grade', normalizeGrade(grade))
    .order('id', { ascending: true }));
  return (rows || []).map(function(r) {
    return { id: r.id, name: r.name || '' };
  });
}

async function getStudentsForGradeScopeDb(grade) {
  var target = normalizeGrade(grade);
  if (!target) return [];
  var rows = await runQuery(getSupabase().from('students')
    .select('id,name,grade')
    .eq('role', 'STUDENT')
    .order('id', { ascending: true }));
  return (rows || []).filter(function(st) {
    return isStudentInSessionGrade(st.grade, target);
  }).map(function(st) {
    return {
      id: st.id,
      name: st.name || '',
      grade: st.grade || ''
    };
  });
}

async function addNewStudentDb(studentId, studentName, grade) {
  var client = getSupabase();
  var sid = String(studentId || '').trim();
  var name = String(studentName || '').trim();
  var g = normalizeGrade(grade);
  if (!sid || !name || !g) return { status: 'fail', msg: 'กรุณากรอกข้อมูลให้ครบถ้วน' };
  await runQuery(client.from('students').insert([{
    id: sid,
    name: name,
    password: sid,
    grade: g,
    role: 'STUDENT',
    photo_url: '',
    is_first_login: true
  }]).select('id'));
  return {
    status: 'success',
    student: { id: sid, name: name, grade: g }
  };
}

async function getStudentHistoryDb(studentId, targetMonth) {
  var client = getSupabase();
  var rows = await runQuery(client.from('attendance_logs')
    .select('id,timestamp,status,points')
    .eq('student_id', String(studentId).trim())
    .order('timestamp', { ascending: false }));
  return (rows || []).filter(function(r) {
    return matchesMonth(r.timestamp, targetMonth || 'all');
  }).map(function(r) {
    return {
      id: r.id,
      date: formatDate(r.timestamp),
      dateKey: dateKeyBangkok(r.timestamp),
      status: String(r.status || '').trim(),
      points: Number(r.points) || 0
    };
  });
}

async function getAttendanceStatsDb(targetGrade, targetMonth) {
  var client = getSupabase();
  var students = await runQuery(client.from('students')
    .select('id,name,grade')
    .eq('grade', normalizeGrade(targetGrade))
    .order('id', { ascending: true }));
  if (!students.length) return [];
  var ids = students.map(function(s) { return s.id; });
  var logs = await runQuery(client.from('attendance_logs')
    .select('student_id,status,points,timestamp')
    .in('student_id', ids));
  var bySt = {};
  var levelMap = {};
  (logs || []).forEach(function(log) {
    var sid = log.student_id;
    if (!levelMap[sid]) levelMap[sid] = { totalPoints: 0 };
    if (String(log.status).trim() === 'มา') {
      levelMap[sid].totalPoints += Number(log.points) || 0;
    }
    if (!matchesMonth(log.timestamp, targetMonth || 'all')) return;
    if (!bySt[sid]) bySt[sid] = { present: 0, absent: 0, leave: 0 };
    if (log.status === 'มา') bySt[sid].present++;
    else if (log.status === 'ขาด') bySt[sid].absent++;
    else if (log.status === 'ลา') bySt[sid].leave++;
  });
  return students.map(function(s) {
    var h = bySt[s.id] || { present: 0, absent: 0, leave: 0 };
    var totalPoints = (levelMap[s.id] && levelMap[s.id].totalPoints) || 0;
    return {
      id: s.id,
      name: s.name || '',
      present: h.present,
      absent: h.absent,
      leave: h.leave,
      level: Math.floor(totalPoints / 5),
      totalPoints: totalPoints
    };
  });
}

async function getDashboardChartDataDb(grade) {
  var client = getSupabase();
  var students = await runQuery(client.from('students')
    .select('id')
    .eq('grade', normalizeGrade(grade)));
  var ids = students.map(function(s) { return s.id; });
  if (!ids.length) return { months: [], totalStudents: 0 };
  var logs = await runQuery(client.from('attendance_logs')
    .select('student_id,status,timestamp')
    .in('student_id', ids));
  var mp = {};
  (logs || []).forEach(function(log) {
    var mk = monthKeyBangkok(log.timestamp);
    if (!mk) return;
    if (!mp[mk]) mp[mk] = { present: 0, absent: 0, leave: 0 };
    if (log.status === 'มา') mp[mk].present++;
    else if (log.status === 'ขาด') mp[mk].absent++;
    else if (log.status === 'ลา') mp[mk].leave++;
  });
  return {
    months: Object.keys(mp).sort().map(function(k) {
      return {
        month: k,
        present: mp[k].present,
        absent: mp[k].absent,
        leave: mp[k].leave
      };
    }),
    totalStudents: ids.length
  };
}

async function getCurrentSessionStatusDb() {
  var s = await getSettingsMap(['pin', 'pin_expiry', 'current_grade', 'session_start']);
  var pin = (s.pin || '').trim();
  var expiry = safeDate(s.pin_expiry);
  var grade = (s.current_grade || '').trim();
  var start = safeDate(s.session_start);
  if (!pin || !expiry || !grade) return { active: false };
  var now = await getServerNowDb(getSupabase());
  return {
    active: true,
    pin: pin,
    grade: grade,
    expiry: formatTime(expiry),
    startTime: start ? start.getTime() : null,
    expired: now > expiry
  };
}

async function generateNewPINDb(targetGrade) {
  if (!targetGrade) return { status: 'fail', message: 'กรุณาเลือกระดับชั้น' };
  var client = getSupabase();
  var active = await getSettingsMap(['pin', 'pin_expiry', 'current_grade']);
  if ((active.pin || '').trim() && safeDate(active.pin_expiry) && normalizeGrade(active.current_grade)) {
    return {
      status: 'active',
      message: 'มีคาบชั้น ' + normalizeGrade(active.current_grade) + ' เปิดอยู่แล้ว กรุณาปิดคาบเดิมก่อนสุ่ม PIN ใหม่'
    };
  }
  var pin = Math.floor(1000 + Math.random() * 9000).toString();
  var now = await getServerNowDb(client);
  var expiry = new Date(now.getTime() + 40 * 60000);
  await upsertSettings({
    pin: pin,
    pin_expiry: expiry.toISOString(),
    current_grade: normalizeGrade(targetGrade),
    session_start: now.toISOString()
  });
  return {
    status: 'success',
    pin: pin,
    expiry: formatTime(expiry),
    startTime: now.getTime()
  };
}

async function submitCheckInDb(studentId, pinCode) {
  var client = getSupabase();
  var cid = String(studentId).trim();
  var settings = await getSettingsMap(['pin', 'pin_expiry', 'current_grade', 'session_start']);
  if (!settings.pin) return { result: 'error', msg: 'ยังไม่มีคาบเรียนที่เปิดอยู่' };
  var pin = String(settings.pin || '').trim();
  var expiry = safeDate(settings.pin_expiry);
  var startTime = safeDate(settings.session_start);
  var now = await getServerNowDb(client);
  var grade = String(settings.current_grade || '').trim();
  if (!expiry) return { result: 'error', msg: 'การตั้งค่าไม่ถูกต้อง' };
  if (String(pinCode).trim() !== pin) return { result: 'error', msg: 'รหัส PIN ไม่ถูกต้อง ❌' };
  if (!grade) return { result: 'error', msg: 'ไม่พบข้อมูลชั้นเรียนของคาบนี้' };

  var student = await runQuery(client.from('students')
    .select('id,grade')
    .eq('id', cid)
    .maybeSingle());
  if (!student) return { result: 'error', msg: 'ไม่พบข้อมูลนักเรียน' };
  if (!isStudentInSessionGrade(student.grade, grade)) {
    return {
      result: 'error',
      msg: 'คาบนี้เปิดสำหรับชั้น ' + grade + ' แต่นักเรียนอยู่ชั้น ' + normalizeGrade(student.grade) + ' จึงเช็คชื่อไม่ได้'
    };
  }

  var existing = await runQuery(client.from('attendance_logs')
    .select('id,timestamp')
    .eq('student_id', cid)
    .order('timestamp', { ascending: false }));
  var today = dateKeyBangkok(now);
  for (var i = 0; i < existing.length; i++) {
    if (dateKeyBangkok(existing[i].timestamp) === today) {
      return { result: 'duplicate', msg: 'เช็คชื่อวันนี้เรียบร้อยแล้ว ✅' };
    }
  }
  if (now > expiry) return { result: 'error', msg: 'รหัส PIN หมดอายุแล้ว ⏰' };

  var pts = 0;
  if (startTime) {
    var min = (now - startTime) / 60000;
    if (min <= 5) pts = 5;
    else if (min <= 10) pts = 3;
  }

  await runQuery(client.from('attendance_logs').insert([{
    timestamp: now.toISOString(),
    student_id: cid,
    status: 'มา',
    points: pts
  }]));

  return { result: 'success', points: pts, grade: grade };
}

async function getPendingCloseSessionStudentsDb() {
  var client = getSupabase();
  var s = await getSettingsMap(['current_grade']);
  var grade = normalizeGrade(s.current_grade);
  if (!grade) return { status: 'fail', msg: 'ไม่มีคาบเรียนที่เปิดอยู่', students: [] };
  var allStudents = await runQuery(client.from('students')
    .select('id,name,grade')
    .eq('role', 'STUDENT')
    .order('id', { ascending: true }));
  var students = (allStudents || []).filter(function(st) {
    return isStudentInSessionGrade(st.grade, grade);
  });
  var ids = students.map(function(st) { return st.id; });
  var now = await getServerNowDb(client);
  var today = dateKeyBangkok(now);
  var checked = {};
  if (ids.length) {
    var logs = await runQuery(client.from('attendance_logs')
      .select('student_id,timestamp')
      .in('student_id', ids));
    (logs || []).forEach(function(log) {
      if (dateKeyBangkok(log.timestamp) === today) checked[log.student_id] = true;
    });
  }
  var pending = students.filter(function(st) {
    return !checked[st.id];
  }).map(function(st) {
    return {
      id: st.id,
      name: st.name || '',
      grade: st.grade || ''
    };
  });
  return { status: 'success', grade: grade, students: pending };
}

async function closeAttendanceAndMarkAbsentDb(statusRows) {
  var client = getSupabase();
  var s = await getSettingsMap(['current_grade']);
  var grade = normalizeGrade(s.current_grade);
  if (!grade) return { status: 'fail', msg: 'ไม่มีคาบเรียนที่เปิดอยู่' };
  var pending = await getPendingCloseSessionStudentsDb();
  if (pending.status !== 'success') return pending;
  var statusMap = {};
  (statusRows || []).forEach(function(row) {
    var sid = String(row.studentId || row.id || '').trim();
    var st = String(row.status || '').trim();
    if (sid && (st === 'ขาด' || st === 'ลา')) statusMap[sid] = st;
  });
  var now = await getServerNowDb(client);
  var nowIso = now.toISOString();
  var rows = (pending.students || []).map(function(st) {
    return {
      timestamp: nowIso,
      student_id: st.id,
      status: statusMap[st.id] || 'ขาด',
      points: 0
    };
  });
  if (rows.length) await runQuery(client.from('attendance_logs').insert(rows));
  await upsertSettings({
    pin: '',
    pin_expiry: '',
    current_grade: '',
    session_start: ''
  });
  var absent = rows.filter(function(row) { return row.status === 'ขาด'; }).length;
  var leave = rows.filter(function(row) { return row.status === 'ลา'; }).length;
  return { status: 'success', msg: 'ปิดคาบ ' + grade + ' เรียบร้อย: ขาด ' + absent + ' คน, ลา ' + leave + ' คน' };
}

async function manualCheckInDb(studentId, dateStr, status, points) {
  var client = getSupabase();
  var cid = String(studentId || '').trim();
  if (['มา', 'ขาด', 'ลา'].indexOf(status) === -1) return { status: 'fail', msg: 'สถานะไม่ถูกต้อง' };
  if (!cid || !dateStr) return { status: 'fail', msg: 'ข้อมูลไม่ครบ' };
  var hasPoints = points !== undefined && points !== null && points !== '';
  var pointValue = Math.max(0, Math.floor(Number(points) || 0));
  var rows = await runQuery(client.from('attendance_logs')
    .select('id,timestamp,status,points')
    .eq('student_id', cid));
  var found = null;
  for (var i = 0; i < rows.length; i++) {
    if (dateKeyBangkok(rows[i].timestamp) === dateStr) {
      found = rows[i];
      break;
    }
  }
  if (found) {
    var payload = { status: status };
    if (status !== 'มา') payload.points = 0;
    else if (hasPoints) payload.points = pointValue;
    await runQuery(client.from('attendance_logs')
      .update(payload)
      .eq('id', found.id)
      .select('id'));
    return { status: 'updated', msg: 'อัปเดตสำเร็จ' };
  }
  await runQuery(client.from('attendance_logs').insert([{
    timestamp: toNoonIso(dateStr),
    student_id: cid,
    status: status,
    points: status === 'มา' ? pointValue : 0
  }]));
  return { status: 'added', msg: 'เพิ่มข้อมูลสำเร็จ' };
}

async function editAttendanceRecordDb(studentId, dateStr, status, points) {
  return manualCheckInDb(studentId, dateStr, status, points);
}

async function getWalletBalanceDb(studentId) {
  var client = getSupabase();
  var cid = String(studentId).trim();
  var logData = await runQuery(client.from('attendance_logs')
    .select('status,points')
    .eq('student_id', cid));
  var redData = await runQuery(client.from('redemption_logs')
    .select('points_used,status')
    .eq('student_id', cid));
  var lifetimeExp = 0;
  (logData || []).forEach(function(log) {
    if (String(log.status).trim() === 'มา') lifetimeExp += Number(log.points) || 0;
  });
  var totalSpent = 0;
  (redData || []).forEach(function(r) {
    var st = String(r.status || 'pending').toLowerCase();
    if (st !== 'rejected') totalSpent += Number(r.points_used) || 0;
  });
  return {
    lifetimeExp: lifetimeExp,
    totalSpent: totalSpent,
    mathCoins: Math.max(0, lifetimeExp - totalSpent)
  };
}

async function getShopItemsDb() {
  var client = getSupabase();
  var rows = await runQuery(client.from('shop_items')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false }));
  return (rows || []).map(mapShopItem);
}

async function getAllShopItemsForTeacherDb() {
  var client = getSupabase();
  var rows = await runQuery(client.from('shop_items')
    .select('*')
    .order('created_at', { ascending: false }));
  return (rows || []).map(mapShopItem);
}

async function addShopItemDb(itemName, cost, description, imageUrl, active) {
  if (!itemName || !itemName.trim()) return { status: 'fail', msg: 'กรุณาระบุชื่อสินค้า' };
  var price = Number(cost);
  if (isNaN(price) || price < 0) return { status: 'fail', msg: 'ราคาไม่ถูกต้อง' };
  var itemId = 'ITEM_' + Date.now();
  var client = getSupabase();
  await runQuery(client.from('shop_items').insert([{
    item_id: itemId,
    item_name: itemName.trim(),
    cost: price,
    description: (description || '').trim(),
    image_url: imageUrl || '',
    is_active: active === true
  }]));
  return { status: 'success', msg: 'เพิ่มสินค้า "' + itemName.trim() + '" เรียบร้อย', itemId: itemId };
}

async function updateShopItemDb(itemId, itemName, cost, description, imageUrl, active) {
  if (!itemId) return { status: 'fail', msg: 'ไม่พบ ItemID' };
  if (!itemName || !itemName.trim()) return { status: 'fail', msg: 'กรุณาระบุชื่อสินค้า' };
  var price = Number(cost);
  if (isNaN(price) || price < 0) return { status: 'fail', msg: 'ราคาไม่ถูกต้อง' };
  var client = getSupabase();
  var existing = await runQuery(client.from('shop_items')
    .select('item_id')
    .eq('item_id', String(itemId).trim())
    .maybeSingle());
  if (!existing) return { status: 'fail', msg: 'ไม่พบสินค้า ID: ' + itemId };
  await runQuery(client.from('shop_items')
    .update({
      item_name: itemName.trim(),
      cost: price,
      description: (description || '').trim(),
      image_url: imageUrl || '',
      is_active: active === true
    })
    .eq('item_id', String(itemId).trim())
    .select('item_id'));
  return { status: 'success', msg: 'อัปเดตสินค้าเรียบร้อย' };
}

async function deleteShopItemDb(itemId) {
  if (!itemId) return { status: 'fail', msg: 'ไม่พบ ItemID' };
  var client = getSupabase();
  await runQuery(client.from('shop_items')
    .delete()
    .eq('item_id', String(itemId).trim())
    .select('item_id'));
  return { status: 'success', msg: 'ลบสินค้าเรียบร้อย' };
}

async function toggleShopItemActiveDb(itemId) {
  var client = getSupabase();
  var row = await runQuery(client.from('shop_items')
    .select('item_id,is_active')
    .eq('item_id', String(itemId).trim())
    .maybeSingle());
  if (!row) return { status: 'fail', msg: 'ไม่พบสินค้า' };
  var next = !row.is_active;
  await runQuery(client.from('shop_items')
    .update({ is_active: next })
    .eq('item_id', row.item_id)
    .select('item_id'));
  return { status: 'success', active: next };
}

async function buyItemDb(studentId, itemId, itemName, cost) {
  var cid = String(studentId).trim();
  var iid = String(itemId).trim();
  var wallet = await getWalletBalanceDb(cid);
  var client = getSupabase();
  var item = await runQuery(client.from('shop_items')
    .select('item_id,item_name,cost,is_active')
    .eq('item_id', iid)
    .maybeSingle());
  if (!item || !item.is_active) {
    return { status: 'fail', msg: 'สินค้านี้ไม่มีในระบบหรือถูกปิดใช้งานแล้ว' };
  }
  var safeItemName = String(item.item_name || itemName || '').trim();
  var price = Number(item.cost) || 0;
  if (price <= 0) return { status: 'fail', msg: 'ราคาสินค้าไม่ถูกต้อง' };
  if (wallet.mathCoins < price) {
    return {
      status: 'fail',
      msg: 'เหรียญไม่เพียงพอ (มี ' + wallet.mathCoins + ' / ต้องการ ' + price + ')',
      mathCoins: wallet.mathCoins
    };
  }
  await runQuery(client.from('redemption_logs').insert([{
    timestamp: new Date().toISOString(),
    student_id: cid,
    item_id: iid,
    item_name: safeItemName,
    points_used: price,
    status: 'pending'
  }]));
  return {
    status: 'success',
    msg: 'ซื้อ "' + safeItemName + '" สำเร็จ! ใช้ไป ' + price + ' เหรียญ',
    mathCoins: wallet.mathCoins - price,
    lifetimeExp: wallet.lifetimeExp,
    pointsUsed: price,
    itemName: safeItemName
  };
}

async function grantFreeItemDb(studentIds, itemId, qty) {
  var ids = (studentIds || []).map(function(id) {
    return String(id || '').trim();
  }).filter(function(id, idx, arr) {
    return id && arr.indexOf(id) === idx;
  });
  var iid = String(itemId || '').trim();
  var amount = Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));
  if (!ids.length) return { status: 'fail', msg: 'กรุณาเลือกนักเรียนอย่างน้อย 1 คน' };
  if (!iid) return { status: 'fail', msg: 'กรุณาเลือกไอเทม' };

  var client = getSupabase();
  var item = await runQuery(client.from('shop_items')
    .select('item_id,item_name')
    .eq('item_id', iid)
    .maybeSingle());
  if (!item) return { status: 'fail', msg: 'ไม่พบไอเทมที่เลือก' };

  var nowIso = new Date().toISOString();
  var rows = [];
  ids.forEach(function(studentId) {
    for (var i = 0; i < amount; i++) {
      rows.push({
        timestamp: nowIso,
        student_id: studentId,
        item_id: item.item_id,
        item_name: item.item_name || '',
        points_used: 0,
        status: 'approved'
      });
    }
  });
  await runQuery(client.from('redemption_logs').insert(rows).select('id'));
  return {
    status: 'success',
    itemName: item.item_name || '',
    studentCount: ids.length,
    quantity: amount,
    rowCount: rows.length
  };
}

async function getRedemptionHistoryDb(studentId) {
  var client = getSupabase();
  var rows = await runQuery(client.from('redemption_logs')
    .select('timestamp,item_name,points_used,status')
    .eq('student_id', String(studentId).trim())
    .order('timestamp', { ascending: false })
    .limit(50));
  return (rows || []).map(function(r) {
    return {
      date: formatDateTime(r.timestamp),
      itemName: String(r.item_name || '').trim(),
      cost: Number(r.points_used) || 0,
      status: String(r.status || 'pending').trim()
    };
  });
}

async function getAllRedemptionsForTeacherDb() {
  var client = getSupabase();
  var orders = await runQuery(client.from('redemption_logs')
    .select('id,timestamp,student_id,item_id,item_name,points_used,status')
    .order('timestamp', { ascending: false }));
  var students = await runQuery(client.from('students').select('id,name'));
  var nameMap = {};
  (students || []).forEach(function(st) { nameMap[st.id] = st.name || st.id; });
  return (orders || []).map(function(row) {
    return {
      rowIndex: row.id,
      timestamp: safeDate(row.timestamp) ? safeDate(row.timestamp).getTime() : 0,
      date: formatDateTime(row.timestamp),
      studentId: row.student_id,
      studentName: nameMap[row.student_id] || row.student_id,
      itemId: String(row.item_id || '').trim(),
      itemName: String(row.item_name || '').trim(),
      cost: Number(row.points_used) || 0,
      isFreeGrant: (Number(row.points_used) || 0) === 0,
      status: String(row.status || 'pending').trim()
    };
  });
}

async function getRewardRedemptionReportDb(grade) {
  var client = getSupabase();
  var targetGrade = normalizeGrade(grade);
  var studentsQuery = client.from('students')
    .select('id,name,grade')
    .order('id', { ascending: true });
  if (targetGrade && targetGrade !== 'all') {
    studentsQuery = studentsQuery.eq('grade', targetGrade);
  }
  var students = await runQuery(studentsQuery);
  var studentMap = {};
  var studentIds = [];
  (students || []).forEach(function(st) {
    studentMap[st.id] = {
      id: st.id,
      name: st.name || '',
      grade: st.grade || ''
    };
    studentIds.push(st.id);
  });
  if (!studentIds.length) return [];

  var orders = await runQuery(client.from('redemption_logs')
    .select('id,timestamp,student_id,item_id,item_name,points_used,status')
    .in('student_id', studentIds)
    .order('timestamp', { ascending: false }));
  var rows = (orders || []).map(function(row) {
    var st = studentMap[row.student_id] || {};
    return {
      rowIndex: row.id,
      studentId: row.student_id || '',
      studentName: st.name || row.student_id || '',
      grade: st.grade || '',
      itemId: String(row.item_id || '').trim(),
      itemName: String(row.item_name || '').trim(),
      cost: Number(row.points_used) || 0,
      timestamp: safeDate(row.timestamp) ? safeDate(row.timestamp).getTime() : 0,
      date: formatDateTime(row.timestamp),
      status: String(row.status || 'pending').trim()
    };
  });
  return groupRewardRedemptionRows(rows);
}

function groupRewardRedemptionRows(rows) {
  var studentMap = {};
  var groupSeq = 1;
  (rows || []).forEach(function(row) {
    var sid = row.studentId || '';
    if (!studentMap[sid]) {
      studentMap[sid] = {
        studentId: sid,
        studentName: row.studentName || sid,
        grade: row.grade || '',
        items: [],
        itemMap: {},
        totalQty: 0
      };
    }
    var student = studentMap[sid];
    var itemKey = row.itemId || row.itemName || 'unknown';
    if (!student.itemMap[itemKey]) {
      student.itemMap[itemKey] = {
        groupId: groupSeq++,
        rowIds: [],
        itemId: row.itemId || '',
        itemName: row.itemName || 'ไม่ระบุของรางวัล',
        quantity: 0,
        totalCost: 0,
        paidQty: 0,
        freeQty: 0,
        latestTimestamp: 0,
        latestDate: '',
        statusCounts: { pending: 0, approved: 0, rejected: 0 },
        status: 'pending'
      };
      student.items.push(student.itemMap[itemKey]);
    }
    var item = student.itemMap[itemKey];
    item.rowIds.push(row.rowIndex);
    item.quantity++;
    var rowCost = Number(row.cost) || 0;
    item.totalCost += rowCost;
    if (rowCost > 0) item.paidQty++;
    else item.freeQty++;
    if (row.timestamp >= item.latestTimestamp) {
      item.latestTimestamp = row.timestamp;
      item.latestDate = row.date || '';
    }
    var st = ['pending', 'approved', 'rejected'].indexOf(row.status) === -1 ? 'pending' : row.status;
    item.statusCounts[st]++;
    student.totalQty++;
  });
  return Object.keys(studentMap).map(function(sid) {
    var student = studentMap[sid];
    delete student.itemMap;
    student.items.forEach(function(item) {
      var activeStatuses = Object.keys(item.statusCounts).filter(function(st) {
        return item.statusCounts[st] > 0;
      });
      item.status = activeStatuses.length === 1 ? activeStatuses[0] : 'mixed';
      if (item.paidQty > 0 && item.freeQty > 0) {
        item.sourceText = 'ผสม: แลก ' + item.paidQty + ' / ครูมอบ ' + item.freeQty;
      } else if (item.freeQty > 0) {
        item.sourceText = 'ครูมอบให้';
      } else {
        item.sourceText = 'แลกด้วยเหรียญ';
      }
    });
    student.items.sort(function(a, b) {
      return b.latestTimestamp - a.latestTimestamp || a.itemName.localeCompare(b.itemName, 'th');
    });
    return student;
  }).sort(function(a, b) {
    return String(a.grade).localeCompare(String(b.grade), 'th') ||
      String(a.studentId).localeCompare(String(b.studentId), 'th');
  });
}

async function updateRedemptionStatusByRowDb(rowId, newStatus) {
  if (['approved', 'rejected', 'pending'].indexOf(newStatus) === -1) {
    return { status: 'fail', msg: 'สถานะไม่ถูกต้อง' };
  }
  var client = getSupabase();
  await runQuery(client.from('redemption_logs')
    .update({ status: newStatus })
    .eq('id', Number(rowId))
    .select('id'));
  return { status: 'success' };
}

async function updateRedemptionStatusByIdsDb(rowIds, newStatus) {
  if (['approved', 'rejected', 'pending'].indexOf(newStatus) === -1) {
    return { status: 'fail', msg: 'สถานะไม่ถูกต้อง' };
  }
  var ids = (rowIds || []).map(function(id) { return Number(id); }).filter(function(id) { return !isNaN(id); });
  if (!ids.length) return { status: 'fail', msg: 'ไม่พบรายการที่ต้องอัปเดต' };
  var client = getSupabase();
  await runQuery(client.from('redemption_logs')
    .update({ status: newStatus })
    .in('id', ids)
    .select('id'));
  return { status: 'success' };
}

async function getGradeWalletSummaryDb(grade) {
  var students = await runQuery(getSupabase().from('students')
    .select('id,name')
    .eq('grade', normalizeGrade(grade))
    .order('name', { ascending: true }));
  var rows = await Promise.all(students.map(async function(st) {
    var w = await getWalletBalanceDb(st.id);
    return {
      id: st.id,
      name: st.name || '',
      mathCoins: w.mathCoins,
      lifetimeExp: w.lifetimeExp
    };
  }));
  return rows.sort(function(a, b) { return b.mathCoins - a.mathCoins; });
}

/* ══ App Init ════════════════════════════════════════ */
window.addEventListener('load', async function() {
  var el = document.getElementById('manDate');
  if (el) el.value = dateKeyBangkok(new Date());
  var manGrade = document.getElementById('manGrade');
  var histGrade = document.getElementById('histGrade');
  if (manGrade && histGrade) histGrade.innerHTML = manGrade.innerHTML;
  if (!isSupabaseConfigured()) {
    showConfigAlert();
    return;
  }
  try {
    applyAppSettings(await getAppSettingsDb());
  } catch (e) {
    console.warn(e);
  }
});

function applyAppSettings(s) {
  if (!s) return;
  appSettings = s;
  if (s.accentColor && s.accentColor !== '#4f46e5') {
    document.documentElement.style.setProperty('--pri', s.accentColor);
    document.documentElement.style.setProperty('--pri-l', s.accentColor + '99');
  }
  document.getElementById('loginAppName').textContent = s.appName || 'ระบบเช็คชื่อนักเรียน';
  document.getElementById('loginSchoolName').textContent = s.schoolName || 'กุงแก้ววิทยาคาร';
  if (s.logoBase64) {
    var w = document.getElementById('loginLogoWrap');
    w.innerHTML = '<img src="' + s.logoBase64 + '" class="login-logo" alt="logo">';
  }
  document.title = s.appName || 'ระบบเช็คชื่อนักเรียน';
  if (document.getElementById('tHdrSchool')) {
    document.getElementById('tHdrSchool').textContent = s.schoolName || 'กุงแก้ววิทยาคาร';
  }
  if (s.logoBase64 && document.getElementById('tHdrLogo')) {
    document.getElementById('tHdrLogo').innerHTML = '<img src="' + s.logoBase64 + '" style="width:26px;height:26px;border-radius:6px;object-fit:cover">';
  }
}

/* ══ Login ═══════════════════════════════════════════ */
async function login() {
  var u = document.getElementById('username').value.trim();
  var p = document.getElementById('password').value.trim();
  if (!u || !p) {
    return Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณากรอกข้อมูลให้ครบ', confirmButtonColor: '#4f46e5' });
  }
  loading('กำลังตรวจสอบ...');
  try {
    var res = await verifyLoginDb(u, p);
    Swal.close();
    if (res.status === 'success') {
      CU = res;
      document.getElementById('loginSection').classList.add('hidden');
      if (res.role === 'TEACHER') {
        document.getElementById('teacherSection').classList.remove('hidden');
        document.getElementById('tNameDisp').textContent = res.name;
        if (document.getElementById('printTeacher')) document.getElementById('printTeacher').textContent = res.name;
        document.getElementById('printSchoolName').textContent = appSettings.schoolName || 'โรงเรียนกุงแก้ววิทยาคาร';
        applyAppSettings(appSettings);
        await loadCurrentSession();
        await loadSettings();
        await loadTeacherShopItems();
        startPasswordResetDashboard();
      } else {
        document.getElementById('studentSection').classList.remove('hidden');
        document.getElementById('sNameDisp').textContent = res.name;
        document.getElementById('sGradeDisp').textContent = 'ชั้น ' + res.grade;
        /* ── First-login: บังคับเปลี่ยนรหัสผ่านก่อนใช้งาน ── */
        if (res.isFirstLogin) {
          await forceChangePassword(res.id);
        }
        await loadStudentProfile();
        shopWallet = await getWalletBalanceDb(CU.id);
        updateShopCoinsBadge(shopWallet.mathCoins);
      }
    } else {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: res.message, confirmButtonColor: '#4f46e5' });
    }
  } catch (e) {
    onErr(e);
  }
}

/* ══ Student Profile + Gamification ═════════════════ */
async function loadStudentProfile() {
  try {
    var d = await getStudentProfileDb(CU.id);
    if (!d) return;
    if (d.photo) document.getElementById('studentPhoto').src = d.photo;
    updateGamiUI({ totalPoints: d.totalPoints, level: d.level, pointsInLevel: d.pointsInLevel });
  } catch (e) {
    await loadStudentGami();
  }
}

async function loadStudentGami() {
  try {
    updateGamiUI(await getStudentPointsAndLevelDb(CU.id));
  } catch (e) {}
}

function updateGamiUI(d) {
  var pts = d.totalPoints || 0, lv = d.level || 0, pip = d.pointsInLevel || 0;
  var tier = Math.min(Math.floor(lv / 10), 4);
  var pct = Math.round((pip / 5) * 100);

  var section = document.getElementById('studentSection');
  if (section && section.getAttribute('data-tier') !== String(tier)) {
    section.setAttribute('data-tier', String(tier));
  }

  var lvNum = document.getElementById('lvNum');
  if (lvNum && lvNum.textContent !== String(lv)) lvNum.textContent = lv;

  var ring = document.getElementById('levelRing');
  if (ring && ring.style.getPropertyValue('--pct') !== pct + '%') {
    ring.style.setProperty('--pct', pct + '%');
  }

  var xpFill = document.getElementById('xpFill');
  if (xpFill) xpFill.style.transform = 'scaleX(' + (pct / 100) + ')';

  var xpLabel = document.getElementById('xpLabel');
  var xpText = pip + ' / 5 XP';
  if (xpLabel && xpLabel.textContent !== xpText) xpLabel.textContent = xpText;

  var ptLabel = document.getElementById('ptLabel');
  var ptText = 'แต้มรวม ' + pts;
  if (ptLabel && ptLabel.textContent !== ptText) ptLabel.textContent = ptText;

  var trophies = updateGamiUI._trophies || (updateGamiUI._trophies = Array.prototype.slice.call(document.querySelectorAll('.trophy')));
  trophies.forEach(function(el) {
    el.classList.toggle('earned', lv >= parseInt(el.dataset.t || '0', 10));
  });

  var lc = document.getElementById('levelCard');
  if (lc) lc.style.cssText = tier >= 1 ? 'background:transparent;box-shadow:none' : '';
}

function openPhotoUpload() {
  document.getElementById('photoInput').click();
}

async function handlePhotoChange(event) {
  var file = event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    event.target.value = '';
    return Swal.fire({ icon: 'warning', title: 'ไฟล์ใหญ่เกินไป', text: 'กรุณาเลือกรูปที่เล็กกว่า 5MB' });
  }
  try {
    loading('กำลังอัปโหลดรูปโปรไฟล์...');
    var uploaded = await uploadCompressedImage(file, {
      folder: 'students/' + CU.id,
      maxWidth: 160,
      maxHeight: 160,
      quality: 0.75
    });
    await saveProfilePictureDb(CU.id, uploaded.publicUrl);
    document.getElementById('studentPhoto').src = uploaded.publicUrl;
    Swal.fire({ icon: 'success', title: 'บันทึกรูปแล้ว', timer: 1500, timerProgressBar: true, confirmButtonColor: '#4f46e5' });
  } catch (e) {
    onErr(e);
  } finally {
    event.target.value = '';
  }
}

async function checkIn() {
  var pin = document.getElementById('pinCode').value.trim();
  if (pin.length !== 4) {
    return Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณาระบุ PIN 4 หลัก', confirmButtonColor: '#4f46e5' });
  }
  loading('กำลังบันทึก...');
  try {
    var res = await submitCheckInDb(CU.id, pin);
    if (res.result === 'success') {
      var pts = res.points || 0;
      Swal.fire({
        icon: 'success',
        title: 'สำเร็จ ✅',
        text: pts > 0 ? 'ได้รับ +' + pts + ' คะแนน 🎉' : 'เช็คชื่อเรียบร้อย',
        confirmButtonColor: '#10b981',
        timer: 2200,
        timerProgressBar: true
      });
      document.getElementById('pinCode').value = '';
      setTimeout(async function() {
        try {
          var d = await getStudentPointsAndLevelDb(CU.id);
          var old = parseInt(document.getElementById('lvNum').textContent, 10) || 0;
          updateGamiUI(d);
          if (d.level > old) {
            var rng = document.getElementById('levelRing');
            rng.classList.add('lv-up-anim');
            setTimeout(function() { rng.classList.remove('lv-up-anim'); }, 600);
          }
        } catch (e) {}
      }, 900);
    } else {
      Swal.fire({
        icon: res.result === 'duplicate' ? 'info' : 'error',
        title: res.result === 'duplicate' ? 'เรียบร้อยแล้ว' : 'ผิดพลาด',
        text: res.msg,
        confirmButtonColor: '#4f46e5'
      });
    }
  } catch (e) {
    onErr(e);
  }
}

async function submitCheckIn() {
  return checkIn();
}

function refreshStudentData() {
  if (refreshCooldown) return;
  refreshCooldown = true;
  var btn = document.getElementById('refreshBtn');
  var icon = document.getElementById('refreshIcon');
  var lbl = document.getElementById('refreshLabel');
  icon.className = 'fa-solid fa-rotate-right fa-spin';
  btn.disabled = true;
  loadStudentProfile();
  var secs = 30;
  lbl.textContent = 'รอ ' + secs + 's';
  var t = setInterval(function() {
    secs--;
    if (secs <= 0) {
      clearInterval(t);
      icon.className = 'fa-solid fa-rotate-right';
      lbl.textContent = 'รีเฟรช';
      btn.disabled = false;
      refreshCooldown = false;
    } else {
      lbl.textContent = 'รอ ' + secs + 's';
    }
  }, 1000);
}

async function showStudentHistory() {
  loading('กำลังโหลด...');
  try {
    var logs = await getStudentHistoryDb(CU.id, 'all');
    var bc = function(s) { return s === 'มา' ? '#10b981' : (s === 'ขาด' ? '#ef4444' : '#f59e0b'); };
    var pts = function(l) {
      return l.points > 0
        ? '<span style="background:#eff6ff;color:#4f46e5;border-radius:5px;padding:1px 6px;font-size:.69rem;font-weight:700">+' + l.points + 'pt</span>'
        : '';
    };
    var html = logs.length ? logs.map(function(l) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 9px;border-radius:9px;margin-bottom:4px;background:#f8fafc">'
        + '<span style="font-size:.78rem;color:#64748b">' + l.date + '</span>'
        + '<div style="display:flex;gap:5px;align-items:center">' + pts(l)
        + '<span style="background:' + bc(l.status) + ';color:#fff;padding:2px 9px;border-radius:999px;font-size:.74rem;font-weight:700">' + l.status + '</span>'
        + '</div></div>';
    }).join('') : '<div style="text-align:center;color:#94a3b8;padding:16px">ไม่มีข้อมูล</div>';
    Swal.fire({
      title: 'ประวัติ ' + CU.name,
      html: '<div style="max-height:65vh;overflow-y:auto">' + html + '</div>',
      confirmButtonColor: '#4f46e5',
      width: 400
    });
  } catch (e) {
    onErr(e);
  }
}

/* ══ Teacher Tabs ════════════════════════════════════ */
function switchTab(name, btn) {
  document.querySelectorAll('.t-pane').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.tn').forEach(function(b) { b.classList.remove('active'); });
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'stats') loadStats();
  if (name === 'pin') loadPasswordResetRequests();
  if (name === 'shop') loadTeacherShopItems();
  if (name === 'reward-report') loadRewardReport();
}

/* ══ Teacher Session ═════════════════════════════════ */
async function loadCurrentSession() {
  try {
    var res = await getCurrentSessionStatusDb();
    var bar = document.getElementById('sessBar');
    var txt = document.getElementById('sessText');
    var dot = document.getElementById('sessDot');
    if (res && res.active) {
      if (res.expired) {
        bar.className = 'sess-bar expired';
        dot.textContent = '⚠️';
        txt.textContent = 'คาบชั้น ' + res.grade + ' หมดอายุแล้ว (PIN: ' + res.pin + ') — กรุณาปิดคาบ';
      } else {
        bar.className = 'sess-bar open';
        dot.innerHTML = '<span class="pulse"></span>';
        txt.textContent = 'คาบ: ' + res.grade + ' | PIN: ' + res.pin + ' | หมดอายุ ' + res.expiry + ' น.';
        document.getElementById('displayPIN').textContent = res.pin;
        document.getElementById('expiryLabel').textContent = 'หมดอายุ ' + res.expiry + ' น.';
        document.getElementById('pinGradeLabel').textContent = 'ชั้น ' + res.grade;
      }
    } else {
      bar.className = 'sess-bar closed';
      dot.textContent = '—';
      txt.textContent = 'ยังไม่มีคาบเรียนที่เปิดอยู่';
    }
  } catch (e) {}
}

async function generatePIN() {
  var g = document.getElementById('targetGrade').value;
  if (!g) return Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณาเลือกระดับชั้น', confirmButtonColor: '#4f46e5' });
  loading('กำลังสร้างรหัส...');
  try {
    var res = await generateNewPINDb(g);
    Swal.close();
    if (res.status === 'success') {
      document.getElementById('displayPIN').textContent = res.pin;
      document.getElementById('expiryLabel').textContent = 'หมดอายุ ' + res.expiry + ' น.';
      document.getElementById('pinGradeLabel').textContent = 'ชั้น ' + g;
      await loadCurrentSession();
    } else {
      Swal.fire({
        icon: res.status === 'active' ? 'warning' : 'error',
        title: res.status === 'active' ? 'ยังมีคาบเปิดอยู่' : 'ผิดพลาด',
        text: res.message,
        confirmButtonColor: res.status === 'active' ? '#f59e0b' : '#ef4444'
      });
    }
  } catch (e) {
    onErr(e);
  }
}

async function closeSession() {
  loading('กำลังโหลดรายชื่อนักเรียน...');
  try {
    var pending = await getPendingCloseSessionStudentsDb();
    Swal.close();
    if (pending.status !== 'success') {
      return Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: pending.msg || '', confirmButtonColor: '#ef4444' });
    }
    var rows = (pending.students || []).map(function(st, i) {
      return '<tr>'
        + '<td class="text-muted">' + (i + 1) + '</td>'
        + '<td class="text-start"><div class="fw-bold">' + escHtml(st.name) + '</div><small class="text-muted">' + escHtml(st.id) + ' | ' + escHtml(st.grade) + '</small></td>'
        + '<td style="width:110px"><select class="form-select form-select-sm close-status" data-sid="' + escHtml(st.id) + '">'
        + '<option value="ขาด">ขาด</option>'
        + '<option value="ลา">ลา</option>'
        + '</select></td>'
        + '</tr>';
    }).join('');
    var html = pending.students.length
      ? '<div class="text-start mb-2" style="font-size:.84rem;color:#64748b">คาบชั้น ' + escHtml(pending.grade) + ' | นักเรียนที่ยังไม่เช็คชื่อ ' + pending.students.length + ' คน</div>'
        + '<div style="max-height:55vh;overflow:auto;border:1px solid #e5e7eb;border-radius:12px">'
        + '<table class="table table-sm align-middle mb-0"><thead class="table-light"><tr><th>#</th><th class="text-start">นักเรียน</th><th>สถานะ</th></tr></thead><tbody>'
        + rows + '</tbody></table></div>'
      : '<div class="text-center py-3"><div class="fw-bold mb-1">นักเรียนทุกคนเช็คชื่อแล้ว</div><div class="text-muted">กดยืนยันเพื่อปิดคาบและลบ PIN</div></div>';
    var r = await Swal.fire({
      icon: 'warning',
      title: 'ปิดคาบเรียน?',
      html: html,
      width: 720,
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'บันทึกและปิดคาบ',
      cancelButtonText: 'ยกเลิก',
      focusConfirm: false,
      preConfirm: function() {
        var selects = Swal.getPopup().querySelectorAll('.close-status');
        return Array.prototype.map.call(selects, function(sel) {
          return { studentId: sel.dataset.sid, status: sel.value };
        });
      }
    });
    if (!r.isConfirmed) return;
    loading('กำลังบันทึกและปิดคาบ...');
    var res = await closeAttendanceAndMarkAbsentDb(r.value || []);
    Swal.close();
    if (res.status === 'success') {
      Swal.fire({ icon: 'success', title: 'สำเร็จ', text: res.msg, confirmButtonColor: '#4f46e5' });
      document.getElementById('displayPIN').textContent = '- - - -';
      document.getElementById('expiryLabel').textContent = '';
      document.getElementById('pinGradeLabel').textContent = '';
      await loadCurrentSession();
      if (statsLoaded) await loadStats();
    } else {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: res.msg || '', confirmButtonColor: '#ef4444' });
    }
  } catch (e) {
    onErr(e);
  }
}

/* ══ Stats & Charts ══════════════════════════════════ */
async function loadStats() {
  var g = document.getElementById('statGrade') && document.getElementById('statGrade').value;
  var m = document.getElementById('statMonth') && document.getElementById('statMonth').value;
  if (!g || !m) return;
  statsLoaded = true;
  document.getElementById('statsSpinner').classList.remove('hidden');
  document.getElementById('statsTbody').innerHTML = '';
  try {
    var data = await getAttendanceStatsDb(g, m);
    document.getElementById('statsSpinner').classList.add('hidden');
    statsCache = data;
    renderSummary(data);
    renderTable(data);
    renderDonut(data);
    var cd = await getDashboardChartDataDb(g);
    renderBar(cd.months);
  } catch (e) {
    document.getElementById('statsSpinner').classList.add('hidden');
    onErr(e);
  }
}

function renderSummary(data) {
  var tot = data.length, pre = 0, abs = 0, lv = 0;
  data.forEach(function(s) { pre += s.present; abs += s.absent; lv += s.leave; });
  var all = pre + abs + lv, rate = all > 0 ? Math.round(pre / all * 100) : 0;
  document.getElementById('summaryCards').innerHTML =
    '<div class="col-6 col-md-3"><div class="stat-card sc-b"><div class="ico"><i class="fa-solid fa-users"></i></div><div><div class="val">' + tot + '</div><div class="lbl">นักเรียน</div></div></div></div>'
    + '<div class="col-6 col-md-3"><div class="stat-card sc-g"><div class="ico"><i class="fa-solid fa-circle-check"></i></div><div><div class="val">' + pre + '</div><div class="lbl">มา (ครั้ง)</div></div></div></div>'
    + '<div class="col-6 col-md-3"><div class="stat-card sc-r"><div class="ico"><i class="fa-solid fa-circle-xmark"></i></div><div><div class="val">' + abs + '</div><div class="lbl">ขาด (ครั้ง)</div></div></div></div>'
    + '<div class="col-6 col-md-3"><div class="stat-card sc-y"><div class="ico"><i class="fa-solid fa-percent"></i></div><div><div class="val">' + rate + '%</div><div class="lbl">อัตราเข้าเรียน</div></div></div></div>';
}

function renderTable(data) {
  var m = document.getElementById('statMonth');
  var mt = m ? m.options[m.selectedIndex].text : 'ทั้งหมด';
  if (!data.length) {
    document.getElementById('statsTbody').innerHTML = '<tr><td colspan="7" class="text-center py-4" style="color:var(--muted)">ไม่พบข้อมูล</td></tr>';
    return;
  }
  document.getElementById('statsTbody').innerHTML = data.map(function(s) {
    var lv = s.level || 0, tier = Math.min(Math.floor(lv / 10), 4);
    var lvBadge = '<span class="lv-banner lv-t' + tier + '"><i class="fa-solid fa-star" style="font-size:.65rem"></i>Lv.' + lv + '</span>';
    return '<tr>'
      + '<td style="color:#94a3b8;font-size:.78rem">' + s.id + '</td>'
      + '<td class="fw-bold" style="font-size:.87rem">' + s.name + '</td>'
      + '<td>' + lvBadge + '</td>'
      + '<td class="text-center"><span class="pill p-g">' + s.present + '</span></td>'
      + '<td class="text-center"><span class="pill p-r">' + s.absent + '</span></td>'
      + '<td class="text-center"><span class="pill p-y">' + s.leave + '</span></td>'
      + '<td class="text-center no-print"><button class="btn btn-sm fw-bold" '
      + 'style="background:#eff6ff;color:#4f46e5;border-radius:8px;font-size:.76rem" '
      + 'onclick="showHistory(\'' + s.id + '\',\'' + mt + '\')"><i class="fa-solid fa-clock-rotate-left me-1"></i>ประวัติ</button></td></tr>';
  }).join('');
}

function renderDonut(data) {
  var pre = 0, abs = 0, lv = 0;
  data.forEach(function(s) { pre += s.present; abs += s.absent; lv += s.leave; });
  var all = pre + abs + lv;
  var ctx = document.getElementById('chartDonut').getContext('2d');
  if (cDonut) { cDonut.destroy(); cDonut = null; }
  cDonut = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['มา', 'ขาด', 'ลา'],
      datasets: [{
        data: [pre, abs, lv],
        backgroundColor: ['#10b981', '#ef4444', '#f59e0b'],
        borderWidth: 3,
        borderColor: '#fff',
        hoverBorderWidth: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(c) {
              var pct = all > 0 ? Math.round(c.raw / all * 100) : 0;
              return ' ' + c.label + ': ' + c.raw + ' ครั้ง (' + pct + '%)';
            }
          }
        }
      }
    }
  });
  var p0 = all > 0 ? Math.round(pre / all * 100) : 0;
  var p1 = all > 0 ? Math.round(abs / all * 100) : 0;
  var p2 = all > 0 ? Math.round(lv / all * 100) : 0;
  document.getElementById('donutLeg').innerHTML =
    '<span style="color:#10b981">●มา ' + p0 + '%</span>'
    + '<span style="color:#ef4444">●ขาด ' + p1 + '%</span>'
    + '<span style="color:#f59e0b">●ลา ' + p2 + '%</span>';
}

function renderBar(months) {
  var last = months.slice(-6);
  var labels = last.map(function(m) {
    var p = m.month.split('-');
    return (TH_MO_S[parseInt(p[1], 10)] || m.month) + "'" + p[0].slice(2);
  });
  var ctx = document.getElementById('chartBar').getContext('2d');
  if (cBar) { cBar.destroy(); cBar = null; }
  cBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: 'มา', data: last.map(function(m) { return m.present; }), backgroundColor: 'rgba(16,185,129,.75)', borderRadius: 6, borderSkipped: false },
        { label: 'ขาด', data: last.map(function(m) { return m.absent; }), backgroundColor: 'rgba(239,68,68,.72)', borderRadius: 6, borderSkipped: false },
        { label: 'ลา', data: last.map(function(m) { return m.leave; }), backgroundColor: 'rgba(245,158,11,.72)', borderRadius: 6, borderSkipped: false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

async function showHistory(id, mt) {
  var m = document.getElementById('statMonth') ? document.getElementById('statMonth').value : 'all';
  loading('กำลังโหลด...');
  try {
    var pair = await Promise.all([
      getStudentProfileDb(id),
      getStudentHistoryDb(id, m)
    ]);
    var profileData = pair[0];
    var histData = pair[1];
    var lv = profileData ? profileData.level : 0;
    var tier = Math.min(Math.floor(lv / 10), 4);
    var lvHtml = profileData ? '<div class="text-center mb-2"><span class="lv-banner lv-t' + tier + '"><i class="fa-solid fa-star" style="font-size:.65rem"></i>Lv.' + lv + ' | ' + profileData.totalPoints + ' XP</span></div>' : '';
    var bc = function(s) { return s === 'มา' ? '#10b981' : (s === 'ขาด' ? '#ef4444' : '#f59e0b'); };
    var pts = function(l) {
      return l.points > 0 ? '<span style="background:#eff6ff;color:#4f46e5;border-radius:5px;padding:1px 6px;font-size:.68rem;font-weight:700">+' + l.points + 'pt</span>' : '';
    };
    var html = histData.length ? histData.map(function(l) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 9px;border-radius:9px;margin-bottom:4px;background:#f8fafc">'
        + '<span style="font-size:.79rem;color:#64748b">' + l.date + '</span>'
        + '<div style="display:flex;gap:5px;align-items:center">' + pts(l)
        + '<span style="background:' + bc(l.status) + ';color:#fff;padding:2px 9px;border-radius:999px;font-size:.74rem;font-weight:700">' + l.status + '</span>'
        + '</div></div>';
    }).join('') : '<div style="text-align:center;color:#94a3b8;padding:14px">ไม่มีข้อมูล</div>';
    Swal.fire({
      title: 'ประวัติ รหัส ' + id,
      html: lvHtml + '<p style="color:#94a3b8;font-size:.76rem;margin-bottom:6px">เดือน: ' + (mt || 'ทั้งหมด') + '</p><div style="max-height:55vh;overflow-y:auto">' + html + '</div>',
      confirmButtonColor: '#4f46e5',
      width: 420
    });
  } catch (e) {
    onErr(e);
  }
}

/* ══ Export ══════════════════════════════════════════ */
function getExportData() {
  var g = document.getElementById('statGrade') ? document.getElementById('statGrade').value : '';
  var m = document.getElementById('statMonth') ? document.getElementById('statMonth').value : 'all';
  var mo = document.getElementById('statMonth');
  var mt = mo ? mo.options[mo.selectedIndex].text : 'ทั้งหมด';
  return { g: g, m: m, mt: mt, data: statsCache };
}

function exportCSV() {
  var ex = getExportData();
  if (!ex.data || !ex.data.length) return Swal.fire({ icon: 'info', title: 'ไม่มีข้อมูล', text: 'กรุณาโหลดสถิติก่อน' });
  var rows = [['#', 'รหัส', 'ชื่อ-นามสกุล', 'Level', 'มา', 'ขาด', 'ลา']];
  ex.data.forEach(function(s, i) { rows.push([i + 1, s.id, s.name, s.level || 0, s.present, s.absent, s.leave]); });
  var csv = rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
  var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href = url;
  a.download = 'attendance_' + ex.g + '_' + ex.mt + '_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

function exportExcel() {
  if (typeof XLSX === 'undefined') return Swal.fire({ icon: 'error', title: 'โหลด Library ไม่สำเร็จ' });
  var ex = getExportData();
  if (!ex.data || !ex.data.length) return Swal.fire({ icon: 'info', title: 'ไม่มีข้อมูล', text: 'กรุณาโหลดสถิติก่อน' });
  var now = new Date().toLocaleDateString('th-TH');
  var header = [['#', 'รหัส', 'ชื่อ-นามสกุล', 'Level', 'XP รวม', 'มา (ครั้ง)', 'ขาด (ครั้ง)', 'ลา (ครั้ง)']];
  var body = ex.data.map(function(s, i) { return [i + 1, s.id, s.name, s.level || 0, s.totalPoints || 0, s.present, s.absent, s.leave]; });
  var ws = XLSX.utils.aoa_to_sheet([['รายงานการเข้าเรียน'], ['ชั้น: ' + ex.g + ' | เดือน: ' + ex.mt + ' | วันที่พิมพ์: ' + now], [[]]].concat(header, body));
  ws['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'สถิติ');
  XLSX.writeFile(wb, 'attendance_' + ex.g + '_' + ex.mt + '.xlsx');
}

function exportPDF() {
  var ex = getExportData();
  if (!ex.data || !ex.data.length) return Swal.fire({ icon: 'info', title: 'ไม่มีข้อมูล', text: 'กรุณาโหลดสถิติก่อน' });
  var now = formatThaiLongDate(new Date());
  document.getElementById('printSubtitle').textContent = 'รายห้อง: ชั้น ' + ex.g + ' | เดือน: ' + ex.mt;
  document.getElementById('printDate').textContent = 'พิมพ์วันที่ ' + now;
  document.getElementById('printSchoolName').textContent = appSettings.schoolName || 'โรงเรียนกุงแก้ววิทยาคาร';
  document.getElementById('printHead').innerHTML = '<tr><th>#</th><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>Level</th><th>มา</th><th>ขาด</th><th>ลา</th></tr>';
  document.getElementById('printBody').innerHTML = ex.data.map(function(s, i) {
    return '<tr><td>' + (i + 1) + '</td><td>' + s.id + '</td><td class="text-start">' + s.name + '</td><td>Lv.' + (s.level || 0) + '</td><td>' + s.present + '</td><td>' + s.absent + '</td><td>' + s.leave + '</td></tr>';
  }).join('');
  setTimeout(function() { window.print(); }, 300);
}

async function preparePDF(type, id) {
  var m = document.getElementById('statMonth');
  var mt = m ? m.options[m.selectedIndex].text : 'ทั้งหมด';
  var now = formatThaiLongDate(new Date());
  document.getElementById('printDate').textContent = 'พิมพ์วันที่ ' + now;
  document.getElementById('printSchoolName').textContent = appSettings.schoolName || 'โรงเรียนกุงแก้ววิทยาคาร';
  loading('กำลังเตรียมเอกสาร...');
  if (type === 'single' && id) {
    document.getElementById('printSubtitle').textContent = 'รายบุคคล รหัส: ' + id + ' | เดือน: ' + mt;
    try {
      var logs = await getStudentHistoryDb(id, m ? m.value : 'all');
      if (!logs.length) return Swal.fire({ icon: 'info', title: 'ไม่พบข้อมูล' });
      document.getElementById('printHead').innerHTML = '<tr><th>#</th><th>วันที่</th><th>สถานะ</th><th>คะแนน</th></tr>';
      document.getElementById('printBody').innerHTML = logs.map(function(l, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + l.date + '</td><td>' + l.status + '</td><td>' + (l.points > 0 ? '+' + l.points : '—') + '</td></tr>';
      }).join('');
      Swal.close();
      setTimeout(function() { window.print(); }, 400);
    } catch (e) {
      onErr(e);
    }
  }
}

function promptIndividualPDF() {
  var statGrade = document.getElementById('statGrade');
  var gradeOptions = statGrade ? statGrade.innerHTML : '<option value="">-- เลือกชั้น --</option>';
  Swal.fire({
    title: 'พิมพ์รายงานรายบุคคล',
    html: '<div class="text-start">'
      + '<label class="form-label">ระดับชั้น</label>'
      + '<select id="pdfGrade" class="form-select mb-3">' + gradeOptions + '</select>'
      + '<label class="form-label">นักเรียน</label>'
      + '<select id="pdfStudent" class="form-select" disabled><option value="">-- เลือกชั้นก่อน --</option></select>'
      + '</div>',
    showCancelButton: true,
    confirmButtonText: 'พิมพ์',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#4f46e5',
    width: 520,
    focusConfirm: false,
    didOpen: function() {
      var gradeEl = document.getElementById('pdfGrade');
      var studentEl = document.getElementById('pdfStudent');
      var currentGrade = statGrade ? statGrade.value : '';
      if (currentGrade) gradeEl.value = currentGrade;
      var loadStudents = async function() {
        var g = gradeEl.value;
        studentEl.disabled = true;
        studentEl.innerHTML = '<option value="">-- กำลังโหลด... --</option>';
        if (!g) {
          studentEl.innerHTML = '<option value="">-- เลือกชั้นก่อน --</option>';
          return;
        }
        try {
          var students = await getStudentsInGradeDb(g);
          studentEl.innerHTML = '<option value="">-- เลือกนักเรียน --</option>' + students.map(function(s) {
            return '<option value="' + escHtml(s.id) + '">' + escHtml(s.id) + ' - ' + escHtml(s.name) + '</option>';
          }).join('');
          studentEl.disabled = false;
        } catch (e) {
          studentEl.innerHTML = '<option value="">โหลดรายชื่อไม่สำเร็จ</option>';
        }
      };
      gradeEl.addEventListener('change', loadStudents);
      loadStudents();
    },
    preConfirm: function() {
      var sid = document.getElementById('pdfStudent').value;
      if (!sid) {
        Swal.showValidationMessage('กรุณาเลือกนักเรียน');
        return false;
      }
      return sid;
    }
  }).then(function(r) {
    if (r.isConfirmed && r.value) preparePDF('single', r.value);
  });
}

/* ══ Manual Check-in ═════════════════════════════════ */
function resetAddStudentForm() {
  document.getElementById('newStudentId').value = '';
  document.getElementById('newStudentName').value = '';
  document.getElementById('newStudentGrade').value = '';
}

function openAddStudentModal() {
  resetAddStudentForm();
  var modal = new bootstrap.Modal(document.getElementById('addStudentModal'));
  modal.show();
  setTimeout(function() {
    var idEl = document.getElementById('newStudentId');
    if (idEl) idEl.focus();
  }, 250);
}

async function refreshStudentViewsAfterAdd(student) {
  var manGrade = document.getElementById('manGrade');
  if (manGrade && normalizeGrade(manGrade.value) === student.grade) {
    await loadManualStudents();
    var manStudent = document.getElementById('manStudent');
    if (manStudent) manStudent.value = student.id;
  }
  var statGrade = document.getElementById('statGrade');
  if (statsLoaded && statGrade && normalizeGrade(statGrade.value) === student.grade) {
    await loadStats();
  }
  var walletGrade = document.getElementById('walletGrade');
  if (walletGrade && normalizeGrade(walletGrade.value) === student.grade) {
    await loadWalletSummary();
  }
  var reportGrade = document.getElementById('rewardReportGrade');
  if (rewardReportCache && reportGrade) {
    var rg = normalizeGrade(reportGrade.value);
    if (rg === 'all' || rg === student.grade) await loadRewardReport();
  }
}

async function addNewStudent() {
  var sid = document.getElementById('newStudentId').value.trim();
  var name = document.getElementById('newStudentName').value.trim();
  var grade = document.getElementById('newStudentGrade').value;
  if (!sid || !name || !grade) {
    return Swal.fire({
      icon: 'warning',
      title: 'กรอกข้อมูลไม่ครบ',
      text: 'กรุณากรอกรหัสประจำตัว ชื่อ-นามสกุล และห้องเรียนให้ครบถ้วน',
      confirmButtonColor: '#4f46e5'
    });
  }
  loading('กำลังเพิ่มนักเรียน...');
  try {
    var res = await addNewStudentDb(sid, name, grade);
    Swal.close();
    if (res.status !== 'success') {
      return Swal.fire({ icon: 'error', title: 'เพิ่มนักเรียนไม่สำเร็จ', text: res.msg || '', confirmButtonColor: '#ef4444' });
    }
    bootstrap.Modal.getInstance(document.getElementById('addStudentModal'))?.hide();
    await refreshStudentViewsAfterAdd(res.student);
    Swal.fire({
      icon: 'success',
      title: 'เพิ่มนักเรียนสำเร็จ',
      text: res.student.name + ' (' + res.student.grade + ')',
      confirmButtonColor: '#10b981',
      timer: 1800,
      timerProgressBar: true
    });
  } catch (e) {
    Swal.close();
    var msg = e && e.code === '23505'
      ? 'รหัสประจำตัวนักเรียนนี้มีอยู่ในระบบแล้ว'
      : (e.message || 'ไม่สามารถเพิ่มนักเรียนได้');
    Swal.fire({ icon: 'error', title: 'เพิ่มนักเรียนไม่สำเร็จ', text: msg, confirmButtonColor: '#ef4444' });
  }
}

async function loadManualStudents() {
  var g = document.getElementById('manGrade').value;
  var sel = document.getElementById('manStudent');
  sel.innerHTML = '<option value="">-- กำลังโหลด... --</option>';
  sel.disabled = true;
  if (!g) {
    sel.innerHTML = '<option value="">-- เลือกชั้นก่อน --</option>';
    return;
  }
  try {
    var studs = await getStudentsInGradeDb(g);
    sel.innerHTML = '<option value="">-- เลือกนักเรียน --</option>' + studs.map(function(s) {
      return '<option value="' + s.id + '">' + s.id + ' - ' + s.name + '</option>';
    }).join('');
    sel.disabled = false;
  } catch (e) {
    sel.innerHTML = '<option value="">เกิดข้อผิดพลาด</option>';
  }
}

async function loadHistoryStudents() {
  var g = document.getElementById('histGrade').value;
  var sel = document.getElementById('histStudent');
  var idInput = document.getElementById('histId');
  var list = document.getElementById('histEditList');
  var banner = document.getElementById('histStudentBanner');
  if (idInput) idInput.value = '';
  if (banner) banner.classList.add('hidden');
  if (list) list.innerHTML = '<div class="text-center py-4" style="color:var(--muted);font-size:.83rem">เลือกชั้นและนักเรียนเพื่อดูประวัติ</div>';
  sel.innerHTML = '<option value="">-- กำลังโหลด... --</option>';
  sel.disabled = true;
  if (!g) {
    sel.innerHTML = '<option value="">-- เลือกชั้นก่อน --</option>';
    return;
  }
  try {
    var studs = await getStudentsInGradeDb(g);
    sel.innerHTML = '<option value="">-- เลือกนักเรียน --</option>' + studs.map(function(s) {
      return '<option value="' + s.id + '">' + s.id + ' - ' + s.name + '</option>';
    }).join('');
    sel.disabled = false;
  } catch (e) {
    sel.innerHTML = '<option value="">เกิดข้อผิดพลาด</option>';
  }
}

function selectHistoryStudent() {
  var sel = document.getElementById('histStudent');
  var idInput = document.getElementById('histId');
  if (idInput) idInput.value = sel.value || '';
  if (sel.value) loadHistEdit();
}

async function submitManual() {
  var sid = document.getElementById('manStudent').value;
  var date = document.getElementById('manDate').value;
  var status = '';
  document.querySelectorAll('input[name="manStatus"]').forEach(function(r) { if (r.checked) status = r.value; });
  if (!sid) return Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณาเลือกนักเรียน', confirmButtonColor: '#4f46e5' });
  if (!date) return Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณาเลือกวันที่', confirmButtonColor: '#4f46e5' });
  loading('กำลังบันทึก...');
  try {
    var res = await manualCheckInDb(sid, date, status);
    if (res.status === 'fail') {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: res.msg });
      return;
    }
    Swal.fire({
      icon: res.status === 'updated' ? 'info' : 'success',
      title: res.status === 'updated' ? 'อัปเดตแล้ว' : 'เพิ่มแล้ว',
      text: res.msg,
      confirmButtonColor: '#4f46e5',
      timer: 1800,
      timerProgressBar: true
    });
    if (statsLoaded) loadStats();
  } catch (e) {
    onErr(e);
  }
}

/* ══ History Edit ════════════════════════════════════ */
async function loadHistEdit() {
  var histSel = document.getElementById('histStudent');
  var sid = (histSel && histSel.value ? histSel.value : document.getElementById('histId').value).trim();
  document.getElementById('histId').value = sid;
  if (!sid) return Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณาระบุรหัสนักเรียน', confirmButtonColor: '#4f46e5' });
  var list = document.getElementById('histEditList');
  var banner = document.getElementById('histStudentBanner');
  list.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>';
  banner.classList.add('hidden');
  try {
    var pair = await Promise.all([
      getStudentProfileDb(sid),
      getStudentHistoryDb(sid, 'all')
    ]);
    var p = pair[0];
    var logs = pair[1];
    if (p) {
      var tier = Math.min(Math.floor((p.level || 0) / 10), 4);
      banner.innerHTML = '<div class="d-flex align-items-center gap-2 p-2" style="background:#f8fafc;border-radius:10px">'
        + (p.photo ? '<img src="' + p.photo + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover">' : '')
        + '<div><div class="fw-bold" style="font-size:.87rem">' + p.name + '</div>'
        + '<span class="lv-banner lv-t' + tier + '"><i class="fa-solid fa-star" style="font-size:.6rem"></i>Lv.' + p.level + ' | ' + p.totalPoints + ' XP</span></div></div>';
      banner.classList.remove('hidden');
    }
    if (!logs.length) {
      list.innerHTML = '<div class="text-center py-4" style="color:var(--muted);font-size:.83rem">ไม่พบข้อมูล</div>';
      return;
    }
    var bc = function(s) { return s === 'มา' ? 'p-g' : (s === 'ขาด' ? 'p-r' : 'p-y'); };
    list.innerHTML = logs.map(function(l) {
      var dk = l.dateKey;
      var points = Number(l.points) || 0;
      return '<div class="hist-item" id="hi-' + dk + '">'
        + '<span class="hist-date">' + l.date + '</span>'
        + '<div style="display:flex;align-items:center;gap:6px">'
        + '<span class="pill p-pri" id="pt-' + dk + '" style="font-size:.68rem;display:' + (points > 0 ? 'inline-flex' : 'none') + '">+' + points + 'pt</span>'
        + '<span class="pill ' + bc(l.status) + '" id="st-' + dk + '">' + l.status + '</span>'
        + '<button class="edit-btn" data-sid="' + sid + '" data-dk="' + dk + '" onclick="toggleEdit(this)"><i class="fa-solid fa-pen"></i></button>'
        + '</div></div>'
        + '<div id="er-' + dk + '" style="display:none;padding:6px 8px;background:#eff6ff;border-radius:8px;margin-bottom:5px">'
        + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'
        + '<select id="esel-' + dk + '" class="form-select form-select-sm" style="width:auto;min-width:86px" onchange="syncEditPointsState(\'' + dk + '\')">'
        + '<option value="มา"' + (l.status === 'มา' ? ' selected' : '') + '>มา</option>'
        + '<option value="ขาด"' + (l.status === 'ขาด' ? ' selected' : '') + '>ขาด</option>'
        + '<option value="ลา"' + (l.status === 'ลา' ? ' selected' : '') + '>ลา</option>'
        + '</select>'
        + '<input id="epts-' + dk + '" type="number" min="0" step="1" class="form-control form-control-sm" style="width:84px" value="' + points + '" placeholder="แต้ม">'
        + '<button class="btn btn-sm fw-bold" style="background:#4f46e5;color:#fff;border-radius:8px;font-size:.76rem" data-sid="' + sid + '" data-dk="' + dk + '" onclick="saveEdit(this)">บันทึก</button>'
        + '<button class="btn btn-sm btn-outline-secondary" style="border-radius:8px;font-size:.76rem" data-dk="' + dk + '" onclick="document.getElementById(\'er-\'+this.dataset.dk).style.display=\'none\'">ยกเลิก</button>'
        + '</div></div>';
    }).join('');
  } catch (e) {
    onErr(e);
  }
}

function toggleEdit(btn) {
  var r = document.getElementById('er-' + btn.dataset.dk);
  r.style.display = r.style.display === 'none' ? 'block' : 'none';
  syncEditPointsState(btn.dataset.dk);
}

function syncEditPointsState(dateKey) {
  var statusEl = document.getElementById('esel-' + dateKey);
  var pointsEl = document.getElementById('epts-' + dateKey);
  if (!statusEl || !pointsEl) return;
  var isPresent = statusEl.value === 'มา';
  pointsEl.disabled = !isPresent;
  if (!isPresent) pointsEl.value = 0;
}

async function saveEdit(btn) {
  var sid = btn.dataset.sid, dk = btn.dataset.dk;
  var nst = document.getElementById('esel-' + dk).value;
  var ptsEl = document.getElementById('epts-' + dk);
  var pts = Math.max(0, Math.floor(Number(ptsEl ? ptsEl.value : 0) || 0));
  loading('กำลังบันทึก...');
  try {
    var res = await editAttendanceRecordDb(sid, dk, nst, pts);
    if (res.status === 'fail') {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: res.msg });
      return;
    }
    Swal.fire({ icon: 'success', title: 'อัปเดตแล้ว', text: res.msg, confirmButtonColor: '#4f46e5', timer: 1500, timerProgressBar: true });
    var pill = document.getElementById('st-' + dk);
    if (pill) {
      pill.className = 'pill ' + (nst === 'มา' ? 'p-g' : (nst === 'ขาด' ? 'p-r' : 'p-y'));
      pill.textContent = nst;
    }
    var pointPill = document.getElementById('pt-' + dk);
    if (pointPill) {
      pointPill.textContent = '+' + (nst === 'มา' ? pts : 0) + 'pt';
      pointPill.style.display = nst === 'มา' && pts > 0 ? 'inline-flex' : 'none';
    }
    document.getElementById('er-' + dk).style.display = 'none';
    if (statsLoaded) loadStats();
  } catch (e) {
    onErr(e);
  }
}

/* ══ Settings ════════════════════════════════════════ */
async function loadSettings() {
  try {
    var s = await getAppSettingsDb();
    if (!s) return;
    document.getElementById('setAppName').value = s.appName || '';
    document.getElementById('setSchoolName').value = s.schoolName || '';
    var col = s.accentColor || '#4f46e5';
    document.getElementById('setColor').value = col;
    settingsColor = col;
    updateColorPreview(col);
    settingsLogoUrl = s.logoUrl || s.logoBase64 || '';
    if (settingsLogoUrl) document.getElementById('logoPreview').src = settingsLogoUrl;
  } catch (e) {}
}

function updateColorPreview(c) {
  settingsColor = c;
  document.getElementById('colorPreview').style.background = c;
  document.getElementById('colorHex').textContent = c;
}

function resetColor() {
  updateColorPreview('#4f46e5');
  document.getElementById('setColor').value = '#4f46e5';
}

async function handleLogoChange(ev) {
  var file = ev.target.files[0];
  if (!file) return;
  try {
    loading('กำลังอัปโหลดโลโก้...');
    var uploaded = await uploadCompressedImage(file, {
      folder: 'settings',
      maxWidth: 80,
      maxHeight: 80,
      quality: 0.8
    });
    settingsLogoUrl = uploaded.publicUrl;
    document.getElementById('logoPreview').src = settingsLogoUrl;
    Swal.close();
  } catch (e) {
    onErr(e);
  } finally {
    ev.target.value = '';
  }
}

function clearLogo() {
  settingsLogoUrl = '';
  document.getElementById('logoPreview').src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'%3E%3Crect width='60' height='60' rx='12' fill='%23e0e7ff'/%3E%3Ctext x='50%25' y='60%25' text-anchor='middle' font-size='28' fill='%234f46e5'%3E🏫%3C/text%3E%3C/svg%3E";
}

async function saveSettings() {
  var s = {
    appName: document.getElementById('setAppName').value.trim() || 'ระบบเช็คชื่อนักเรียน',
    schoolName: document.getElementById('setSchoolName').value.trim() || 'กุงแก้ววิทยาคาร',
    accentColor: settingsColor || '#4f46e5',
    logoBase64: settingsLogoUrl || '',
    logoUrl: settingsLogoUrl || ''
  };
  loading('กำลังบันทึก...');
  try {
    var res = await saveAppSettingsDb(s);
    if (res.status === 'success') {
      appSettings = s;
      applyAppSettings(s);
      Swal.fire({ icon: 'success', title: 'บันทึกแล้ว', confirmButtonColor: '#4f46e5', timer: 2000, timerProgressBar: true });
    } else {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: res.msg });
    }
  } catch (e) {
    onErr(e);
  }
}

/* ══ Logout ══════════════════════════════════════════ */
function logout() {
  CU = {};
  statsCache = null;
  statsLoaded = false;
  shopItems = null;
  shopWallet = null;
  stopPasswordResetDashboard();
  location.reload();
}

async function loadRewardReport() {
  var wrap = document.getElementById('rewardReportGroups');
  var spinner = document.getElementById('rewardReportSpinner');
  var countEl = document.getElementById('rewardReportCount');
  if (!wrap) return;
  var grade = document.getElementById('rewardReportGrade') ? document.getElementById('rewardReportGrade').value : 'all';
  if (spinner) spinner.classList.remove('hidden');
  wrap.innerHTML = '';
  if (countEl) countEl.textContent = 'กำลังโหลด...';
  try {
    var groups = await getRewardRedemptionReportDb(grade);
    rewardReportCache = groups;
    if (spinner) spinner.classList.add('hidden');
    renderRewardReport(groups);
  } catch (e) {
    if (spinner) spinner.classList.add('hidden');
    if (countEl) countEl.textContent = 'โหลดไม่สำเร็จ';
    wrap.innerHTML = '<div class="text-center py-4 text-danger">โหลดรายงานไม่สำเร็จ: ' + escHtml(e.message || '') + '</div>';
  }
}

function rewardReportStatusBadge(status) {
  if (status === 'approved') return '<span class="badge rounded-pill text-bg-success">อนุมัติแล้ว</span>';
  if (status === 'rejected') return '<span class="badge rounded-pill text-bg-danger">ปฏิเสธ</span>';
  if (status === 'mixed') return '<span class="badge rounded-pill text-bg-secondary">หลายสถานะ</span>';
  return '<span class="badge rounded-pill text-bg-warning text-dark">รอดำเนินการ</span>';
}

function rewardReportSourceBadge(item) {
  if (item.paidQty > 0 && item.freeQty > 0) {
    return '<span class="badge rounded-pill text-bg-info text-dark">' + escHtml(item.sourceText) + '</span>';
  }
  if (item.freeQty > 0) return '<span class="badge rounded-pill text-bg-primary">ครูมอบให้</span>';
  return '<span class="badge rounded-pill text-bg-light border text-dark">แลกด้วยเหรียญ</span>';
}

function rewardReportActionButtons(item) {
  var pendingDisabled = item.status === 'pending' ? ' disabled' : '';
  var approvedDisabled = item.status === 'approved' ? ' disabled' : '';
  var rejectedDisabled = item.status === 'rejected' ? ' disabled' : '';
  return '<div class="d-flex gap-1 justify-content-center flex-wrap">'
    + '<button class="btn btn-sm btn-outline-warning fw-bold" style="border-radius:8px;font-size:.72rem"'
    + pendingDisabled + ' onclick="setRewardReportStatus(' + item.groupId + ',\'pending\')">รอ</button>'
    + '<button class="btn btn-sm btn-outline-success fw-bold" style="border-radius:8px;font-size:.72rem"'
    + approvedDisabled + ' onclick="setRewardReportStatus(' + item.groupId + ',\'approved\')">อนุมัติ</button>'
    + '<button class="btn btn-sm btn-outline-danger fw-bold" style="border-radius:8px;font-size:.72rem"'
    + rejectedDisabled + ' onclick="setRewardReportStatus(' + item.groupId + ',\'rejected\')">ปฏิเสธ</button>'
    + '</div>';
}

function renderRewardReport(groups) {
  var wrap = document.getElementById('rewardReportGroups');
  var countEl = document.getElementById('rewardReportCount');
  var totalItems = 0, totalQty = 0;
  (groups || []).forEach(function(st) {
    totalItems += st.items.length;
    totalQty += st.totalQty || 0;
  });
  if (countEl) countEl.textContent = 'พบ ' + groups.length + ' คน | ' + totalItems + ' ชนิด | ' + totalQty + ' ชิ้น';
  if (!groups.length) {
    wrap.innerHTML = '<div class="text-center py-4 text-muted">ไม่พบรายการแลกของรางวัลในห้องที่เลือก</div>';
    return;
  }
  wrap.innerHTML = '<div class="accordion" id="rewardReportAccordion">' + groups.map(function(student, i) {
    var collapseId = 'reward-student-' + i;
    var itemRows = student.items.map(function(item, n) {
      return '<tr>'
        + '<td class="text-muted">' + (n + 1) + '</td>'
        + '<td class="fw-semibold">' + escHtml(item.itemName) + ' <span class="badge text-bg-primary ms-1">x' + item.quantity + '</span></td>'
        + '<td class="text-center">' + item.totalCost + '</td>'
        + '<td>' + rewardReportSourceBadge(item) + '</td>'
        + '<td style="white-space:nowrap">' + escHtml(item.latestDate) + '</td>'
        + '<td>' + rewardReportStatusBadge(item.status) + '</td>'
        + '<td class="text-center">' + rewardReportActionButtons(item) + '</td>'
        + '</tr>';
    }).join('');
    return '<div class="accordion-item mb-2 border rounded-3 overflow-hidden">'
      + '<h2 class="accordion-header" id="' + collapseId + '-head">'
      + '<button class="accordion-button ' + (i === 0 ? '' : 'collapsed') + '" type="button" data-bs-toggle="collapse" data-bs-target="#' + collapseId + '" aria-expanded="' + (i === 0 ? 'true' : 'false') + '" aria-controls="' + collapseId + '">'
      + '<div class="d-flex flex-column flex-md-row gap-1 gap-md-3 w-100 pe-3">'
      + '<span class="fw-bold">' + escHtml(student.studentName) + '</span>'
      + '<span class="text-muted">' + escHtml(student.studentId) + ' | ' + escHtml(student.grade) + '</span>'
      + '<span class="badge text-bg-light border ms-md-auto">' + student.items.length + ' ชนิด / ' + student.totalQty + ' ชิ้น</span>'
      + '</div></button></h2>'
      + '<div id="' + collapseId + '" class="accordion-collapse collapse ' + (i === 0 ? 'show' : '') + '" aria-labelledby="' + collapseId + '-head" data-bs-parent="#rewardReportAccordion">'
      + '<div class="accordion-body p-0"><div class="table-responsive">'
      + '<table class="table table-sm table-hover align-middle mb-0">'
      + '<thead class="table-light"><tr><th style="width:54px">#</th><th>ของรางวัล</th><th class="text-center">ใช้เหรียญ</th><th>ประเภท</th><th>ล่าสุด</th><th>สถานะ</th><th class="text-center">จัดการ</th></tr></thead>'
      + '<tbody>' + itemRows + '</tbody></table></div></div></div></div>';
  }).join('') + '</div>';
}

function findRewardReportItem(groupId) {
  var found = null;
  (rewardReportCache || []).forEach(function(student) {
    student.items.forEach(function(item) {
      if (item.groupId === groupId) found = item;
    });
  });
  return found;
}

async function setRewardReportStatus(groupId, newStatus) {
  var item = findRewardReportItem(groupId);
  if (!item) return Swal.fire({ icon: 'error', title: 'ไม่พบรายการ', confirmButtonColor: '#ef4444' });
  var label = newStatus === 'approved' ? 'อนุมัติแล้ว' : (newStatus === 'rejected' ? 'ปฏิเสธ' : 'รอดำเนินการ');
  var note = newStatus === 'rejected'
    ? '<br><small class="text-muted">ระบบคำนวณเหรียญคงเหลือโดยไม่นับรายการที่ถูกปฏิเสธ จึงถือว่าเด็กได้คะแนนคืน</small>'
    : (newStatus === 'approved'
      ? '<br><small class="text-muted">ใช้เมื่อมอบของรางวัลให้นักเรียนเรียบร้อยแล้ว</small>'
      : '<br><small class="text-muted">รายการทั้งหมดในกลุ่มนี้จะกลับไปรอดำเนินการ</small>');
  var r = await Swal.fire({
    icon: newStatus === 'approved' ? 'success' : 'warning',
    title: 'ยืนยันการเปลี่ยนสถานะ?',
    html: 'ต้องการเปลี่ยนสถานะ <b>' + escHtml(item.itemName) + ' x' + item.quantity + '</b> เป็น <b>' + label + '</b>' + note,
    showCancelButton: true,
    confirmButtonText: 'ยืนยัน',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: newStatus === 'approved' ? '#10b981' : '#ef4444'
  });
  if (!r.isConfirmed) return;
  loading('กำลังอัปเดตสถานะ...');
  try {
    var res = await updateRedemptionStatusByIdsDb(item.rowIds, newStatus);
    Swal.close();
    if (res.status !== 'success') {
      Swal.fire({ icon: 'error', title: 'อัปเดตไม่สำเร็จ', text: res.msg || '', confirmButtonColor: '#ef4444' });
      return;
    }
    item.status = newStatus;
    item.statusCounts = { pending: 0, approved: 0, rejected: 0 };
    item.statusCounts[newStatus] = item.quantity;
    renderRewardReport(rewardReportCache || []);
    if (tShopOrders) {
      tShopOrders.forEach(function(row) {
        if (item.rowIds.indexOf(row.rowIndex) !== -1) row.status = newStatus;
      });
    }
    Swal.fire({ icon: 'success', title: 'อัปเดตสถานะแล้ว', timer: 1300, timerProgressBar: true, confirmButtonColor: '#10b981' });
  } catch (e) {
    onErr(e);
  }
}

function rewardReportStatusText(status) {
  if (status === 'approved') return 'อนุมัติแล้ว';
  if (status === 'rejected') return 'ปฏิเสธ';
  if (status === 'mixed') return 'หลายสถานะ';
  return 'รอดำเนินการ';
}

function ensureRewardReportLoaded() {
  if (!rewardReportCache || !rewardReportCache.length) {
    Swal.fire({
      icon: 'info',
      title: 'ยังไม่มีข้อมูลสำหรับ Export',
      text: 'กรุณาโหลดรายงานการแลกของรางวัลก่อน',
      confirmButtonColor: '#4f46e5'
    });
    return false;
  }
  return true;
}

function getRewardReportExportRows() {
  var rows = [];
  (rewardReportCache || []).forEach(function(student, studentIndex) {
    student.items.forEach(function(item) {
      rows.push({
        no: studentIndex + 1,
        studentId: student.studentId,
        studentName: student.studentName,
        grade: student.grade,
        itemName: item.itemName,
        quantity: item.quantity,
        totalCost: item.totalCost,
        source: item.sourceText || (item.totalCost > 0 ? 'แลกด้วยเหรียญ' : 'ครูมอบให้'),
        latestDate: item.latestDate,
        status: rewardReportStatusText(item.status)
      });
    });
  });
  return rows;
}

function getRewardReportExportMeta() {
  var gradeEl = document.getElementById('rewardReportGrade');
  var grade = gradeEl ? gradeEl.value : 'all';
  return {
    grade: grade === 'all' ? 'ทุกห้อง' : grade,
    date: formatThaiLongDate(new Date())
  };
}

function exportRewardReportCSV() {
  if (!ensureRewardReportLoaded()) return;
  var rows = [['ลำดับนักเรียน', 'เลขประจำตัว', 'ชื่อ-นามสกุล', 'ห้อง', 'ของรางวัล', 'จำนวน', 'ใช้เหรียญรวม', 'ประเภท', 'วันที่ล่าสุด', 'สถานะ']];
  getRewardReportExportRows().forEach(function(r) {
    rows.push([r.no, r.studentId, r.studentName, r.grade, r.itemName, r.quantity, r.totalCost, r.source, r.latestDate, r.status]);
  });
  var csv = rows.map(function(row) {
    return row.map(function(c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  var meta = getRewardReportExportMeta();
  var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'reward_picklist_' + meta.grade + '_' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportRewardReportExcel() {
  if (typeof XLSX === 'undefined') return Swal.fire({ icon: 'error', title: 'โหลด Library ไม่สำเร็จ' });
  if (!ensureRewardReportLoaded()) return;
  var meta = getRewardReportExportMeta();
  var body = getRewardReportExportRows().map(function(r) {
    return [r.no, r.studentId, r.studentName, r.grade, r.itemName, r.quantity, r.totalCost, r.source, r.latestDate, r.status];
  });
  var ws = XLSX.utils.aoa_to_sheet([
    ['Pick List รายงานการแลกของรางวัล'],
    ['ห้อง: ' + meta.grade + ' | วันที่พิมพ์: ' + meta.date],
    [],
    ['ลำดับนักเรียน', 'เลขประจำตัว', 'ชื่อ-นามสกุล', 'ห้อง', 'ของรางวัล', 'จำนวน', 'ใช้เหรียญรวม', 'ประเภท', 'วันที่ล่าสุด', 'สถานะ']
  ].concat(body));
  ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 28 }, { wch: 10 }, { wch: 28 }, { wch: 8 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 14 }];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reward Pick List');
  XLSX.writeFile(wb, 'reward_picklist_' + meta.grade + '.xlsx');
}

function exportRewardReportPDF() {
  if (!ensureRewardReportLoaded()) return;
  var meta = getRewardReportExportMeta();
  var titleEl = document.querySelector('#printArea h3');
  var oldTitle = titleEl ? titleEl.textContent : '';
  if (titleEl) titleEl.textContent = 'Pick List รายงานการแลกของรางวัล';
  document.getElementById('printSubtitle').textContent = 'ห้อง: ' + meta.grade;
  document.getElementById('printDate').textContent = 'พิมพ์วันที่ ' + meta.date;
  document.getElementById('printSchoolName').textContent = appSettings.schoolName || 'โรงเรียนกุงแก้ววิทยาคาร';
  document.getElementById('printHead').innerHTML = '<tr><th>#</th><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>ห้อง</th><th>ของรางวัล</th><th>จำนวน</th><th>ประเภท</th><th>สถานะ</th></tr>';
  document.getElementById('printBody').innerHTML = getRewardReportExportRows().map(function(r) {
    return '<tr><td>' + r.no + '</td><td>' + escHtml(r.studentId) + '</td><td class="text-start">' + escHtml(r.studentName) + '</td><td>' + escHtml(r.grade) + '</td><td class="text-start">' + escHtml(r.itemName) + '</td><td>x' + r.quantity + '</td><td>' + escHtml(r.source) + '</td><td>' + escHtml(r.status) + '</td></tr>';
  }).join('');
  setTimeout(function() {
    window.print();
    setTimeout(function() {
      if (titleEl) titleEl.textContent = oldTitle || 'รายงานการเข้าเรียน';
    }, 500);
  }, 300);
}

/* ════════════════════════════════════════════════════
   TEACHER SHOP MANAGEMENT
═════════════════════════════════════════════════════ */

function switchTShopTab(tab, btn) {
  ['items', 'orders', 'wallet'].forEach(function(t) {
    var panel = document.getElementById('tshop-' + t + '-panel');
    var tabBtn = document.getElementById('tstab-' + t);
    if (panel) panel.classList.toggle('hidden', t !== tab);
    if (tabBtn) tabBtn.classList.toggle('active', t === tab);
  });
  if (tab === 'items') loadTeacherShopItems();
  if (tab === 'orders') loadTeacherOrders();
  if (tab === 'wallet') loadWalletSummary();
}

async function loadTeacherShopItems() {
  var el = document.getElementById('teacherItemsList');
  if (!el) return;
  el.innerHTML = '<div class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลด...</div>';
  try {
    var items = await getAllShopItemsForTeacherDb();
    tShopItems = items;
    renderTeacherItems(items);
  } catch (e) {
    el.innerHTML = '<div class="text-center py-4 text-danger">โหลดไม่สำเร็จ: ' + escHtml(e.message || '') + '</div>';
  }
}

async function loadManageShopItems() {
  return loadTeacherShopItems();
}

function buildGradeSelectOptions(selectedGrade) {
  return '<option value="">-- เลือกชั้น/ห้อง --</option>' + GRADE_LIST.map(function(g) {
    return '<option value="' + escHtml(g) + '"' + (g === selectedGrade ? ' selected' : '') + '>' + escHtml(g) + '</option>';
  }).join('');
}

function openGrantItemModal() {
  var currentGrade = document.getElementById('walletGrade') ? document.getElementById('walletGrade').value : '';
  Swal.fire({
    title: 'มอบไอเทมฟรี',
    html: '<div class="text-start">'
      + '<label class="form-label">ชั้น/ห้องเรียน</label>'
      + '<select id="grantGrade" class="form-select mb-3">' + buildGradeSelectOptions(currentGrade) + '</select>'
      + '<label class="form-label">นักเรียนที่ได้รับ</label>'
      + '<div class="d-flex gap-2 align-items-center mb-2 flex-wrap">'
      + '<button type="button" class="btn btn-sm btn-outline-primary fw-bold" id="grantSelectAll" style="border-radius:8px;font-size:.76rem">เลือกทั้งหมด</button>'
      + '<button type="button" class="btn btn-sm btn-outline-secondary fw-bold" id="grantClearAll" style="border-radius:8px;font-size:.76rem">ล้าง</button>'
      + '<small class="text-muted ms-auto" id="grantSelectedCount">เลือก 0 คน</small>'
      + '</div>'
      + '<div id="grantStudentsBox" style="max-height:220px;overflow:auto;border:1px solid #e2e8f0;border-radius:12px;padding:8px;margin-bottom:14px">'
      + '<div class="text-center py-3 text-muted">เลือกชั้น/ห้องเพื่อโหลดรายชื่อ</div>'
      + '</div>'
      + '<label class="form-label">ไอเทม</label>'
      + '<select id="grantItem" class="form-select mb-3"><option value="">กำลังโหลดไอเทม...</option></select>'
      + '<label class="form-label">จำนวนต่อคน</label>'
      + '<input id="grantQty" type="number" min="1" max="99" step="1" value="1" class="form-control mb-2">'
      + '<div class="alert mb-0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:10px;font-size:.8rem;color:#065f46">'
      + 'รายการนี้จะถูกบันทึกเป็นสถานะอนุมัติแล้ว และไม่หักเหรียญนักเรียน'
      + '</div></div>',
    width: 720,
    showCancelButton: true,
    confirmButtonText: 'มอบไอเทม',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#10b981',
    focusConfirm: false,
    didOpen: function() {
      var popup = Swal.getPopup();
      var gradeEl = popup.querySelector('#grantGrade');
      var box = popup.querySelector('#grantStudentsBox');
      var itemEl = popup.querySelector('#grantItem');
      var countEl = popup.querySelector('#grantSelectedCount');

      var updateCount = function() {
        var total = popup.querySelectorAll('.grant-student').length;
        var selected = popup.querySelectorAll('.grant-student:checked').length;
        countEl.textContent = 'เลือก ' + selected + ' / ' + total + ' คน';
      };
      var setAll = function(checked) {
        popup.querySelectorAll('.grant-student').forEach(function(cb) {
          cb.checked = checked;
        });
        updateCount();
      };
      popup.querySelector('#grantSelectAll').addEventListener('click', function() { setAll(true); });
      popup.querySelector('#grantClearAll').addEventListener('click', function() { setAll(false); });
      box.addEventListener('change', updateCount);

      var loadItems = async function() {
        try {
          var items = tShopItems || await getAllShopItemsForTeacherDb();
          tShopItems = items;
          if (!items.length) {
            itemEl.innerHTML = '<option value="">ยังไม่มีไอเทมในระบบ</option>';
            return;
          }
          itemEl.innerHTML = '<option value="">-- เลือกไอเทม --</option>' + items.map(function(item) {
            var note = item.active ? '' : ' (ซ่อนอยู่)';
            return '<option value="' + escHtml(item.itemId) + '">' + escHtml(item.itemName) + ' - ' + item.cost + ' เหรียญ' + note + '</option>';
          }).join('');
        } catch (e) {
          itemEl.innerHTML = '<option value="">โหลดไอเทมไม่สำเร็จ</option>';
        }
      };
      var loadStudents = async function() {
        var grade = gradeEl.value;
        updateCount();
        if (!grade) {
          box.innerHTML = '<div class="text-center py-3 text-muted">เลือกชั้น/ห้องเพื่อโหลดรายชื่อ</div>';
          updateCount();
          return;
        }
        box.innerHTML = '<div class="text-center py-3 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลดรายชื่อ...</div>';
        try {
          var students = await getStudentsForGradeScopeDb(grade);
          if (!students.length) {
            box.innerHTML = '<div class="text-center py-3 text-muted">ไม่พบนักเรียนในชั้น/ห้องนี้</div>';
            updateCount();
            return;
          }
          box.innerHTML = students.map(function(st) {
            return '<label class="d-flex align-items-start gap-2 py-2 px-2" style="border-bottom:1px solid #f1f5f9;cursor:pointer">'
              + '<input type="checkbox" class="form-check-input grant-student mt-1" value="' + escHtml(st.id) + '">'
              + '<span style="line-height:1.25"><span class="fw-bold">' + escHtml(st.id) + '</span> '
              + escHtml(st.name) + '<br><small class="text-muted">' + escHtml(st.grade) + '</small></span>'
              + '</label>';
          }).join('');
          updateCount();
        } catch (e) {
          box.innerHTML = '<div class="text-center py-3 text-danger">โหลดรายชื่อไม่สำเร็จ: ' + escHtml(e.message || '') + '</div>';
          updateCount();
        }
      };
      gradeEl.addEventListener('change', loadStudents);
      loadItems();
      if (gradeEl.value) loadStudents();
    },
    preConfirm: function() {
      var popup = Swal.getPopup();
      var itemId = popup.querySelector('#grantItem').value;
      var qty = Math.floor(Number(popup.querySelector('#grantQty').value) || 0);
      var ids = Array.prototype.map.call(popup.querySelectorAll('.grant-student:checked'), function(cb) {
        return cb.value;
      });
      if (!itemId) {
        Swal.showValidationMessage('กรุณาเลือกไอเทม');
        return false;
      }
      if (!ids.length) {
        Swal.showValidationMessage('กรุณาเลือกนักเรียนอย่างน้อย 1 คน');
        return false;
      }
      if (qty < 1 || qty > 99) {
        Swal.showValidationMessage('จำนวนต่อคนต้องอยู่ระหว่าง 1-99');
        return false;
      }
      return { itemId: itemId, studentIds: ids, quantity: qty };
    }
  }).then(async function(r) {
    if (!r.isConfirmed || !r.value) return;
    loading('กำลังมอบไอเทม...');
    try {
      var res = await grantFreeItemDb(r.value.studentIds, r.value.itemId, r.value.quantity);
      Swal.close();
      if (res.status !== 'success') {
        return Swal.fire({ icon: 'error', title: 'มอบไอเทมไม่สำเร็จ', text: res.msg || '', confirmButtonColor: '#ef4444' });
      }
      tShopOrders = null;
      rewardReportCache = null;
      var ordersPanel = document.getElementById('tshop-orders-panel');
      var reportPane = document.getElementById('tab-reward-report');
      if (ordersPanel && !ordersPanel.classList.contains('hidden')) await loadTeacherOrders();
      if (reportPane && reportPane.classList.contains('active')) await loadRewardReport();
      Swal.fire({
        icon: 'success',
        title: 'มอบไอเทมสำเร็จ',
        text: 'มอบ "' + res.itemName + '" จำนวน ' + res.quantity + ' ชิ้น/คน ให้ ' + res.studentCount + ' คน',
        confirmButtonColor: '#10b981',
        timer: 2200,
        timerProgressBar: true
      });
    } catch (e) {
      onErr(e);
    }
  });
}

function renderTeacherItems(items) {
  var el = document.getElementById('teacherItemsList');
  if (!items || !items.length) {
    el.innerHTML = '<div class="text-center py-5 text-muted"><div style="font-size:3rem;opacity:.3">📦</div><p class="mt-2">ยังไม่มีสินค้า กดปุ่ม "เพิ่มสินค้า" เพื่อเริ่มต้น</p></div>';
    return;
  }
  el.innerHTML = items.map(function(item) {
    var imgHtml = item.image
      ? '<div class="si-img"><img src="' + item.image + '" alt=""></div>'
      : '<div class="si-img">🎁</div>';
    return '<div class="si-card">'
      + imgHtml
      + '<div class="si-info">'
      + '<div class="si-name">' + escHtml(item.itemName) + '</div>'
      + (item.description ? '<div class="si-desc">' + escHtml(item.description) + '</div>' : '')
      + '<div class="si-cost">🪙 ' + item.cost + ' เหรียญ</div>'
      + '<div class="mt-1">'
      + (item.active ? '<span class="si-badge-on">✓ แสดงในร้าน</span>' : '<span class="si-badge-off">✕ ซ่อน</span>')
      + '</div></div>'
      + '<div class="si-actions">'
      + '<button class="btn btn-sm fw-bold" style="background:#eff6ff;color:#4f46e5;border-radius:8px;font-size:.73rem" onclick="openEditItemModal(\'' + escHtml(item.itemId) + '\')"><i class="fa-solid fa-pen"></i></button>'
      + '<button class="btn btn-sm fw-bold" style="background:' + (item.active ? '#fff7ed' : '#f0fdf4') + ';color:' + (item.active ? '#c2410c' : '#15803d') + ';border-radius:8px;font-size:.73rem" onclick="toggleItem(\'' + escHtml(item.itemId) + '\',this)" title="' + (item.active ? 'ซ่อน' : 'แสดง') + '">'
      + (item.active ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>') + '</button>'
      + '<button class="btn btn-sm fw-bold" style="background:#fef2f2;color:#dc2626;border-radius:8px;font-size:.73rem" onclick="deleteItem(\'' + escHtml(item.itemId) + '\',\'' + escHtml(item.itemName) + '\')"><i class="fa-solid fa-trash"></i></button>'
      + '</div></div>';
  }).join('');
}

async function toggleItem(itemId) {
  try {
    var res = await toggleShopItemActiveDb(itemId);
    if (res.status === 'success') {
      tShopItems = null;
      await loadTeacherShopItems();
    } else {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: res.msg });
    }
  } catch (e) {
    onErr(e);
  }
}

function deleteItem(itemId, itemName) {
  Swal.fire({
    icon: 'warning',
    title: 'ยืนยันการลบ?',
    html: 'ต้องการลบสินค้า <b>"' + escHtml(itemName) + '"</b> ออกจากระบบ?<br><small class="text-muted">การลบจะไม่สามารถกู้คืนได้</small>',
    showCancelButton: true,
    confirmButtonColor: '#ef4444',
    confirmButtonText: 'ลบเลย',
    cancelButtonText: 'ยกเลิก'
  }).then(async function(r) {
    if (!r.isConfirmed) return;
    loading('กำลังลบ...');
    try {
      var res = await deleteShopItemDb(itemId);
      Swal.close();
      if (res.status === 'success') {
        Swal.fire({ icon: 'success', title: 'ลบแล้ว', timer: 1500, timerProgressBar: true, confirmButtonColor: '#4f46e5' });
        tShopItems = null;
        await loadTeacherShopItems();
      } else {
        Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: res.msg });
      }
    } catch (e) {
      onErr(e);
    }
  });
}

function openAddItemModal() {
  document.getElementById('itemModalTitle').textContent = 'เพิ่มสินค้าใหม่';
  document.getElementById('editItemId').value = '';
  document.getElementById('itemName').value = '';
  document.getElementById('itemCost').value = '';
  document.getElementById('itemDesc').value = '';
  document.getElementById('itemActive').checked = true;
  itemImageUrl = '';
  document.getElementById('itemPreviewEmoji').style.display = '';
  document.getElementById('itemPreviewImg').style.display = 'none';
  document.getElementById('itemPreviewImg').src = '';
  document.getElementById('itemImageInput').value = '';
  var modal = new bootstrap.Modal(document.getElementById('itemModal'));
  modal.show();
}

function openEditItemModal(itemId) {
  var item = null;
  if (tShopItems) {
    for (var i = 0; i < tShopItems.length; i++) {
      if (tShopItems[i].itemId === itemId) { item = tShopItems[i]; break; }
    }
  }
  if (!item) return Swal.fire({ icon: 'error', title: 'ไม่พบสินค้า' });
  document.getElementById('itemModalTitle').textContent = 'แก้ไขสินค้า';
  document.getElementById('editItemId').value = item.itemId;
  document.getElementById('itemName').value = item.itemName;
  document.getElementById('itemCost').value = item.cost;
  document.getElementById('itemDesc').value = item.description;
  document.getElementById('itemActive').checked = item.active;
  itemImageUrl = item.image || '';
  if (item.image) {
    document.getElementById('itemPreviewEmoji').style.display = 'none';
    document.getElementById('itemPreviewImg').style.display = 'block';
    document.getElementById('itemPreviewImg').src = item.image;
  } else {
    document.getElementById('itemPreviewEmoji').style.display = '';
    document.getElementById('itemPreviewImg').style.display = 'none';
  }
  document.getElementById('itemImageInput').value = '';
  var modal = new bootstrap.Modal(document.getElementById('itemModal'));
  modal.show();
}

async function handleItemImageChange(event) {
  var file = event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    event.target.value = '';
    return Swal.fire({ icon: 'warning', title: 'ไฟล์ใหญ่เกินไป', text: 'กรุณาเลือกรูปที่เล็กกว่า 5MB' });
  }
  try {
    loading('กำลังอัปโหลดรูปสินค้า...');
    var uploaded = await uploadCompressedImage(file, {
      folder: 'shop-items',
      maxWidth: 200,
      maxHeight: 200,
      quality: 0.8
    });
    itemImageUrl = uploaded.publicUrl;
    document.getElementById('itemPreviewEmoji').style.display = 'none';
    document.getElementById('itemPreviewImg').style.display = 'block';
    document.getElementById('itemPreviewImg').src = itemImageUrl;
    Swal.close();
  } catch (e) {
    onErr(e);
  } finally {
    event.target.value = '';
  }
}

function clearItemImage() {
  itemImageUrl = '';
  document.getElementById('itemPreviewEmoji').style.display = '';
  document.getElementById('itemPreviewImg').style.display = 'none';
  document.getElementById('itemPreviewImg').src = '';
  document.getElementById('itemImageInput').value = '';
}

async function saveItemModal() {
  var editId = document.getElementById('editItemId').value.trim();
  var name = document.getElementById('itemName').value.trim();
  var cost = document.getElementById('itemCost').value;
  var desc = document.getElementById('itemDesc').value.trim();
  var active = document.getElementById('itemActive').checked;
  if (!name) return Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณาระบุชื่อสินค้า' });
  if (cost === '' || isNaN(Number(cost)) || Number(cost) < 0) {
    return Swal.fire({ icon: 'warning', title: 'แจ้งเตือน', text: 'กรุณาระบุราคาที่ถูกต้อง' });
  }
  loading('กำลังบันทึก...');
  try {
    var res = editId
      ? await updateShopItemDb(editId, name, Number(cost), desc, itemImageUrl, active)
      : await addShopItemDb(name, Number(cost), desc, itemImageUrl, active);
    bootstrap.Modal.getInstance(document.getElementById('itemModal'))?.hide();
    Swal.close();
    if (res.status === 'success') {
      Swal.fire({
        icon: 'success',
        title: editId ? 'อัปเดตแล้ว' : 'เพิ่มสินค้าแล้ว',
        text: res.msg || '',
        timer: 1800,
        timerProgressBar: true,
        confirmButtonColor: '#4f46e5'
      });
      tShopItems = null;
      await loadTeacherShopItems();
    } else {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: res.msg });
    }
  } catch (e) {
    onErr(e);
  }
}

async function loadTeacherOrders() {
  var el = document.getElementById('teacherOrdersList');
  if (!el) return;
  el.innerHTML = '<div class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลด...</div>';
  try {
    var orders = await getAllRedemptionsForTeacherDb();
    tShopOrders = orders;
    renderTeacherOrders(orders, tOrderFilter);
  } catch (e) {
    el.innerHTML = '<div class="text-center py-4 text-danger">โหลดไม่สำเร็จ</div>';
  }
}

function filterOrders(status, btn) {
  tOrderFilter = status;
  document.querySelectorAll('.order-filter-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  if (tShopOrders) renderTeacherOrders(tShopOrders, status);
}

function renderTeacherOrders(orders, filter) {
  var el = document.getElementById('teacherOrdersList');
  var filtered = filter === 'all' ? orders : orders.filter(function(o) { return o.status === filter; });
  var lbl = document.getElementById('orderCountLabel');
  if (lbl) lbl.textContent = 'พบ ' + filtered.length + ' รายการ';
  if (!filtered.length) {
    el.innerHTML = '<div class="text-center py-5 text-muted"><div style="font-size:2.5rem;opacity:.3">📋</div><p class="mt-2">ไม่มีรายการ</p></div>';
    return;
  }
  var statusBadge = function(s) {
    if (s === 'approved') return '<span class="pill p-g" style="font-size:.72rem">✅ อนุมัติ</span>';
    if (s === 'rejected') return '<span class="pill p-r" style="font-size:.72rem">❌ ปฏิเสธ</span>';
    return '<span class="pill p-y" style="font-size:.72rem">⏳ รอ</span>';
  };
  el.innerHTML = filtered.map(function(o) {
    var isPending = o.status === 'pending';
    var costHtml = o.cost > 0
      ? '<div class="order-cost">-' + o.cost + ' 🪙</div>'
      : '<div class="order-cost" style="color:#4f46e5">ครูมอบให้</div>';
    return '<div class="order-row" id="orow-' + o.rowIndex + '">'
      + '<div style="flex:1;min-width:0">'
      + '<div class="order-student">' + escHtml(o.studentName) + ' <span style="color:#94a3b8;font-size:.76rem">(' + escHtml(o.studentId) + ')</span></div>'
      + '<div class="order-item">🎁 ' + escHtml(o.itemName) + '</div>'
      + '<div class="order-date">' + o.date + '</div>'
      + '</div>'
      + '<div style="text-align:right;flex-shrink:0">' + costHtml + statusBadge(o.status) + '</div>'
      + (isPending
        ? '<div class="order-actions">'
          + '<button class="btn btn-sm fw-bold" style="background:#dcfce7;color:#15803d;border-radius:8px;font-size:.73rem" onclick="setOrderStatus(' + o.rowIndex + ',\'approved\')">✅ อนุมัติ</button>'
          + '<button class="btn btn-sm fw-bold" style="background:#fef2f2;color:#dc2626;border-radius:8px;font-size:.73rem" onclick="setOrderStatus(' + o.rowIndex + ',\'rejected\')">❌ ปฏิเสธ</button>'
          + '</div>'
        : '')
      + '</div>';
  }).join('');
}

async function setOrderStatus(rowIndex, newStatus) {
  loading('กำลังอัปเดต...');
  try {
    var res = await updateRedemptionStatusByRowDb(rowIndex, newStatus);
    Swal.close();
    if (res.status === 'success') {
      Swal.fire({ icon: 'success', title: 'อัปเดตแล้ว', timer: 1200, timerProgressBar: true, confirmButtonColor: '#4f46e5' });
      if (tShopOrders) {
        for (var i = 0; i < tShopOrders.length; i++) {
          if (tShopOrders[i].rowIndex === rowIndex) { tShopOrders[i].status = newStatus; break; }
        }
        renderTeacherOrders(tShopOrders, tOrderFilter);
      }
    } else {
      Swal.fire({ icon: 'error', title: 'ผิดพลาด', text: res.msg });
    }
  } catch (e) {
    onErr(e);
  }
}

async function loadWalletSummary() {
  var grade = document.getElementById('walletGrade').value;
  var el = document.getElementById('walletSummaryList');
  el.innerHTML = '<div class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลด...</div>';
  try {
    var data = await getGradeWalletSummaryDb(grade);
    if (!data.length) {
      el.innerHTML = '<div class="text-center py-4 text-muted">ไม่พบข้อมูล</div>';
      return;
    }
    el.innerHTML = '<div class="row g-2 mb-3">'
      + '<div class="col-4"><div class="stat-card sc-p"><div class="ico"><i class="fa-solid fa-users"></i></div><div><div class="val">' + data.length + '</div><div class="lbl">นักเรียน</div></div></div></div>'
      + '<div class="col-4"><div class="stat-card sc-y"><div class="ico"><i class="fa-solid fa-coins"></i></div><div><div class="val">' + data.reduce(function(a, d) { return a + d.mathCoins; }, 0) + '</div><div class="lbl">เหรียญรวม</div></div></div></div>'
      + '<div class="col-4"><div class="stat-card sc-g"><div class="ico"><i class="fa-solid fa-star"></i></div><div><div class="val">' + data.reduce(function(a, d) { return a + d.lifetimeExp; }, 0) + '</div><div class="lbl">EXP รวม</div></div></div></div>'
      + '</div>'
      + '<div class="table-responsive"><table class="s-tbl"><thead><tr><th>#</th><th>ชื่อ-นามสกุล</th><th class="text-center">EXP รวม</th><th class="text-center">เหรียญคงเหลือ</th></tr></thead><tbody>'
      + data.map(function(s, i) {
        return '<tr><td style="color:#94a3b8;font-size:.78rem">' + (i + 1) + '</td><td class="fw-bold" style="font-size:.87rem">' + escHtml(s.name) + '<br><small style="color:#94a3b8;font-weight:400">' + escHtml(s.id) + '</small></td><td class="text-center"><span class="pill p-pri">' + s.lifetimeExp + '</span></td><td class="text-center"><span class="pill ' + (s.mathCoins > 0 ? 'p-y' : 'p-gray') + '" style="font-size:.85rem">🪙 ' + s.mathCoins + '</span></td></tr>';
      }).join('')
      + '</tbody></table></div>';
  } catch (e) {
    el.innerHTML = '<div class="text-center py-4 text-danger">โหลดไม่สำเร็จ: ' + escHtml(e.message || '') + '</div>';
  }
}

/* ════════════════════════════════════════════════════
   STUDENT MAGIC SHOP
═════════════════════════════════════════════════════ */
function openShop() {
  document.getElementById('shopOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  loadShopData();
}

function closeShop() {
  document.getElementById('shopOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

function handleShopOverlayClick(e) {
  if (e.target === document.getElementById('shopOverlay')) closeShop();
}

function switchShopTab(tab) {
  shopTabCurrent = tab;
  document.getElementById('shopTabContent').style.display = tab === 'shop' ? 'block' : 'none';
  document.getElementById('historyTabContent').style.display = tab === 'history' ? 'block' : 'none';
  document.getElementById('stab-shop').classList.toggle('active', tab === 'shop');
  document.getElementById('stab-history').classList.toggle('active', tab === 'history');
  if (tab === 'history') loadRedemptionHistory();
}

async function loadShopData() {
  await refreshWallet();
  if (shopItems !== null) {
    renderShopItems(shopItems);
    return;
  }
  var grid = document.getElementById('shopGrid');
  grid.innerHTML = '<div class="shop-skeleton"></div>'.repeat(4);
  try {
    shopItems = await getShopItemsDb();
    renderShopItems(shopItems);
  } catch (e) {
    document.getElementById('shopGrid').innerHTML = '<div class="shop-empty" style="grid-column:1/-1"><div class="shop-empty-icon">😵</div><p>โหลดสินค้าไม่สำเร็จ</p></div>';
  }
}

async function refreshWallet() {
  document.getElementById('shopCoinsDisplay').textContent = '…';
  document.getElementById('shopLifetimeDisplay').textContent = 'Lifetime EXP: …';
  try {
    shopWallet = await getWalletBalanceDb(CU.id);
    updateWalletUI(shopWallet, null);
    updateShopCoinsBadge(shopWallet.mathCoins);
  } catch (e) {}
}

function updateWalletUI(w, prevCoins) {
  var el = document.getElementById('shopCoinsDisplay');
  el.textContent = w.mathCoins + ' 🪙';
  if (prevCoins !== null && prevCoins !== w.mathCoins) {
    if (el.animate) {
      el.animate([
        { transform: 'scale(1)', textShadow: '0 0 0 rgba(251,191,36,0)' },
        { transform: 'scale(1.18)', textShadow: '0 0 14px rgba(251,191,36,.75)' },
        { transform: 'scale(1)', textShadow: '0 0 0 rgba(251,191,36,0)' }
      ], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1)' });
    } else {
      el.classList.remove('coin-flash');
      requestAnimationFrame(function() { el.classList.add('coin-flash'); });
    }
  }
  document.getElementById('shopLifetimeDisplay').textContent =
    'Lifetime EXP: ' + w.lifetimeExp + ' | ใช้ไปแล้ว: ' + w.totalSpent;
}

function updateShopCoinsBadge(coins) {
  var b = document.getElementById('shopCoinsBadge');
  if (b) b.textContent = coins + ' 🪙';
}

function renderShopItems(items) {
  var grid = document.getElementById('shopGrid');
  if (!items || !items.length) {
    grid.innerHTML = '<div class="shop-empty" style="grid-column:1/-1"><div class="shop-empty-icon">🏪</div><p>ยังไม่มีสินค้าในร้านค้าตอนนี้</p></div>';
    return;
  }
  var coins = shopWallet ? shopWallet.mathCoins : 0;
  grid.innerHTML = items.map(function(item) {
    var canAfford = coins >= item.cost;
    var imgHtml = item.image
      ? '<img src="' + item.image + '" class="shop-item-img" alt="' + escHtml(item.itemName) + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\'"><span class="shop-item-emoji" style="display:none">🎁</span>'
      : '<span class="shop-item-emoji">🎁</span>';
    return '<div class="shop-item">'
      + imgHtml
      + '<div class="shop-item-name">' + escHtml(item.itemName) + '</div>'
      + (item.description ? '<div class="shop-item-desc">' + escHtml(item.description) + '</div>' : '')
      + '<div class="shop-item-cost"><span>🪙</span>' + item.cost + '</div>'
      + '<button class="shop-buy-btn' + (canAfford ? '' : ' cant-afford') + '" ' + (canAfford ? '' : 'disabled ') + 'onclick="tryBuyItem(\'' + escHtml(item.itemId) + '\',\'' + escHtml(item.itemName) + '\',' + item.cost + ')">'
      + (canAfford ? '🛍️ ซื้อเลย' : '🔒 เหรียญไม่พอ')
      + '</button></div>';
  }).join('');
}

async function getWalletBalance(studentId) {
  return getWalletBalanceDb(studentId || CU.id);
}

async function buyShopItem(itemId, itemName, cost) {
  return tryBuyItem(itemId, itemName, cost);
}

function tryBuyItem(itemId, itemName, cost) {
  /* ── z-index fix: บังคับ SweetAlert2 ลอยเหนือ .shop-overlay (z-index:2000) ── */
  var SWAL_ABOVE = { customClass: { container: 'swal-above-shop' } };

  if (!shopWallet) return Swal.fire(Object.assign({ icon: 'info', title: 'กรุณารอ', text: 'กำลังโหลดข้อมูลเหรียญ' }, SWAL_ABOVE));
  if (shopWallet.mathCoins < cost) {
    return Swal.fire(Object.assign({
      icon: 'warning',
      title: 'เหรียญไม่เพียงพอ',
      html: 'คุณมี <b>' + shopWallet.mathCoins + ' 🪙</b><br>ต้องการ <b>' + cost + ' 🪙</b>',
      confirmButtonColor: '#4f46e5'
    }, SWAL_ABOVE));
  }
  Swal.fire(Object.assign({
    title: 'ยืนยันการซื้อ',
    html: '<div style="text-align:center"><div style="font-size:1.1rem;font-weight:700;color:#1e293b;margin-bottom:8px">' + escHtml(itemName) + '</div><div style="display:inline-flex;align-items:center;gap:6px;background:#fef9c3;border:1px solid #fde68a;border-radius:999px;padding:4px 16px"><span>🪙</span><span style="font-size:1.1rem;font-weight:800;color:#92400e">' + cost + '</span></div><div style="margin-top:10px;font-size:.82rem;color:#64748b">เหลือ ' + (shopWallet.mathCoins - cost) + ' 🪙</div></div>',
    showCancelButton: true,
    confirmButtonText: '🛍️ ยืนยันซื้อ',
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#4f46e5'
  }, SWAL_ABOVE)).then(async function(r) {
    if (!r.isConfirmed) return;
    loading('กำลังดำเนินการ...');
    try {
      var res = await buyItemDb(CU.id, itemId, itemName, cost);
      Swal.close();
      if (res.status === 'success') {
        var prevCoins = shopWallet.mathCoins;
        var spent = Number(res.pointsUsed) || Number(cost) || 0;
        shopWallet.mathCoins = res.mathCoins;
        shopWallet.totalSpent = (shopWallet.totalSpent || 0) + spent;
        updateWalletUI(shopWallet, prevCoins);
        updateShopCoinsBadge(res.mathCoins);
        shopItems = null;
        loadShopData();
        fireShopConfetti();
        Swal.fire(Object.assign({
          icon: 'success',
          title: 'ซื้อสำเร็จ! 🎉',
          html: escHtml(res.itemName || itemName) + '<br><small style="color:#64748b">ครูจะตรวจสอบและมอบของรางวัลให้เร็วๆ นี้</small><br><br>เหลือ <b style="color:#92400e">' + res.mathCoins + ' 🪙</b>',
          confirmButtonColor: '#10b981',
          timer: 4000,
          timerProgressBar: true
        }, SWAL_ABOVE));
      } else {
        Swal.fire(Object.assign({ icon: 'error', title: 'ไม่สำเร็จ', text: res.msg, confirmButtonColor: '#ef4444' }, SWAL_ABOVE));
      }
    } catch (e) {
      onErr(e);
    }
  });
}
function fireShopConfetti() {
  if (typeof confetti === 'undefined') return;
  var count = 180, defaults = { origin: { y: 0.65 } };
  function fire(part, opts) {
    confetti(Object.assign({}, defaults, opts, { particleCount: Math.floor(count * part) }));
  }
  fire(0.25, { spread: 26, startVelocity: 55 });
  fire(0.2, { spread: 60 });
  fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
  fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
  fire(0.1, { spread: 120, startVelocity: 45 });
}

async function loadRedemptionHistory() {
  var el = document.getElementById('redemptionList');
  el.innerHTML = '<div class="shop-empty"><div class="shop-empty-icon" style="font-size:1.5rem">⏳</div><p>กำลังโหลด...</p></div>';
  try {
    var logs = await getRedemptionHistoryDb(CU.id);
    if (!logs.length) {
      el.innerHTML = '<div class="shop-empty"><div class="shop-empty-icon">🧾</div><p>ยังไม่มีประวัติการซื้อ</p></div>';
      return;
    }
    var statusBadge = function(s) {
      if (s === 'approved') return '<span class="badge-approved">✓ อนุมัติแล้ว</span>';
      if (s === 'rejected') return '<span class="badge-rejected">✗ ปฏิเสธ</span>';
      return '<span class="badge-pending">⏳ รอดำเนินการ</span>';
    };
    el.innerHTML = logs.map(function(l) {
      var costHtml = l.cost > 0
        ? '<div class="ri-cost">-' + l.cost + ' 🪙</div>'
        : '<div class="ri-cost" style="color:#a5b4fc">ครูมอบให้</div>';
      return '<div class="redeem-item"><div style="flex:1;min-width:0"><div class="ri-name">' + escHtml(l.itemName) + '</div><div class="ri-date">' + l.date + '</div></div><div style="text-align:right;flex-shrink:0">' + costHtml + statusBadge(l.status) + '</div></div>';
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="shop-empty"><div class="shop-empty-icon">😵</div><p>โหลดประวัติไม่สำเร็จ</p></div>';
  }
}
