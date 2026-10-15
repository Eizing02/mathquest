const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {startServer}=require('./serve.cjs');
async function main(){
  const output=path.resolve(__dirname,'../tmp/scansob');fs.mkdirSync(output,{recursive:true});
  const server=await startServer();const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let fail=false,studentView=true;
  const requestId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',connectionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const config={school_id:connectionId,enabled:false,student_view_enabled:false,identity_policy_accepted:false,score_count:2,
    requests:[{id:requestId,workspace_id:requestId,workspace_label:'ครูวิทยาศาสตร์ ชื่อสำหรับทดสอบข้อความยาวบนหน้าจอมือถือ',status:'pending_approval',expires_at:'2026-10-15T08:00:00Z'}],
    connections:[{id:connectionId,workspace_id:connectionId,workspace_label:'ครูคณิตศาสตร์',status:'active',last_received_at:'2026-10-15T00:00:00Z'}]};
  const meta={title:'แบบทดสอบเรื่องสมการเชิงเส้นตัวแปรเดียว ชื่อยาวสำหรับตรวจการจัดวาง',subject:'คณิตศาสตร์',exam_type:'เก็บคะแนน',term:1,academic_year:2569};
  const rows=[{id:1,exam_id:1,student_code:'00001',student_name:'นักเรียนจำลอง ชื่อยาวสำหรับหน้าจอมือถือ',grade:'ม.2/1',metadata:meta,result:{score:17.5,max_score:25,percent:70,passed:true},updated_at:'2026-10-15T00:00:00Z'},
    {id:2,exam_id:1,student_code:'00002',student_name:'นักเรียนจำลอง ข',grade:'ม.2/2',metadata:meta,result:{score:15,max_score:25,percent:60,passed:true},updated_at:'2026-10-15T00:00:00Z'}];
  const calls=[];
  await page.route('**/*.supabase.co/**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
  await page.route('**/__scansob_fixture',async route=>{
    const {name,args,student}=route.request().postDataJSON();calls.push({name,args});let data;
    if(fail)return route.fulfill({contentType:'application/json',body:JSON.stringify({data:null,error:{code:'PGRST202',message:'Could not find the function'}})});
    if(name==='mq_scansob_admin'){
      if(args.p_action==='create_code')data={code:'1234ABCD1234ABCD',expires_at:'2026-10-15T08:00:00Z'};
      else{if(args.p_action==='approve'||args.p_action==='reject')config.requests=[];
        if(args.p_action==='revoke')config.connections[0].status='revoked';
        if(args.p_action==='configure')Object.assign(config,args.p_args);data=config;}
    }else if(args.p_kind==='exams')data={enabled:true,rows:[{id:1,metadata:meta,revision:1,batch_count:1,received_batches:1}],next_cursor:null};
    else if(args.p_kind==='issues')data={enabled:true,rows:[{id:1,exam_id:1,student_code:'00999',reason:'STUDENT_NOT_FOUND',metadata:meta,revision:1}],next_cursor:null};
    else data={enabled:studentView,rows:studentView?(student?rows.slice(0,1):rows):[],next_cursor:null,version:'fixture-v1'};
    await route.fulfill({contentType:'application/json',body:JSON.stringify({data,error:null})});
  });
  const capture=async name=>{if(!process.argv.includes('--no-capture'))await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});};
  try{
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
    await page.evaluate(()=>{
      getSupabase=()=>({rpc:async(name,args)=>{const r=await fetch('/__scansob_fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args,student:CU.role==='STUDENT'})});return r.json();}});
      CU={id:'teacher',role:'TEACHER',authMode:'google'};googleAccount={linkVersion:''};teacherAdminToken='fixture-token';
      document.getElementById('loginSection').classList.add('hidden');document.getElementById('teacherSection').classList.remove('hidden');switchTab('settings');
    });
    await page.waitForFunction(()=>document.querySelector('#scansobSave').disabled===false);
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'settings overflow '+width);
      if([390,1280].includes(width))await capture('settings-'+width);
    }
    await page.locator('#scansobCreate').click();await page.waitForSelector('.scansob-code');assert.equal(await page.locator('.scansob-code').textContent(),'1234ABCD1234ABCD');await page.locator('.swal2-confirm').click();
    await page.locator('[onclick*="decideScanSobRequest"]').first().click();await page.locator('.swal2-confirm').click();await page.waitForFunction(()=>document.querySelector('#scansobRequests').textContent.includes('ไม่มีคำขอ'));
    await page.evaluate(()=>switchTab('exams'));await page.waitForSelector('.scansob-table tbody tr');
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'teacher scores overflow '+width);
      if([390,1280].includes(width))await capture('scores-'+width);
    }
    const download=page.waitForEvent('download');await page.locator('#externalScoreExport').click();assert.match((await download).suggestedFilename(),/ScanSob_scores/);
    await page.locator('[name="externalExamMode"][value="issues"]').check();await page.waitForFunction(()=>document.querySelector('#externalExamRows').textContent.includes('00999'));
    assert.ok((await page.locator('#externalExamRows').textContent()).includes('ไม่พบรหัสในทะเบียน'));
    await page.evaluate(()=>{document.getElementById('teacherSection').classList.add('hidden');document.getElementById('studentSection').classList.remove('hidden');CU={id:'00001',name:'จำลอง',role:'STUDENT',authMode:'google'};openStudentExamScores();});
    await page.waitForSelector('.scansob-student-result');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.swal2-popup')).opacity==='1');assert.equal(await page.locator('.scansob-student-result').count(),1);
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'student scores overflow '+width);
      if([390,1280].includes(width))await capture('student-'+width);
    }
    assert.ok(calls.filter(c=>c.name==='mq_scansob_read').every(c=>!Object.hasOwn(c.args,'student_id')),'no caller-selected student identity');
    await page.locator('.swal2-confirm').click();studentView=false;await page.evaluate(()=>{openStudentExamScores();});await page.waitForFunction(()=>document.querySelector('#studentExamStatus').textContent.includes('ยังไม่เปิด'));
    assert.equal(await page.locator('.scansob-student-result').count(),0);await page.locator('.swal2-confirm').click();
    fail=true;await page.evaluate(()=>{openStudentExamScores();});await page.waitForFunction(()=>document.querySelector('#studentExamStatus').textContent.includes('ยังไม่พร้อม'));
    assert.deepEqual(errors,[]);
    console.log('PASS ScanSob browser: pairing code, approval, scores/issues, CSV download, own-score request, disabled/missing-migration states, responsive 320/390/768/1280; mocked server only');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
