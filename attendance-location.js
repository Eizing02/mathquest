/* Location is requested only for a check-in. Supabase owns the policy and decision. */
var attendanceLocationBusy = false;
var attendanceLocationRun = null;
var attendanceLocationRequest = null;
var attendanceLocationMessages = {
  LOCATION_REQUIRED: 'ต้องใช้ตำแหน่งที่ตั้งในการเช็คชื่อ กรุณาโหลดหน้าเว็บใหม่',
  LOCATION_UPDATE_REQUIRED: 'ระบบตำแหน่งยังไม่พร้อม กรุณาแจ้งครูให้อัปเดต SQL 20261028_01_attendance_geofence.sql',
  LOCATION_PERMISSION: 'ยังไม่ได้อนุญาตตำแหน่ง เปิดสิทธิ์ตำแหน่งที่ตั้งให้เบราว์เซอร์ แล้วลองอีกครั้ง',
  LOCATION_UNAVAILABLE: 'เครื่องยังระบุตำแหน่งไม่ได้ ลองย้ายไปบริเวณที่รับสัญญาณได้ดีขึ้น หรือแจ้งครู',
  LOCATION_TIMEOUT: 'ตรวจตำแหน่งไม่ทันเวลา ลองใหม่อีกครั้ง หากยังไม่ได้ให้แจ้งครู',
  LOCATION_UNSUPPORTED: 'เบราว์เซอร์นี้ใช้ตำแหน่งไม่ได้ กรุณาเปิดเว็บด้วย Safari หรือ Chrome ผ่าน HTTPS หรือแจ้งครู',
  LOCATION_INACCURATE: 'ตำแหน่งยังคลาดเคลื่อนมากเกินไป ลองใหม่ในบริเวณที่รับสัญญาณได้ดีขึ้น หรือแจ้งครู',
  LOCATION_OUTSIDE: 'ตำแหน่งที่เครื่องรายงานอยู่นอกพื้นที่ 100 เมตร กรุณาเข้าพื้นที่แล้วลองใหม่ หากอยู่ที่โรงเรียนแล้วให้แจ้งครู',
  LOCATION_UNCERTAIN: 'ตำแหน่งอยู่ใกล้ขอบเขตและยังคลาดเคลื่อน ลองใหม่ใกล้จุดเช็คชื่อขึ้น หรือแจ้งครู',
  LOCATION_INVALID: 'ข้อมูลตำแหน่งไม่สมบูรณ์ กรุณาลองตรวจตำแหน่งใหม่',
  LOCATION_REQUEST_INVALID: 'ข้อมูลบัญชีหรือคำขอเปลี่ยนแล้ว กรุณาลองเช็คชื่อใหม่',
  LOCATION_REQUEST_EXPIRED: 'คำขอตรวจตำแหน่งหมดอายุแล้ว กรุณาลองเช็คชื่อใหม่',
  LOCATION_SESSION_CHANGED: 'คาบเรียนเปลี่ยนหรือปิดแล้ว กรุณาสอบถามครู',
  LOCATION_NO_SESSION: 'ยังไม่มีคาบเรียนที่เปิดอยู่ กรุณารอครูเปิดคาบ',
  LOCATION_WRONG_PIN: 'รหัส PIN ไม่ถูกต้อง กรุณาตรวจสอบกับครู',
  LOCATION_PIN_EXPIRED: 'รหัส PIN หมดอายุแล้ว กรุณาสอบถามครู',
  LOCATION_WRONG_CLASS: 'คาบนี้ไม่ได้เปิดสำหรับห้องของคุณ กรุณาตรวจสอบกับครู',
  LOCATION_NOT_CONFIGURED: 'ยังไม่ได้ตั้งค่าพื้นที่เช็คชื่อ กรุณาแจ้งครู',
  LOCATION_RATE_LIMIT: 'ลองเช็คชื่อหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
  LOCATION_NETWORK: 'เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง รหัส PIN ยังอยู่',
  LOCATION_SIGN_IN: 'กรุณาเข้าสู่ระบบ Google และเชื่อมรหัสนักเรียนก่อนเช็คชื่อ',
  LOCATION_FAILED: 'ยังบันทึกการเช็คชื่อไม่ได้ กรุณาลองใหม่หรือแจ้งครู'
};

function attendanceLocationIdentity() {
  return [CU.id, CU.authMode, googleAccount && googleAccount.authSessionId,
    googleAccount && googleAccount.linkVersion, schoolSemester.version].join(':');
}

function setAttendanceLocationStatus(state, message, detail) {
  var region = document.getElementById('attendanceLocationStatus');
  if (!region) return;
  region.dataset.state = state;
  document.getElementById('attendanceLocationText').textContent = message;
  document.getElementById('attendanceLocationDetail').textContent = detail || '';
  var icons = { idle: 'location-dot', loading: 'location-crosshairs', success: 'circle-check', error: 'circle-exclamation', guest: 'flask' };
  document.getElementById('attendanceLocationIcon').className = 'fa-solid fa-' + (icons[state] || icons.error);
}

function setAttendanceLocationBusy(busy) {
  attendanceLocationBusy = busy;
  var button = document.getElementById('checkInBtn'), input = document.getElementById('pinCode');
  if (button) { button.disabled = busy; button.setAttribute('aria-busy', String(busy)); }
  if (input) input.readOnly = busy;
  var label = document.getElementById('checkInLabel');
  if (label) label.textContent = busy ? 'กำลังตรวจสอบการเช็คชื่อ' : 'เช็คชื่อเข้าเรียน';
}

function cancelAttendanceLocation() {
  var run = attendanceLocationRun;
  attendanceLocationRun = null;
  attendanceLocationRequest = null;
  if (run) { run.cancelled = true; if (run.cancel) run.cancel(); }
  setAttendanceLocationBusy(false);
}

function resetAttendanceLocationStatus(guest) {
  cancelAttendanceLocation();
  setAttendanceLocationStatus(guest ? 'guest' : 'idle', guest ? 'โหมดทดลอง ไม่ตรวจตำแหน่งจริง' : 'ใช้ตำแหน่งภายใน 100 เมตร',
    guest ? 'ข้อมูลทดลองไม่บันทึกเข้าเรียนจริง' : 'ขอตำแหน่งเฉพาะเมื่อกดเช็คชื่อ หากเครื่องระบุตำแหน่งไม่ได้ให้แจ้งครู');
}

function attendanceLocationError(code, details) {
  return Object.assign({ result: 'error', code: code, msg: attendanceLocationMessages[code] || attendanceLocationMessages.LOCATION_FAILED }, details || {});
}

async function attendanceLocationRpc(name, args) {
  try { return await runQuery(getSupabase().rpc(name, args)); }
  catch (error) {
    var message = error && error.message || '';
    if ((error && ['PGRST202', '42883'].indexOf(error.code) !== -1) || /Could not find the function/.test(message)) {
      throw attendanceLocationError('LOCATION_UPDATE_REQUIRED');
    }
    if (/GOOGLE_SESSION_REQUIRED|LINKED_STUDENT_REQUIRED|ข้อมูลถูกรีเซ็ต/.test(message)) {
      throw attendanceLocationError('LOCATION_REQUEST_INVALID');
    }
    throw attendanceLocationError(/fetch|network|timeout/i.test(message) ? 'LOCATION_NETWORK' : 'LOCATION_FAILED');
  }
}

function readAttendanceLocation(run, maxAccuracy) {
  return new Promise(function(resolve, reject) {
    var watch = null, timer = null, finished = false, bestAccuracy = null;
    function finish(error, fix) {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (watch !== null) navigator.geolocation.clearWatch(watch);
      run.cancel = null;
      if (error) reject(error); else resolve(fix);
    }
    run.cancel = function() { finish({ result: 'cancelled' }); };
    timer = setTimeout(function() {
      finish(attendanceLocationError(bestAccuracy === null ? 'LOCATION_TIMEOUT' : 'LOCATION_INACCURATE', { accuracy_m: bestAccuracy }));
    }, 20000);
    try {
      watch = navigator.geolocation.watchPosition(function(position) {
        if (finished) return;
        if (run.cancelled || attendanceLocationIdentity() !== run.identity) return finish({ result: 'cancelled' });
        var coords = position.coords, age = Date.now() - position.timestamp;
        if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude) ||
          Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180 ||
          !Number.isFinite(coords.accuracy) || coords.accuracy <= 0 || !Number.isFinite(age) || age < -2000 || age > 15000) return;
        bestAccuracy = bestAccuracy === null ? coords.accuracy : Math.min(bestAccuracy, coords.accuracy);
        if (coords.accuracy > maxAccuracy) {
          setAttendanceLocationStatus('loading', 'กำลังรอตำแหน่งที่แม่นยำขึ้น', 'เครื่องรายงานความคลาดเคลื่อนประมาณ ' + Math.ceil(bestAccuracy) + ' เมตร');
          return;
        }
        finish(null, { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, timestamp: position.timestamp });
      }, function(error) {
        finish(attendanceLocationError(error.code === 1 ? 'LOCATION_PERMISSION' : error.code === 3 ? 'LOCATION_TIMEOUT' : 'LOCATION_UNAVAILABLE'));
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
      if (finished) navigator.geolocation.clearWatch(watch);
    } catch (error) { finish(attendanceLocationError('LOCATION_UNAVAILABLE')); }
  });
}

async function submitLocationCheckIn(pin) {
  if (attendanceLocationBusy) return { result: 'cancelled' };
  if (!isGoogleLoginActive() || CU.role !== 'STUDENT') return attendanceLocationError('LOCATION_SIGN_IN');
  if (!window.isSecureContext || !navigator.geolocation) {
    var unsupported = attendanceLocationError('LOCATION_UNSUPPORTED');
    setAttendanceLocationStatus('error', unsupported.msg); return unsupported;
  }
  var run = { identity: attendanceLocationIdentity(), cancelled: false, cancel: null };
  attendanceLocationRun = run;
  setAttendanceLocationBusy(true);
  setAttendanceLocationStatus('loading', 'กำลังตรวจสอบคาบเรียน', 'ยังไม่บันทึกการเข้าเรียนจนกว่าจะตรวจตำแหน่งผ่าน');
  function current() { return !run.cancelled && attendanceLocationRun === run && attendanceLocationIdentity() === run.identity; }
  try {
    var cached = attendanceLocationRequest;
    var prepared = cached && cached.identity === run.identity && cached.pin === pin && Date.now() < cached.validUntil ? cached.prepared :
      await attendanceLocationRpc('mq_prepare_location_check_in', { p_pin: pin, p_expected_version: schoolSemester.version });
    if (!current()) return { result: 'cancelled' };
    if (!prepared || prepared.result !== 'ready') throw prepared || attendanceLocationError('LOCATION_FAILED');
    if (!prepared.request_id || !Number.isFinite(prepared.max_accuracy_m) || prepared.max_accuracy_m <= 0 || prepared.max_accuracy_m > 50) {
      throw attendanceLocationError('LOCATION_FAILED');
    }
    if (!cached || cached.prepared !== prepared) attendanceLocationRequest = { identity: run.identity, pin: pin, prepared: prepared, validUntil: Date.now() + 45000 };
    setAttendanceLocationStatus('loading', 'กำลังตรวจตำแหน่ง กรุณาอนุญาตเมื่อเครื่องถาม', 'ใช้ตำแหน่งครั้งนี้เท่านั้น ไม่ติดตามหลังเช็คชื่อ');
    var fix = await readAttendanceLocation(run, prepared.max_accuracy_m);
    if (!current()) return { result: 'cancelled' };
    setAttendanceLocationStatus('loading', 'กำลังยืนยันกับระบบ', 'ตรวจพื้นที่และบันทึกการเข้าเรียน');
    var result = await attendanceLocationRpc('mq_student_check_in_at_location', {
      p_request_id: prepared.request_id, p_pin: pin, p_expected_version: schoolSemester.version,
      p_latitude: fix.latitude, p_longitude: fix.longitude, p_accuracy: fix.accuracy,
      p_fix_age_ms: Math.max(0, Date.now() - fix.timestamp)
    });
    if (!current()) return { result: 'cancelled' };
    if (!result || (result.result !== 'success' && result.result !== 'duplicate')) throw result || attendanceLocationError('LOCATION_FAILED');
    attendanceLocationRequest = null;
    setAttendanceLocationStatus('success', result.result === 'duplicate' ? 'มีข้อมูลเข้าเรียนคาบนี้แล้ว' : 'ตรวจตำแหน่งและเช็คชื่อสำเร็จ',
      Number.isFinite(result.distance_m) ? 'ห่างจากจุดเช็คชื่อประมาณ ' + Math.ceil(result.distance_m) + ' เมตร' : 'ตรวจสอบประวัติการเข้าเรียนได้');
    return result;
  } catch (error) {
    if (!current() || error.result === 'cancelled') return { result: 'cancelled' };
    var failure = error.code ? attendanceLocationError(error.code, error) : Object.assign(attendanceLocationError('LOCATION_FAILED'), error);
    if (failure.code !== 'LOCATION_NETWORK') attendanceLocationRequest = null;
    var detail = Number.isFinite(failure.distance_m) ? 'เครื่องรายงานระยะประมาณ ' + Math.ceil(failure.distance_m) + ' เมตร' : '';
    if (Number.isFinite(failure.accuracy_m)) detail += (detail ? ' · ' : '') + 'คลาดเคลื่อนประมาณ ' + Math.ceil(failure.accuracy_m) + ' เมตร';
    setAttendanceLocationStatus('error', failure.msg, detail);
    return failure;
  } finally {
    if (attendanceLocationRun === run) { attendanceLocationRun = null; setAttendanceLocationBusy(false); }
  }
}

window.addEventListener('pagehide', cancelAttendanceLocation);
document.addEventListener('visibilitychange', function() {
  if (document.hidden && attendanceLocationBusy) {
    cancelAttendanceLocation();
    setAttendanceLocationStatus('idle', 'หยุดตรวจตำแหน่งแล้ว', 'กลับมากดเช็คชื่อใหม่เมื่อต้องการ');
  }
});
