const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const sharp=require('sharp');
const root=path.resolve(__dirname,'../assets/student-banners');
const out=path.resolve(__dirname,'../tmp/student-panels');
async function main(){
  fs.mkdirSync(out,{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const frames=JSON.parse(fs.readFileSync(path.resolve(root,'../profile-frames/manifest.json'),'utf8'));
  assert.deepEqual(new Set(manifest.pets),new Set(frames.frames.map(frame=>frame.petId)));
  const luma=hex=>{const n=parseInt(hex.slice(1),16);return [n>>16,(n>>8)&255,n&255].map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);};
  const contrast=(a,b)=>(Math.max(luma(a),luma(b))+.05)/(Math.min(luma(a),luma(b))+.05);
  const textColors=['#18362c','#405e52','#82520b',...frames.frames.map(frame=>{const n=parseInt(frame.color.slice(1),16);return '#'+[n>>16,(n>>8)&255,n&255].map(c=>Math.round(c*.48).toString(16).padStart(2,'0')).join('');})];
  textColors.forEach(color=>assert.ok(contrast(color,'#f6faf8')>=4.5,'fallback surface text contrast '+color));
  const ids=[...manifest.pets,...manifest.ranks.filter(Boolean).map(rank=>'rank-'+rank)];
  assert.equal(ids.length,25);
  const hashes=new Set(), report=[],tiles=[];
  for(const [i,id] of ids.entries()){
    const file=path.join(root,id+'.webp'),buffer=fs.readFileSync(file),meta=await sharp(buffer).metadata();
    const sidecar=JSON.parse(fs.readFileSync(file+'.json','utf8'));
    assert.equal(meta.width,1280,id);assert.equal(meta.height,512,id);assert.ok(buffer.length<256000,id+' payload');
    assert.ok(sidecar.prompt.length>300,id+' exact prompt');
    const master=fs.readFileSync(path.join(root,'masters',id+'.png'));
    assert.ok(master.includes(Buffer.from(sidecar.prompt)),id+' prompt embedded in master');
    const hash=crypto.createHash('sha256').update(buffer).digest('hex');assert.ok(!hashes.has(hash),id+' unique art');hashes.add(hash);
    const stats=await sharp(buffer).stats();assert.ok(stats.channels.slice(0,3).some(c=>c.stdev>10),id+' not blank');
    let alpha=null;
    if(id.startsWith('rank-')){
      assert.ok(meta.hasAlpha,id+' true alpha');
      const {data}=await sharp(buffer).extract({left:192,top:77,width:896,height:384}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      let total=0,visible=0;for(let j=3;j<data.length;j+=4){total+=data[j];if(data[j]>=16)visible++;}
      alpha={mean:total/(data.length/4),visibleFraction:visible/(data.length/4)};
      assert.ok(alpha.mean<1&&alpha.visibleFraction<.003,id+' clear center tolerance');
    }
    const thumb=await sharp(buffer).resize(384,154).flatten({background:'#f7faf8'}).png().toBuffer();
    const label=Buffer.from('<svg width="384" height="28"><rect width="384" height="28" fill="white"/><text x="8" y="20" font-family="Arial" font-size="16">'+id+'</text></svg>');
    tiles.push({input:thumb,left:(i%3)*384,top:Math.floor(i/3)*182},{input:label,left:(i%3)*384,top:Math.floor(i/3)*182+154});
    report.push({id,bytes:buffer.length,alpha,sha256:hash});
  }
  await sharp({create:{width:1152,height:Math.ceil(ids.length/3)*182,channels:3,background:'#ffffff'}}).composite(tiles).png().toFile(path.join(out,'banner-contact.png'));
  fs.writeFileSync(path.join(out,'banner-assets.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS 21 pet banners + 4 rank overlays: unique, 1280x512, <250KB, prompt provenance, nonblank, native-alpha center tolerance, fallback text colors >=4.5:1. Artwork contrast requires the rendered audit; strict zero-alpha residue is not claimed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
