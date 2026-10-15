const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer } = require('./serve.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tmp', 'school-ui');

async function main() {
  fs.mkdirSync(output,{recursive:true});
  const server=await startServer();
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage();
  const capture=options=>process.argv.includes('--no-capture')?Promise.resolve():page.screenshot(options);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*.supabase.co/**',route=>route.abort());
  try {
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>typeof schoolSemester!=='undefined' && typeof Swal!=='undefined');
    await page.evaluate(()=>{
      const students=[
        {id:'02001',name:'นักเรียนทดสอบชื่อยาว นามสกุลเพื่อทดสอบการจัดหน้าจอ',grade:'ม.2/1',role:'STUDENT'},
        {id:'02002',name:'นักเรียน ทดสอบ',grade:'ม.2/1',role:'STUDENT'},
        {id:'02003',name:'นักเรียน ห้องสอง',grade:'ม.2/2',role:'STUDENT'},
        {id:'03001',name:'นักเรียน ชั้นสาม',grade:'ม.3',role:'STUDENT'}
      ];
      window.fixtureStudents=students;
      const settings={semester_number:'1',semester_year:'2569',semester_start:'2026-05-16',semester_end:'2026-10-15',school_data_version:'fixture-v1',school_name:'โรงเรียนทดสอบ',app_name:'MathQuest'};
      window.fixtureCalls=[];
      getSupabase=()=>({
        auth:{getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
        from(table){
          let filters=[],cursor=null,one=false;
          const q={select(){return q},eq(k,v){filters.push(row=>row[k]===v);return q},or(value){const grade=value.split(',')[0].split('.').slice(2).join('.');filters.push(row=>row.grade===grade||row.grade.startsWith(grade+'/'));return q},
            order(){return q},limit(){return q},gt(k,v){cursor=v;return q},in(k,v){filters.push(row=>v.includes(row[k]));return q},maybeSingle(){one=true;return q},
            then(resolve){let rows=table==='students'?students:[];rows=rows.filter(row=>filters.every(f=>f(row))&&(cursor===null||row.id>cursor));return Promise.resolve({data:one?rows[0]||null:rows,error:null}).then(resolve)}
          };return q;
        },
        rpc(name,args){
          fixtureCalls.push({name,args});
          let data={status:'success'};
          if(name==='verify_student_reset_otp') data=args.p_code==='123456'?{status:'success',studentId:args.p_student_id,token:'proof-token'}:{status:'fail',message:'รหัส OTP ไม่ถูกต้อง'};
          if(name==='complete_student_password_reset') data={status:'success',studentId:args.p_student_id};
          if(name==='request_student_password_reset') data={status:'success',studentId:args.p_student_id,studentName:'นักเรียน ทดสอบ',grade:'ม.2/1',expiresAt:new Date(Date.now()+900000).toISOString()};
          if(name==='preview_school_reset') data={students:4,attendance:80,orders:12,pets:4,pet_events:8,pending_orders:0,active_session:false,version:'fixture-v1'};
          if(name==='reset_school_progress' && window.fixtureResetError) return Promise.resolve({data:null,error:window.fixtureResetError});
          return Promise.resolve({data,error:null});
        }
      });
      getSettingsMap=async()=>settings;
      CU={id:'teacher',name:'ครูทดสอบ',role:'TEACHER'};
      teacherAdminToken='fixture-teacher-token';
      applyAppSettings({appName:'MathQuest',schoolName:'โรงเรียนทดสอบ',logoBase64:'./apple-touch-icon.png',semester:{number:'1',year:'2569',start:'2026-05-16',end:'2026-10-15',version:'fixture-v1'}});
      document.getElementById('tNameDisp').textContent=CU.name;
      document.getElementById('loginSection').classList.add('hidden');
      document.getElementById('teacherSection').classList.remove('hidden');
      loadTeacherShopItems=async()=>{};
      loadPasswordResetRequests=async()=>renderPasswordResetRequests([{id:1,student_id:'02001',student_name:students[0].name,grade:'ม.2/1',reset_code:'123456',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+900000).toISOString()}]);
    });
    await page.evaluate(async()=>{await refreshSchoolRooms();await loadPasswordResetRequests();populateSemesterForm();});
    assert.equal(await page.locator('.t-nav .tn').count(),4);
    assert.equal(await page.locator('#targetGrade option[value="ม.2/3"]').count(),0);
    assert.equal(await page.locator('#targetGrade option[value="ม.2"]').count(),0);
    assert.equal(await page.locator('#statGrade option[value="ม.2"]').count(),1);
    assert.equal(await page.locator('#studentNavCount').textContent(),'1');
    await page.locator('#teacher-tab-manual').click();
    assert.ok(await page.locator('#manual-view-single').isVisible());
    assert.ok(!await page.locator('#manual-view-bulk').isVisible());
    await page.locator('#manual-mode-bulk').click();
    await page.locator('#bulkGrade').selectOption('ม.2');
    await page.waitForFunction(()=>bulkStudents.length===3);
    await page.getByRole('button',{name:'เลือกทั้งหมด',exact:true}).click();
    assert.match(await page.locator('#bulkPreview').textContent(),/3/);
    assert.ok(await page.locator('#bulkApplyBtn').isEnabled());
    for(const width of [320,390,768,1024,1280,1440]){
      await page.setViewportSize({width,height:1000});
      for(const [tab,mode] of [['pin'],['manual','single'],['manual','bulk'],['manual','history'],['reset'],['stats'],['reward-report'],['shop'],['settings']]){
        await page.evaluate(({tab,mode})=>{switchTab(tab);if(mode)setManualMode(mode);},{tab,mode});
        await page.waitForTimeout(100);
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
        assert.equal(overflow,false,tab+'/'+mode+' overflow at '+width);
        await capture({path:path.join(output,`${tab}-${mode||'view'}-${width}.png`),fullPage:true});
      }
    }
    // Keyboard navigation keeps the selected mode and its panel in sync.
    await page.evaluate(()=>{switchTab('manual');setManualMode('single');});
    await page.locator('#manual-mode-single').focus();await page.keyboard.press('ArrowRight');
    assert.ok(await page.locator('#manual-view-bulk').isVisible());
    // Browser touch synthesis is evidence of interaction, not a physical-device test.
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await page.locator('#manual-mode-single').scrollIntoViewIfNeeded();
    const target=await page.locator('#manual-mode-single').boundingBox();
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:target.x+target.width/2,y:target.y+target.height/2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.ok(await page.locator('#manual-view-single').isVisible(),'synthesized touch switches mode');
    await cdp.detach();
    await page.evaluate(()=>{document.documentElement.style.fontSize='200%';switchTab('manual');});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'200% text zoom teacher');
    await page.evaluate(()=>document.documentElement.style.fontSize='');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#username,#password,.login-reset-actions').count(),0,'Google login replaces password/OTP login');
    await page.evaluate(()=>{switchTab('settings');openSemesterReset();});
    await page.waitForSelector('#resetPhrase');
    assert.match(await page.locator('.reset-summary').textContent(),/ลบถาวร/);
    assert.match(await page.locator('.reset-summary').textContent(),/ทุกวันที่/);
    assert.equal(await page.locator('#nextNumber, #nextYear, #nextStart, #nextEnd').count(),0,'reset does not ask for semester or dates');
    assert.equal(await page.locator('.reset-confirm-button').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(185, 28, 28)','destructive action uses existing danger color');
    await page.locator('.swal2-confirm').click();await page.waitForSelector('.swal2-validation-message');
    assert.equal(await page.evaluate(()=>fixtureCalls.some(call=>call.name==='reset_school_progress')),false,'no destructive RPC without acknowledgement');
    for (const width of [320,390,768,1280]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'reset dialog overflow '+width);
      const popup=await page.locator('.swal2-popup').boundingBox();
      assert.ok(popup.x>=0 && popup.x+popup.width<=width+1,'reset popup fits '+width);
      await capture({path:path.join(output,'reset-confirm-'+width+'.png')});
    }
    await page.locator('#resetAck').check();
    await page.locator('#resetPhrase').fill('ลบทั้งหมด');
    await page.locator('.swal2-confirm').click();await page.waitForSelector('.swal2-validation-message');
    assert.equal(await page.evaluate(()=>fixtureCalls.some(call=>call.name==='reset_school_progress')),false,'no RPC without teacher password');
    await page.locator('#resetTeacherPassword').fill('fixture-teacher-password');
    await page.evaluate(()=>window.fixtureResetError={code:'PGRST202',message:'Could not find the function'});
    await page.locator('.swal2-confirm').click();
    await page.waitForFunction(()=>document.querySelector('.swal2-validation-message')?.textContent.includes('20261010_02_reset_progress_without_dates.sql'));
    assert.ok(await page.locator('.swal2-confirm').isEnabled(),'confirmation recovers after RPC failure');
    await page.evaluate(()=>{window.fixtureResetError=null;window.fixtureLogoutCount=0;logout=()=>{fixtureLogoutCount++;};});
    await page.locator('.swal2-confirm').click();
    await page.waitForFunction(()=>document.querySelector('.swal2-title')?.textContent==='ล้างข้อมูลนักเรียนแล้ว');
    const resetCall=await page.evaluate(()=>fixtureCalls.filter(call=>call.name==='reset_school_progress').at(-1));
    assert.deepEqual(Object.keys(resetCall.args).sort(),['p_expected_version','p_password','p_teacher_token']);
    assert.equal(resetCall.args.p_expected_version,'fixture-v1');
    assert.equal(await page.evaluate(()=>semesterLabel(schoolSemester)),'1/2569','reset does not change semester label');
    await page.locator('.swal2-confirm').click();
    await page.waitForFunction(()=>fixtureLogoutCount===1);
    await page.evaluate(async()=>{
      document.getElementById('teacherSection').classList.add('hidden');
      document.getElementById('studentSection').classList.remove('hidden');
      CU={id:'02001',name:fixtureStudents[0].name,grade:'ม.2/1',role:'STUDENT'};
      document.getElementById('sNameDisp').textContent=CU.name;
      document.getElementById('sGradeDisp').textContent=CU.grade;
      updateGamiUI({totalPoints:30,level:6,pointsInLevel:0});
      await loadStudentPet();
    });
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'student overflow '+width);
      await capture({path:path.join(output,'student-'+width+'.png'),fullPage:true});
    }
    await page.evaluate(()=>{document.getElementById('studentSection').classList.add('hidden');document.getElementById('loginSection').classList.remove('hidden');});
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'login overflow '+width);
      const logo=await page.locator('.login-logo').boundingBox();assert.ok(logo.width>=112);
      await capture({path:path.join(output,'login-'+width+'.png'),fullPage:true});
    }
    assert.deepEqual(errors,[],'no uncaught browser exceptions');
    console.log('PASS browser: all teacher views at 320/390/768/1024/1280/1440; actual rooms; bulk selection; keyboard tabs; guarded permanent reset; student/Google-login layouts and logo; no production DB calls');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
