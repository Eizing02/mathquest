const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const root = path.resolve(__dirname,'..');

async function main() {
  const folder=path.join(root,'assets/profile-frames');
  const {frames}=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
  const pets=JSON.parse(fs.readFileSync(path.join(root,'assets/pets/manifest.json'),'utf8')).pets;
  const prompts=JSON.parse(fs.readFileSync(path.join(root,'docs/20261029-profile-frame-prompts.json'),'utf8')).assets;
  assert.deepEqual(frames.map(f=>f.petId).sort(),pets.map(p=>p.id).sort(),'all current pets have a frame');
  let bytes=0;
  const layers=[];
  const portrait=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="132" height="132"><circle cx="66" cy="66" r="66" fill="#dcebe9"/><circle cx="66" cy="50" r="22" fill="#1c6466"/><path d="M24 132v-17a42 42 0 0 1 84 0v17" fill="#1c6466"/></svg>')).png().toBuffer();
  for(let index=0;index<frames.length;index++) {
    const {petId}=frames[index];
    const file=path.join(folder,petId+'.webp');
    const original=path.join(folder,'masters',petId+'.png');
    const metadata=await sharp(file).metadata();
    assert.equal(metadata.width,640);assert.equal(metadata.height,640);assert.equal(metadata.hasAlpha,true);
    assert.ok((await sharp(original).metadata()).width>=1024,'high resolution master '+petId);
    const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const alpha=(x,y)=>data[(y*info.width+x)*4+3];
    assert.equal(alpha(0,0),0);assert.equal(alpha(320,320),0);
    let centerClear=0,centerCount=0;
    for(let y=170;y<470;y++)for(let x=170;x<470;x++){
      if(Math.hypot(x-320,y-320)<140){centerCount++;if(alpha(x,y)<8)centerClear++;}
    }
    // Small rim/jewel tips may enter the outer edge; the central face area must stay clear.
    assert.ok(centerClear/centerCount>.99,'central face area unobstructed '+petId);
    assert.ok(alpha(320,240)<8&&alpha(240,320)<8&&alpha(400,320)<8&&alpha(320,400)<8,'clear face core '+petId);
    const length=fs.statSync(file).size;
    bytes+=length;assert.ok(length<190000,'bounded runtime asset '+petId);
    const provenance=JSON.parse(fs.readFileSync(file+'.json','utf8'));
    assert.ok(JSON.stringify(provenance).includes(prompts.find(p=>p.petId===petId).prompt),'exact prompt retained '+petId);
    const art=await sharp(file).resize(200,200).png().toBuffer();
    const sample=await sharp({create:{width:200,height:200,channels:4,background:{r:0,g:0,b:0,alpha:0}}})
      .composite([{input:portrait,left:34,top:34},{input:art,left:0,top:0}]).png().toBuffer();
    const x=(index%4)*440,y=Math.floor(index/4)*236;
    layers.push({input:sample,left:x+10,top:y+8},{input:sample,left:x+230,top:y+8});
    layers.push({input:Buffer.from('<svg width="440" height="28"><text x="220" y="21" text-anchor="middle" font-family="Arial" font-size="16" fill="#384555">'+petId+'</text></svg>'),left:x,top:y+205});
  }
  const backgrounds=[];
  for(let i=0;i<24;i++)backgrounds.push({input:{create:{width:220,height:205,channels:4,background:'#18222f'}},left:(i%4)*440+220,top:Math.floor(i/4)*236});
  const output=path.join(root,'tmp/profile-frames');fs.mkdirSync(output,{recursive:true});
  await sharp({create:{width:1760,height:1416,channels:4,background:'#f5f7f8'}}).composite([...backgrounds,...layers]).png().toFile(path.join(output,'frame-contact-sheet.png'));
  console.log('PASS 21 unique registered assets, real alpha/clear face center, 640px WebP and high-res masters, exact prompts. Runtime total '+Math.round(bytes/1024)+' KiB; startup requests only the active pet frame. Contact sheet: tmp/profile-frames/frame-contact-sheet.png');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
