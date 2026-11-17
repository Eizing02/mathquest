const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {startServer}=require('./serve.cjs');
async function main(){
  const output=path.resolve(__dirname,'../tmp/scansob');fs.mkdirSync(output,{recursive:true});
  const server=await startServer();const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let fail=false,studentView=true,oldProfile=false,studentGate=null,studentStarted=null;
  let receiptMode='partial';
  let inboxMode=false,inboxRows=[],inboxClock=Date.now(),policyConflict=false;
  const policy={school_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',enabled:false,emails:[],revision:'0'};
  const requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',connectionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const config={school_id:connectionId,receiver_profile:'1.1',held_score_count:1,enabled:false,student_view_enabled:false,identity_policy_accepted:false,score_count:2,
    requests:[{id:requestId,workspace_id:requestId,workspace_label:'ครูวิทยาศาสตร์ ชื่อสำหรับทดสอบข้อความยาวบนหน้าจอมือถือ',status:'pending_approval',expires_at:'2026-10-15T08:00:00Z',held_score_count:1}],
    connections:[{id:connectionId,workspace_id:connectionId,workspace_label:'ครูคณิตศาสตร์',status:'active',last_received_at:'2026-10-15T00:00:00Z'}]};
  const meta={title:'แบบทดสอบเรื่องสมการเชิงเส้นตัวแปรเดียว ชื่อยาวสำหรับตรวจการจัดวาง',subject:'คณิตศาสตร์',exam_type:'เก็บคะแนน',term:1,academic_year:2569};
  const rows=[{id:1,exam_id:1,student_code:'00001',student_visible:true,visibility_reason:'current',student_name:'นักเรียนจำลอง ชื่อยาวสำหรับหน้าจอมือถือ',grade:'ม.2/1',metadata:meta,result:{score:17.5,max_score:25,percent:70,passed:true},updated_at:'2026-10-15T00:00:00Z'},
    {id:2,exam_id:1,student_code:'00002',student_visible:false,visibility_reason:'connection_revoked',student_name:'นักเรียนจำลอง ข',grade:'ม.2/2',metadata:meta,result:{score:15,max_score:25,percent:60,passed:true},updated_at:'2026-10-15T00:00:00Z'}];
  const calls=[];
  await page.route('**/*.supabase.co/**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
  await page.route('**/__scansob_fixture',async route=>{
    const {name,args,student}=route.request().postDataJSON();calls.push({name,args});let data;
    if(student&&studentGate){if(studentStarted)studentStarted();await studentGate;}
    if(fail)return route.fulfill({contentType:'application/json',body:JSON.stringify({data:null,error:{code:'PGRST202',message:'Could not find the function'}})});
    if(name==='mq_scansob_admin'){
      if(args.p_action==='create_code')data={code:'1234ABCD1234ABCD',expires_at:'2026-10-15T08:00:00Z'};
      else{if(args.p_action==='approve'||args.p_action==='reject'){config.requests=[];inboxRows=inboxRows.filter(row=>row.id!==args.p_args.request_id);}
        if(args.p_action==='revoke')config.connections[0].status='revoked';
        if(args.p_action==='configure')Object.assign(config,args.p_args);data=config;}
    }else if(name==='mq_scansob_pairing_inbox'){
      if(!inboxMode)return route.fulfill({contentType:'application/json',body:JSON.stringify({data:null,error:{code:'PGRST202'}})});
      if(args.p_action==='inbox'){
        const page=args.p_args.page;
        data={school_id:policy.school_id,count:inboxRows.length,requests:inboxRows.slice(page*20,page*20+20),page,page_size:20,server_now:new Date(inboxClock).toISOString()};
      }else{
        if(args.p_action==='configure'){
          if(policyConflict)return route.fulfill({contentType:'application/json',body:JSON.stringify({data:null,error:{message:'PAIRING_POLICY_CHANGED'}})});
          Object.assign(policy,args.p_args,{revision:'1'});
        }
        data=policy;
      }
    }else if(name==='mq_scansob_publication_receipt'){
      if(receiptMode==='missing'){
        return route.fulfill({contentType:'application/json',body:JSON.stringify({data:null,error:{code:'PGRST202'}})});
      }
      data={exam_id:1,source_exam_id:requestId,source_workspace_id:connectionId,revision:'3',
        withdrawn:false,expected_batches:2,verified_batches:receiptMode==='unverified'?0:1,accepted:1,unmatched:1,invalid:0};
    }else if(args.p_kind==='exams')data={enabled:true,rows:[{id:1,metadata:meta,revision:1,batch_count:1,received_batches:1,student_count:2,visible_student_count:1}],next_cursor:null};
    else if(args.p_kind==='issues')data={enabled:true,rows:[{id:1,exam_id:1,student_code:'00999',reason:'STUDENT_NOT_FOUND',metadata:meta,revision:1}],next_cursor:null};
    else data={enabled:studentView,rows:studentView?(student?rows.slice(0,1):rows):[],next_cursor:null,version:'fixture-v1'};
    data=Object.assign({},data,{receiver_profile:oldProfile?'1.0':'1.1'});
    await route.fulfill({contentType:'application/json',body:JSON.stringify({data,error:null})});
  });
  const capture=async name=>{if(!process.argv.includes('--no-capture'))await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});};
  try{
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
    await page.evaluate(()=>{
      getSupabase=()=>({
        rpc:async(name,args)=>{const r=await fetch('/__scansob_fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args,student:CU.role==='STUDENT'})});return r.json();},
        channel(topic,options){
          window.inboxChannel={topic,options,removed:false};
          return {on(type,filter,callback){Object.assign(window.inboxChannel,{type,filter,callback});return this;},
            subscribe(callback){callback('SUBSCRIBED');return this;}};
        },
        removeChannel(){window.inboxChannel.removed=true;}
      });
      CU={id:'teacher',role:'TEACHER',authMode:'google'};googleAccount={linkVersion:''};teacherAdminToken='fixture-token';
      document.getElementById('loginSection').classList.add('hidden');document.getElementById('teacherSection').classList.remove('hidden');switchTab('settings');
    });
    await page.waitForFunction(()=>document.querySelector('#scansobSave').disabled===false);
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'settings overflow '+width);
      if([390,1280].includes(width))await capture('settings-'+width);
    }
    await page.locator('#scansobCreate').click();await page.waitForSelector('.scansob-code');assert.equal(await page.locator('.scansob-code').textContent(),'1234ABCD1234ABCD');await page.locator('.swal2-confirm').click();
    await page.locator('[onclick*="decideScanSobRequest"]').first().click();assert.ok((await page.locator('.swal2-html-container').textContent()).includes('คะแนนค้าง'));await page.locator('.swal2-confirm').click();await page.waitForFunction(()=>document.querySelector('#scansobRequests').textContent.includes('ไม่มีคำขอ'));
    await page.evaluate(()=>switchTab('exams'));await page.waitForSelector('.scansob-table tbody tr');
    const examSelect=page.locator('#externalExamSelect');
    await examSelect.selectOption('1');
    await page.waitForSelector('#scansobReceiptData:not([hidden])');
    assert.match(await page.locator('#scansobReceiptStatus').textContent(),/รอบ 3.*1 \/ 2/);
    assert.deepEqual(await page.locator('.scansob-receipt-counts dd').allTextContents(),['1','1','0']);
    await page.locator('.scansob-receipt-reference summary').click();
    assert.equal(await page.locator('#scansobReceiptExam').textContent(),requestId);
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'teacher scores overflow '+width);
      if([390,1280].includes(width))await capture('scores-'+width);
    }
    assert.equal(await page.locator('.scansob-visibility').count(),2);assert.ok((await page.locator('#externalExamRows').textContent()).includes('เพิกถอนแล้ว'));
    receiptMode='unverified';
    await page.evaluate(()=>loadTeacherExamRows(false));
    await page.waitForFunction(()=>document.querySelector('#scansobReceiptStatus').textContent.includes('ยังไม่มีใบตอบรับที่ตรวจสอบได้'));
    assert.equal(await page.locator('#scansobReceiptData').isVisible(),false);
    receiptMode='missing';
    await page.evaluate(()=>loadTeacherExamRows(false));
    await page.locator('#scansobReceipt').waitFor({state:'hidden'});
    await page.waitForSelector('.scansob-table tbody tr');
    const download=page.waitForEvent('download');await page.locator('#externalScoreExport').click();const csv=await download;assert.match(csv.suggestedFilename(),/ScanSob_scores/);
    const csvText=fs.readFileSync(await csv.path(),'utf8');assert.ok(csvText.includes('การเผยแพร่'));assert.ok(csvText.includes('เพิกถอนแล้ว'));
    await page.locator('[name="externalExamMode"][value="issues"]').check();await page.waitForFunction(()=>document.querySelector('#externalExamRows').textContent.includes('00999'));
    assert.ok((await page.locator('#externalExamRows').textContent()).includes('ไม่พบรหัสในทะเบียน'));
    await page.evaluate(()=>{document.getElementById('teacherSection').classList.add('hidden');document.getElementById('studentSection').classList.remove('hidden');CU={id:'00001',name:'จำลอง',role:'STUDENT',authMode:'google'};openStudentExamScores();});
    await page.waitForSelector('.scansob-student-result');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.swal2-popup')).opacity==='1');assert.equal(await page.locator('.scansob-student-result').count(),1);
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'student scores overflow '+width);
      if([390,1280].includes(width))await capture('student-'+width);
    }
    assert.ok(calls.filter(c=>c.name==='mq_scansob_read').every(c=>!Object.hasOwn(c.args,'student_id')),'no caller-selected student identity');
    studentView=false;await page.evaluate(()=>loadStudentExamScores(true));assert.equal(await page.locator('.scansob-student-result').count(),0,'disabled read clears previously loaded rows');
    await page.locator('.swal2-confirm').click();studentView=true;
    let release;studentGate=new Promise(resolve=>{release=resolve;});const started=new Promise(resolve=>{studentStarted=resolve;});
    await page.evaluate(()=>{openStudentExamScores();});await started;
    await page.evaluate(()=>{CU.id='00002';googleAccount.linkVersion='switched';});release();studentGate=null;
    await page.waitForFunction(()=>!scanSobStudentLoading);assert.equal(await page.locator('.scansob-student-result').count(),0,'late old-identity scores discarded');
    await page.locator('.swal2-confirm').click();studentView=false;await page.evaluate(()=>{openStudentExamScores();});await page.waitForFunction(()=>document.querySelector('#studentExamStatus').textContent.includes('ยังไม่เปิด'));
    assert.equal(await page.locator('.scansob-student-result').count(),0);await page.locator('.swal2-confirm').click();
    fail=true;await page.evaluate(()=>{openStudentExamScores();});await page.waitForFunction(()=>document.querySelector('#studentExamStatus').textContent.includes('ยังไม่พร้อม'));
    await page.locator('.swal2-confirm').click();fail=false;oldProfile=true;
    await page.evaluate(()=>{CU={id:'teacher',role:'TEACHER',authMode:'google'};loadScanSobSettings();});
    await page.waitForFunction(()=>document.querySelector('#scansobSettingsStatus').textContent.includes('20261015_03'));
    assert.equal(await page.locator('#scansobCreate').isDisabled(),true,'old SQL cannot enable pairing in the new UI');

    oldProfile=false;inboxMode=true;
    const makeRequest=(id,second)=>({id,workspace_id:connectionId,workspace_label:'โรงเรียนทดสอบการเชื่อมต่อชื่อยาว '.repeat(5),
      sender_name:'ครูตัวอย่าง',sender_email:'teacher-with-a-long-name-in-a-text-wrap-test@fixture.invalid',
      created_at:new Date(inboxClock+second*1000).toISOString(),expires_at:new Date(inboxClock+86400000).toISOString()});
    inboxRows=[makeRequest(requestId,-20)];
    await page.evaluate(()=>{
      CU={id:'teacher',role:'TEACHER',authMode:'google'};
      document.getElementById('teacherSection').classList.remove('hidden');
      document.getElementById('studentSection').classList.add('hidden');
      document.getElementById('tNameDisp').textContent='นายทดสอบ ชื่อครูสำหรับหน้าจอขนาดเล็ก';
      switchTab('pin');startScanSobInbox();
    });
    const bell=page.locator('#scansobInboxBell'), toast=page.locator('#scansobInboxToast');
    await bell.waitFor({state:'visible'});
    assert.equal(await page.locator('#scansobInboxBadge').textContent(),'1');
    assert.equal(await toast.isVisible(),false,'baseline pending is not announced on sign-in');
    assert.deepEqual(await page.evaluate(()=>window.inboxChannel.options),{config:{private:true}});
    inboxRows.unshift(makeRequest(connectionId,1));
    await page.evaluate(()=>window.inboxChannel.callback({payload:{}}));
    await toast.waitFor({state:'visible'});
    assert.equal(await page.locator('#tab-pin').isVisible(),true,'alert does not interrupt attendance');
    assert.equal(await page.locator('#scansobInboxBadge').textContent(),'2');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await toast.evaluate(el=>el.getBoundingClientRect().bottom <= document.querySelector('.teacher-workspace').getBoundingClientRect().top),true,
      'mobile notice never covers attendance controls');
    await capture('inbox-toast-390');
    await toast.getByRole('button',{name:'ปิดแจ้งเตือน ScanSob'}).click();
    assert.equal(await page.locator('#scansobInboxBadge').textContent(),'2');
    await bell.focus();await page.keyboard.press('Enter');
    await page.waitForSelector('#scansobRequests [data-request-id]');
    assert.equal(await page.locator('#scansobInboxTitle').evaluate(el=>el===document.activeElement),true);
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'inbox overflow '+width);
      assert.equal(await page.locator('#scansobRequests .scansob-connection').count(),2);
      if([390,768,1280].includes(width)) await capture('inbox-'+width);
    }
    await page.locator('#scansobSignedPolicy summary').click();
    await page.locator('#scansobPolicyEnabled').check();
    await page.locator('#scansobPolicySave').click();
    await page.waitForFunction(()=>document.querySelector('#scansobPolicyStatus').textContent.includes('ตรวจอีเมล'));
    await page.locator('#scansobPolicyEmails').fill(' TEACHER@fixture.invalid ');
    await page.locator('#scansobPolicySave').click();
    await page.waitForFunction(()=>document.querySelector('#scansobPolicyStatus').textContent==='บันทึกการรับคำขอแล้ว');
    assert.equal(await page.locator('#scansobPolicyEmails').inputValue(),'teacher@fixture.invalid');
    policyConflict=true;
    await page.locator('#scansobPolicyEmails').fill('draft@fixture.invalid');
    await page.locator('#scansobPolicySave').click();
    await page.locator('#scansobPolicyReload').waitFor({state:'visible'});
    await page.evaluate(()=>window.inboxChannel.callback({payload:{}}));
    assert.equal(await page.locator('#scansobPolicyEmails').inputValue(),'draft@fixture.invalid','Realtime does not overwrite settings drafts');
    await page.locator('#scansobPolicyReload').click();
    await page.waitForFunction(()=>document.querySelector('#scansobPolicyEmails').value==='teacher@fixture.invalid');
    await page.locator('#scansobRequests [data-request-action=approve]').first().click();
    await page.waitForSelector('.scansob-decision');
    assert.match(await page.locator('.scansob-decision').textContent(),/teacher-with-a-long-name.*สิทธิ์: ส่งคะแนน/);
    await page.locator('.swal2-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#scansobInboxBadge').textContent==='1');
    await page.locator('#scansobRequests [data-request-action=reject]').first().click();
    await page.locator('.swal2-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#scansobRequests').textContent.includes('ไม่มีคำขอ'));
    assert.equal(await page.locator('#scansobInboxBadge').isVisible(),false);
    inboxRows=Array.from({length:21},(_,i)=>makeRequest('fixture-'+i,-20));
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await page.locator('#scansobInboxNext').waitFor({state:'visible'});
    await page.locator('#scansobInboxNext').click();
    await page.waitForFunction(()=>document.querySelector('#scansobInboxPageText').textContent==='หน้า 2 / 2');
    assert.equal(await page.locator('#scansobRequests [data-request-action=approve]').count(),1);
    await page.evaluate(()=>{stopScanSobInbox();CU={id:'00001',role:'STUDENT',authMode:'google'};startScanSobInbox();});
    assert.equal(await bell.isVisible(),false);
    assert.equal(await page.evaluate(()=>window.inboxChannel.removed),true);
    assert.deepEqual(errors,[]);
    console.log('PASS ScanSob browser: legacy approval, revision receipts/fallback, visibility/CSV, signed inbox, responsive 320/390/768/1280; mocked server only');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
