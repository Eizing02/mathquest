const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'reports.js'), 'utf8');
const helpers = `
function dateKeyBangkok(t){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));}
function matchesMonth(t,m){return dateKeyBangkok(t).startsWith(m);}
function formatDate(t){return dateKeyBangkok(t);}
function formatThaiLongDate(t){return new Date(t).toLocaleDateString('th-TH');}
function rewardReportStatusText(s){return {approved:'อนุมัติแล้ว',pending:'รอดำเนินการ',rejected:'ปฏิเสธ'}[s];}
var TH_MO_L=['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];`;
const context = vm.createContext({ Intl, Date, Map, Set, console });
vm.runInContext(helpers + code, context);
const selection = { kind:'attendance',grade:'ม.6',month:'2026-09',from:'',to:'',createdAt:'2026-09-15T05:00:00Z',school:'โรงเรียนตัวอย่าง',teacher:'ครูทดสอบ' };
const students = Array.from({length:70},(_,i)=>({id:String(2000+i).padStart(5,'0'),name:'นักเรียนทดสอบชื่อยาว นามสกุลเพื่อทดสอบการพิมพ์ '+(i+1),grade:'ม.6'}));
const data = { students, attendance:[], orders:[], pets:[], catalog:[{item_id:'bonus',bonus_points:2}] };
students.forEach(s=>{
  data.attendance.push({id:1,student_id:s.id,timestamp:'2026-09-02T02:00:00Z',status:'มา',points:100});
  data.attendance.push({id:2,student_id:s.id,timestamp:'2025-09-02T02:00:00Z',status:'มา',points:5});
  data.attendance.push({id:3,student_id:s.id,timestamp:'2026-09-03T02:00:00Z',status:'กิจกรรม',points:5});
  [['approved',20,2],['pending',10,2],['rejected',30,2],['approved',0,null]].forEach(([status,cost,bonus],i)=>data.orders.push({id:data.orders.length+1,student_id:s.id,item_id:'bonus',item_name:'แต้มพิเศษ 2 คะแนน',timestamp:'2026-09-04T03:00:00Z',status,points_used:cost,bonus_points:bonus}));
  data.pets.push({student_id:s.id,points_used:15});
});
const build=(kind)=>context.buildReport({...selection,kind,month:kind==='attendance'?selection.month:''},data);
assert.equal(build('attendance').rows[0].cells[7],100);
assert.equal(build('attendance').rows[0].cells[4],1);
assert.equal(build('wallet').rows[0].cells.at(-1),60);
assert.equal(build('bonus').rows[0].cells.at(-1),4);
assert.equal(build('pending').rows.length,70);
assert.equal(build('history').rows.length,210);
assert.match(context.reportCsvCell('=1+1'),/^"'/);
assert.equal(context.reportCsvCell('02074'),'"02074"');
async function main(){
  let calls=0;
  context.runQuery=async q=>q.cursor===null?[{id:1},{id:2}]:q.cursor===2?[{id:3}]:[];
  const paged=await context.reportReadAll(()=>({cursor:null,order(){return this},limit(){calls++;return this},gt(k,c){this.cursor=c;return this}}),'id');
  assert.equal(paged.length,3);assert.equal(calls,3);
  console.log('PASS: year, activity, bonus, pending, wallet incl pets, CSV, capped pagination');
  if(!process.argv.includes('--browser'))return;
  const {chromium}=require('playwright');
  const http=require('node:http');
  const server=http.createServer((req,res)=>{
    const requested=new URL(req.url,'http://localhost').pathname;
    const file=path.join(root,requested==='/'?'index.html':requested);
    if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.woff2')?'font/woff2':'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/report-print.css`);
    await page.setContent('<html><head></head><body></body></html>');
    await page.addScriptTag({content:helpers+code});
    const output=path.join(root,'tmp','pdfs');fs.mkdirSync(output,{recursive:true});
    for(const kind of ['attendance','history','bonus','pending','wallet','individual']){
      const report=kind==='individual'?context.buildReport({...selection,kind,studentId:students[0].id},{...data,students:[students[0]]}):build(kind);
      await page.evaluate(async r=>{await renderReportPrint(window,r)},report);
      const metrics=await page.evaluate(()=>Array.from(document.querySelectorAll('.report-page')).map(p=>({rows:p.querySelectorAll('tbody tr').length,head:!!p.querySelector('thead'),overflow:p.scrollHeight>p.clientHeight+1,number:p.querySelector('.page-number').textContent})));
      assert.ok(metrics.length>=(kind==='individual'?2:3),kind+' multipage');
      assert.ok(metrics.every(m=>!m.overflow && (m.rows===0||m.head)),kind+' layout');
      assert.equal(metrics.reduce((n,m)=>n+m.rows,0),report.rows.length+(report.attachments||[]).reduce((n,r)=>n+r.rows.length,0));
      await page.emulateMedia({media:'print'});
      await page.pdf({path:path.join(output,kind+'.pdf'),preferCSSPageSize:true,printBackground:true});
      await page.emulateMedia({media:'screen'});
      await page.locator('.report-page').nth(1).screenshot({path:path.join(output,kind+'-page2.png')});
      console.log('PASS PDF',kind,metrics.length,'pages',report.rows.length,'rows');
    }
    // Test actual application controls without contacting the production database.
    await page.route('**/*supabase*/**',route=>route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof XLSX!=='undefined' && typeof downloadReport==='function');
    for(const format of ['csv','xlsx']){
      const downloaded=page.waitForEvent('download');
      await page.evaluate(({report,format})=>downloadReport(report,format),{report:build('bonus'),format});
      await (await downloaded).saveAs(path.join(output,'bonus.'+format));
      console.log('PASS download',format);
    }
    for(const width of [390,768,1280]){
      await page.setViewportSize({width,height:900});
      await page.evaluate(()=>{
        document.querySelectorAll('body > main, body > div').forEach(el=>{if(el.id!=='teacherSection')el.style.display='none'});
        const teacher=document.getElementById('teacherSection');teacher.classList.remove('hidden');teacher.style.display='block';
        document.querySelectorAll('.t-pane').forEach(el=>{el.hidden=el.id!=='tab-reward-report';el.style.display=el.hidden?'none':'block'});
      });
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'responsive '+width);
      await page.screenshot({path:path.join(output,'controls-'+width+'.png')});
    }
  }finally{if(browser)await browser.close();server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
