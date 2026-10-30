/* Student-only paging. Shared teacher/report history readers remain untouched. */
var studentHistoryRun=null, studentHistorySerial=0;
var STUDENT_HISTORY_CHUNK=12;
function studentHistoryDay(timestamp){
  var date=new Date(timestamp);
  if(!Number.isFinite(date.getTime()))throw new Error('Invalid attendance date');
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
function makeStudentDayPager(read){return {read:read,buffer:[],done:false,seen:new Set(),busy:false,days:0};}
async function takeStudentHistoryDays(pager,count){
  if(pager.busy)return [];
  pager.busy=true;
  var groups=[], index=0, pendingIds=new Set();
  try{
    while(true){
      if(index>=pager.buffer.length){
        if(pager.done)break;
        var page=await pager.read();
        if(!page || !Array.isArray(page.rows))throw new Error('Invalid history page');
        pager.buffer.push.apply(pager.buffer,page.rows);pager.done=!!page.done;
        if(!page.rows.length && !pager.done)throw new Error('History page did not advance');
        continue;
      }
      var row=pager.buffer[index], id=String(row.id), day=studentHistoryDay(row.timestamp);
      if(pager.seen.has(id) || pendingIds.has(id)){index++;continue;}
      var last=groups[groups.length-1];
      if(!last || last.day!==day){
        if(groups.length>=count)break;
        last={day:day,timestamp:row.timestamp,rows:[]};groups.push(last);
      }
      last.rows.push(row);pendingIds.add(id);index++;
    }
    pager.buffer.splice(0,index);pendingIds.forEach(function(id){pager.seen.add(id);});pager.days+=groups.length;
    return groups;
  }finally{pager.busy=false;}
}
function cancelStudentAttendanceHistory(){
  studentHistorySerial++;
  if(studentHistoryRun){studentHistoryRun.cancelled=true;if(studentHistoryRun.controller)studentHistoryRun.controller.abort();}
  studentHistoryRun=null;
}
function historyRunCurrent(run){return studentHistoryRun===run && !run.cancelled && run.owner===studentUiIdentity();}
async function studentHistoryQuery(run,query){
  if(!historyRunCurrent(run))throw new Error('History cancelled');
  var controller=new AbortController(), timer;
  run.controller=controller;
  if(typeof query.abortSignal==='function')query=query.abortSignal(controller.signal);
  try{
    var rows=await Promise.race([runQuery(query),new Promise(function(resolve,reject){timer=setTimeout(function(){controller.abort();reject(new Error('History timeout'));},15000);})]);
    if(!historyRunCurrent(run))throw new Error('History cancelled');
    return rows || [];
  }finally{clearTimeout(timer);if(run.controller===controller)run.controller=null;}
}
function createStudentAttendanceReader(run){
  if(isGuestMode()){
    var session=getActiveGuestSession();
    if(!session)throw new Error('Guest session expired');
    var rows=(session.attendanceLogs || []).map(function(row){return Object.assign({},row);});
    rows.sort(function(a,b){return new Date(b.timestamp)-new Date(a.timestamp) || String(b.id).localeCompare(String(a.id));});
    var offset=0;
    return async function(){if(!historyRunCurrent(run))throw new Error('History cancelled');var result=rows.slice(offset,offset+STUDENT_HISTORY_CHUNK);offset+=result.length;return {rows:result,done:offset>=rows.length};};
  }
  var ceiling=null, cursor=null;
  return async function(){
    var client=getSupabase();
    if(ceiling===null){
      var ids=await studentHistoryQuery(run,client.from('attendance_logs').select('id').eq('student_id',run.studentId).order('id',{ascending:false}).limit(1));
      if(!ids.length)return {rows:[],done:true};
      ceiling=String(ids[0].id);if(!/^\d+$/.test(ceiling))throw new Error('Invalid attendance cursor');
    }
    var query=client.from('attendance_logs').select('id,timestamp,status,points').eq('student_id',run.studentId).lte('id',ceiling)
      .order('timestamp',{ascending:false}).order('id',{ascending:false}).limit(STUDENT_HISTORY_CHUNK);
    if(cursor)query=query.or('timestamp.lt.'+cursor.timestamp+',and(timestamp.eq.'+cursor.timestamp+',id.lt.'+cursor.id+')');
    var result=await studentHistoryQuery(run,query);
    if(result.length){
      // Keep PostgreSQL microseconds: Date.toISOString() would lose cursor precision.
      var last=result[result.length-1], next={id:String(last.id),timestamp:String(last.timestamp)};
      if(!/^\d+$/.test(next.id) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(next.timestamp)
          || (cursor && cursor.id===next.id && cursor.timestamp===next.timestamp))throw new Error('History cursor did not advance');
      cursor=next;
    }
    return {rows:result,done:result.length<STUDENT_HISTORY_CHUNK};
  };
}
function renderStudentAttendanceDays(groups){
  var list=document.getElementById('studentAttendanceDays');
  groups.forEach(function(group){
    var article=document.createElement('article');article.className='student-attendance-day';article.dataset.day=group.day;
    var time=document.createElement('time');time.dateTime=group.day;
    time.textContent=new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'short',year:'numeric'}).format(new Date(group.timestamp));article.appendChild(time);
    group.rows.forEach(function(row){
      var entry=document.createElement('div');entry.className='student-attendance-entry';entry.dataset.status=String(row.status || '').trim();
      var status=document.createElement('span');status.textContent=String(row.status || 'ไม่ระบุสถานะ');
      var points=document.createElement('span');points.textContent=(Number(row.points)>0?'+':'')+(Number(row.points)||0)+' คะแนน';
      entry.append(status,points);article.appendChild(entry);
    });list.appendChild(article);
  });
}
async function loadMoreStudentAttendance(){
  var run=studentHistoryRun;if(!run || !historyRunCurrent(run) || run.pager.busy)return;
  var button=document.getElementById('studentHistoryMore'), status=document.getElementById('studentAttendanceHistoryStatus');
  if(!button || !status)return;
  button.disabled=true;button.textContent='กำลังโหลด...';
  try{
    var groups=await takeStudentHistoryDays(run.pager,5);
    if(!historyRunCurrent(run) || !document.getElementById('studentAttendanceDays'))return;
    renderStudentAttendanceDays(groups);
    if(!run.pager.days)document.getElementById('studentAttendanceDays').innerHTML='<p class="student-history-empty">ยังไม่มีประวัติเข้าเรียน</p>';
    var finished=run.pager.done && !run.pager.buffer.length;
    status.textContent=run.pager.days?'แสดง '+run.pager.days+' วัน'+(finished?' · ครบแล้ว':' · เรียงจากล่าสุด'):'ยังไม่มีข้อมูล';
    button.hidden=finished;button.textContent='ดูอีก 5 วัน';
  }catch(error){
    if(historyRunCurrent(run)){status.textContent='โหลดประวัติไม่ได้ กรุณาลองอีกครั้ง';button.hidden=false;button.textContent='ลองโหลดอีกครั้ง';}
  }finally{if(historyRunCurrent(run))button.disabled=false;}
}
function openStudentAttendanceHistory(){
  if(CU.role!=='STUDENT')return;
  var html='<div class="student-history-scroll" id="studentHistoryScroll" tabindex="0" role="region" aria-label="ประวัติเข้าเรียน เลื่อนเพื่อดูวันก่อนหน้า"><div id="studentAttendanceDays"></div></div>'
    +'<div class="student-history-footer"><p id="studentAttendanceHistoryStatus" role="status" aria-live="polite">กำลังโหลดประวัติ...</p><button id="studentHistoryMore" type="button" onclick="loadMoreStudentAttendance()">ดูอีก 5 วัน</button></div>';
  if(!openStudentUtility('ประวัติเข้าเรียน',html,'attendance-history'))return;
  cancelStudentAttendanceHistory();
  var run={owner:studentUiIdentity(),studentId:String(CU.id),serial:studentHistorySerial,cancelled:false,controller:null,lastScrollTop:0};
  studentHistoryRun=run;
  try{run.pager=makeStudentDayPager(createStudentAttendanceReader(run));}catch(error){document.getElementById('studentAttendanceHistoryStatus').textContent='ยังโหลดประวัติไม่ได้ กรุณาเข้าสู่ระบบใหม่';document.getElementById('studentHistoryMore').hidden=true;return;}
  document.getElementById('studentUtilityModal').addEventListener('hidden.bs.modal',function(){if(studentHistoryRun===run)cancelStudentAttendanceHistory();},{once:true});
  document.getElementById('studentHistoryScroll').addEventListener('scroll',function(){
    if(!historyRunCurrent(run))return;
    if(this.scrollTop===run.lastScrollTop)return;
    run.lastScrollTop=this.scrollTop;
    if(this.scrollTop>0 && this.scrollHeight-this.clientHeight-this.scrollTop<65 && !run.pager.busy && !(run.pager.done && !run.pager.buffer.length))loadMoreStudentAttendance();
  },{passive:true});
  return loadMoreStudentAttendance();
}
if(typeof module!=='undefined' && module.exports)module.exports={studentHistoryDay:studentHistoryDay,makeStudentDayPager:makeStudentDayPager,takeStudentHistoryDays:takeStudentHistoryDays};
