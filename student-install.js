/* Installation is progressive enhancement; attendance never works offline. */
var studentInstallPrompt = null, studentInstallBusy = false, studentInstallObserved = false;
var studentInstallPlatform = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1) ? 'ios' : 'android';
function studentIsStandalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone===true; }
function studentInstallOverlaps(rect,other,padding) {
  return rect.left<other.right+padding && rect.right>other.left-padding && rect.top<other.bottom+padding && rect.bottom>other.top-padding;
}
function updateStudentInstallVisibility() {
  var button=document.getElementById('studentInstallButton');
  if(!button)return;
  var editing=document.activeElement===document.getElementById('pinCode');
  document.getElementById('studentSection').dataset.pinEditing=String(editing);
  button.hidden=studentInstallObserved || studentIsStandalone() || CU.role!=='STUDENT' || editing || studentCheckInBusy
    || !!document.querySelector('.modal.show,.shop-overlay.open,.student-gift-toast') || Swal.isVisible();
  if(!button.hidden){
    var nav=document.querySelector('.student-actions').getBoundingClientRect();
    button.style.bottom=(innerHeight-nav.top+8)+'px';
    var rect=button.getBoundingClientRect();
    button.hidden=['checkInBtn','studentPin','studentPinMessage','attendanceLocationStatus'].some(function(id){return studentInstallOverlaps(rect,document.getElementById(id).getBoundingClientRect(),8);}) || studentInstallOverlaps(rect,nav,8);
  }
}
function installStep(icon,title,detail) {
  return '<li><span class="install-step-icon" aria-hidden="true"><i class="'+icon+'"></i></span><div><strong>'+title+'</strong><small>'+detail+'</small></div></li>';
}
function studentInstallContent() {
  return '<div class="student-install-brand"><img src="./assets/app-icons/icon-192.png" width="64" height="64" alt="โลโก้แอป"><strong>เช็คชื่อเข้าเรียนครูอี้</strong></div>'
    +'<div class="student-install-tabs" role="tablist" aria-label="เลือกอุปกรณ์">'
    +'<button id="installAndroidTab" type="button" role="tab" aria-controls="studentInstallPanel" onclick="selectStudentInstallPlatform(\'android\')"><i class="fa-brands fa-android" aria-hidden="true"></i> Android</button>'
    +'<button id="installIosTab" type="button" role="tab" aria-controls="studentInstallPanel" onclick="selectStudentInstallPlatform(\'ios\')"><i class="fa-brands fa-apple" aria-hidden="true"></i> iPhone / iPad</button></div>'
    +'<div id="studentInstallPanel" role="tabpanel"></div><p class="student-install-note">เปิดจากไอคอนบนหน้าจอโฮมได้เลย การเช็คชื่อยังต้องใช้อินเทอร์เน็ตและอนุญาตตำแหน่ง</p>';
}
function openStudentInstall() {
  if(openStudentUtility('เพิ่มไว้บนหน้าจอโฮม',studentInstallContent(),'install'))selectStudentInstallPlatform(studentInstallPlatform);
}
function selectStudentInstallPlatform(platform) {
  studentInstallPlatform=platform;
  var panel=document.getElementById('studentInstallPanel');if(!panel)return;
  ['android','ios'].forEach(function(id){var tab=document.getElementById(id==='ios'?'installIosTab':'installAndroidTab');tab.setAttribute('aria-selected',String(id===platform));tab.tabIndex=id===platform?0:-1;});
  panel.setAttribute('aria-labelledby',platform==='ios'?'installIosTab':'installAndroidTab');
  if(platform==='ios')panel.innerHTML='<ol class="student-install-steps">'
    +installStep('fa-brands fa-safari','เปิดเว็บนี้ด้วย Safari','หากเปิดจาก LINE หรือ Facebook ให้เลือกเปิดในเบราว์เซอร์ก่อน')
    +installStep('fa-solid fa-arrow-up-from-bracket','กดปุ่มแชร์','บางรูปแบบหน้าจอ ต้องเปิดเมนูเพิ่มเติมก่อนเลือกแชร์')
    +installStep('fa-regular fa-square-plus','เลือก “เพิ่มไปยังหน้าจอโฮม”','หากยังไม่เห็น ให้เลื่อนรายการหรือกดดูเพิ่มเติม')
    +installStep('fa-solid fa-circle-check','กด “เพิ่ม”','เปิดตัวเลือก “เปิดเป็นเว็บแอป” หากมี แล้วมองหาโลโก้ครูอี้บนหน้าจอโฮม')+'</ol>';
  else panel.innerHTML='<ol class="student-install-steps">'
    +installStep('fa-brands fa-chrome','เปิดเว็บนี้ด้วย Chrome','แนะนำ Chrome บน Android หากเปิดจากแอปอื่น ให้เปิดในเบราว์เซอร์ก่อน')
    +(studentInstallPrompt?installStep('fa-solid fa-download','กด “ติดตั้งแอป” ด้านล่าง','เบราว์เซอร์จะแสดงหน้าต่างให้ยืนยันการติดตั้ง'):
      installStep('fa-solid fa-ellipsis-vertical','เปิดเมนูสามจุดของ Chrome','อยู่ข้างแถบที่อยู่เว็บไซต์')
      +installStep('fa-regular fa-square-plus','เลือก “ติดตั้งแอป” หรือ “เพิ่มลงในหน้าจอหลัก”','บางเวอร์ชันอยู่ในเมนูติดตั้งและสร้างทางลัด'))
    +installStep('fa-solid fa-circle-check','ยืนยัน แล้วเปิดจากหน้าจอโฮม','มองหาโลโก้แอปเช็คชื่อเข้าเรียนครูอี้')+'</ol>'
    +(studentInstallPrompt?'<button id="studentInstallNow" class="student-install-primary" type="button" onclick="installStudentApp()"><i class="fa-solid fa-download" aria-hidden="true"></i> ติดตั้งแอป</button>':'<p class="student-install-note">หากไม่มีเมนูติดตั้ง ให้ลอง Chrome รุ่นล่าสุด หรือใช้เมนูเพิ่มทางลัดแทน</p>');
  panel.insertAdjacentHTML('beforeend','<p id="studentInstallStatus" class="student-install-status" role="status" aria-live="polite" hidden></p>');
}
async function installStudentApp() {
  if(!studentInstallPrompt || studentInstallBusy)return;
  var prompt=studentInstallPrompt, originalPanel=document.getElementById('studentInstallPanel');studentInstallPrompt=null;studentInstallBusy=true;
  var button=document.getElementById('studentInstallNow');if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
  var status='';
  try {
    var result=await prompt.prompt();
    if(!result && prompt.userChoice)result=await prompt.userChoice;
    status=result && result.outcome==='accepted'?'ยืนยันคำขอติดตั้งแล้ว รอระบบติดตั้งและตรวจไอคอนบนหน้าจอโฮม':'ยังไม่ได้ติดตั้ง ใช้วิธีผ่านเมนู Chrome ด้านบนได้';
  } catch(error){status='ยังเปิดหน้าติดตั้งไม่ได้ ใช้เมนู Chrome เพื่อเพิ่มลงหน้าจอโฮมได้';}
  finally{
    studentInstallBusy=false;
    if(originalPanel && document.getElementById('studentInstallPanel')===originalPanel){
      selectStudentInstallPlatform(studentInstallPlatform);
      var message=document.getElementById('studentInstallStatus');message.textContent=status;message.hidden=false;
    }
  }
}
window.addEventListener('beforeinstallprompt',function(event){
  event.preventDefault();studentInstallPrompt=event;
  var modal=document.getElementById('studentUtilityModal');
  if(modal && modal.classList.contains('show') && modal.dataset.kind==='install' && !studentInstallBusy)selectStudentInstallPlatform(studentInstallPlatform);
});
window.addEventListener('appinstalled',function(){studentInstallObserved=true;studentInstallPrompt=null;updateStudentInstallVisibility();});
matchMedia('(display-mode: standalone)').addEventListener('change',updateStudentInstallVisibility);
document.addEventListener('keydown',function(event){
  if(!event.target.closest('.student-install-tabs') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();var next=event.key==='Home'?'android':event.key==='End'?'ios':studentInstallPlatform==='ios'?'android':'ios';
  selectStudentInstallPlatform(next);document.getElementById(next==='ios'?'installIosTab':'installAndroidTab').focus();
});
function initStudentInstall() {
  new MutationObserver(updateStudentInstallVisibility).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  document.addEventListener('focusin',updateStudentInstallVisibility);document.addEventListener('focusout',function(){requestAnimationFrame(updateStudentInstallVisibility);});
  var resize=new ResizeObserver(updateStudentInstallVisibility);
  resize.observe(document.getElementById('studentSection'));resize.observe(document.getElementById('studentCheckInSurface'));resize.observe(document.querySelector('.student-actions'));
  window.addEventListener('resize',updateStudentInstallVisibility);window.addEventListener('scroll',updateStudentInstallVisibility,{passive:true});
  updateStudentInstallVisibility();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initStudentInstall);else initStudentInstall();
