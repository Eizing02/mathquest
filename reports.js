/* Reports use fresh, complete data. PDF, CSV and XLSX share the same rows. */
'use strict';
var reportExportBusy = false;
var reportExportController = null;
var REPORT_EXPORT_TIMEOUT_MS = 45000;
var REPORT_PREVIEW_TIMEOUT_MS = 12000;

function reportWait(task, signal, timeout, message) {
  return new Promise(function(resolve, reject) {
    var timer;
    function cleanup() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', aborted);
    }
    function aborted() { cleanup(); reject(signal.reason || new Error('ยกเลิกการส่งออกแล้ว')); }
    if (signal && signal.aborted) { aborted(); return; }
    if (signal) signal.addEventListener('abort', aborted, { once: true });
    if (timeout) timer = setTimeout(function() { cleanup(); reject(new Error(message)); }, timeout);
    Promise.resolve(task).then(function(value) { cleanup(); resolve(value); }, function(error) { cleanup(); reject(error); });
  });
}

function cancelReportExport() {
  if (reportExportController) reportExportController.abort(new Error('ยกเลิกการส่งออกแล้ว'));
}

function reportStatus(region, message, busy) {
  if (!region) return;
  region.hidden = false;
  region.querySelector('[data-report-progress]').textContent = message;
  region.querySelector('[data-report-cancel]').hidden = !busy;
}

function getReportMonth() {
  var yearEl = document.getElementById('statYear');
  var year = yearEl && yearEl.value ? yearEl.value : new Date().getFullYear().toString();
  if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2200) throw new Error('กรุณาระบุปี ค.ศ. ระหว่าง 2000 ถึง 2200');
  var monthEl = document.getElementById('statMonth');
  var month = monthEl ? monthEl.value : 'all';
  return month === 'all' ? year : year + '-' + month.padStart(2, '0');
}

async function reportReadAll(makeQuery, key, signal) {
  var rows = [], cursor = null;
  // Keyset pagination also works when the server caps pages below our request.
  while (true) {
    if (signal && signal.aborted) throw signal.reason;
    var query = makeQuery().order(key, { ascending: true }).limit(500);
    if (cursor !== null) query = query.gt(key, cursor);
    if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal);
    var page = await reportWait(runQuery(query), signal);
    if (!page || !page.length) break;
    var next = page[page.length - 1][key];
    if (next == null || next === cursor) throw new Error('อ่านข้อมูลรายงานไม่ครบ กรุณาลองใหม่');
    rows = rows.concat(page);
    cursor = next;
  }
  return rows;
}

async function reportReadStudents(table, columns, ids, signal) {
  var rows = [];
  for (var i = 0; i < ids.length; i += 100) {
    var chunk = ids.slice(i, i + 100);
    rows = rows.concat(await reportReadAll(function() {
      return getSupabase().from(table).select(columns).in('student_id', chunk);
    }, 'id', signal));
  }
  return rows;
}

function reportInRange(timestamp, selection) {
  var day = dateKeyBangkok(timestamp);
  return !!day && (!selection.month || matchesMonth(timestamp, selection.month)) &&
    (!selection.from || day >= selection.from) && (!selection.to || day <= selection.to);
}

function reportSelection(kind, studentId) {
  var attendance = kind === 'attendance' || kind === 'individual';
  var value = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };
  var selection = {
    kind: kind === 'reward' ? value('reportKind') || 'history' : kind,
    grade: attendance ? value('statGrade') : value('rewardReportGrade'),
    studentId: studentId || '',
    month: attendance ? getReportMonth() : '',
    from: attendance ? '' : value('reportFrom'), to: attendance ? '' : value('reportTo'),
    createdAt: new Date().toISOString(),
    school: appSettings.schoolName || 'โรงเรียนกุงแก้ววิทยาคาร',
    teacher: document.getElementById('printTeacher').textContent || ''
  };
  if (!selection.grade && !studentId) throw new Error('กรุณาเลือกห้องเรียน');
  if (selection.from && selection.to && selection.from > selection.to) throw new Error('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด');
  if (selection.kind === 'wallet') { selection.from = ''; selection.to = ''; }
  return selection;
}

async function loadReportData(selection, signal, progress) {
  progress = progress || function() {};
  progress('กำลังโหลดรายชื่อนักเรียน...');
  var students = await reportReadAll(function() {
    var q = getSupabase().from('students').select('id,name,grade');
    if (selection.studentId) return q.eq('id', selection.studentId);
    return selection.grade === 'all' ? q : q.eq('grade', normalizeGrade(selection.grade));
  }, 'id', signal);
  var ids = students.map(function(s) { return s.id; });
  students.sort(function(a, b) { return String(a.grade).localeCompare(String(b.grade), 'th') || String(a.id).localeCompare(String(b.id)); });
  var data = { students: students, attendance: [], orders: [], pets: [], catalog: [] };
  if (['attendance', 'individual', 'wallet'].includes(selection.kind)) {
    progress('กำลังโหลดข้อมูลเข้าเรียน...');
    data.attendance = await reportReadStudents('attendance_logs', 'id,student_id,timestamp,status,points', ids, signal);
  }
  if (selection.kind !== 'attendance') {
    progress('กำลังโหลดรายการแลกของ...');
    data.orders = await reportReadStudents('redemption_logs', '*', ids, signal);
    data.catalog = await reportReadAll(function() { return getSupabase().from('shop_items').select('*'); }, 'item_id', signal);
    if (selection.kind === 'bonus' && data.catalog.some(function(item) { return !Object.prototype.hasOwnProperty.call(item, 'bonus_points'); })) {
      throw new Error('ยังไม่ได้ติดตั้งข้อมูลแต้มพิเศษ กรุณารัน SQL อัปเดตรายงานก่อน');
    }
  }
  if (['wallet', 'individual'].includes(selection.kind)) {
    // A failed read must not silently turn spending into zero.
    progress('กำลังตรวจยอดเหรียญ...');
    data.pets = await reportReadStudents('student_pet_events', 'id,student_id,points_used', ids, signal);
  }
  return data;
}

function reportNumber(value) { return Math.round((Number(value) || 0) * 100) / 100; }

function buildReport(selection, data) {
  var report = { selection: selection, title: '', landscape: false, columns: [], rows: [], note: '', summary: '' };
  var columns = function(labels, widths) { return labels.map(function(label, i) { return { label: label, width: widths[i] }; }); };
  var catalog = new Map(data.catalog.map(function(item) { return [item.item_id, item]; }));
  var fallbackCount = 0, unmappedCount = 0;
  function bonus(row) {
    if (row.bonus_points != null) return reportNumber(row.bonus_points);
    var item = catalog.get(row.item_id);
    if (!item || !Number(item.bonus_points)) { unmappedCount++; return 0; }
    fallbackCount++;
    return reportNumber(item.bonus_points);
  }
  function studentLogs(student) { return data.attendance.filter(function(r) { return r.student_id === student.id; }); }
  function stats(logs) {
    var s = { present: 0, activity: 0, absent: 0, leave: 0, points: 0, duplicate: 0 };
    var days = new Set();
    logs.forEach(function(r) {
      var day = dateKeyBangkok(r.timestamp);
      if (days.has(day)) s.duplicate++; else days.add(day);
      if (r.status === 'มา') { s.present++; s.points += Number(r.points) || 0; }
      if (r.status === 'กิจกรรม') s.activity++;
      if (r.status === 'ขาด') s.absent++;
      if (r.status === 'ลา') s.leave++;
    });
    var total = s.present + s.activity + s.absent + s.leave;
    s.rate = total ? reportNumber((s.present + s.activity) * 100 / total) : 0;
    return s;
  }
  function wallet(student) {
    var earned = stats(studentLogs(student)).points;
    var approved = 0, pending = 0, rejected = 0;
    data.orders.filter(function(r) { return r.student_id === student.id; }).forEach(function(r) {
      if (r.status === 'approved') approved += Number(r.points_used) || 0;
      else if (r.status === 'rejected') rejected += Number(r.points_used) || 0;
      else pending += Number(r.points_used) || 0;
    });
    var pets = data.pets.filter(function(r) { return r.student_id === student.id; }).reduce(function(n, r) { return n + (Number(r.points_used) || 0); }, 0);
    return [earned, approved, pending, pets, rejected, Math.max(0, earned - approved - pending - pets)];
  }
  var duplicates = 0;
  if (selection.kind === 'attendance') {
    report.title = 'สรุปคะแนนและการเข้าเรียน';
    report.columns = columns(['ลำดับ', 'รหัส', 'ชื่อ-นามสกุล', 'มา', 'กิจกรรม', 'ขาด', 'ลา', 'คะแนน', 'เข้าเรียน %'], [7, 11, 30, 7, 9, 7, 7, 10, 12]);
    data.students.forEach(function(student, i) {
      var s = stats(studentLogs(student).filter(function(r) { return reportInRange(r.timestamp, selection); }));
      duplicates += s.duplicate;
      report.rows.push({ cells: [i + 1, student.id, student.name, s.present, s.activity, s.absent, s.leave, s.points, s.rate] });
    });
    report.note = 'คะแนนเฉพาะช่วงที่เลือก • กิจกรรมนับเข้าเรียน ได้ 0 คะแนน • วันที่ไม่มีรายการไม่ถูกนับเป็นขาด';
  } else if (selection.kind === 'wallet') {
    report.title = 'สรุปคะแนนสะสมและเหรียญ ณ ปัจจุบัน'; report.landscape = true;
    report.columns = columns(['ลำดับ', 'รหัส', 'ชื่อ-นามสกุล', 'ห้อง', 'XP สะสม', 'แลกสำเร็จ', 'รอดำเนินการ', 'สัตว์เลี้ยง', 'ปฏิเสธ', 'คงเหลือ'], [5, 8, 23, 8, 9, 9, 10, 9, 9, 10]);
    data.students.forEach(function(student, i) { report.rows.push({ cells: [i + 1, student.id, student.name, student.grade].concat(wallet(student)) }); });
    report.note = 'ยอดทุกช่วงเวลา ณ วันที่พิมพ์ • คงเหลือ = XP - แลกสำเร็จ - รอดำเนินการ - สัตว์เลี้ยง (ขั้นต่ำ 0) • ปฏิเสธไม่หักเหรียญ';
  } else if (selection.kind === 'individual') {
    var student = data.students[0];
    if (!student) throw new Error('ไม่พบนักเรียน');
    report.title = 'รายละเอียดคะแนนรายบุคคล';
    report.student = student.name + ' | รหัส ' + student.id + ' | ' + student.grade;
    report.columns = columns(['ลำดับ', 'วันที่', 'สถานะ', 'คะแนน'], [10, 35, 35, 20]);
    var logs = studentLogs(student).filter(function(r) { return reportInRange(r.timestamp, selection); }).sort(function(a, b) { return a.timestamp.localeCompare(b.timestamp) || Number(a.id) - Number(b.id); });
    var s = stats(logs); duplicates = s.duplicate;
    report.summary = 'มา ' + s.present + ' | กิจกรรม ' + s.activity + ' | ขาด ' + s.absent + ' | ลา ' + s.leave + ' | คะแนนช่วงนี้ ' + s.points + ' | เข้าเรียน ' + s.rate + '%';
    logs.forEach(function(r, i) { report.rows.push({ cells: [i + 1, formatDate(r.timestamp), r.status, r.status === 'มา' ? Number(r.points) || 0 : 0] }); });
    var w = wallet(student);
    report.note = 'ยอดปัจจุบัน: XP ' + w[0] + ' | แลกสำเร็จ ' + w[1] + ' | รอ ' + w[2] + ' | สัตว์เลี้ยง ' + w[3] + ' | คงเหลือ ' + w[5] + ' เหรียญ • กิจกรรมได้ 0 คะแนน';
    var history = buildReport(Object.assign({}, selection, { kind: 'history' }), data);
    history.title = 'รายละเอียดการแลกของรายบุคคล'; history.student = report.student; history.landscape = false;
    history.columns = columns(['ของรางวัล', 'แลก', 'ฟรี', 'เหรียญ', 'ล่าสุด', 'สถานะ'], [35, 8, 8, 12, 19, 18]);
    history.rows = history.rows.map(function(row) { return { cells: row.cells.slice(4) }; });
    var bonusReport = buildReport(Object.assign({}, selection, { kind: 'bonus' }), data);
    var bonusRow = bonusReport.rows[0];
    history.summary = 'แต้มพิเศษอนุมัติแล้ว: จากการแลก ' + bonusRow.cells[4] + ' | ครูมอบ ' + bonusRow.cells[5] + ' | รวม ' + bonusRow.cells[6];
    history.note += ' • ' + bonusReport.note;
    report.attachments = history.rows.length ? [history] : [];
  } else if (selection.kind === 'bonus') {
    report.title = 'สรุปแต้มพิเศษที่อนุมัติแล้ว';
    report.columns = columns(['ลำดับ', 'รหัส', 'ชื่อ-นามสกุล', 'ห้อง', 'จากการแลก', 'ครูมอบให้', 'รวมแต้ม'], [7, 11, 30, 10, 14, 14, 14]);
    data.students.forEach(function(student, i) {
      var paid = 0, free = 0;
      data.orders.filter(function(r) { return r.student_id === student.id && r.status === 'approved' && reportInRange(r.timestamp, selection); }).forEach(function(r) {
        var points = bonus(r);
        if (Number(r.points_used) > 0) paid += points; else free += points;
      });
      report.rows.push({ cells: [i + 1, student.id, student.name, student.grade, reportNumber(paid), reportNumber(free), reportNumber(paid + free)] });
    });
    report.note = 'แต้มพิเศษแยกจาก XP และเหรียญ • เฉพาะรายการอนุมัติแล้วตามสถานะปัจจุบัน';
    if (fallbackCount) report.note += ' • ' + fallbackCount + ' รายการเดิมใช้แต้มต่อชิ้นตามค่าของสินค้าปัจจุบัน';
    if (unmappedCount) report.note += ' • ' + unmappedCount + ' รายการเดิมไม่มีแต้มกำกับหรือเป็นของทั่วไป จึงไม่นับแต้ม';
  } else {
    var pendingOnly = selection.kind === 'pending';
    report.title = pendingOnly ? 'รายการรอแจกของรางวัล' : 'ประวัติการแลกของรางวัล'; report.landscape = true;
    report.columns = columns(['ลำดับ', 'รหัส', 'ชื่อ-นามสกุล', 'ห้อง', 'ของรางวัล', 'แลก', 'ฟรี', 'เหรียญ', 'ล่าสุด', pendingOnly ? 'ตรวจรับ' : 'สถานะ'], [5, 8, 22, 7, 20, 5, 5, 7, 12, 9]);
    data.students.forEach(function(student, i) {
      var groups = new Map();
      data.orders.filter(function(r) { return r.student_id === student.id && reportInRange(r.timestamp, selection) && (!pendingOnly || r.status === 'pending'); }).forEach(function(r) {
        var source = Number(r.points_used) > 0 ? 'paid' : 'free';
        var key = JSON.stringify([r.item_id, r.item_name, r.status]);
        if (!groups.has(key)) groups.set(key, { name: r.item_name, paid: 0, free: 0, cost: 0, latest: r.timestamp, status: r.status });
        var group = groups.get(key); group[source]++; group.cost += Number(r.points_used) || 0;
        if (r.timestamp > group.latest) group.latest = r.timestamp;
      });
      Array.from(groups.values()).sort(function(a, b) { return a.name.localeCompare(b.name, 'th') || a.status.localeCompare(b.status); }).forEach(function(g) {
        report.rows.push({ group: student.id, cells: [i + 1, student.id, student.name, student.grade, g.name, g.paid, g.free, g.cost, formatDate(g.latest), pendingOnly ? '[    ]' : rewardReportStatusText(g.status)] });
      });
    });
    report.note = 'จำนวนแยกแลกด้วยเหรียญ / รับฟรี • สถานะ ณ วันที่พิมพ์ • รายการปฏิเสธไม่หักเหรียญ';
  }
  if (duplicates) report.note += ' • พบรายการวันซ้ำ ' + duplicates + ' รายการ: ยังคงนับตามข้อมูลเดิม โปรดตรวจสอบ';
  if (selection.kind === 'bonus') report.summary = 'นักเรียน ' + report.rows.length + ' คน | รวมแต้มพิเศษ ' + reportNumber(report.rows.reduce(function(n, r) { return n + r.cells[6]; }, 0));
  if (selection.kind === 'pending') report.summary = 'รอแจก ' + report.rows.reduce(function(n, r) { return n + r.cells[5] + r.cells[6]; }, 0) + ' ชิ้น';
  return report;
}

function reportPeriod(selection) {
  if (selection.kind === 'wallet') return 'ทุกช่วงเวลา ณ วันที่พิมพ์';
  if (selection.month) return selection.month.length === 4 ? 'ปี พ.ศ. ' + (Number(selection.month) + 543) + ' (ทั้งปี)' : TH_MO_L[Number(selection.month.slice(5))] + ' ' + (Number(selection.month.slice(0, 4)) + 543);
  return (selection.from || selection.to) ? (selection.from || 'เริ่มต้นข้อมูล') + ' ถึง ' + (selection.to || 'ปัจจุบัน') : 'ทุกช่วงเวลา';
}

function reportCsvCell(value) {
  var text = String(value == null ? '' : value);
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function downloadReport(report, format) {
  var rows = [report.columns.map(function(c) { return c.label; })].concat(report.rows.map(function(r) { return r.cells; }));
  var name = (report.title + '_' + (report.selection.grade || report.selection.studentId) + '_' + reportPeriod(report.selection) + '_' + dateKeyBangkok(report.selection.createdAt)).replace(/[\\/:*?"<>|]/g, '-');
  if (format === 'csv') {
    var url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(function(row) { return row.map(reportCsvCell).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a'); a.href = url; a.download = name + '.csv'; a.click();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  } else {
    if (typeof XLSX === 'undefined') throw new Error('โหลด Excel ไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่');
    var sheet = XLSX.utils.aoa_to_sheet([[report.title], [report.selection.school], ['ห้อง: ' + report.selection.grade + ' | ' + reportPeriod(report.selection)], ['พิมพ์: ' + formatThaiLongDate(new Date(report.selection.createdAt))], [report.note], []].concat(rows));
    sheet['!cols'] = report.columns.map(function(c) { return { wch: Math.max(12, c.width) }; });
    var book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'รายงาน'); XLSX.writeFile(book, name + '.xlsx');
  }
}

async function exportReport(format, kind, studentId) {
  if (reportExportBusy) return;
  var popup = null;
  var buttons = Array.from(document.querySelectorAll('[onclick*="exportReport"]'));
  var previous = buttons.map(function(b) { return b.disabled; });
  var region = document.getElementById(kind === 'reward' ? 'rewardExportStatus' : 'attendanceExportStatus');
  var controller = new AbortController();
  var deadline;
  var popupWatch;
  function progress(message) { if (!controller.signal.aborted) reportStatus(region, message, true); }
  try {
    var selection = reportSelection(kind, studentId);
    if (format === 'pdf') {
      popup = window.open(new URL('report-preview.html', document.baseURI).href, '_blank');
      if (!popup) throw new Error('กรุณาอนุญาตหน้าต่างป๊อปอัปสำหรับรายงาน');
    }
    reportExportBusy = true; reportExportController = controller;
    buttons.forEach(function(b) { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
    deadline = setTimeout(function() { controller.abort(new Error('เตรียมรายงานนานเกินไป กรุณาตรวจการเชื่อมต่อแล้วลองใหม่')); }, REPORT_EXPORT_TIMEOUT_MS);
    if (popup) popupWatch = setInterval(function() {
      if (popup.closed) controller.abort(new Error('ปิดหน้าตัวอย่างรายงานแล้ว'));
    }, 250);
    progress('กำลังเตรียมรายงาน...');
    var data = await reportWait(loadReportData(selection, controller.signal, progress), controller.signal);
    var report = buildReport(selection, data);
    if (!report.rows.length) throw new Error('ไม่พบข้อมูลในช่วงที่เลือก');
    if (popup) {
      progress('กำลังจัดหน้ารายงาน...');
      await reportWait(renderReportPrint(popup, report, controller.signal), controller.signal);
    }
    else downloadReport(report, format);
    reportStatus(region, popup ? 'เปิดตัวอย่างรายงานแล้ว กดพิมพ์ / บันทึก PDF ในหน้ารายงาน' : 'ส่งไฟล์ไปยังรายการดาวน์โหลดแล้ว', false);
    Swal.close();
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    controller.abort(error);
    reportStatus(region, error.message || 'ส่งออกไม่สำเร็จ กรุณาลองใหม่', false);
    if (error.message !== 'ยกเลิกการส่งออกแล้ว') Swal.fire({ icon: 'error', title: 'ส่งออกไม่สำเร็จ', text: error.message || 'กรุณาลองใหม่' });
  } finally {
    clearTimeout(deadline);
    clearInterval(popupWatch);
    reportExportBusy = false; reportExportController = null;
    buttons.forEach(function(b, i) { b.disabled = previous[i]; b.removeAttribute('aria-busy'); });
  }
}

function waitReportPreview(popup, signal) {
  var interval;
  var loaded = new Promise(function(resolve, reject) {
    function check() {
      if (popup.closed) { reject(new Error('ปิดหน้าตัวอย่างรายงานแล้ว')); return; }
      var doc;
      try { doc = popup.document; } catch (e) { reject(new Error('เปิดหน้าตัวอย่างรายงานไม่สำเร็จ กรุณาลองใหม่')); return; }
      if (doc.body && doc.body.hasAttribute('data-report-preview') && doc.readyState === 'complete') {
        var css = doc.querySelector('link[rel="stylesheet"]');
        if (!css || !css.sheet || popup.getComputedStyle(doc.body).getPropertyValue('--report-print-ready').trim() !== '1') reject(new Error('โหลดรูปแบบรายงานไม่สำเร็จ กรุณาลองใหม่'));
        else resolve();
      }
    }
    interval = setInterval(check, 50);
    check();
  });
  return reportWait(loaded, signal, REPORT_PREVIEW_TIMEOUT_MS, 'โหลดหน้าตัวอย่างรายงานนานเกินไป กรุณาลองใหม่')
    .finally(function() { clearInterval(interval); });
}

async function renderReportPrint(popup, report, signal) {
  var isPreview = popup !== window;
  if (isPreview) await waitReportPreview(popup, signal);
  var doc = popup.document;
  doc.documentElement.lang = 'th';
  if (!isPreview) doc.head.innerHTML = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
  doc.title = report.title;
  var base = doc.createElement('base'); base.href = document.baseURI; doc.head.appendChild(base);
  if (!isPreview) {
    var link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('report-print.css', document.baseURI).href;
    var ready = new Promise(function(resolve, reject) { link.onload = resolve; link.onerror = function() { reject(new Error('โหลดรูปแบบรายงานไม่สำเร็จ')); }; });
    doc.head.appendChild(link);
    await reportWait(ready, signal, REPORT_PREVIEW_TIMEOUT_MS, 'โหลดรูปแบบรายงานนานเกินไป กรุณาลองใหม่');
  }
  var pageStyle = doc.createElement('style'); pageStyle.textContent = '@page{size:A4 ' + (report.landscape ? 'landscape' : 'portrait') + ';margin:15mm}'; doc.head.appendChild(pageStyle);
  doc.body.className = report.landscape ? 'landscape' : 'portrait';
  doc.body.innerHTML = '<nav><button type="button">พิมพ์ / บันทึก PDF</button></nav><main></main>';
  var printButton = doc.querySelector('button');
  printButton.disabled = true;
  printButton.onclick = function() { popup.print(); };
  await reportWait(doc.fonts.ready, signal, REPORT_PREVIEW_TIMEOUT_MS, 'โหลดตัวอักษรรายงานนานเกินไป กรุณาลองใหม่');
  var main = doc.querySelector('main');
  var pages = [], current, lastGroup = null;
  function element(tag, text, className) { var el = doc.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
  function newPage() {
    var page = element('section', null, 'report-page');
    var header = element('header');
    header.appendChild(element('h1', report.title));
    header.appendChild(element('p', report.selection.school));
    header.appendChild(element('p', report.student || ('ห้อง: ' + (report.selection.grade === 'all' ? 'ทุกห้อง' : report.selection.grade))));
    header.appendChild(element('p', reportPeriod(report.selection) + ' | พิมพ์ ' + formatThaiLongDate(new Date(report.selection.createdAt)), 'meta'));
    page.appendChild(header);
    var table = element('table'); var colgroup = element('colgroup');
    report.columns.forEach(function(c) { var col = element('col'); col.style.width = c.width + '%'; colgroup.appendChild(col); }); table.appendChild(colgroup);
    var head = element('thead'), tr = element('tr');
    report.columns.forEach(function(c) { tr.appendChild(element('th', c.label)); }); head.appendChild(tr); table.appendChild(head);
    var body = element('tbody'); table.appendChild(body); page.appendChild(table);
    var foot = element('footer'); foot.appendChild(element('span', report.title)); foot.appendChild(element('span', '', 'page-number')); page.appendChild(foot);
    main.appendChild(page); pages.push(page); current = { page: page, body: body }; lastGroup = null;
  }
  function overflow() { return current.page.querySelector('table').getBoundingClientRect().bottom > current.page.querySelector('footer').getBoundingClientRect().top - 10; }
  var parts = [report].concat(report.attachments || []);
  parts.forEach(function(part) {
  report = part;
  newPage();
  report.rows.forEach(function(row, rowIndex) {
    function makeRow() {
      var tr = element('tr');
      row.cells.forEach(function(value, i) {
        var repeat = row.group && row.group === lastGroup && i < 4;
        var label = report.columns[i].label;
        var cell = element('td', repeat ? '' : value);
        if (label === 'ชื่อ-นามสกุล' || label === 'ของรางวัล') cell.className = 'text';
        if (label === 'รหัส') cell.className = 'identifier';
        if (i === 2 && row.group && !lastGroup && rowIndex && report.rows[rowIndex - 1].group === row.group) cell.appendChild(element('small', ' (ต่อ)'));
        tr.appendChild(cell);
      });
      if (row.group && lastGroup !== row.group) tr.className = 'group-start';
      return tr;
    }
    var tr = makeRow(); current.body.appendChild(tr);
    if (overflow()) {
      tr.remove();
      if (!current.body.children.length) throw new Error('รายการยาวเกินหน้ากระดาษ กรุณาส่งออก Excel เพื่อตรวจสอบ');
      newPage(); tr = makeRow(); current.body.appendChild(tr);
      if (overflow()) throw new Error('รายการยาวเกินหน้ากระดาษ');
    }
    lastGroup = row.group || null;
  });
  var closing = element('div', null, 'closing');
  if (report.summary) closing.appendChild(element('p', report.summary));
  closing.appendChild(element('p', report.note));
  closing.appendChild(element('p', 'ลงชื่อ ................................................ ครูผู้สอน   (' + (report.selection.teacher || '................................') + ')', 'signature'));
  current.page.insertBefore(closing, current.page.querySelector('footer'));
  if (closing.getBoundingClientRect().bottom > current.page.querySelector('footer').getBoundingClientRect().top - 10) {
    closing.remove();
    var lastRow = report.rows[report.rows.length - 1];
    if (current.body.children.length > 1) current.body.lastElementChild.remove();
    else throw new Error('ข้อความสรุปยาวเกินหน้ากระดาษ กรุณาส่งออก Excel');
    newPage();
    var finalRow = element('tr');
    lastRow.cells.forEach(function(value, i) {
      var cell = element('td', value);
      if (report.columns[i].label === 'ชื่อ-นามสกุล' || report.columns[i].label === 'ของรางวัล') cell.className = 'text';
      if (report.columns[i].label === 'รหัส') cell.className = 'identifier';
      if (i === 2 && lastRow.group && report.rows.length > 1 && report.rows[report.rows.length - 2].group === lastRow.group) cell.appendChild(element('small', ' (ต่อ)'));
      finalRow.appendChild(cell);
    });
    current.body.appendChild(finalRow);
    current.page.insertBefore(closing, current.page.querySelector('footer'));
    if (closing.getBoundingClientRect().bottom > current.page.querySelector('footer').getBoundingClientRect().top - 10) throw new Error('ข้อความสรุปยาวเกินหน้ากระดาษ');
  }
  });
  pages.forEach(function(page, i) { page.querySelector('.page-number').textContent = 'หน้า ' + (i + 1) + ' / ' + pages.length; });
  printButton.disabled = false;
  popup.focus();
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', function() {
  var year = document.getElementById('statYear');
  if (year && !year.value) year.value = new Date().getFullYear();
  var kind = document.getElementById('reportKind');
  if (kind) kind.addEventListener('change', function() {
    ['reportFrom', 'reportTo'].forEach(function(id) { document.getElementById(id).disabled = kind.value === 'wallet'; });
  });
});
