const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('sharp');
const root=path.resolve(__dirname,'..');
async function main(){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'app.webmanifest'),'utf8'));
  assert.equal(manifest.name,'เช็คชื่อเข้าเรียนครูอี้');assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');
  assert.ok(manifest.icons.some(icon=>icon.sizes==='192x192'&&icon.purpose==='any'));
  assert.ok(manifest.icons.some(icon=>icon.sizes==='512x512'&&icon.purpose==='maskable'));
  for(const icon of manifest.icons.concat([{src:'./assets/app-icons/icon-180.png',sizes:'180x180'}])){
    const file=path.resolve(root,icon.src);assert.ok(file.startsWith(root+path.sep));
    const info=await sharp(file).metadata();assert.equal(info.width+'x'+info.height,icon.sizes);
    const stats=await sharp(file).stats();assert.ok(stats.channels.some(channel=>channel.stdev>20),'logo is not blank');
    assert.ok(fs.readFileSync(file).includes(Buffer.from('Origin: existing project logo')),'source provenance retained');
    assert.ok(fs.statSync(file).size<160000,'small runtime icon');
  }
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/rel="manifest" href="\.\/app.webmanifest"/);
  assert.match(html,/apple-touch-icon.*assets\/app-icons\/icon-180.png/);
  const code=fs.readFileSync(path.join(root,'student-install.js'),'utf8');
  assert.ok(!code.includes('serviceWorker.register'),'no caching of auth, scores or attendance RPCs');
  console.log('PASS manifest/app name, existing-logo derivatives 180/192/512 and maskable, nonblank images, payload/provenance, no service-worker cache');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
