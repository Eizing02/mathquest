/* School metadata is deliberately not an archive: a new-term reset deletes progress. */
var teacherAdminToken = '';
var schoolSemester = { number: '', year: '', start: '', end: '', version: '' };
var schoolRooms = [];
var schoolSyncTimer = null;
var schoolSyncChannel = null;
var schoolSyncBusy = false;
var schoolResetBusy = false;

async function schoolRpc(name, args) {
  try {
    return await runQuery(getSupabase().rpc(name, args || {}));
  } catch (error) {
    if (error.code === 'PGRST202' || /Could not find the function/.test(error.message || '')) {
      if (name === 'reset_school_progress') {
        throw new Error('ยังไม่ได้อัปเดตการล้างข้อมูล กรุณารันไฟล์ 20261010_02_reset_progress_without_dates.sql ก่อน');
      }
      throw new Error('ยังไม่ได้อัปเดตฐานข้อมูล กรุณารันไฟล์ 20261010_01_school_term_reset_otp.sql ก่อน');
    }
    throw error;
  }
}

async function openTeacherAdminSession(id, password) {
  teacherAdminToken = await schoolRpc('open_teacher_admin_session', { p_teacher_id: id, p_password: password });
}

function semesterLabel(term) {
  return term && term.number && term.year ? term.number + '/' + term.year : '';
}

function applySemesterSettings(settings) {
  var term = settings.semester || {};
  schoolSemester = {
    number: term.number || '', year: term.year || '', start: term.start || '',
    end: term.end || '', version: term.version || ''
  };
  var label = semesterLabel(schoolSemester);
  ['teacherTermLabel', 'studentTermLabel'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.textContent = label ? 'ภาคเรียน ' + label : 'ยังไม่ระบุภาคเรียน';
  });
  var status = document.getElementById('semesterStatus');
  if (status) status.textContent = label ? 'ปัจจุบัน ' + label : 'ยังไม่ได้ตั้งค่า';
  if (schoolSemester.start && schoolSemester.end) {
    ['reportFrom', 'reportTo'].forEach(function(id, index) {
      var el = document.getElementById(id);
      if (el && !el.dataset.userChanged) el.value = index === 0 ? schoolSemester.start : schoolSemester.end;
    });
  }
}

function populateSemesterForm() {
  document.getElementById('semesterNumber').value = schoolSemester.number || '1';
  document.getElementById('semesterYear').value = schoolSemester.year || new Date().getFullYear() + 543;
  document.getElementById('semesterStart').value = schoolSemester.start;
  document.getElementById('semesterEnd').value = schoolSemester.end;
}

function validSchoolDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}

function readSemesterFields(prefix, requireDates) {
  var number = document.getElementById(prefix + 'Number').value;
  var year = document.getElementById(prefix + 'Year').value.trim();
  var start = document.getElementById(prefix + 'Start').value;
  var end = document.getElementById(prefix + 'End').value;
  if (!/^[12]$/.test(number) || !/^\d{4}$/.test(year) || Number(year) < 2500 || Number(year) > 2800) {
    throw new Error('เลือกภาคเรียน 1 หรือ 2 และระบุปีการศึกษา พ.ศ. 2500–2800');
  }
  if ((requireDates && (!start || !end)) || (!!start !== !!end) ||
      (start && (!validSchoolDate(start) || !validSchoolDate(end) || start > end))) {
    throw new Error('ระบุวันเริ่มและวันสิ้นสุดให้ครบ โดยวันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
  }
  return { number: number, year: year, start: start, end: end };
}

function teacherTokenArgs() {
  if (!teacherAdminToken) throw new Error('กรุณาอัปเดต SQL แล้วออกจากระบบและเข้าสู่ระบบครูอีกครั้ง');
  return { p_teacher_token: teacherAdminToken };
}

async function saveSemester() {
  var button = document.getElementById('semesterSaveBtn');
  try {
    var term = readSemesterFields('semester', false);
    button.disabled = true;
    await schoolRpc('set_school_semester', Object.assign(teacherTokenArgs(), {
      p_number: Number(term.number), p_year: Number(term.year),
      p_start: term.start || null, p_end: term.end || null,
      p_expected_version: schoolSemester.version
    }));
    applyAppSettings(await getAppSettingsDb());
    populateSemesterForm();
    await Swal.fire({ icon: 'success', title: 'บันทึกภาคเรียนแล้ว', text: 'ข้อมูลนักเรียนไม่ได้ถูกลบ', confirmButtonText: 'ปิด' });
  } catch (error) { onErr(error); }
  finally { button.disabled = false; }
}

async function openSemesterReset() {
  if (schoolResetBusy) return;
  if (typeof reportExportBusy !== 'undefined' && reportExportBusy) {
    return onErr(new Error('รอให้ส่งออกรายงานเสร็จก่อนล้างข้อมูลนักเรียน'));
  }
  schoolResetBusy = true;
  try {
    var preview = await schoolRpc('preview_school_reset', teacherTokenArgs());
    if (preview.active_session) throw new Error('ยังมีคาบเปิดอยู่ กรุณาปิดหรือยกเลิกคาบก่อน');
    if (preview.pending_orders) throw new Error('มีออเดอร์รอดำเนินการ ' + preview.pending_orders + ' รายการ กรุณาอนุมัติหรือปฏิเสธก่อนล้างข้อมูล');
    var result = await Swal.fire({
      title: 'ล้างข้อมูลนักเรียนทั้งหมด',
      html: '<div class="reset-summary"><strong>นักเรียน ' + preview.students + ' คน</strong>'
        + '<dl><dt>ประวัติเข้าเรียน</dt><dd>' + preview.attendance + ' รายการ</dd>'
        + '<dt>รายการร้านค้า / ของฟรี</dt><dd>' + preview.orders + ' รายการ</dd>'
        + '<dt>สัตว์เลี้ยง</dt><dd>' + preview.pets + ' คน</dd>'
        + '<dt>ประวัติสัตว์เลี้ยง</dt><dd>' + preview.pet_events + ' รายการ</dd></dl>'
        + '<p class="reset-warning">ข้อมูลทุกวันที่บันทึกไว้จะถูกลบถาวรและพิมพ์รายงานย้อนหลังไม่ได้ กรุณาส่งออกรายงานที่ต้องการก่อน</p>'
        + '<p>ชื่อภาคเรียนและวันที่ที่ตั้งไว้จะไม่เปลี่ยน</p></div>'
        + '<label class="reset-ack"><input id="resetAck" type="checkbox"> เข้าใจว่าคะแนน เหรียญ แต้มพิเศษ สัตว์เลี้ยง และประวัติจะถูกลบ โดยคงบัญชีและรูปโปรไฟล์ไว้</label>'
        + '<label for="resetPhrase" class="form-label">พิมพ์ ลบทั้งหมด เพื่อยืนยัน</label>'
        + '<input id="resetPhrase" class="form-control" autocomplete="off">'
        + '<label for="resetTeacherPassword" class="form-label mt-3">รหัสผ่านครูปัจจุบัน</label>'
        + '<input id="resetTeacherPassword" type="password" class="form-control" autocomplete="current-password">',
      width: 600, showCancelButton: true, confirmButtonText: 'ลบข้อมูลนักเรียนถาวร',
      customClass: { title: 'reset-dialog-title', htmlContainer: 'reset-dialog-body', confirmButton: 'reset-confirm-button' },
      cancelButtonText: 'ยกเลิก', confirmButtonColor: UI_COLOR_DANGER,
      focusConfirm: false, showLoaderOnConfirm: true,
      allowOutsideClick: function() { return !Swal.isLoading(); },
      allowEscapeKey: function() { return !Swal.isLoading(); },
      preConfirm: async function() {
        try {
          if (!document.getElementById('resetAck').checked || document.getElementById('resetPhrase').value.trim() !== 'ลบทั้งหมด') {
            throw new Error('ยืนยันผลกระทบและพิมพ์ข้อความยืนยันให้ตรงก่อนลบ');
          }
          var password = document.getElementById('resetTeacherPassword').value;
          if (!password) throw new Error('กรอกรหัสผ่านครูเพื่อยืนยันตัวตน');
          return await schoolRpc('reset_school_progress', Object.assign(teacherTokenArgs(), {
            p_password: password, p_expected_version: preview.version
          }));
        } catch (error) { Swal.showValidationMessage(error.message); return false; }
      }
    });
    if (!result.isConfirmed) return;
    stopSchoolSync();
    await Swal.fire({ icon: 'success', title: 'ล้างข้อมูลนักเรียนแล้ว', text: 'ลบความคืบหน้าเดิมทั้งหมดแล้ว บัญชี รหัสผ่าน รูปโปรไฟล์ และการตั้งค่าภาคเรียนยังอยู่ กรุณาเข้าสู่ระบบอีกครั้ง', confirmButtonText: 'เข้าสู่ระบบใหม่' });
    logout();
  } catch (error) { onErr(error); }
  finally { schoolResetBusy = false; }
}

function applyStudentGradeFilter(query, grade) {
  var target = normalizeGrade(grade);
  if (!target || target === 'all') return query;
  if (/^ม\.[1-6]$/.test(target)) return query.or('grade.eq.' + target + ',grade.like.' + target + '/%');
  return query.eq('grade', target);
}

function roomOptions(aggregate) {
  var options = schoolRooms.map(function(room) { return { value: room, label: room }; });
  if (aggregate) {
    var bases = {};
    schoolRooms.forEach(function(room) {
      var match = /^ม\.[1-6](?=\/|$)/.exec(room);
      if (match && room.indexOf('/') !== -1) bases[match[0]] = true;
    });
    Object.keys(bases).forEach(function(base) {
      options = options.filter(function(option) { return option.value !== base; });
      options.push({ value: base, label: base + ' (ทุกห้อง)' });
    });
  }
  return options.sort(function(a, b) { return a.value.localeCompare(b.value, 'th', { numeric: true }); });
}

function roomSelectHtml(aggregate, selected, placeholder, allowAll) {
  var html = placeholder ? '<option value="">' + escHtml(placeholder) + '</option>' : '';
  if (allowAll) html += '<option value="all">ทุกชั้น / ทุกห้อง</option>';
  return html + roomOptions(aggregate).map(function(option) {
    return '<option value="' + escHtml(option.value) + '"' + (option.value === selected ? ' selected' : '') + '>' + escHtml(option.label) + '</option>';
  }).join('');
}

async function refreshSchoolRooms() {
  var rows = await reportReadAll(function() {
    return getSupabase().from('students').select('id,grade').eq('role', 'STUDENT');
  }, 'id');
  schoolRooms = Array.from(new Set(rows.map(function(row) { return normalizeGrade(row.grade); }).filter(Boolean)));
  ['targetGrade', 'statGrade', 'manGrade', 'histGrade', 'bulkGrade', 'walletGrade', 'rewardReportGrade', 'newStudentGrade'].forEach(function(id) {
    var select = document.getElementById(id);
    if (!select) return;
    var previous = select.value;
    var choose = ['targetGrade', 'manGrade', 'histGrade', 'bulkGrade', 'newStudentGrade'].indexOf(id) !== -1;
    select.innerHTML = roomSelectHtml(id !== 'targetGrade' && id !== 'newStudentGrade', previous,
      choose ? (schoolRooms.length ? '-- เลือกชั้น / ห้อง --' : 'ยังไม่มีนักเรียนในระบบ') : '', id === 'rewardReportGrade');
    if (id === 'newStudentGrade') select.innerHTML += '<option value="__new__">เพิ่มห้องใหม่…</option>';
    if (previous && Array.prototype.some.call(select.options, function(option) { return option.value === previous; })) select.value = previous;
    else if (choose) select.value = '';
    select.disabled = !schoolRooms.length && id !== 'newStudentGrade';
  });
}

function setManualMode(mode) {
  ['single', 'bulk', 'history'].forEach(function(name) {
    var active = name === mode;
    document.getElementById('manual-view-' + name).hidden = !active;
    var button = document.getElementById('manual-mode-' + name);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
}

function updateTeacherNavigation(name) {
  var parent = name === 'reset' ? 'manual' : name === 'reward-report' ? 'stats' : name;
  document.querySelectorAll('.tn').forEach(function(button) {
    var active = button.dataset.tab === parent;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
    button.tabIndex = 0;
  });
  ['studentSubnav', 'reportSubnav'].forEach(function(id) {
    var nav = document.getElementById(id);
    nav.classList.toggle('hidden', id === 'studentSubnav' ? parent !== 'manual' : parent !== 'stats');
    nav.querySelectorAll('[role="tab"]').forEach(function(button) {
      var active = button.getAttribute('aria-controls') === 'tab-' + name;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  });
}

function stopSchoolSync() {
  if (schoolSyncTimer) clearInterval(schoolSyncTimer);
  if (schoolSyncChannel) getSupabase().removeChannel(schoolSyncChannel);
  schoolSyncTimer = null;
  schoolSyncChannel = null;
}

async function syncSchoolMetadata() {
  if (schoolSyncBusy || schoolResetBusy || !CU.id || isGuestMode()) return;
  schoolSyncBusy = true;
  try {
    var settings = await getAppSettingsDb();
    var oldVersion = schoolSemester.version;
    var changed = oldVersion && settings.semester.version && oldVersion !== settings.semester.version;
    if (JSON.stringify(appSettings) !== JSON.stringify(settings)) applyAppSettings(settings);
    if (changed) {
      stopSchoolSync();
      await Swal.fire({ icon: 'info', title: 'ระบบเริ่มภาคเรียนใหม่แล้ว', text: 'ข้อมูลเดิมถูกรีเซ็ต กรุณาเข้าสู่ระบบอีกครั้งเพื่อโหลดข้อมูลปัจจุบัน', confirmButtonText: 'เข้าสู่ระบบใหม่', allowOutsideClick: false });
      logout();
    }
  } catch (error) { console.warn('School metadata refresh failed', error.message); }
  finally { schoolSyncBusy = false; }
}

function startSchoolSync() {
  stopSchoolSync();
  if (isGuestMode()) return;
  schoolSyncTimer = setInterval(syncSchoolMetadata, 30000);
  schoolSyncChannel = getSupabase().channel('school-metadata').on('postgres_changes',
    { event: '*', schema: 'public', table: 'system_settings' }, syncSchoolMetadata).subscribe();
}

document.addEventListener('DOMContentLoaded', function() {
  var select = document.getElementById('newStudentGrade');
  select.addEventListener('change', function() {
    document.getElementById('newRoomFields').classList.toggle('hidden', select.value !== '__new__');
  });
  ['reportFrom', 'reportTo'].forEach(function(id) {
    document.getElementById(id).addEventListener('input', function(event) { event.target.dataset.userChanged = 'true'; });
  });
  document.addEventListener('visibilitychange', function() { if (!document.hidden) syncSchoolMetadata(); });
});
