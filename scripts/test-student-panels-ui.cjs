const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {startServer}=require('./serve.cjs');
const out=path.resolve(__dirname,'../tmp/student-panels');
async function main(){
  fs.mkdirSync(out,{recursive:true});
  const server=await startServer(),browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  const errors=[],production=[],calls=[],requests=[];let failHistory=false,slow=false;
  const student={state:'linked',id:'00001',name:'นักเรียนตัวอย่าง ชื่อยาวสำหรับทดสอบ',grade:'ม.2/1',role:'STUDENT',email:'panels@fixture.invalid',authMode:'google',linkVersion:'fixture-link',authSessionId:'fixture-session'};
  const pet={student_id:'00001',pet_id:'leafy',pet_name:'ใบไม้',free_select_used:1,rename_used:0};
  const settings={school_name:'โรงเรียนทดสอบ',app_name:'เช็คชื่อเข้าเรียนครูอี้',semester_number:'1',semester_year:'2569',school_data_version:'fixture-v1',pin:''};
  const rows=[];let id=500;
  for(let day=30;day>=1;day--)for(let n=0;n<(day===26?21:day===30?3:1);n++)rows.push({id:id--,student_id:'00001',timestamp:'2026-10-'+String(day).padStart(2,'0')+'T08:00:00.123456+00:00',status:n%3===0?'กิจกรรม':'มา',points:n%3===0?0:5});
  const items=Array.from({length:8},(_,i)=>({item_id:String(i+1),item_name:i===0?"สมุด 'ฝึกคิด' <พิเศษ>":'สินค้าจำลอง '+(i+1),description:'รายละเอียดสินค้าสำหรับทดสอบการจัดบรรทัดให้ครบถ้วน',cost:i===7?1000:10,is_active:true,image_url:'/assets/app-icons/icon-192.png'}));
  const sdk=`window.supabase={createClient(){const post=async(name,args,signal)=>{const r=await fetch('/__panels_fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args}),signal});return r.json()};return {auth:{getSession:()=>post('session'),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},rpc:post,removeChannel:()=>Promise.resolve(),channel:()=>({on(){return this},subscribe(){return this}}),from(table){let one=false,filters=[],orders=[],fields='',limit=null,or=null,signal;const q={select(v){fields=v;return q},order(k,v){orders.push([k,v]);return q},range(){return q},limit(v){limit=v;return q},gt(k,v){filters.push(['gt',k,v]);return q},gte(k,v){filters.push(['gte',k,v]);return q},lte(k,v){filters.push(['lte',k,v]);return q},in(){return q},is(){return q},or(v){or=v;return q},eq(k,v){filters.push(['eq',k,v]);return q},abortSignal(v){signal=v;return q},maybeSingle(){one=true;return q},single(){one=true;return q},then(resolve,reject){return post('table',{table,one,filters,orders,fields,limit,or},signal).then(resolve,reject)}};return q}}}};`;
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/student-banners/')&&request.url().endsWith('.webp'))requests.push(request.url());});
  await page.route('**/*.supabase.co/**',route=>{production.push(route.request().url());return route.abort();});
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({contentType:'application/javascript',body:sdk}));
  await page.route('**/__panels_fixture',async route=>{
    const {name,args}=route.request().postDataJSON();calls.push({name,args});let data=null,error=null;
    if(name==='session')data={session:{user:{id:'fixture-only'}}};
    else if(name==='mq_google_account')data=student;
    else if(name==='mq_student_profile_style')data={status:'success',frameEnabled:true,motionEnabled:true,revision:null};
    else if(name==='table'){
      let result=args.table==='students'?[student]:args.table==='student_pets'?[pet]:args.table==='system_settings'?Object.entries(settings).map(([key,value])=>({key,value})):args.table==='attendance_logs'?rows.slice():args.table==='shop_items'?items:[];
      result=result.filter(row=>args.filters.every(([op,key,value])=>op==='eq'?row[key]===value:op==='lte'?Number(row[key])<=Number(value):op==='gt'?Number(row[key])>Number(value):op==='gte'?Number(row[key])>=Number(value):true));
      if(args.or){const m=args.or.match(/^timestamp.lt.([^,]+),and\(timestamp.eq.([^,]+),id.lt.(\d+)\)$/);assert.ok(m);result=result.filter(row=>row.timestamp<m[1]||(row.timestamp===m[2]&&Number(row.id)<Number(m[3])));}
      for(const [key,order] of args.orders.slice().reverse())result.sort((a,b)=>typeof a[key]==='number'?(a[key]-b[key])*(order.ascending?1:-1):String(a[key]).localeCompare(String(b[key]))*(order.ascending?1:-1));
      if(args.limit)result=result.slice(0,args.limit);
      if(args.table==='attendance_logs'&&args.fields.includes('timestamp')){if(slow)await new Promise(resolve=>setTimeout(resolve,1000));if(failHistory){failHistory=false;error={message:'fixture network error'};}}
      data=args.one?result[0]||null:result;
    }
    try{await route.fulfill({contentType:'application/json',body:JSON.stringify({data,error,count:Array.isArray(data)?data.length:0})});}catch(error){}
  });
  const shot=async name=>{if(!process.argv.includes('--no-capture')){await page.waitForTimeout(350);await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});}};
  const closeUtility=async()=>{await page.waitForFunction(()=>document.getElementById('studentUtilityModal').classList.contains('show')&&getComputedStyle(document.querySelector('#studentUtilityModal .modal-dialog')).transform==='none');await page.mouse.click(4,4);await page.waitForFunction(()=>!document.querySelector('.modal.show,.modal-backdrop'));};
  try{
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>profileStyleReady&&studentBannerCatalog&&studentSection.dataset.petTheme==='leafy');
    await page.evaluate(()=>{getStudentPointsAndLevelDb=async()=>({level:0,totalPoints:0,pointsInLevel:0});getWalletBalanceDb=async()=>({mathCoins:80,lifetimeExp:100,totalSpent:20});shopWallet={mathCoins:80,lifetimeExp:100,totalSpent:20};updateShopCoinsBadge(80);studentExamButton.hidden=false;});
    assert.equal(await page.locator('.student-toolbar>strong').count(),0,'student page has no app-name heading');
    assert.ok(await page.locator('#levelCard .student-identity #lvNum').count());assert.ok(await page.locator('#levelCard .student-identity #shopCoinsBadge').count());
    for(const [width,height] of [[320,568],[360,740],[390,844],[768,1024],[1280,900]]){
      await page.setViewportSize({width,height});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'home overflow '+width);
      const primary=await page.locator('#checkInBtn').boundingBox(),nav=await page.locator('.student-actions').boundingBox();
      if(width>=360)assert.ok(primary.y+primary.height<=nav.y-8,'primary clears navigation '+width+' '+JSON.stringify({primary,nav}));
      const menu=await page.locator('.student-toolbar').boundingBox(),name=await page.locator('#sNameDisp').boundingBox();assert.ok(menu.y>=name.y+name.height,'menu never overlaps name');await shot('home-'+width);
      await page.locator('#studentShopButton').click();await page.waitForFunction(()=>shopOverlay.classList.contains('open')&&document.querySelectorAll('#shopGrid .shop-item').length===8);await page.locator('#shopModal .shop-scroll').evaluate(el=>{el.scrollTop=0;});
      await page.waitForTimeout(220);
      const box=await page.locator('#shopModal').boundingBox();assert.ok(Math.abs(box.y+box.height/2-height/2)<3,'store centered '+width);assert.ok(box.y>=10&&box.y+box.height<=height-10,'store bounded '+width);
      assert.equal(await page.locator('#shopModalTitle').textContent(),'ร้านค้า');
      assert.equal(await page.locator('#shopGrid .shop-buy-btn').last().isDisabled(),true);
      await shot('shop-'+width);
      const head=await page.locator('#shopModal .shop-header').boundingBox(),beforeScroll=await page.evaluate(()=>scrollY);
      await page.locator('#shopModal .shop-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});
      assert.equal((await page.locator('#shopModal .shop-header').boundingBox()).y,head.y,'only shop body scrolls');assert.equal(await page.evaluate(()=>scrollY),beforeScroll);
      await page.mouse.click(4,4);await page.waitForFunction(()=>!shopOverlay.classList.contains('open'));
    }
    await page.setViewportSize({width:390,height:844});await page.locator('#studentShopButton').click();await page.locator('#shopModal .shop-scroll').evaluate(el=>{el.scrollTop=0;});
    await page.locator('[data-shop-item="1"]').click();await page.waitForFunction(()=>Swal.isVisible());
    assert.match(await page.locator('.swal2-html-container').textContent(),/สมุด 'ฝึกคิด' <พิเศษ>/,'literal product names are safe and usable');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!Swal.isVisible());assert.equal(await page.locator('#shopOverlay').getAttribute('aria-hidden'),'false','Escape cancels topmost purchase only');
    await page.mouse.click(4,4);await page.waitForFunction(()=>!shopOverlay.classList.contains('open'));
    await page.locator('.student-actions button').filter({hasText:'ประวัติ'}).click();await page.waitForFunction(()=>document.querySelectorAll('.student-attendance-day').length===5);
    await page.waitForFunction(()=>document.getElementById('studentUtilityModal').classList.contains('show')&&getComputedStyle(document.querySelector('#studentUtilityModal .modal-dialog')).transform==='none');
    assert.equal(await page.locator('.student-attendance-day').first().locator('.student-attendance-entry').count(),3);
    assert.equal(await page.locator('.student-attendance-day').nth(4).locator('.student-attendance-entry').count(),21,'complete fifth day across chunks');await shot('history-first5');
    await page.locator('#studentHistoryScroll').evaluate(el=>{el.scrollTop=el.scrollHeight;el.dispatchEvent(new Event('scroll'));});await page.waitForFunction(()=>document.querySelectorAll('.student-attendance-day').length>=10);assert.equal(await page.locator('.student-attendance-day').count(),10,'one scroll appends only five days');await shot('history-next5');
    assert.equal(new Set(await page.locator('.student-attendance-day').evaluateAll(list=>list.map(el=>el.dataset.day))).size,10);
    await closeUtility();
    failHistory=true;await page.locator('.student-actions button').filter({hasText:'ประวัติ'}).click();await page.waitForFunction(()=>studentAttendanceHistoryStatus.textContent.includes('ไม่ได้'));
    await page.locator('#studentHistoryMore').click();await page.waitForFunction(()=>document.querySelectorAll('.student-attendance-day').length===5);await closeUtility();
    slow=true;await page.locator('.student-actions button').filter({hasText:'ประวัติ'}).click();await closeUtility();await page.waitForTimeout(1050);assert.equal(await page.locator('.modal.show').count(),0,'late history response does not reopen');slow=false;
    for(const [level,rank] of [[9,0],[10,1],[19,1],[20,2],[29,2],[30,3],[39,3],[40,4]]){
      await page.evaluate(level=>updateGamiUI({level,totalPoints:level*5,pointsInLevel:0}),level);
      await page.waitForFunction(rank=>levelCard.dataset.rank===String(rank),rank);
      assert.equal(await page.locator('#studentRankArt').getAttribute('src'),rank?'./assets/student-banners/rank-'+rank*10+'.webp':null);
      if([9,10,20,30,40].includes(level)){await page.waitForFunction(()=>[studentBannerArt,studentRankArt].every(img=>!img.hasAttribute('src')||(img.complete&&img.naturalWidth>0&&!img.hidden)));await shot('rank-'+rank*10);}
    }
    const leafyBg=await page.locator('#studentSection').evaluate(el=>getComputedStyle(el).backgroundColor);
    await page.evaluate(()=>{studentPet.pet_id='ember';renderStudentPet(studentPet,40);});await page.waitForFunction(()=>studentSection.dataset.petTheme==='ember');
    await page.waitForFunction(bg=>getComputedStyle(studentSection).backgroundColor!==bg,leafyBg);
    assert.notEqual(await page.locator('#studentSection').evaluate(el=>getComputedStyle(el).backgroundColor),leafyBg,'pet and rank resolve different real page backgrounds');
    await shot('ember-40');
    for(const petId of ['thorn','rocky','luna','iron']){
      await page.evaluate(id=>{studentPet.pet_id=id;renderStudentPet(studentPet,40);},petId);
      await page.waitForFunction(id=>studentSection.dataset.petTheme===id&&studentBannerArt.complete&&!studentBannerArt.hidden,petId);await shot(petId+'-40');
    }
    await page.evaluate(()=>{studentPet=null;renderStudentPet(null,40);});await page.waitForFunction(()=>studentSection.dataset.petTheme==='none'&&!studentAvatar.dataset.frame);
    assert.equal(await page.locator('#studentBannerArt').isHidden(),true);assert.ok(await page.locator('#petHero .pet-empty-state').count());await shot('no-pet');
    await page.evaluate(()=>{studentPet={pet_id:'leafy',pet_name:'ใบไม้'};renderStudentPet(studentPet,40);});await page.waitForFunction(()=>studentSection.dataset.petTheme==='leafy');
    await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#levelCard').evaluate(el=>getComputedStyle(el).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>document.documentElement.style.fontSize='200%');await page.locator('#studentShopButton').click();assert.equal(await page.locator('#shopModal').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);await shot('shop-text-zoom');await page.mouse.click(4,4);await page.waitForFunction(()=>!shopOverlay.classList.contains('open'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await shot('profile-text-zoom');await page.evaluate(()=>document.documentElement.style.fontSize='');
    if(process.argv.includes('--banner-audit'))await require('./student-banner-qa.cjs')({page,out,capture:!process.argv.includes('--no-capture')});
    assert.ok(calls.filter(c=>c.name==='table'&&c.args.table==='attendance_logs'&&['id','id,timestamp,status,points'].includes(c.args.fields)).every(c=>c.args.limit<=12&&c.args.filters.some(f=>f[0]==='eq'&&f[1]==='student_id'&&f[2]==='00001')));
    assert.ok(!requests.some(url=>url.includes('/masters/')));assert.deepEqual(errors,[]);assert.deepEqual(production,[]);
    if(!process.argv.includes('--no-capture')){
      const review=path.resolve(__dirname,'../.impeccable/review');fs.mkdirSync(review,{recursive:true});
      for(const [source,target] of [['home-390','mobile'],['home-1280','desktop'],['home-320','user-320'],['home-768','tablet']])fs.copyFileSync(path.join(out,source+'.png'),path.join(review,target+'.png'));
    }
    console.log('PASS centered shop/responsive/body scroll/literal names/topmost dismissal, five-day history with complete duplicate dates/retry/cancel/privacy, pet+rank backgrounds, prominent identity, zoom/reduced motion. Browser fixture only; production and real devices not tested.');
  }catch(error){
    console.error('Panel fixture diagnostic',JSON.stringify(await page.evaluate(()=>({user:CU,pet:studentPet,profileStyleReady,theme:studentSection.dataset.petTheme,historyDays:document.querySelectorAll('.student-attendance-day').length,scroll:document.getElementById('studentHistoryScroll')&&[studentHistoryScroll.scrollTop,studentHistoryScroll.clientHeight,studentHistoryScroll.scrollHeight],pager:studentHistoryRun&&{busy:studentHistoryRun.pager.busy,days:studentHistoryRun.pager.days,done:studentHistoryRun.pager.done},alert:typeof Swal!=='undefined'&&Swal.getPopup()?.textContent}))),JSON.stringify(errors),JSON.stringify(calls.slice(-8)));
    throw error;
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
