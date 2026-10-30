const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {studentHistoryDay,makeStudentDayPager,takeStudentHistoryDays}=require('../student-history.js');
const {studentBannerRank,studentThemeMix}=require('../student-banners.js');
async function main(){
  assert.equal(studentHistoryDay('2026-10-29T16:59:59.999Z'),'2026-10-29');
  assert.equal(studentHistoryDay('2026-10-29T17:00:00.000Z'),'2026-10-30');
  const rows=[];let id=1000;
  for(let day=30;day>=1;day--){for(let n=0;n<(day===30?31:2);n++)rows.push({id:id--,timestamp:'2026-10-'+String(day).padStart(2,'0')+'T08:00:00.123456+00:00',status:n%3===0?'กิจกรรม':'มา',points:n%3===0?0:5});}
  let offset=0,reads=0;
  const pager=makeStudentDayPager(async()=>{reads++;const page=rows.slice(offset,offset+12);offset+=page.length;return {rows:page,done:offset>=rows.length};});
  const first=await takeStudentHistoryDays(pager,5);
  assert.equal(first.length,5);assert.equal(first[0].rows.length,31,'one day is never cut off at the raw chunk boundary');
  assert.equal(first[4].day,'2026-10-26');assert.ok(reads>1&&offset<rows.length,'bounded reads, not full history');
  const all=first.slice();while(!pager.done || pager.buffer.length)all.push(...await takeStudentHistoryDays(pager,5));
  assert.equal(all.length,30);assert.equal(all.flatMap(day=>day.rows).length,rows.length);assert.equal(new Set(all.flatMap(day=>day.rows.map(row=>row.id))).size,rows.length);
  let attempts=0;
  const retry=makeStudentDayPager(async()=>{attempts++;if(attempts===1)return {rows:rows.slice(0,12),done:false};if(attempts===2)throw new Error('network');return {rows:rows.slice(12),done:true};});
  await assert.rejects(()=>takeStudentHistoryDays(retry,5),/network/);assert.equal(retry.days,0);assert.equal(retry.seen.size,0);
  assert.equal((await takeStudentHistoryDays(retry,5))[0].rows.length,31,'retry retains already-fetched pending rows');
  const empty=makeStudentDayPager(async()=>({rows:[],done:true}));assert.deepEqual(await takeStudentHistoryDays(empty,5),[]);
  let release;const delayed=makeStudentDayPager(()=>new Promise(resolve=>{release=resolve;}));
  const pending=takeStudentHistoryDays(delayed,5);assert.deepEqual(await takeStudentHistoryDays(delayed,5),[]);release({rows:[],done:true});await pending;
  const source=fs.readFileSync(path.resolve(__dirname,'../student-history.js'),'utf8');
  const queries=[],raw=rows.slice(0,12);let queryCount=0;
  const context={Intl,Date,Set,Promise,AbortController,setTimeout,clearTimeout,studentUiIdentity:()=> 'owner',isGuestMode:()=>false,
    getSupabase:()=>({from(table){const q={table,fields:'',filters:[],select(fields){q.fields=fields;return q;},eq(k,v){q.filters.push(['eq',k,v]);return q;},lte(k,v){q.filters.push(['lte',k,v]);return q;},order(){return q;},limit(n){q.limitValue=n;return q;},or(value){q.orValue=value;return q;},abortSignal(){return q;}};queries.push(q);return q;}}),
    runQuery:async q=>{queryCount++;return q.fields==='id'?[{id:1000}]:queryCount===2?raw:[];}};
  vm.createContext(context);vm.runInContext(source,context);
  context.studentHistoryRun={owner:'owner',studentId:'00001',cancelled:false};
  const reader=context.createStudentAttendanceReader(context.studentHistoryRun);
  await reader();await reader();
  assert.equal(queries.length,3);assert.ok(queries[2].orValue.includes('2026-10-30T08:00:00.123456+00:00'),'cursor retains DB microseconds and timezone');
  assert.ok(queries.every(q=>q.filters.some(f=>f[0]==='eq'&&f[1]==='student_id'&&f[2]==='00001')));
  assert.ok(queries.slice(1).every(q=>q.filters.some(f=>f[0]==='lte'&&f[1]==='id'&&f[2]==='1000')),'new inserts stay beyond opening snapshot');
  context.studentHistoryRun.cancelled=true;await assert.rejects(()=>reader(),/cancelled/);
  for(const [level,rank] of [[-1,0],[0,0],[9,0],[10,1],[19,1],[20,2],[29,2],[30,3],[39,3],[40,4],[99,4]])assert.equal(studentBannerRank(level),rank);
  assert.notEqual(studentThemeMix('#218ab8',.97),studentThemeMix('#218ab8',.83));assert.notEqual(studentThemeMix('#218ab8',.9),studentThemeMix('#ed7529',.9));
  const evolution=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../assets/pets/manifest.json'),'utf8')).evolution;
  assert.deepEqual(evolution.map(stage=>stage.minLevel),[0,16,31],'cosmetic rank does not change pet evolution');
  console.log('PASS history: five distinct Bangkok days, complete multi-row days, bounded cursor reads/microsecond precision/snapshot, retry/no loss, busy/cancel/privacy guards; rank0/10/20/30/40 and original pet evolution');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
