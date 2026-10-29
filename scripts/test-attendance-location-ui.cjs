const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('./serve.cjs');
async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const output = path.resolve(__dirname, '../tmp/attendance-location');
  fs.mkdirSync(output, { recursive: true });
  const errors = [], production = [], calls = [];
  let decision = 'success', failNetwork = false, missing = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*.supabase.co/**', route => { production.push(route.request().url()); return route.fulfill({ contentType: 'application/json', body: '[]' }); });
  // Disable live auth/bootstrap in this synthetic app fixture, including the real SDK.
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route => route.fulfill({ contentType: 'application/javascript', body: `window.supabase={createClient(){return {
    auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    from(){const q={select(){return q},eq(){return q},then(resolve){return Promise.resolve({data:[],error:null}).then(resolve)}};return q},
    rpc:async()=>({data:null,error:null})
  }}};` }));
  await page.route('**/__location_fixture', async route => {
    const { name, args } = route.request().postDataJSON(); calls.push({ name, args });
    let data, error = null;
    if (missing) error = { code: 'PGRST202', message: 'Could not find the function' };
    else if (name === 'mq_prepare_location_check_in') data = { result: 'ready', request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', max_accuracy_m: 50, radius_m: 100 };
    else if (name === 'mq_student_check_in_at_location') {
      data = decision === 'success' ? { result: 'success', points: 5, distance_m: 0, accuracy_m: 10 } :
        { result: 'error', code: decision, distance_m: decision === 'LOCATION_OUTSIDE' ? 150 : 90, accuracy_m: 30 };
      if (failNetwork) { failNetwork = false; error = { message: 'Failed to fetch' }; data = null; }
    } else throw new Error('Unexpected location endpoint: ' + name);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data, error }) });
  });
  await page.addInitScript(() => {
    window.fixtureLocation = { mode: 'inside', watches: 0, cleared: 0, options: null };
    let next = 0; const watches = new Map();
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition(success, error, options) {
        fixtureLocation.watches++; fixtureLocation.options = options;
        const id = ++next;
        const timer = setInterval(() => {
          const mode = fixtureLocation.mode;
          if (mode === 'denied') return error({ code: 1 });
          if (mode === 'timeout') return error({ code: 3 });
          if (mode === 'unavailable') return error({ code: 2 });
          success({ coords: { latitude: 17.131333, longitude: 102.103092, accuracy: mode === 'waiting' ? 200 : 10 }, timestamp: Date.now() });
        }, 25);
        watches.set(id, timer); return id;
      },
      clearWatch(id) { clearInterval(watches.get(id)); watches.delete(id); fixtureLocation.cleared++; }
    } });
  });
  try {
    await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof submitLocationCheckIn === 'function' && typeof Swal !== 'undefined');
    await page.evaluate(() => {
      Swal.close(); stopSchoolSync(); stopGoogleAccountGuard();
      getSupabase = () => ({ rpc: async (name, args) => {
        const response = await fetch('/__location_fixture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) });
        return response.json();
      } });
      schoolSemester.version = 'fixture-v1';
      CU = { id: '00001', name: 'นักเรียนทดสอบ', grade: 'ม.2/1', role: 'STUDENT', authMode: 'google' };
      googleAccount = { authSessionId: 'fixture-session', linkVersion: 'fixture-link' };
      document.getElementById('loginSection').classList.add('hidden');
      document.getElementById('studentSection').classList.remove('hidden');
      document.getElementById('sNameDisp').textContent = CU.name;
      document.getElementById('sGradeDisp').textContent = CU.grade;
      resetAttendanceLocationStatus(false);
      getStudentPointsAndLevelDb = async () => ({ level: 1, totalPoints: 5, currentExp: 0, requiredExp: 5 });
      getWalletBalanceDb = async () => ({ mathCoins: 5 });
    });
    assert.equal(await page.evaluate(() => fixtureLocation.watches), 0, 'no location request on page load');
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'overflow ' + width);
      const box = await page.locator('#checkInBtn').boundingBox(); assert.ok(box.height >= 44);
      if (!process.argv.includes('--no-capture')) await page.locator('#studentCheckInSurface').screenshot({ path: path.join(output, 'idle-' + width + '.png') });
    }
    async function start(mode) {
      await page.evaluate(mode => { cancelAttendanceLocation(); fixtureLocation.mode = mode; Swal.close(); }, mode);
      await page.locator('#pinCode').fill('1234'); await page.locator('#checkInBtn').click();
    }
    async function finished() { await page.waitForFunction(() => !attendanceLocationBusy); }
    for (const [mode, expected] of [['denied', 'ตำแหน่ง'], ['unavailable', 'ระบุตำแหน่งไม่ได้'], ['timeout', 'ไม่ทันเวลา']]) {
      const count = calls.filter(c => c.name === 'mq_student_check_in_at_location').length;
      await start(mode); await finished();
      assert.match(await page.locator('#attendanceLocationText').textContent(), new RegExp(expected));
      assert.equal(await page.locator('#pinCode').inputValue(), '1234');
      assert.equal(calls.filter(c => c.name === 'mq_student_check_in_at_location').length, count, 'no commit after geolocation failure');
    }
    await start('waiting'); await page.waitForFunction(() => document.querySelector('#attendanceLocationText').textContent.includes('แม่นยำขึ้น'));
    assert.equal(await page.locator('#checkInBtn').isDisabled(), true);
    const count = calls.length; await page.locator('#pinCode').press('Enter'); assert.equal(calls.length, count, 'Enter cannot double submit');
    if (!process.argv.includes('--no-capture')) await page.locator('#studentCheckInSurface').screenshot({ path: path.join(output, 'waiting-1280.png') });
    await page.evaluate(() => { fixtureLocation.mode = 'inside'; }); await finished();
    await page.waitForFunction(() => document.getElementById('pinCode').value === '', { timeout: 5000 });
    assert.equal(await page.locator('#pinCode').inputValue(), '', 'successful check-in clears PIN after the 3-second visual feedback');
    const opts = await page.evaluate(() => fixtureLocation.options);
    assert.equal(opts.enableHighAccuracy, true); assert.equal(opts.maximumAge, 0); assert.equal(opts.timeout, 20000);
    const commitsBeforePoorFix = calls.filter(c => c.name === 'mq_student_check_in_at_location').length;
    await start('waiting'); await finished();
    assert.match(await page.locator('#attendanceLocationText').textContent(), /คลาดเคลื่อนมากเกินไป/);
    assert.equal(calls.filter(c => c.name === 'mq_student_check_in_at_location').length, commitsBeforePoorFix, 'poor fixes never turn into automatic acceptance at the deadline');
    for (const code of ['LOCATION_OUTSIDE', 'LOCATION_UNCERTAIN', 'LOCATION_REQUEST_EXPIRED', 'LOCATION_SESSION_CHANGED']) {
      decision = code; await start('inside'); await finished();
      assert.equal(await page.locator('#attendanceLocationStatus').getAttribute('data-state'), 'error');
      assert.equal(await page.locator('#pinCode').inputValue(), '1234');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    decision = 'LOCATION_OUTSIDE'; await start('inside'); await finished(); await page.evaluate(() => Swal.close());
    if (!process.argv.includes('--no-capture')) await page.locator('#studentCheckInSurface').screenshot({ path: path.join(output, 'outside-390.png') });
    decision = 'success'; failNetwork = true; await start('inside'); await finished();
    assert.match(await page.locator('#attendanceLocationText').textContent(), /อินเทอร์เน็ต/);
    const preparedCount = calls.filter(c => c.name === 'mq_prepare_location_check_in').length;
    await page.evaluate(() => Swal.close()); await page.locator('#checkInBtn').click(); await finished();
    assert.equal(calls.filter(c => c.name === 'mq_prepare_location_check_in').length, preparedCount, 'network retry reuses the same live nonce');
    await start('waiting'); await page.waitForFunction(() => document.querySelector('#attendanceLocationText').textContent.includes('แม่นยำขึ้น'));
    const commits = calls.filter(c => c.name === 'mq_student_check_in_at_location').length;
    await page.evaluate(() => { CU.id = '00002'; cancelAttendanceLocation(); }); await finished();
    assert.equal(calls.filter(c => c.name === 'mq_student_check_in_at_location').length, commits, 'identity switch cancels pending geolocation');
    await page.evaluate(() => { CU.id = '00001'; });
    missing = true; await start('inside'); await finished();
    assert.match(await page.locator('#attendanceLocationText').textContent(), /20261028_01_attendance_geofence.sql/);
    assert.ok(calls.every(c => !Object.hasOwn(c.args, 'student_id') && !Object.hasOwn(c.args, 'p_student_id')));
    assert.ok(!(await page.evaluate(() => Object.keys(localStorage).some(key => /latitude|longitude|location-request/.test(key)))), 'no coordinates in localStorage');
    assert.equal(await page.evaluate(() => fixtureLocation.watches === fixtureLocation.cleared), true, 'all watches stop');
    assert.deepEqual(errors, []);
    assert.deepEqual(production, [], 'no production database request');
    console.log('PASS synthetic browser: permission/unavailable/timeout/retry states, no background GPS, cleanup/identity cancellation, busy guard, server errors, migration guidance, nonce retry, no caller-selected ID, responsive 320/390/768/1280; no real device GPS or production DB');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
