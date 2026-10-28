const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { startServer } = require('./serve.cjs');
const output = path.resolve(__dirname,'../tmp/google-auth');

async function testActualSdkPkce(browser,server) {
  const page=await browser.newPage();
  let challenge=null,verifier=null,authenticatedRpc=false;
  const user={id:'10000000-0000-4000-8000-000000000099',email:'pkce@fixture.invalid',email_confirmed_at:new Date().toISOString(),
    aud:'authenticated',role:'authenticated',app_metadata:{provider:'google',providers:['google']},user_metadata:{},identities:[]};
  const payload={sub:user.id,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),aud:'authenticated',role:'authenticated',session_id:'20000000-0000-4000-8000-000000000099'};
  const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+Buffer.from('fixture-only-signature').toString('base64url');
  await page.route('**/*.supabase.co/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/auth/v1/authorize'){
      challenge=url.searchParams.get('code_challenge');
      assert.equal(url.searchParams.get('code_challenge_method'),'s256');
      assert.equal(url.searchParams.get('provider'),'google');
      return route.fulfill({status:302,headers:{location:'http://127.0.0.1:'+server.address().port+'/?code=fixture-pkce-code'}});
    }
    let data;
    if(url.pathname==='/auth/v1/token'){
      assert.equal(url.searchParams.get('grant_type'),'pkce');
      const body=route.request().postDataJSON();verifier=body.code_verifier;
      assert.equal(body.auth_code,'fixture-pkce-code');
      data={access_token:token,refresh_token:'fixture-refresh-token',expires_in:3600,token_type:'bearer',user};
    } else if(url.pathname==='/auth/v1/user')data=user;
    else if(url.pathname==='/rest/v1/rpc/mq_google_account'){
      authenticatedRpc=route.request().headers().authorization==='Bearer '+token;
      data={state:'unlinked',email:user.email};
    } else if(url.pathname==='/rest/v1/system_settings') data=[{key:'school_name',value:'โรงเรียนทดสอบ PKCE'}];
    else return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Unexpected test-only endpoint'})});
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  try {
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
    await page.locator('#googleLoginBtn').click();
    await page.waitForSelector('#googleLinkSection:not(.hidden)');
    assert.ok(verifier && challenge,'actual SDK performs PKCE exchange');
    assert.equal(crypto.createHash('sha256').update(verifier).digest('base64url'),challenge);
    assert.equal(authenticatedRpc,true,'account RPC uses resulting access token');
    assert.ok(!page.url().includes('code='),'SDK removes the OAuth code after callback');
    console.log('PASS actual Supabase browser SDK: PKCE challenge/verifier, simulated callback exchange, session restore and bearer-authenticated account RPC; no real Google/Supabase request');
  } finally {await page.close();}
}

async function main() {
  fs.mkdirSync(output,{recursive:true});
  const server=await startServer();
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({permissions:['geolocation'],geolocation:{latitude:17.131333,longitude:102.103092,accuracy:10}});
  let state='signed_out', duplicate=false, lookupFailure=false, recent=true;
  const calls=[],errors=[],production=[];
  const teacher={state:'linked',id:'teacher',name:'ครูทดสอบ',grade:'-',role:'TEACHER',email:'piyawatpiwsiri@gmail.com',authMode:'google',linkVersion:'',authSessionId:'fixture-session'};
  const student={state:'linked',id:'00001',name:'นักเรียนทดสอบชื่อยาว นามสกุลสำหรับตรวจหน้าจอบนโทรศัพท์',grade:'ม.2/1',role:'STUDENT',email:'student@fixture.invalid',authMode:'google',linkVersion:'fixture-link',authSessionId:'fixture-session',isFirstLogin:false};
  const settings={school_name:'โรงเรียนทดสอบ',app_name:'MathQuest',semester_number:'1',semester_year:'2569',semester_start:'',semester_end:'',school_data_version:'fixture-v1',pin:''};
  const sdk=`window.supabase={createClient:function(url,key,options){window.testAuthOptions=options.auth;
    const post=async(name,args)=>{const r=await fetch('/__mq-auth-fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});return r.json()};
    const client={auth:{getSession:()=>post('session'),signInWithOAuth:args=>post('oauth',args),signOut:()=>post('signout'),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
      rpc:post,removeChannel:()=>Promise.resolve(),channel:()=>({on(){return this},subscribe(){return this}}),
      from(table){let filters=[],one=false;const q={select(){return q},order(){return q},limit(){return q},gt(k,v){filters.push([k,v,'gt']);return q},eq(k,v){filters.push([k,v]);return q},in(){return q},or(){return q},maybeSingle(){one=true;return q},
        then(resolve,reject){return post('table',{table,filters,one}).then(resolve,reject)}};return q;}
    };return client;}};`;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*.supabase.co/**',route=>{production.push(route.request().url());return route.abort();});
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',route=>route.fulfill({contentType:'application/javascript',body:sdk}));
  await page.route('**/__mq-auth-fixture',async route=>{
    const {name,args}=route.request().postDataJSON(); calls.push({name,args});
    let data=null,error=null;
    if(name==='session')data={session:state==='signed_out'?null:{user:{id:'UNTRUSTED-CLIENT-ID',email:'fake-teacher@fixture.invalid',user_metadata:{role:'TEACHER'}}}};
    else if(name==='oauth')data={url:'https://accounts.google.com/fixture'};
    else if(name==='signout'){state='signed_out';data={};}
    else if(name==='mq_google_account'){
      if(state==='account_error')error={code:'PGRST202',message:'Could not find the function'};
      else data=state==='teacher'?teacher:state==='student'?student:{state:'unlinked',email:'student@fixture.invalid'};
    }
    else if(name==='mq_student_link'){
      if(lookupFailure){error={message:'network request failed'};}
      else if(args.p_action==='lookup')data=args.p_student_code==='99999'?{ok:false,code:'STUDENT_NOT_FOUND'}:{ok:true,student};
      else if(duplicate)data={ok:false,code:'STUDENT_ALREADY_LINKED'};
      else{data={ok:true};state='student';}
    }
    else if(name==='mq_open_teacher_session')data='fixture-teacher-token';
    else if(name==='mq_google_recent_auth')data=recent;
    else if(name==='preview_school_reset')data={students:3,attendance:80,orders:12,pets:3,pet_events:8,pending_orders:0,active_session:false,version:'fixture-v1'};
    else if(name==='mq_reset_student_progress')data={status:'success'};
    else if(name==='mq_student_check_in')data={result:'error',code:'LOCATION_REQUIRED'};
    else if(name==='mq_prepare_location_check_in')data={result:'ready',request_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',max_accuracy_m:50,radius_m:100};
    else if(name==='mq_student_check_in_at_location')data={result:'success',points:5,distance_m:0,accuracy_m:10};
    else if(name==='mq_student_buy_item')data={status:'success',mathCoins:95};
    else if(name==='mq_student_pet')data={status:'success',pet:{student_id:'00001',pet_id:'leafy',pet_name:'ทดสอบ'},cost:0};
    else if(name==='table'){
      let rows=args.table==='system_settings'?Object.entries(settings).map(([key,value])=>({key,value})):args.table==='students'?[student]:[];
      rows=rows.filter(row=>args.filters.every(([k,v,mode])=>mode==='gt'?row[k]>v:row[k]===v));data=args.one?rows[0]||null:rows;
    }
    const body=name==='session'?{data,error}:name==='oauth'?{data,error}:{data,error,count:Array.isArray(data)?data.length:0};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  const capture=async name=>{if(!process.argv.includes('--no-capture'))await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});};
  try {
    await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'networkidle'});
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Google login overflow '+width);
      await capture('login-google-'+width);
    }
    assert.equal(await page.locator('#username,#password,.login-reset-actions').count(),0,'no legacy password login');
    assert.equal(await page.evaluate(()=>testAuthOptions.flowType),'pkce');
    await page.locator('#googleLoginBtn').click();
    const oauth=calls.find(c=>c.name==='oauth');
    assert.equal(oauth.args.provider,'google');assert.equal(oauth.args.options.redirectTo,new URL(page.url()).origin+'/');
    state='unlinked';await page.reload({waitUntil:'networkidle'});await page.waitForSelector('#googleLinkSection:not(.hidden)');
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'link input overflow '+width);
      await capture('link-input-'+width);
    }
    await page.locator('#googleStudentCode').fill('123');await page.locator('#googleLinkSubmit').click();
    assert.match(await page.locator('#googleLinkError').textContent(),/5 หลัก/);
    await page.locator('#googleStudentCode').fill('99999');await page.locator('#googleLinkSubmit').click();
    await page.waitForFunction(()=>document.querySelector('#googleLinkError').textContent.includes('ไม่พบรหัส'));
    lookupFailure=true;await page.locator('#googleStudentCode').fill('00001');await page.locator('#googleLinkSubmit').click();
    await page.waitForFunction(()=>document.querySelector('#googleLinkError').textContent.includes('อินเทอร์เน็ต'));
    assert.equal(await page.locator('#googleStudentCode').inputValue(),'00001','network failure preserves code');
    lookupFailure=false;
    await page.locator('#googleStudentCode').fill('๐๐๐๐๑');await page.locator('#googleLinkSubmit').click();
    await page.waitForSelector('#googleLinkPreview:not([hidden])');
    assert.equal(await page.locator('#googlePreviewCode').textContent(),'00001','leading zeros preserved');
    assert.equal(await page.locator('#googlePreviewName').textContent(),student.name);
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'preview overflow '+width);
      await capture('link-preview-'+width);
    }
    duplicate=true;await page.locator('#googleLinkSubmit').click();
    await page.waitForFunction(()=>document.querySelector('#googleLinkError').textContent.includes('บัญชีอื่น'));
    duplicate=false;await page.locator('#googleLinkSubmit').click();
    await page.waitForSelector('#studentSection:not(.hidden)');
    assert.equal(await page.evaluate(()=>CU.id),'00001','server account wins over spoofed client session user');
    await page.reload({waitUntil:'networkidle'});await page.waitForSelector('#studentSection:not(.hidden)');
    assert.ok(!(await page.locator('#googleLinkSection').isVisible()),'linked account needs no code on returning login');
    const beforeCalls=calls.length;
    await page.evaluate(async()=>{await submitCheckInDb('OTHER-ID','1234');await buyItemDb('OTHER-ID','bonus','forged-name',1);await selectStudentPetDb('OTHER-ID','leafy','ทดสอบ');});
    assert.ok(calls.slice(beforeCalls).some(c=>c.name==='mq_student_check_in_at_location'),'Google student check-in uses the location RPC');
    for(const call of calls.slice(beforeCalls).filter(c=>['mq_prepare_location_check_in','mq_student_check_in_at_location','mq_student_buy_item','mq_student_pet'].includes(c.name))){
      assert.ok(!JSON.stringify(call.args).includes('OTHER-ID'),'student writes never submit a caller-selected identity');
    }
    await page.locator('#googleStudentAccountButton').click();await page.locator('.swal2-confirm').click();
    await page.waitForSelector('#googleLinkChangeNote:not([hidden])');assert.ok(await page.locator('#googleLinkCancel').isVisible());
    await page.locator('#googleLinkCancel').click();await page.waitForSelector('#studentSection:not(.hidden)');
    state='teacher';await page.reload({waitUntil:'networkidle'});await page.waitForSelector('#teacherSection:not(.hidden)');
    assert.equal(await page.evaluate(()=>CU.role),'TEACHER');
    assert.ok(!(await page.locator('#teacher-tab-reset').isVisible()),'legacy student-password panel hidden');
    for(const width of [320,390,768,1280]){
      await page.setViewportSize({width,height:900});await page.evaluate(()=>switchTab('settings'));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'teacher overflow '+width);
      await capture('teacher-google-'+width);
    }
    recent=false;
    await page.locator('#semesterResetBtn').click();
    await page.waitForFunction(()=>document.querySelector('.swal2-title')?.textContent==='ยืนยันบัญชี Google อีกครั้ง');
    await page.locator('.swal2-cancel').click();
    assert.equal(calls.some(call=>call.name==='mq_reset_student_progress'),false,'reauth never resets automatically');
    recent=true;
    await page.locator('#semesterResetBtn').click();await page.waitForSelector('#resetPhrase');
    assert.equal(await page.locator('#resetTeacherPassword').count(),0,'Google reset does not require an old local password');
    await page.locator('#resetAck').check();await page.locator('#resetPhrase').fill('ลบทั้งหมด');
    await page.locator('.swal2-confirm').click();
    await page.waitForFunction(()=>document.querySelector('.swal2-title')?.textContent==='ล้างข้อมูลนักเรียนแล้ว');
    const reset=calls.find(call=>call.name==='mq_reset_student_progress');
    assert.deepEqual(Object.keys(reset.args).sort(),['p_expected_version','p_teacher_token']);
    await page.locator('.swal2-confirm').click();await page.waitForSelector('#loginSection:not(.hidden)');
    assert.equal(state,'signed_out','logout revokes Supabase session through SDK');
    state='account_error';await page.reload({waitUntil:'networkidle'});
    await page.waitForSelector('#googleSignedOutAction:not([hidden])');
    assert.match(await page.locator('#googleLoginStatus').textContent(),/20261015_01_google_login_student_links.sql/);
    assert.equal(await page.evaluate(()=>googleAccount),null,'failed bootstrap has no loaded profile');
    await page.locator('#googleSignedOutAction').click();
    await page.locator('#googleSignedOutAction').waitFor({state:'hidden'});
    assert.equal(state,'signed_out','recovery signs out even when profile loading failed');
    assert.deepEqual(production,[],'no production DB calls');
    assert.deepEqual(errors,[],'no uncaught exceptions');
    console.log('PASS Google browser: PKCE options, first/returning login, lookup/preview/claim, duplicate/network recovery, normalized codes, server-derived identity, teacher UI/reset/logout, responsive 320/390/768/1280; OAuth simulated only');
    await testActualSdkPkce(browser,server);
  } catch(error) {
    console.error('Auth UI diagnostic:',await page.locator('#googleLoginStatus').textContent());
    console.error('Uncaught:',errors);
    throw error;
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
