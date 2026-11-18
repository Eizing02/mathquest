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
  let studentFault=null;
  let receiptMode='partial';
  let inboxMode=false,inboxRows=[],inboxClock=Date.now(),policyConflict=false;
  const policy={school_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',enabled:false,emails:[],revision:'0',policy:'email_allowlist'};
  const requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',connectionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const config={school_id:connectionId,receiver_profile:'1.1',held_score_count:1,enabled:false,student_view_enabled:false,identity_policy_accepted:false,score_count:2,
    requests:[{id:requestId,workspace_id:requestId,workspace_label:'ครูวิทยาศาสตร์ ชื่อสำหรับทดสอบข้อความยาวบนหน้าจอมือถือ',status:'pending_approval',expires_at:'2026-10-15T08:00:00Z',held_score_count:1}],
    connections:[{id:connectionId,workspace_id:connectionId,workspace_label:'ครูคณิตศาสตร์',status:'active',last_received_at:'2026-10-15T00:00:00Z'}]};
  const meta={title:'แบบทดสอบเรื่องสมการเชิงเส้นตัวแปรเดียว ชื่อยาวสำหรับตรวจการจัดวาง',subject:'คณิตศาสตร์',exam_type:'เก็บคะแนน',term:1,academic_year:2569};
  const rows=[{id:1,exam_id:1,student_code:'00001',student_visible:true,visibility_reason:'current',student_name:'นักเรียนจำลอง ชื่อยาวสำหรับหน้าจอมือถือ',grade:'ม.2/1',metadata:meta,result:{score:17.5,max_score:25,percent:70,passed:true},updated_at:'2026-10-15T00:00:00Z'},
    {id:2,exam_id:1,student_code:'00002',student_visible:false,visibility_reason:'connection_revoked',student_name:'นักเรียนจำลอง ข',grade:'ม.2/2',metadata:meta,result:{score:15,max_score:25,percent:60,passed:true},updated_at:'2026-10-15T00:00:00Z'}];
  const studentRows=Array.from({length:37},(_,i)=>({
    id:String(100-i),
    metadata:{...meta,title:i===0?'ผลสอบล่าสุด':i===36?'พลังงานและการเปลี่ยนรูป':meta.title+' '+(i+1),
      subject:i===36?'วิทยาศาสตร์':i<4?'คณิตศาสตร์':i%2?'คณิตศาสตร์':'ภาษาอังกฤษ',term:2},
    result:i===2?{score:11,max_score:25,percent:44,passed:false}:rows[0].result,
    updated_at:i===0?'2026-11-18T09:00:00Z':'2026-11-17T08:00:00Z'
  }));
  const calls=[];
  await page.route('**/*.supabase.co/**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
  await page.route('**/__scansob_fixture',async route=>{
    const {name,args,student}=route.request().postDataJSON();calls.push({name,args});let data;
    if(fail)return route.fulfill({contentType:'application/json',body:JSON.stringify({data:null,error:{code:'PGRST202',message:'Could not find the function'}})});
    if(name==='mq_scansob_student_scores'){
      assert.equal(student,true);
      const fault=studentFault;
      if(studentGate){if(studentStarted)studentStarted();await studentGate;}
      const filtered=studentRows.filter(row=>!args.p_subject||row.metadata.subject===args.p_subject);
      const after=args.p_before_id===null?0:filtered.findIndex(row=>row.id===args.p_before_id)+1;
      const pageRows=studentView?filtered.slice(after,after+args.p_limit):[];
      const last=pageRows.at(-1);
      return route.fulfill({json:{data:{enabled:studentView,rows:pageRows,subjects:[...new Set(studentRows.map(r=>r.metadata.subject))],
        total:filtered.length,single_term:{term:2,academic_year:2569},
        next_cursor:last&&after+args.p_limit<filtered.length?{id:last.id,updated_at:last.updated_at}:null},error:fault}});
    }
    if(name==='mq_scansob_admin'){
      if(args.p_action==='create_code')data={code:'1234ABCD1234ABCD',expires_at:'2026-10-15T08:00:00Z'};
      else{if(args.p_action==='approve'||args.p_action==='reject'){config.requests=[];inboxRows=inboxRows.filter(row=>row.id!==args.p_args.request_id);}
        if(args.p_action==='revoke')config.connections[0].status='revoked';
        if(args.p_action==='configure')Object.assign(config,args.p_args);data=config;}
    }else if(name==='mq_scansob_pairing_inbox'){
      if(!inboxMode)return route.fulfill({contentType:'application/json',body:JSON.stringify({data:null,error:{code:'PGRST202'}})});
      if(args.p_action==='inbox'){
        const page=args.p_args.page;
        data={school_id:policy.school_id,destination_label:'โรงเรียนปลายทางทดสอบ',count:inboxRows.length,requests:inboxRows.slice(page*20,page*20+20),page,page_size:20,server_now:new Date(inboxClock).toISOString()};
      }else{
        if(args.p_action==='configure'){
          if(policyConflict)return route.fulfill({contentType:'application/json',body:JSON.stringify({data:null,error:{message:'PAIRING_POLICY_CHANGED'}})});
          Object.assign(policy,args.p_args,{revision:'1'});
          if(policy.policy==='review_each_request')policy.emails=[];
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
    assert.equal(await page.locator('#scansobCreate').isVisible(),false,'code creation is not in the main toolbar');
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
    await page.evaluate(()=>{document.getElementById('teacherSection').classList.add('hidden');document.getElementById('studentSection').classList.remove('hidden');CU={id:'00001',name:'จำลอง',role:'STUDENT',authMode:'google'};studentExamButton.hidden=false;});
    const tab=page.locator('#studentExamButton'),home=page.locator('.student-home-link'),subject=page.locator('#studentExamSubject'),more=page.locator('#studentExamMore');
    const results=page.locator('.scansob-student-result');
    const waitCount=count=>page.waitForFunction(n=>document.querySelectorAll('.scansob-student-result').length===n&&studentExamScores.getAttribute('aria-busy')==='false',count);
    await tab.click();await waitCount(30);assert.equal(await tab.getAttribute('aria-current'),'page');
    assert.equal(await page.locator('#studentHomeView').isHidden(),true);
    assert.equal(await page.locator('#studentInstallButton').isHidden(),true);
    assert.equal(await page.locator('.swal2-popup').count(),0,'scores are not an alert dialog');
    assert.equal(await results.first().locator('h2').textContent(),'ผลสอบล่าสุด');
    assert.match(await page.locator('#studentExamStatus').textContent(),/30 จาก 37/);
    assert.equal(await page.locator('#studentExamTerm').textContent(),'ภาคเรียน 2/2569');
    assert.equal(await page.locator('.student-exam-meta').filter({hasText:'ภาคเรียน'}).count(),0);
    for(const [width,height] of [[320,568],[390,844],[768,1024],[1280,900]]){
      await page.setViewportSize({width,height});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1||['studentExamView','studentExamSubject','studentExamScores'].some(id=>document.getElementById(id).getBoundingClientRect().right>innerWidth)),false,'student scores overflow '+width);
      if([320,390,1280].includes(width)&&!process.argv.includes('--no-capture')){
        await page.evaluate(()=>document.fonts.ready);
        await page.screenshot({path:path.join(output,'student-score-tab-'+width+'.png')});
      }
    }
    await page.setViewportSize({width:320,height:568});
    await page.evaluate(()=>document.documentElement.style.fontSize='200%');
    assert.equal(await page.evaluate(()=>studentExamScores.scrollWidth>studentExamScores.clientWidth+1),false,'larger Thai text stays inside the result list');
    await page.evaluate(()=>document.documentElement.style.fontSize='');
    assert.equal(await results.filter({hasText:'วิทยาศาสตร์'}).count(),0,'requested subject starts beyond page one');
    await subject.selectOption('วิทยาศาสตร์');await waitCount(1);
    assert.equal(await results.first().locator('h2').textContent(),'พลังงานและการเปลี่ยนรูป');
    await subject.selectOption('');await waitCount(30);
    studentFault={message:'Synthetic network error'};
    await more.press('Enter');
    await page.waitForFunction(()=>studentExamMore.textContent==='ลองอีกครั้ง');
    assert.equal(await results.count(),30,'paging error preserves displayed scores');
    assert.equal(await more.evaluate(el=>document.activeElement===el),true,'paging keeps focus during error');
    assert.match(await page.locator('#studentExamPageStatus').textContent(),/โหลดคะแนนเพิ่มเติมไม่สำเร็จ/);
    studentFault=null;await more.press('Enter');await waitCount(37);
    assert.equal(await more.isHidden(),true);
    assert.equal(await results.nth(30).evaluate(el=>el===document.activeElement),true,'focus moves to first appended result');
    const studentReads=calls.filter(c=>c.name==='mq_scansob_student_scores');
    assert.ok(studentReads.every(c=>!Object.hasOwn(c.args,'student_id')),'no caller-selected student identity');
    assert.equal(studentReads.at(-1).args.p_before_id,'71');
    assert.equal(studentReads.at(-2).args.p_before_id,studentReads.at(-1).args.p_before_id,'retry uses the same cursor');
    await home.click();assert.equal(await results.count(),0);assert.equal(await home.getAttribute('aria-current'),'page');
    await tab.click();await waitCount(30);studentView=false;
    await more.click();await waitCount(0);
    assert.equal(await subject.isHidden(),true,'a disabled read clears displayed scores and subjects');
    assert.match(await page.locator('#studentExamStatus').textContent(),/ยังไม่เปิด/);
    await home.click();studentView=true;
    let release;
    const hold=()=>{studentGate=new Promise(resolve=>{release=resolve;});return new Promise(resolve=>{studentStarted=resolve;});};
    studentFault={message:'Synthetic old request failed'};
    const started=hold();await tab.click();await started;
    await home.click();studentGate=null;studentFault=null;await tab.click();await waitCount(30);
    const response=page.waitForResponse(async r=>r.url().endsWith('/__scansob_fixture') && (await r.json()).error?.message==='Synthetic old request failed');
    release();await response;
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.match(await page.locator('#studentExamStatus').textContent(),/30 จาก 37/,'late old error cannot overwrite current results');
    await home.click();
    const switching=hold();await tab.click();await switching;
    await page.evaluate(()=>{CU.id='00002';googleAccount.linkVersion='switched';resetStudentHome();});
    const switchedResponse=page.waitForResponse(r=>r.url().endsWith('/__scansob_fixture'));
    release();studentGate=null;await switchedResponse;
    assert.equal(await tab.getAttribute('aria-current'),null);
    assert.equal(await results.count(),0,'late old-identity scores discarded');
    studentView=false;await tab.click();await page.waitForFunction(()=>studentExamStatus.textContent.includes('ยังไม่เปิด'));
    assert.equal(await results.count(),0);assert.equal(await subject.isHidden(),true);await home.click();
    fail=true;await tab.click();await page.waitForFunction(()=>studentExamStatus.textContent.includes('ยังไม่พร้อม'));
    fail=false;studentView=true;await more.click();await waitCount(30);await home.click();oldProfile=true;
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
    await page.locator('#scansobLegacyPolicy summary').click();
    await page.locator('#scansobCreate').click();
    await page.waitForSelector('.scansob-code');
    assert.equal(await page.locator('.scansob-code').textContent(),'1234ABCD1234ABCD');
    await page.locator('.swal2-confirm').click();
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
    policyConflict=false;
    await page.locator('#scansobPolicyUseReview').click();
    await page.locator('.swal2-confirm').click();
    await page.waitForFunction(()=>document.querySelector('#scansobPolicyMode').textContent==='อนุมัติรายคำขอ');
    assert.equal(await page.locator('#scansobPolicyEnabled').isChecked(),false,'mode switch pauses intake');
    assert.equal(await page.locator('#scansobPolicyEmails').isVisible(),false);
    assert.equal(await page.locator('#scansobCreate').isVisible(),false);
    assert.equal(await page.locator('#scansobPolicyEnabled').evaluate(el=>el===document.activeElement),true);
    await page.locator('#scansobPolicyEnabled').check();
    await page.locator('#scansobPolicySave').click();
    await page.waitForFunction(()=>document.querySelector('#scansobPolicyStatus').textContent==='บันทึกการรับคำขอแล้ว');
    assert.equal(calls.filter(call=>call.name==='mq_scansob_pairing_inbox'&&call.args.p_action==='configure').at(-1).args.p_args.emails,undefined);
    assert.match(await page.locator('#scansobRequests').textContent(),/โรงเรียนปลายทางทดสอบ/);
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'review settings overflow '+width);
      if([390,1280].includes(width))await capture('review-settings-'+width);
    }
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
