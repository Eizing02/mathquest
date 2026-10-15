const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {stripTypeScriptTypes,createRequire}=require('node:module');
const {event}=require('./test-scansob.cjs');
async function loadUpstream(){
  const source=process.env.SCANSOB_SOURCE_DIR||path.join(os.tmpdir(),'mathquest-scansob-reference');
  const qa=process.env.SQL_QA_MODULE_ROOT||path.join(os.tmpdir(),'mathquest-sql-qa','node_modules');
  const zod=createRequire(path.join(qa,'fixture.cjs')).resolve('zod');
  let code=stripTypeScriptTypes(fs.readFileSync(path.join(source,'lib/integrations/mathquest/contract.ts'),'utf8'),{mode:'transform'});
  code=code.replace('from "zod"','from '+JSON.stringify(pathToFileURL(zod).href));
  return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
async function main(){
  const upstream=await loadUpstream();
  const local=await import(pathToFileURL(path.resolve(__dirname,'../supabase/functions/_shared/scansob-contract.mjs')));
  const base=event(crypto.randomUUID(),crypto.randomUUID());
  const variants=[base,{...base,extra:1},{...base,publication_revision:Number.MAX_SAFE_INTEGER},{...base,publication_revision:Number.MAX_SAFE_INTEGER+1}];
  const fixturePath=path.join(process.env.SCANSOB_SOURCE_DIR||path.join(os.tmpdir(),'mathquest-scansob-reference'),'tests/score-integration-event-fixture.ts');
  const fixtureModule=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(fs.readFileSync(fixturePath,'utf8'),{mode:'transform'})).toString('base64'));
  variants.push(fixtureModule.syntheticScoreEvent());
  for(const term of [0,1,2,3,4])variants.push({...base,exam:{...base.exam,term}});
  for(const title of ['x','  aaa  ','a'.repeat(120),'a'.repeat(121)])variants.push({...base,exam:{...base.exam,title}});
  for(const academic_year of [2499,2500,2700,2701])variants.push({...base,exam:{...base.exam,academic_year}});
  for(const exam_type of ['กลางภาค','ปลายภาค','เก็บคะแนน','ก่อนเรียน','หลังเรียน','อื่นๆ'])variants.push({...base,exam:{...base.exam,exam_type}});
  for(const stamp of ['2026-10-15T00:00Z','2026-10-15T00:00:00.000000Z','2026-02-30T00:00:00Z','2026-10-15T00:00:00+07:00','2026-10-15T24:00:00Z','2026-10-15T23:59:60Z'])variants.push({...base,occurred_at:stamp});
  for(const [score,max_score,percent] of [[0,25,0],[25,25,100],[6000,6000,100],[6001,6001,100],[26,25,100],[1,3,33.33],[1,3,33.34],[1,3,33.35],[1,0,100]])variants.push({...base,results:[{...base.results[0],score,max_score,percent}]});
  for(const variant of variants){
    const parsed=upstream.scoreEventSchema.safeParse(variant);let output,accepted=true;
    try{output=local.validateScoreEvent(structuredClone(variant));}catch{accepted=false;}
    assert.equal(accepted,parsed.success,'matches actual source schema: '+JSON.stringify(variant));
    if(accepted)assert.deepEqual(output,parsed.data);
  }
  const valid=upstream.scoreEventSchema.parse(base);
  const ack={schema_version:'1.0',event_id:valid.event_id,status:'processed',accepted:1,unmatched:[],invalid:[]};
  upstream.validateAcknowledgment(ack,valid);
  console.log('PASS source contract: '+variants.length+' differential cases against actual ScanSob Zod schema and ACK validator');
}
module.exports={loadUpstream};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
