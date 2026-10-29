/* Four visual slots keep native editing, paste and assistive technology on one input. */
var studentPinTimer = null, studentCheckInBusy = false, studentUtilityModal = null;
var studentUtilityReturnFocus = null, studentBackdropStart = null, studentDiscardPending = false;

function studentUiIdentity() {
  return [CU.id,CU.authMode,typeof googleAccount !== 'undefined' && googleAccount && googleAccount.linkVersion,
    typeof schoolSemester !== 'undefined' && schoolSemester.version].join(':');
}
function renderStudentPin(previous) {
  var input=document.getElementById('pinCode'), slots=document.querySelectorAll('.student-pin-slots>span');
  var position=input.selectionStart == null ? input.value.length : input.selectionStart;
  slots.forEach(function(slot,index) {
    slot.textContent=input.value[index] || '';
    slot.classList.toggle('is-current',index===Math.min(position,3));
    if (previous !== undefined && input.value[index] && previous[index]!==input.value[index]) {
      slot.classList.remove('is-typed'); void slot.offsetWidth; slot.classList.add('is-typed');
    }
  });
}
function resetStudentPinFeedback() {
  clearTimeout(studentPinTimer);studentPinTimer=null;
  document.getElementById('studentPin').dataset.feedback='idle';
  document.getElementById('pinCode').removeAttribute('aria-invalid');
}
function studentEnsurePinFeedbackVisible() {
  var message=document.getElementById('studentPinMessage').getBoundingClientRect();
  var nav=document.querySelector('.student-actions').getBoundingClientRect();
  var viewport=window.visualViewport, bottom=viewport?viewport.offsetTop+viewport.height:innerHeight;
  if(nav.height)bottom=Math.min(bottom,nav.top);
  if(message.bottom>bottom-12){
    var root=document.documentElement, previous=root.style.scrollBehavior;
    root.style.scrollBehavior='auto';window.scrollBy(0,message.bottom-bottom+12);root.style.scrollBehavior=previous;
  }
}
function studentPinFeedback(kind,message,clearOnFinish) {
  resetStudentPinFeedback();
  var panel=document.getElementById('studentPin'), text=document.getElementById('studentPinMessage');
  text.textContent=message;text.dataset.tone=kind;
  if (kind==='error') document.getElementById('pinCode').setAttribute('aria-invalid','true');
  void panel.offsetWidth;panel.dataset.feedback=kind;
  var owner=studentUiIdentity(), value=document.getElementById('pinCode').value;
  requestAnimationFrame(function(){if(owner===studentUiIdentity())studentEnsurePinFeedbackVisible();});
  studentPinTimer=setTimeout(function() {
    if(owner!==studentUiIdentity())return;
    panel.dataset.feedback='idle';
    if(clearOnFinish && document.getElementById('pinCode').value===value){document.getElementById('pinCode').value='';renderStudentPin();}
  },3000);
}
function studentCheckInFeedback(result) {
  if (!result || result.result==='cancelled') return;
  var fieldCodes=['LOCATION_WRONG_PIN','LOCATION_NO_SESSION','LOCATION_PIN_EXPIRED','LOCATION_WRONG_CLASS','LOCATION_SESSION_CHANGED'];
  if(result.result==='success') {
    studentPinFeedback('success','เช็คชื่อสำเร็จ'+(Number(result.points)>0?' ได้รับ +'+Number(result.points)+' คะแนน':''),true);
    document.getElementById('pinCode').blur();
  } else if(result.result==='duplicate') studentPinFeedback('info',result.msg || 'เช็คชื่อคาบนี้แล้ว ไม่บันทึกซ้ำ',false);
  else studentPinFeedback(fieldCodes.indexOf(result.code)!==-1?'error':'notice',result.msg || 'ยังบันทึกไม่ได้ กรุณาลองอีกครั้ง',false);
}
function setStudentSubmissionBusy(busy) {
  var button=document.getElementById('checkInBtn');button.disabled=busy;button.setAttribute('aria-busy',String(busy));
  document.getElementById('pinCode').readOnly=busy;
  document.getElementById('checkInLabel').textContent=busy?'กำลังตรวจสอบการเช็คชื่อ':'เช็คชื่อเข้าเรียน';
}
function studentUiCanDismiss() {
  return !studentCheckInBusy && !(typeof profileStyleBusy!=='undefined' && profileStyleBusy)
    && !(typeof profileUploadInFlight!=='undefined' && profileUploadInFlight)
    && !(typeof profileCropProcessing!=='undefined' && profileCropProcessing)
    && !(typeof Swal!=='undefined' && Swal.isVisible());
}
function studentEditableSwalDismiss(initial) {
  if(Swal.isLoading())return false;
  var input=Swal.getInput();if(!input || input.value===initial)return true;
  Swal.showValidationMessage('มีการเปลี่ยนแปลงที่ยังไม่บันทึก ต้องการออกหรือไม่?');
  var popup=Swal.getPopup();
  if(!popup.querySelector('.student-discard-input')){
    var button=document.createElement('button');button.type='button';button.className='swal2-cancel swal2-styled student-discard-input';
    button.textContent='ออกโดยไม่บันทึก';button.addEventListener('click',function(){Swal.close();});
    Swal.getActions().appendChild(button);
  }
  return false;
}
function studentBackdropClick(event,id,close) {
  if(event.target!==document.getElementById(id) || studentBackdropStart!==event.target || !studentUiCanDismiss()) return;
  event.stopPropagation();close();
}
function ensureStudentUtility() {
  if(studentUtilityModal)return;
  var modal=document.createElement('div');
  modal.id='studentUtilityModal';modal.className='modal fade student-utility-modal';modal.tabIndex=-1;
  modal.setAttribute('aria-labelledby','studentUtilityTitle');modal.setAttribute('aria-hidden','true');
  modal.innerHTML='<div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h2 class="modal-title" id="studentUtilityTitle"></h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="ปิดหน้าต่าง"></button></div><div class="modal-body" id="studentUtilityBody"></div></div></div>';
  document.body.appendChild(modal);studentUtilityModal=bootstrap.Modal.getOrCreateInstance(modal);
  modal.addEventListener('hidden.bs.modal',function(){
    if(studentUtilityReturnFocus && studentUtilityReturnFocus.isConnected)studentUtilityReturnFocus.focus({preventScroll:true});
    studentUtilityReturnFocus=null;
  });
}
function openStudentUtility(title,html,kind) {
  if(CU.role!=='STUDENT' || document.querySelector('.modal.show') || document.querySelector('.shop-overlay.open') || Swal.isVisible())return false;
  ensureStudentUtility();studentUtilityReturnFocus=document.activeElement;
  document.getElementById('studentUtilityTitle').textContent=title;
  document.getElementById('studentUtilityBody').innerHTML=html;
  document.getElementById('studentUtilityModal').dataset.kind=kind || '';
  studentUtilityModal.show();return true;
}
function studentUtilityAction(action) {
  var modal=document.getElementById('studentUtilityModal');
  if(!modal || !modal.classList.contains('show'))return;
  modal.addEventListener('hidden.bs.modal',function(){action();},{once:true});studentUtilityModal.hide();
}
function openStudentMenu() {
  var google=typeof isGoogleLoginActive==='function' && isGoogleLoginActive();
  openStudentUtility('บัญชีและเมนู','<div class="student-menu-list">'
    +(google?'<button type="button" onclick="studentUtilityAction(openGoogleAccount)"><i class="fa-solid fa-user" aria-hidden="true"></i>บัญชี Google</button>':'')
    +'<button type="button" onclick="studentUtilityAction(refreshStudentData)"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i>รีเฟรชข้อมูล</button>'
    +'<button type="button" onclick="studentUtilityAction(openStudentInstall)"><i class="fa-solid fa-mobile-screen-button" aria-hidden="true"></i>เพิ่มแอปบนหน้าจอโฮม</button>'
    +'<button type="button" class="student-menu-logout" onclick="studentUtilityAction(logout)"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i>ออกจากระบบ</button></div>','menu');
}
function openStudentPetDetails() {
  var row=studentPet, pet=row && findPetById(row.pet_id), stage=getPetStageForLevel(getCurrentStudentLevel());
  var summary=row && pet ? escHtml(row.pet_name || pet.defaultName)+' · '+escHtml(stage.label || 'Stage '+stage.stage)
    +'<br>เปลี่ยนตัวฟรีใช้แล้ว '+clampPetCount(row.free_select_used,PET_FREE_SELECT_LIMIT)+'/'+PET_FREE_SELECT_LIMIT
    +' · เปลี่ยนชื่อใช้แล้ว '+clampPetCount(row.rename_used,PET_RENAME_LIMIT)+'/'+PET_RENAME_LIMIT : 'เลือกสัตว์เลี้ยงคู่หูของคุณ';
  openStudentUtility('สัตว์เลี้ยงและความสำเร็จ','<p class="student-pet-summary">'+summary+'</p><div class="student-pet-manage">'
    +'<button type="button" onclick="studentUtilityAction(openPetSelector)"><i class="fa-solid fa-paw" aria-hidden="true"></i> '+(row?'เปลี่ยนตัว':'เลือกสัตว์เลี้ยง')+'</button>'
    +(row?'<button type="button" onclick="studentUtilityAction(openRenamePetModal)"><i class="fa-solid fa-pen" aria-hidden="true"></i> เปลี่ยนชื่อ</button>':'')
    +'</div><div class="trophy-row" id="trophies">'+[0,10,20,30,40,50].map(function(level){return '<span class="trophy'+(getCurrentStudentLevel()>=level?' earned':'')+'" data-t="'+level+'" title="Level '+level+'"><i class="fa-solid fa-'+(level===50?'crown':level>=30?'trophy':'medal')+'" aria-hidden="true"></i><span class="visually-hidden">Level '+level+'</span></span>';}).join('')+'</div>','pet');
  updateGamiUI._trophies=null;
}
function studentGoHome() { window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}); }

function studentConfirmDiscard(event,modal,dirty) {
  if(!dirty || modal.dataset.discardApproved==='true') { delete modal.dataset.discardApproved;return false; }
  event.preventDefault();
  if(studentDiscardPending)return true;
  studentDiscardPending=true;
  var owner=studentUiIdentity(), returnFocus=document.activeElement;
  // Bootstrap 5.3's parent trap must yield to the body-mounted SweetAlert trap.
  var parent=bootstrap.Modal.getInstance(modal), trap=parent && parent._focustrap;
  if(trap)trap.deactivate();
  Swal.fire({title:'ออกโดยไม่บันทึก?',text:'การเปลี่ยนแปลงครั้งนี้จะไม่ถูกบันทึก',showCancelButton:true,
    confirmButtonText:'ออกโดยไม่บันทึก',cancelButtonText:'แก้ไขต่อ',confirmButtonColor:'#b0273f',returnFocus:false,
    didClose:function(){
      if(owner===studentUiIdentity() && modal.classList.contains('show')){
        if(trap)trap.activate();
        if(returnFocus && modal.contains(returnFocus))returnFocus.focus({preventScroll:true});else modal.focus({preventScroll:true});
      }
    }}).then(function(answer){
      studentDiscardPending=false;
      if(answer.isConfirmed && owner===studentUiIdentity()){modal.dataset.discardApproved='true';bootstrap.Modal.getInstance(modal).hide();}
    });return true;
}
function studentProfileDraftDirty() {
  return profileStyleReady && !profileStyleLoading && (document.getElementById('profileFrameAuto').checked!==profileStyle.frameEnabled
    || document.getElementById('profileFrameMotion').checked!==profileStyle.motionEnabled);
}
function resetStudentHome() {
  resetStudentPinFeedback();studentCheckInBusy=false;
  setStudentSubmissionBusy(false);
  var input=document.getElementById('pinCode');input.value='';renderStudentPin();
  var message=document.getElementById('studentPinMessage');message.textContent='กรอกรหัสจากครู แล้วกดเช็คชื่อ';delete message.dataset.tone;
  if(studentUtilityModal)studentUtilityModal.hide();
}
function initStudentHome() {
  var input=document.getElementById('pinCode'), previous=input.value;
  var tap=null;
  input.addEventListener('pointerdown',function(event){tap={x:event.clientX,y:event.clientY};});
  input.addEventListener('pointerup',function(event){
    if(!tap || Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>8 || input.readOnly)return;
    var rect=input.getBoundingClientRect(), index=Math.min(input.value.length,Math.max(0,Math.floor((event.clientX-rect.left)/(rect.width/4))));
    requestAnimationFrame(function(){input.setSelectionRange(index,Math.min(index+1,input.value.length));renderStudentPin();});tap=null;
  });
  input.addEventListener('pointercancel',function(){tap=null;});
  input.addEventListener('input',function(){
    resetStudentPinFeedback();
    input.value=input.value.replace(/[๐-๙]/g,function(n){return String(n.charCodeAt(0)-3664);}).replace(/\D/g,'').slice(0,4);
    renderStudentPin(previous);previous=input.value;
    var text=document.getElementById('studentPinMessage');text.textContent=input.value.length===4?'พร้อมเช็คชื่อเข้าเรียน':'กรอกรหัสจากครู แล้วกดเช็คชื่อ';delete text.dataset.tone;
  });
  ['focus','click','keyup','select'].forEach(function(name){input.addEventListener(name,function(){renderStudentPin();});});
  renderStudentPin();
  document.addEventListener('pointerdown',function(event){studentBackdropStart=event.target;},true);
  document.addEventListener('pointercancel',function(){studentBackdropStart=null;},true);
  document.addEventListener('show.bs.modal',function(){document.getElementById('studentInstallButton').hidden=true;});
  if(typeof updateStudentInstallVisibility==='function')updateStudentInstallVisibility();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initStudentHome);else initStudentHome();
