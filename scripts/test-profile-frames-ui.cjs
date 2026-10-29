const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {startServer} = require('./serve.cjs');
const output = path.resolve(__dirname,'../tmp/profile-frames');
const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname,'../assets/profile-frames/manifest.json'),'utf8'));
const portrait = 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" fill="#dcebe9"/><circle cx="120" cy="91" r="40" fill="#1c6466"/><path d="M40 240v-29a80 80 0 0 1 160 0v29" fill="#1c6466"/></svg>');

async function main() {
  fs.mkdirSync(output,{recursive:true});
  const server=await startServer();
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({hasTouch:true});
  const errors=[],production=[],calls=[],frameRequests=[];
  let fail='',delay=0,prefs={frameEnabled:true,motionEnabled:true,revision:null},nextRevision=0,signedIn=true;
  const student={state:'linked',id:'00001',name:'นักเรียนตัวอย่าง ชื่อสำหรับทดสอบหน้าจอ',grade:'ม.2/1',role:'STUDENT',email:'frames@fixture.invalid',authMode:'google',linkVersion:'fixture-link',authSessionId:'fixture-session',photo_url:portrait};
  const pet={student_id:'00001',pet_id:'ember',pet_name:'เปลวไฟ',free_select_used:1,rename_used:0};
  const settings={school_name:'โรงเรียนทดสอบ',app_name:'MathQuest',semester_number:'1',semester_year:'2569',school_data_version:'fixture-v1',pin:''};
  const sdk=`window.supabase={createClient(){const post=async(name,args)=>{const r=await fetch('/__profile-frame-fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});return r.json()};
    return {auth:{getSession:()=>post('session'),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:post,removeChannel:()=>Promise.resolve(),channel:()=>({on(){return this},subscribe(){return this}}),
    from(table){let one=false,filters=[],operation='read',payload;const q={select(){return q},order(){return q},range(){return q},limit(){return q},gt(){return q},gte(){return q},lte(){return q},in(){return q},is(){return q},or(){return q},eq(k,v){filters.push([k,v]);return q},update(v){operation='update';payload=v;return q},maybeSingle(){one=true;return q},single(){one=true;return q},then(resolve,reject){return post('table',{table,one,filters,operation,payload}).then(resolve,reject)}};return q}}
  }};`;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/\/profile-frames\/[^/]+\.webp(?:\?|$)/.test(request.url()))frameRequests.push(request.url());});
  await page.route('**/*.supabase.co/**',route=>{production.push(route.request().url());return route.abort();});
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({contentType:'application/javascript',body:sdk}));
  await page.route('**/__profile-frame-fixture',async route=>{
    const {name,args}=route.request().postDataJSON();calls.push({name,args});
    let data=null,error=null;
    if(name==='session')data={session:signedIn?{user:{id:'untrusted-fixture-id'}}:null};
    else if(name==='mq_google_account')data=student;
    else if(name==='mq_student_profile_style'){
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      if(fail==='migration')error={code:'PGRST202',message:'Could not find the function'};
      else if(fail==='network')error={message:'network offline'};
      else if(args.p_action==='save'){
        if(fail==='conflict')data={status:'conflict',...prefs,revision:'external-revision'};
        else{prefs={frameEnabled:args.p_frame_enabled,motionEnabled:args.p_motion_enabled,revision:'fixture-'+(++nextRevision)};data={status:'success',...prefs};}
      }else data={status:'success',...prefs};
    }else if(name==='table'){
      let rows=args.table==='students'?[student]:args.table==='student_pets'?[pet]:args.table==='system_settings'?Object.entries(settings).map(([key,value])=>({key,value})):[];
      rows=rows.filter(row=>args.filters.every(([key,value])=>row[key]===value));
      data=args.one?rows[0]||null:rows;
    }
    await route.fulfill({contentType:'application/json',body:JSON.stringify({data,error,count:Array.isArray(data)?data.length:0})});
  });
  const screenshot=async name=>{if(!process.argv.includes('--no-capture'))await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});};
  const close=async()=>{await page.locator('#profileStyleModal .btn-close').click();await page.waitForFunction(()=>!profileStyleTransitioning&&!isProfileStyleOpen()&&!document.getElementById('profileStyleModal').classList.contains('show'));};
  const open=async()=>{await page.locator('#photoEditButton').click();await page.waitForFunction(()=>isProfileStyleOpen()&&profileStyleReady&&!profileStyleLoading&&getComputedStyle(document.getElementById('profileStyleModal')).opacity==='1'&&getComputedStyle(document.querySelector('#profileStyleModal .modal-dialog')).transform==='none');};
  try {
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
    await page.waitForSelector('#studentSection:not(.hidden)');
    await page.waitForFunction(()=>profileStyleReady&&studentAvatar.dataset.frame==='ember');
    assert.equal(new Set(frameRequests).size,1,'startup loads only the current frame, not the whole collection');
    const photoBefore=await page.locator('#studentPhoto').getAttribute('src');
    for(const [width,height] of [[320,780],[390,844],[768,1024],[1024,768],[1280,900]]){
      await page.setViewportSize({width,height});
      await screenshot('student-'+width);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'student overflow '+width);
      const edit=await page.locator('#photoEditButton').boundingBox();assert.ok(edit.width>=44&&edit.height>=44,'touch target');
      await open();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'dialog overflow '+width);
      const panel=await page.locator('#profileStyleModal .modal-content').boundingBox();
      assert.ok(panel.x>=0&&panel.x+panel.width<=width+1,'dialog contained '+width);
      await screenshot('editor-'+width);
      await close();
    }
    await page.setViewportSize({width:390,height:844});
    await open();
    await page.locator('#profileFrameNone').check();
    assert.equal(await page.locator('#profileStyleAvatar').getAttribute('data-frame'),'');
    assert.equal(await page.locator('#studentAvatar').getAttribute('data-frame'),'ember','draft is not saved early');
    await page.locator('#profileStyleSave').click();
    await page.waitForFunction(()=>profileStyle.frameEnabled===false&&!profileStyleBusy);
    assert.equal(await page.locator('#studentAvatar').getAttribute('data-frame'),'');
    assert.equal(await page.locator('#studentPhoto').getAttribute('src'),photoBefore,'changing frame does not reupload/change photo');
    await close();
    await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>profileStyleReady);
    assert.equal(await page.locator('#studentAvatar').getAttribute('data-frame'),'','saved preference survives a fresh document');
    await open();await page.locator('#profileFrameAuto').check();await page.locator('#profileFrameMotion').uncheck();
    delay=300;
    await page.evaluate(()=>{saveStudentProfileStyle();saveStudentProfileStyle();});
    await page.waitForFunction(()=>!profileStyleBusy);
    delay=0;
    assert.equal(calls.filter(call=>call.name==='mq_student_profile_style'&&call.args.p_action==='save').length,2,'double click saves once');
    assert.equal(await page.locator('#studentAvatar').getAttribute('data-motion'),'false');
    for(const id of ['aqua','mystic','ember']){
      await page.evaluate(id=>{studentPet.pet_id=id;renderStudentPet(studentPet,21);},id);
      assert.equal(await page.locator('#studentAvatar').getAttribute('data-frame'),id,'pet change follows '+id);
      await screenshot('frame-'+id);
    }
    await page.locator('#profileFrameMotion').check();
    await page.locator('#profileStyleSave').click();await page.waitForFunction(()=>!profileStyleBusy);
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('#profileStyleAvatar .mq-frame-light').evaluate(el=>getComputedStyle(el).animationName),'none');
    await screenshot('editor-reduced-motion');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await close();
    await page.setViewportSize({width:390,height:500});
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    await page.waitForFunction(()=>studentAvatar.dataset.inView==='false');
    assert.equal(await page.locator('#studentAvatar .mq-frame-light').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
    await page.setViewportSize({width:390,height:844});
    await page.locator('#photoEditButton').scrollIntoViewIfNeeded();
    await open();fail='network';
    await page.locator('#profileFrameNone').check();await page.locator('#profileStyleSave').click();
    await page.waitForFunction(()=>!profileStyleBusy&&profileStyleStatus.textContent.includes('อินเทอร์เน็ต'));
    assert.equal(await page.locator('#profileFrameNone').isChecked(),true,'failed save preserves draft');
    assert.equal(await page.locator('#studentAvatar').getAttribute('data-frame'),'ember','failed save preserves actual saved style');
    fail='conflict';await page.locator('#profileStyleSave').click();
    await page.waitForFunction(()=>!profileStyleBusy&&profileStyleStatus.textContent.includes('อีกหน้าต่าง'));
    fail='';await close();
    fail='migration';await page.locator('#photoEditButton').click();
    await page.waitForFunction(()=>profileStyleStatus.textContent.includes('20261029_01_student_profile_frames.sql')&&!profileStyleTransitioning);
    assert.equal(await page.locator('#profileStyleSave').isDisabled(),true);
    assert.equal(await page.locator('#profileStyleChangePhoto').isEnabled(),true,'missing cosmetic SQL does not disable photo upload');
    fail='';await close();await open();
    await page.evaluate(()=>{studentPet=null;renderStudentPet(null,0);});
    assert.equal(await page.locator('#profileFrameAuto').isDisabled(),true);
    assert.equal(await page.locator('#studentAvatar').getAttribute('data-frame'),'');
    await screenshot('editor-no-pet');
    await page.route('**/profile-frames/cinder.webp*',route=>route.fulfill({status:404,body:'fixture image failure'}));
    await page.evaluate(()=>{studentPet={pet_id:'cinder',pet_name:'ทดสอบ'};renderStudentPet(studentPet,0);});
    await page.waitForFunction(()=>profileFrameFailed.cinder===true);
    assert.equal(await page.locator('#studentAvatar').getAttribute('data-frame'),'','failed art falls back to photo');
    assert.ok((await page.locator('#profileStyleStatus').textContent()).includes('โหลดภาพกรอบไม่สำเร็จ'));
    const failedRequests=frameRequests.filter(url=>url.includes('/cinder.webp')).length;
    await close();
    await page.unroute('**/profile-frames/cinder.webp*');
    await open();
    await page.waitForFunction(()=>!profileFrameFailed.cinder&&!profileFramePending.cinder&&studentAvatar.dataset.frame==='cinder'&&document.querySelector('#profileStyleAvatar .mq-frame-art').naturalWidth>0);
    assert.ok(frameRequests.filter(url=>url.includes('/cinder.webp')).length>failedRequests,'explicit reopen requests the same failed frame again');
    assert.ok(frameRequests.some(url=>url.includes('/cinder.webp?retry=1')),'retry bypasses the cached failure');
    assert.equal(await page.locator('#profileStyleStatus').textContent(),'','image failure cleared only after recovery');
    await screenshot('editor-recovered-image');
    await close();
    await page.evaluate(()=>{studentPet.pet_id='ember';renderStudentProfileFrame();});
    await open();
    delay=200;await page.evaluate(()=>{PROFILE_STYLE_REQUEST_TIMEOUT_MS=40;});
    await page.locator('#profileStyleSave').click();
    await page.waitForFunction(()=>!profileStyleBusy&&profileStyleStatus.textContent.includes('ยังยืนยันผลไม่ได้'));
    assert.equal(await page.locator('#profileStyleChangePhoto').isEnabled(),true,'timeout unblocks the editor');
    await page.waitForTimeout(220);delay=0;
    await page.evaluate(()=>{PROFILE_STYLE_REQUEST_TIMEOUT_MS=15000;});
    await close();await open();
    await page.locator('#profileFrameNone').focus();await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#profileFrameAuto').isChecked(),true,'native keyboard radio navigation');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!profileStyleTransitioning&&!isProfileStyleOpen());
    assert.equal(await page.locator('#photoEditButton').evaluate(el=>el===document.activeElement),true,'focus returns to camera');
    await page.locator('#photoEditButton').tap();
    await page.waitForFunction(()=>profileStyleReady&&!profileStyleTransitioning);
    await page.evaluate(()=>document.documentElement.style.fontSize='200%');
    assert.equal(await page.locator('#profileStyleModal .modal-body').evaluate(el=>el.scrollWidth>el.clientWidth+1),false,'editor text zoom 200%');
    await page.evaluate(()=>document.documentElement.style.fontSize='');
    const crop=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#38a9a0"/></svg>');
    const png=await require('sharp')(crop).png().toBuffer();
    const chooserPromise=page.waitForEvent('filechooser');
    await page.locator('#profileStyleChangePhoto').click();
    await (await chooserPromise).setFiles({name:'synthetic-photo.png',mimeType:'image/png',buffer:png});
    await page.locator('#profileCropModal').waitFor({state:'visible'});
    await page.waitForFunction(()=>profileCropReady);
    assert.equal(await page.locator('.modal.show').count(),1,'file picker handoff has only one modal open');
    await page.locator('#profileCropModal .btn-close').click();await page.locator('#profileCropModal').waitFor({state:'hidden'});
    assert.equal(await page.locator('#studentPhoto').getAttribute('src'),photoBefore,'cancelled crop preserves photo');
    await open();delay=400;
    const staleSave=page.evaluate(()=>saveStudentProfileStyle());
    await page.waitForTimeout(60);
    await page.evaluate(()=>{resetStudentProfileStyle();CU={};});
    await staleSave;
    assert.equal(await page.evaluate(()=>profileStyleReady),false,'stale identity response ignored');
    delay=0;
    assert.deepEqual(production,[],'no production Supabase requests');
    assert.deepEqual(errors,[]);
    for(const call of calls.filter(call=>call.name==='mq_student_profile_style')){
      assert.equal('p_student_id' in call.args,false,'server derives identity');
      assert.equal(call.args.p_link_version,'fixture-link');
    }
    signedIn=false;await page.reload({waitUntil:'networkidle'});
    const guestRpcStart=calls.length;
    await page.locator('.btn-guest-login').click();await page.waitForFunction(()=>profileStyleReady&&CU.isGuest);
    await open();await page.locator('#profileFrameNone').check();await page.locator('#profileStyleSave').click();
    await page.waitForFunction(()=>!profileStyleBusy&&profileStyle.frameEnabled===false);
    await close();await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>profileStyleReady&&CU.isGuest);
    assert.equal(await page.locator('#studentAvatar').getAttribute('data-frame'),'','guest choice persists in session');
    assert.equal(calls.slice(guestRpcStart).some(call=>call.name==='mq_student_profile_style'),false,'guest never sends cosmetic RPC');
    assert.deepEqual(errors,[]);
    console.log('PASS frame UI: real app flow, preview/save/persistence, pet switch, missing SQL/network/conflict/image failures, timeout, reduced/offscreen motion, 320/390/768/1024/1280px, keyboard, synthesized touch (Edge), 200% text, camera/crop cancellation, stale identity, session-only guest, no production requests');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
