const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {startServer}=require('./serve.cjs');
const out=path.resolve(__dirname,'../tmp/student-home');
async function main(){
  fs.mkdirSync(out,{recursive:true});
  const server=await startServer(), browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  const errors=[],production=[],calls=[];
  let decision='success',hold=false,submitCount=0;
  const student={state:'linked',id:'00001',name:'นักเรียนตัวอย่าง สำหรับทดสอบหน้าจอ',grade:'ม.2/1',role:'STUDENT',email:'student@fixture.invalid',authMode:'google',linkVersion:'fixture-link',authSessionId:'fixture-session'};
  const pet={student_id:'00001',pet_id:'aqua',pet_name:'หยดน้ำ',free_select_used:1,rename_used:0};
  const settings={school_name:'โรงเรียนทดสอบ',app_name:'เช็คชื่อเข้าเรียนครูอี้',semester_number:'1',semester_year:'2569',school_data_version:'fixture-v1',pin:''};
  const sdk=`window.supabase={createClient(){const post=async(name,args)=>{const r=await fetch('/__student_ui_fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});return r.json()};return {auth:{getSession:()=>post('session'),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:post,removeChannel:()=>Promise.resolve(),channel:()=>({on(){return this},subscribe(){return this}}),from(table){let one=false,filters=[];const q={select(){return q},order(){return q},range(){return q},limit(){return q},gt(){return q},gte(){return q},lte(){return q},in(){return q},is(){return q},or(){return q},eq(k,v){filters.push([k,v]);return q},maybeSingle(){one=true;return q},single(){one=true;return q},then(resolve,reject){return post('table',{table,one,filters}).then(resolve,reject)}};return q}}}};`;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*.supabase.co/**',route=>{production.push(route.request().url());return route.abort();});
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({contentType:'application/javascript',body:sdk}));
  await page.route('**/__student_ui_fixture',async route=>{
    const {name,args}=route.request().postDataJSON();calls.push({name,args});let data=null,error=null;
    if(name==='session')data={session:{user:{id:'fixture-only'}}};
    else if(name==='mq_google_account')data=student;
    else if(name==='mq_student_profile_style')data={status:'success',frameEnabled:true,motionEnabled:true,revision:null};
    else if(name==='mq_prepare_location_check_in')data=decision.startsWith('LOCATION_')?{result:'error',code:decision}:{result:'ready',request_id:'fixture-request',max_accuracy_m:50};
    else if(name==='mq_student_check_in_at_location'){
      submitCount++;if(hold)await new Promise(resolve=>setTimeout(resolve,500));
      data=decision==='duplicate'?{result:'duplicate',points:0}:{result:'success',points:5,distance_m:3};
    }else if(name==='table'){
      let rows=args.table==='students'?[student]:args.table==='student_pets'?[pet]:args.table==='system_settings'?Object.entries(settings).map(([key,value])=>({key,value})):[];
      rows=rows.filter(row=>args.filters.every(([key,value])=>row[key]===value));data=args.one?rows[0]||null:rows;
    }
    await route.fulfill({contentType:'application/json',body:JSON.stringify({data,error,count:Array.isArray(data)?data.length:0})});
  });
  await page.addInitScript(()=>{
    window.fixtureGpsCalls=0;
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(success){fixtureGpsCalls++;const id=setTimeout(()=>success({coords:{latitude:17.131333,longitude:102.103092,accuracy:10},timestamp:Date.now()}),30);return id;},clearWatch(id){clearTimeout(id);}}});
  });
  const shot=async name=>{if(!process.argv.includes('--no-capture'))await page.screenshot({path:path.join(out,name+'.png'),fullPage:name==='text-zoom-document'});};
  const utilityOpen=async()=>page.waitForFunction(()=>document.getElementById('studentUtilityModal').classList.contains('show')&&getComputedStyle(document.querySelector('#studentUtilityModal .modal-dialog')).transform==='none');
  const utilityClose=async()=>{await page.mouse.click(4,4);await page.waitForFunction(()=>!document.getElementById('studentUtilityModal').classList.contains('show'));await page.waitForFunction(()=>!document.querySelector('.modal-backdrop'));};
  try{
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>profileStyleReady&&studentAvatar.dataset.frame==='aqua');
    await page.evaluate(()=>{getStudentPointsAndLevelDb=async()=>({level:7,totalPoints:35,pointsInLevel:0});getWalletBalanceDb=async()=>({mathCoins:30});studentExamButton.hidden=false;});
    assert.equal(await page.evaluate(()=>fixtureGpsCalls),0,'no background GPS');
    const manifest=await page.request.get('http://127.0.0.1:'+server.address().port+'/app.webmanifest');
    assert.match(manifest.headers()['content-type'],/manifest\+json/);assert.equal((await manifest.json()).name,'เช็คชื่อเข้าเรียนครูอี้');
    for(const [width,height] of [[320,568],[360,740],[390,844],[430,932],[768,1024],[1280,900]]){
      await page.setViewportSize({width,height});
      await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'no overflow '+width);
      const button=await page.locator('#checkInBtn').boundingBox(), nav=await page.locator('.student-actions').boundingBox();
      assert.ok(button.height>=44&&button.width>=44);if(width>=360)assert.ok(button.y+button.height<nav.y,'primary task in one viewport '+width+' '+JSON.stringify({button,nav}));
      if(await page.locator('#studentInstallButton').isVisible()){
        const icon=await page.locator('#studentInstallButton').boundingBox();
        assert.ok(!((icon.x<button.x+button.width)&&(icon.x+icon.width>button.x)&&(icon.y<button.y+button.height+8)&&(icon.y+icon.height>button.y-8)),'install does not intersect primary '+width);
        assert.ok(icon.y+icon.height<=nav.y-7,'install clears navigation '+width+' '+JSON.stringify({icon,nav,inner:await page.evaluate(()=>innerHeight)}));
      }
      await shot('home-'+width);
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('#pinCode').fill('0123');
    assert.deepEqual(await page.locator('.student-pin-slots>span').allTextContents(),['0','1','2','3']);
    const pinBox=await page.locator('#pinCode').boundingBox();
    await page.mouse.click(pinBox.x+pinBox.width*.375,pinBox.y+pinBox.height/2);await page.waitForFunction(()=>pinCode.selectionStart===1&&pinCode.selectionEnd===2);
    await page.keyboard.type('9');assert.equal(await page.locator('#pinCode').inputValue(),'0923','tap replaces the intended visible slot');
    assert.equal(await page.locator('#studentInstallButton').isHidden(),true,'install shortcut hidden while typing');
    await page.locator('#pinCode').fill('๐๑๒๓');assert.equal(await page.locator('#pinCode').inputValue(),'0123');
    await page.locator('#pinCode').fill('12');await page.locator('#checkInBtn').click();
    assert.equal(await page.locator('#pinCode').getAttribute('aria-invalid'),'true');assert.equal(submitCount,0);
    for(const code of ['LOCATION_WRONG_PIN','LOCATION_NO_SESSION','LOCATION_PIN_EXPIRED','LOCATION_WRONG_CLASS']){
      decision=code;await page.locator('#pinCode').fill('0123');await page.locator('#checkInBtn').click();
      await page.waitForFunction(()=>!studentCheckInBusy);
      assert.equal(await page.locator('#studentPin').getAttribute('data-feedback'),'error');assert.equal(submitCount,0);
      await shot(code.toLowerCase());
    }
    await page.waitForFunction(()=>studentPin.dataset.feedback==='idle',{timeout:5000});
    assert.ok((await page.locator('#studentPinMessage').textContent()).length>0,'message persists after effect');
    decision='LOCATION_OUTSIDE';await page.locator('#pinCode').fill('0123');await page.locator('#checkInBtn').click();await page.waitForFunction(()=>!studentCheckInBusy);
    assert.equal(await page.locator('#studentPin').getAttribute('data-feedback'),'notice','GPS errors do not label PIN invalid');
    decision='success';hold=true;await page.locator('#checkInBtn').click();await page.waitForFunction(()=>attendanceLocationBusy);
    await page.evaluate(()=>{checkIn();checkIn();});await page.waitForFunction(()=>!studentCheckInBusy);
    assert.equal(submitCount,1,'only one commit during busy');hold=false;
    assert.equal(await page.locator('#studentPin').getAttribute('data-feedback'),'success');await shot('pin-success');
    assert.match(await page.locator('.student-pin-slots>span').first().evaluate(el=>getComputedStyle(el).animationName),/wave/);
    await page.waitForFunction(()=>pinCode.value===''&&studentPin.dataset.feedback==='idle',{timeout:5000});
    decision='duplicate';await page.locator('#pinCode').fill('1234');await page.locator('#checkInBtn').click();await page.waitForFunction(()=>!studentCheckInBusy);
    assert.equal(await page.locator('#studentPin').getAttribute('data-feedback'),'info');assert.doesNotMatch(await page.locator('#studentPinMessage').textContent(),/\+5/);
    await page.locator('#pinCode').blur();
    await page.locator('#studentInstallButton').click();await utilityOpen();
    await page.locator('#installAndroidTab').click();assert.equal(await page.locator('#studentInstallNow').count(),0,'manual guidance when prompt unavailable');await shot('install-android-manual');
    await page.evaluate(()=>{window.fakeInstallCount=0;const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{fakeInstallCount++;return {outcome:'dismissed'};};window.dispatchEvent(event);});
    await page.locator('#studentInstallNow').click();assert.equal(await page.evaluate(()=>fakeInstallCount),1);assert.equal(await page.locator('#studentInstallNow').count(),0,'one-use event consumed');
    await page.locator('#installIosTab').click();assert.equal(await page.locator('#studentInstallNow').count(),0);assert.match(await page.locator('#studentInstallPanel').textContent(),/Safari/);await shot('install-ios');
    await page.locator('#studentUtilityBody').click({position:{x:12,y:12}});assert.equal(await page.locator('#studentUtilityModal').isVisible(),true,'inside blank does not close');
    await utilityClose();assert.equal(await page.locator('#pinCode').inputValue(),'1234','dismiss preserves PIN');
    await page.locator('#studentPetDetailsButton').click();await utilityOpen();await shot('pet-details');await utilityClose();
    await page.locator('.student-toolbar .student-icon-button').click();await utilityOpen();await shot('account-menu');await utilityClose();
    await page.locator('#studentShopButton').click();await page.waitForFunction(()=>shopOverlay.classList.contains('open'));
    await page.locator('#shopModal').click({position:{x:10,y:15}});assert.equal(await page.locator('#shopOverlay').getAttribute('aria-hidden'),'false');
    await page.mouse.click(4,4);await page.waitForFunction(()=>!shopOverlay.classList.contains('open'));assert.equal(await page.locator('#studentSection').evaluate(el=>el.inert),false);
    await page.locator('#photoEditButton').click();await page.waitForFunction(()=>profileStyleReady&&!profileStyleTransitioning);
    await page.locator('#profileFrameNone').check();await page.mouse.click(4,4);
    await page.waitForFunction(()=>studentDiscardPending);assert.equal(await page.locator('#profileStyleModal').isVisible(),true);
    for(let tab=0;tab<6;tab++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Swal.getPopup().contains(document.activeElement)),true,'topmost discard owns keyboard focus');}
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!studentDiscardPending&&!document.querySelector('.swal2-container'));assert.equal(await page.locator('#profileFrameNone').isChecked(),true,'cancel exit keeps draft');
    assert.equal(await page.evaluate(()=>profileStyleModal._element.contains(document.activeElement)),true,'cancel restores parent focus');
    await page.mouse.click(4,4);await page.locator('.swal2-confirm').click();await page.waitForFunction(()=>!profileStyleTransitioning&&!isProfileStyleOpen());
    await page.emulateMedia({reducedMotion:'reduce'});await page.locator('#pinCode').fill('12');await page.locator('#checkInBtn').click();
    assert.equal(await page.locator('.student-pin-slots>span').first().evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>document.documentElement.style.fontSize='200%');
    await page.evaluate(()=>checkIn());await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'200% text reflows');await shot('text-zoom');
    const slots=await page.locator('#studentPin').boundingBox(),message=await page.locator('#studentPinMessage').boundingBox();
    assert.ok(slots.height>=100&&message.y>=slots.y+slots.height+12,'scaled PIN and validation keep vertical clearance');
    const zoomNav=await page.locator('.student-actions').boundingBox();
    assert.ok(message.y+message.height<=zoomNav.y-10,'validation remains above fixed navigation '+JSON.stringify({slots,message,zoomNav,scroll:await page.evaluate(()=>scrollY)}));
    await page.evaluate(()=>document.documentElement.style.fontSize='');
    await page.setViewportSize({width:768,height:1024});
    const photoBefore=await page.locator('#studentPhoto').getAttribute('src');
    await page.locator('#photoEditButton').click();await page.waitForFunction(()=>profileStyleReady&&!profileStyleTransitioning);
    const chooser=page.waitForEvent('filechooser');await page.locator('#profileStyleChangePhoto').click();
    await(await chooser).setFiles({name:'fixture.png',mimeType:'image/png',buffer:await require('sharp')({create:{width:800,height:800,channels:3,background:'#268472'}}).png().toBuffer()});
    await page.waitForFunction(()=>profileCropReady);
    const workspace=await page.locator('#profileCropWorkspace').boundingBox();
    await page.mouse.move(workspace.x+workspace.width/2,workspace.y+workspace.height/2);await page.mouse.down();await page.mouse.move(4,4,{steps:5});await page.mouse.up();
    assert.equal(await page.evaluate(()=>Swal.isVisible()),false,'crop drag ending outside is not dismissal');
    await page.evaluate(()=>{profileCropProcessing=true;});await page.mouse.click(4,4);assert.equal(await page.evaluate(()=>Swal.isVisible()),false,'busy crop cannot dismiss');
    await page.evaluate(()=>{profileCropProcessing=false;});await page.mouse.click(4,4);await page.waitForFunction(()=>studentDiscardPending);
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.swal2-container'));
    assert.equal(await page.locator('#profileCropModal').isVisible(),true,'crop draft survives cancel');
    await page.mouse.click(4,4);await page.locator('.swal2-confirm').click();await page.waitForFunction(()=>!document.querySelector('.modal.show'));
    assert.equal(await page.locator('#studentPhoto').getAttribute('src'),photoBefore,'discard does not upload or change photo');
    await page.setViewportSize({width:390,height:400});await page.locator('#pinCode').focus();
    await page.waitForFunction(()=>studentSection.dataset.pinEditing==='true');
    assert.equal(await page.locator('.student-actions').isHidden(),true,'short keyboard viewport reserves space for form');
    await page.locator('#pinCode').blur();await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
    assert.equal(await page.locator('#studentInstallButton').isHidden(),true,'confirmed appinstalled hides shortcut');
    assert.deepEqual(errors,[]);assert.deepEqual(production,[]);
    console.log('PASS student home: native PIN/paste/Thai digits/leading zero, server states, no early success, busy guard, 3s reset, duplicate, install prompt/manual/iOS, backdrop/draft guard, 320-1280 responsive, reduced motion, 200% text. Synthetic browser only, no production DB or real device install.');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
