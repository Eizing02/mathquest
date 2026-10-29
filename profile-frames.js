/* Cosmetic preferences never modify the uploaded photo or the pet economy. */
var profileFrameCatalog = null;
var profileFrameCatalogPromise = null;
var profileStyle = { frameEnabled: true, motionEnabled: true, revision: null };
var profileStyleOwner = '';
var profileStyleReady = false;
var profileStyleError = '';
var profileStyleBusy = false;
var profileStyleLoading = false;
var profileStyleLoadSerial = 0;
var profileStyleModal = null;
var profileStyleActive = false;
var profileStyleTransitioning = false;
var profileStyleClosing = null;
var profileStyleObserver = null;
var profileFrameFailed = {};
var profileFrameRetries = {};
var profileFramePending = {};
var PROFILE_STYLE_REQUEST_TIMEOUT_MS = 15000;

async function profileStyleRequest(request, controller) {
  var timer;
  try {
    return await Promise.race([request, new Promise(function(resolve,reject) {
      timer = setTimeout(function() {
        if (controller) controller.abort();
        reject(new Error('PROFILE_STYLE_TIMEOUT'));
      }, PROFILE_STYLE_REQUEST_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}

function profileStyleIdentity() {
  return CU && CU.role === 'STUDENT' ? [CU.id, CU.authMode || 'guest', CU.linkVersion || '',
    CU.authSessionId || '', schoolSemester.version || ''].join('|') : '';
}

function profileStyleMessage(error) {
  var message = error && error.message || '';
  if (error && (error.code === 'PGRST202' || /Could not find the function/.test(message))) {
    return 'ยังบันทึกกรอบไม่ได้ กรุณาให้ครูรันไฟล์ 20261029_01_student_profile_frames.sql แล้วลองใหม่';
  }
  if (/LINK_STATE_CHANGED|LINKED_STUDENT_REQUIRED|GOOGLE_SESSION_REQUIRED|ถูกรีเซ็ต/.test(message)) {
    return 'บัญชีหรือข้อมูลภาคเรียนเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่ก่อนบันทึก';
  }
  if (/RATE_LIMITED/.test(message)) return 'บันทึกหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่';
  if (/GUEST_SESSION_EXPIRED/.test(message)) return 'โหมดทดลองหมดเวลาแล้ว กรุณาเปิดโหมดทดลองใหม่';
  if (/PROFILE_STYLE_TIMEOUT|AbortError/.test(message)) return 'ยังยืนยันผลไม่ได้ กรุณาปิดแล้วเปิดหน้าโปรไฟล์ใหม่เพื่อตรวจสอบก่อนลองอีกครั้ง';
  return 'เชื่อมต่อไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่ รูปโปรไฟล์เดิมยังอยู่';
}

function loadProfileFrameCatalog() {
  if (profileFrameCatalogPromise) return profileFrameCatalogPromise;
  var controller = new AbortController();
  profileFrameCatalogPromise = profileStyleRequest(fetch('./assets/profile-frames/manifest.json', {signal:controller.signal}),controller).then(function(response) {
    if (!response.ok) throw new Error('Frame catalog unavailable');
    return response.json();
  }).then(function(catalog) {
    if (!catalog || !Array.isArray(catalog.frames)) throw new Error('Invalid frame catalog');
    profileFrameCatalog = catalog;
    return catalog;
  }).catch(function() {
    profileFrameCatalogPromise = null;
    return null;
  });
  return profileFrameCatalogPromise;
}

function currentPetFrame() {
  if (!profileFrameCatalog || !studentPet) return null;
  return profileFrameCatalog.frames.find(function(frame) { return frame.petId === studentPet.pet_id; }) || null;
}

async function profileStyleRpc(action, draft) {
  var controller = new AbortController();
  var request = getSupabase().rpc('mq_student_profile_style', {
    p_action: action, p_frame_enabled: draft ? draft.frameEnabled : null,
    p_motion_enabled: draft ? draft.motionEnabled : null, p_expected_version: schoolSemester.version || '',
    p_link_version: CU.linkVersion || '', p_revision: action === 'save' ? profileStyle.revision : null
  });
  if (request.abortSignal) request = request.abortSignal(controller.signal);
  var result = await profileStyleRequest(runQuery(request),controller);
  if (!result || ['success', 'conflict'].indexOf(result.status) === -1) {
    throw new Error(result && result.code || 'Invalid style response');
  }
  return result;
}

function profileStyleValue(value) {
  return {frameEnabled:value.frameEnabled !== false, motionEnabled:value.motionEnabled !== false,
    revision:value.revision || null};
}

async function loadStudentProfileStyle() {
  var owner = profileStyleIdentity();
  if (!owner) return;
  var serial = ++profileStyleLoadSerial;
  profileStyleOwner = owner;
  profileStyleReady = false;
  profileStyleLoading = true;
  profileStyleError = '';
  if (isProfileStyleOpen()) updateProfileStyleControls();
  try {
    var catalogRequest = loadProfileFrameCatalog();
    var result;
    if (isGuestMode()) {
      var session = getActiveGuestSession();
      if (!session) throw new Error('GUEST_SESSION_EXPIRED');
      result = session && session.profileStyle || {};
    } else result = await profileStyleRpc('read');
    await catalogRequest;
    if (owner !== profileStyleIdentity() || serial !== profileStyleLoadSerial) return;
    profileStyle = profileStyleValue(result);
    profileStyleReady = true;
  } catch (error) {
    if (owner !== profileStyleIdentity() || serial !== profileStyleLoadSerial) return;
    profileStyleError = profileStyleMessage(error);
  }
  if (owner === profileStyleIdentity() && serial === profileStyleLoadSerial) {
    profileStyleLoading = false;
    renderStudentProfileFrame();
  }
}

function observeProfileFrame(element) {
  if (!profileStyleObserver && window.IntersectionObserver) {
    profileStyleObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        entry.target.dataset.inView = entry.isIntersecting ? 'true' : 'false';
      });
    });
  }
  if (profileStyleObserver) profileStyleObserver.observe(element);
  else element.dataset.inView = 'true';
}

function renderProfileAvatar(container, preferences) {
  if (!container) return;
  var frame = currentPetFrame();
  var enabled = !!(frame && preferences.frameEnabled && !profileFrameFailed[frame.petId]);
  container.dataset.frame = enabled ? frame.petId : '';
  container.dataset.motion = preferences.motionEnabled ? 'true' : 'false';
  container.dataset.pageVisible = document.hidden ? 'false' : 'true';
  if (!container.dataset.observed) {
    container.dataset.observed = 'true';
    container.dataset.inView = 'false';
    observeProfileFrame(container);
  }
  var decoration = container.querySelector('.mq-frame-decoration');
  if (!enabled) { if (decoration) decoration.remove(); return; }
  container.style.setProperty('--frame-color', frame.color);
  container.dataset.effect = frame.effect;
  if (decoration && decoration.dataset.petId === frame.petId) return;
  if (decoration) decoration.remove();
  decoration = document.createElement('span');
  decoration.className = 'mq-frame-decoration';
  decoration.dataset.petId = frame.petId;
  decoration.setAttribute('aria-hidden', 'true');
  var art = document.createElement('img');
  art.className = 'mq-frame-art';
  art.alt = '';
  art.draggable = false;
  art.decoding = 'async';
  art.onload = function() {
    if (!decoration.isConnected || container.querySelector('.mq-frame-decoration') !== decoration || container.dataset.frame !== frame.petId) return;
    delete profileFrameFailed[frame.petId];
    delete profileFramePending[frame.petId];
    if (isProfileStyleOpen() && document.getElementById('profileStyleStatus').dataset.kind === 'image') showProfileStyleLoadStatus();
  };
  art.onerror = function() {
    if (!decoration.isConnected || container.querySelector('.mq-frame-decoration') !== decoration || container.dataset.frame !== frame.petId) return;
    profileFrameFailed[frame.petId] = true;
    delete profileFramePending[frame.petId];
    renderStudentProfileFrame();
    if (isProfileStyleOpen()) {
      previewProfileStyle();
      showProfileStyleLoadStatus();
    }
  };
  var glow = document.createElement('img');
  glow.className = 'mq-frame-light';
  glow.alt = '';
  glow.draggable = false;
  var retry = profileFrameRetries[frame.petId] || 0;
  var source = './assets/profile-frames/' + frame.petId + '.webp' + (retry ? '?retry=' + retry : '');
  art.src = source;
  glow.src = source;
  decoration.appendChild(glow);
  decoration.appendChild(art);
  var icons = {embers:'fire',water:'droplet',snow:'snowflake',leaves:'leaf',electric:'bolt',wind:'wind',sand:'star',cloud:'star',sun:'star',stars:'star',arcane:'star'};
  for (var index = 0; index < 4; index++) {
    var spark = document.createElement('i');
    spark.className = 'mq-frame-spark fa-solid fa-' + (icons[frame.effect] || 'star');
    spark.style.setProperty('--spark-index', index);
    decoration.appendChild(spark);
  }
  container.appendChild(decoration);
}

function renderStudentProfileFrame() {
  renderProfileAvatar(document.getElementById('studentAvatar'), profileStyleReady && profileStyleOwner === profileStyleIdentity()
    ? profileStyle : {frameEnabled:false,motionEnabled:false});
  if (isProfileStyleOpen()) previewProfileStyle();
}

function isProfileStyleOpen() {
  return profileStyleActive;
}

function setProfileStyleStatus(message, error, kind) {
  var status = document.getElementById('profileStyleStatus');
  status.hidden = !message;
  status.textContent = message || '';
  status.classList.toggle('is-error', !!error);
  status.dataset.kind = kind || 'general';
}

function showProfileStyleLoadStatus() {
  var frame = currentPetFrame();
  if (profileStyleError) return setProfileStyleStatus(profileStyleError,true,'preferences');
  if (frame && profileFrameFailed[frame.petId]) {
    return setProfileStyleStatus('โหลดภาพกรอบไม่สำเร็จ ปิดแล้วเปิดหน้าปรับโปรไฟล์ใหม่เพื่อลองอีกครั้ง รูปโปรไฟล์ยังใช้งานได้',true,'image');
  }
  if (frame && profileFramePending[frame.petId]) return setProfileStyleStatus('กำลังโหลดภาพกรอบอีกครั้ง...',false,'image');
  setProfileStyleStatus('');
}

function updateProfileStyleControls() {
  var available = !!currentPetFrame();
  document.getElementById('profileFrameAuto').disabled = profileStyleBusy || profileStyleLoading || !available;
  document.getElementById('profileFrameNone').disabled = profileStyleBusy || profileStyleLoading;
  document.getElementById('profileFrameMotion').disabled = profileStyleBusy || profileStyleLoading || !available || !document.getElementById('profileFrameAuto').checked;
  document.getElementById('profileStyleSave').disabled = profileStyleBusy || !profileStyleReady;
  document.getElementById('profileStyleSave').setAttribute('aria-busy', profileStyleBusy ? 'true' : 'false');
  document.getElementById('profileStyleChangePhoto').disabled = profileStyleBusy || profileStyleTransitioning || profileUploadInFlight;
  document.querySelectorAll('#profileStyleModal [data-bs-dismiss="modal"]').forEach(function(button) { button.disabled = profileStyleBusy; });
  document.querySelector('#profileStyleSave span').textContent = profileStyleBusy ? 'กำลังบันทึก...' : 'บันทึกกรอบ';
}

function previewProfileStyle() {
  var photo = document.getElementById('profileStylePhoto');
  var dashboardPhoto = document.getElementById('studentPhoto');
  if (!photo || !dashboardPhoto) return;
  var source = dashboardPhoto.getAttribute('src') || BLANK_IMAGE_SRC;
  if (photo.getAttribute('src') !== source) photo.src = source;
  photo.onerror = function() { photo.onerror = null; photo.src = profilePlaceholderSrc || BLANK_IMAGE_SRC; };
  var frame = currentPetFrame();
  renderProfileAvatar(document.getElementById('profileStyleAvatar'), {
    frameEnabled: document.getElementById('profileFrameAuto').checked,
    motionEnabled: document.getElementById('profileFrameMotion').checked
  });
  document.getElementById('profileStyleFrameName').textContent = frame ? 'กรอบ ' + frame.name : studentPet ? 'ยังโหลดกรอบไม่ได้' : 'ยังไม่มีสัตว์เลี้ยง';
  document.getElementById('profileStylePetName').textContent = frame && studentPet ? studentPet.pet_name || frame.name : '';
  document.getElementById('profileStyleEmpty').hidden = !!frame;
  document.getElementById('profileStyleEmpty').textContent = studentPet ? 'ลองปิดแล้วเปิดหน้านี้ใหม่เพื่อโหลดกรอบอีกครั้ง' : 'เลือกสัตว์เลี้ยงก่อนใช้กรอบโปรไฟล์';
  var sprite = document.getElementById('profileStylePetSprite');
  sprite.hidden = !frame;
  if (frame) setPetSprite(sprite, findPetById(frame.petId), getPetStageForLevel(getCurrentStudentLevel()));
  document.getElementById('profileStyleReducedMotion').hidden = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  updateProfileStyleControls();
}

function initProfileStyleModal() {
  if (profileStyleModal) return;
  var modal = document.getElementById('profileStyleModal');
  profileStyleModal = bootstrap.Modal.getOrCreateInstance(modal);
  modal.addEventListener('hide.bs.modal', function(event) {
    if (profileStyleBusy) { event.preventDefault(); return; }
    if (profileStyleActive && typeof studentConfirmDiscard === 'function'
        && studentConfirmDiscard(event, modal, studentProfileDraftDirty())) return;
    profileStyleActive = false;
    profileStyleTransitioning = true;
    profileStyleClosing = new Promise(function(resolve) {
      modal.addEventListener('hidden.bs.modal', function() { profileStyleClosing = null; resolve(); }, {once:true});
    });
  });
  modal.addEventListener('shown.bs.modal', function() {
    profileStyleTransitioning = false;
    if (!profileStyleActive) { profileStyleModal.hide(); return; }
    updateProfileStyleControls();
    document.getElementById('profileStyleChangePhoto').focus();
  });
  modal.addEventListener('hidden.bs.modal', function() {
    profileStyleTransitioning = false;
    var button = document.getElementById('photoEditButton');
    if (button && !document.querySelector('.modal.show')) button.focus();
  });
}

async function openProfileStyle() {
  if (!profileStyleIdentity() || profileUploadInFlight || profileStyleBusy || isProfileStyleOpen()) return;
  initProfileStyleModal();
  var frame = currentPetFrame();
  if (frame && profileFrameFailed[frame.petId]) {
    // Retry only on an explicit reopen; use a new URL to bypass cached failures.
    delete profileFrameFailed[frame.petId];
    profileFramePending[frame.petId] = true;
    profileFrameRetries[frame.petId] = (profileFrameRetries[frame.petId] || 0) + 1;
  }
  profileStyleActive = true;
  profileStyleTransitioning = true;
  document.getElementById('profileFrameAuto').checked = profileStyle.frameEnabled;
  document.getElementById('profileFrameNone').checked = !profileStyle.frameEnabled;
  document.getElementById('profileFrameMotion').checked = profileStyle.motionEnabled;
  document.getElementById('profileStyleGuest').hidden = !isGuestMode();
  setProfileStyleStatus('กำลังโหลดค่ากรอบ...');
  previewProfileStyle();
  profileStyleModal.show();
  var owner = profileStyleIdentity();
  await loadStudentProfileStyle();
  if (owner !== profileStyleIdentity() || !isProfileStyleOpen()) return;
  document.getElementById('profileFrameAuto').checked = profileStyle.frameEnabled;
  document.getElementById('profileFrameNone').checked = !profileStyle.frameEnabled;
  document.getElementById('profileFrameMotion').checked = profileStyle.motionEnabled;
  previewProfileStyle();
  showProfileStyleLoadStatus();
}

function waitForProfileStyleClose() { return profileStyleClosing || Promise.resolve(); }

function chooseProfileStylePhoto() {
  if (profileStyleBusy || profileStyleTransitioning || profileUploadInFlight) return;
  // Keep the file picker in the original user gesture (required by Safari).
  document.getElementById('profileStyleModal').dataset.discardApproved = 'true';
  profileStyleModal.hide();
  openPhotoUpload();
}

async function saveStudentProfileStyle() {
  if (profileStyleBusy || !profileStyleReady || profileStyleOwner !== profileStyleIdentity()) return;
  var owner = profileStyleIdentity();
  var draft = {frameEnabled:document.getElementById('profileFrameAuto').checked,
    motionEnabled:document.getElementById('profileFrameMotion').checked};
  profileStyleBusy = true;
  updateProfileStyleControls();
  setProfileStyleStatus('');
  try {
    var result;
    if (isGuestMode()) {
      var session = getActiveGuestSession();
      if (!session) throw new Error('GUEST_SESSION_EXPIRED');
      session.profileStyle = draft;
      saveActiveGuestSession(session);
      result = Object.assign({status:'success'},draft);
    } else result = await profileStyleRpc('save', draft);
    if (owner !== profileStyleIdentity()) return;
    profileStyle = profileStyleValue(result);
    renderStudentProfileFrame();
    setProfileStyleStatus(result.status === 'conflict'
      ? 'ค่ากรอบถูกเปลี่ยนจากอีกหน้าต่างแล้ว ตรวจตัวอย่างและกดบันทึกอีกครั้งเพื่อใช้ค่าที่เลือก'
      : 'บันทึกกรอบแล้ว', result.status === 'conflict');
    var frame = currentPetFrame();
    if (result.status === 'success' && frame && profileFrameFailed[frame.petId]) showProfileStyleLoadStatus();
  } catch (error) {
    if (owner === profileStyleIdentity()) setProfileStyleStatus(profileStyleMessage(error),true);
  } finally {
    if (owner === profileStyleIdentity()) {
      profileStyleBusy = false;
      updateProfileStyleControls();
    }
  }
}

function resetStudentProfileStyle() {
  profileStyleLoadSerial++;
  profileStyleOwner = '';
  profileStyleReady = false;
  profileStyleLoading = false;
  profileStyleBusy = false;
  profileStyleError = '';
  profileStyle = {frameEnabled:true,motionEnabled:true,revision:null};
  profileStyleActive = false;
  profileStyleTransitioning = false;
  var editorPhoto = document.getElementById('profileStylePhoto');
  if (editorPhoto) editorPhoto.src = BLANK_IMAGE_SRC;
  if (profileStyleModal) profileStyleModal.hide();
  document.querySelectorAll('.mq-frame-decoration').forEach(function(element) { element.remove(); });
  document.querySelectorAll('.mq-avatar').forEach(function(element) { element.dataset.frame = ''; });
}

document.addEventListener('visibilitychange', function() {
  document.querySelectorAll('.mq-avatar').forEach(function(element) {
    element.dataset.pageVisible = document.hidden ? 'false' : 'true';
  });
});
window.addEventListener('pagehide', resetStudentProfileStyle);
window.addEventListener('pageshow', function(event) {
  if (event.persisted && profileStyleIdentity()) loadStudentProfileStyle();
});
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function() {
  if (isProfileStyleOpen()) previewProfileStyle();
});
