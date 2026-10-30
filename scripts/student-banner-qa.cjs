const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('sharp');
const luma=rgb=>rgb.map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(luma(a),luma(b))+.05)/(Math.min(luma(a),luma(b))+.05);
module.exports=async function auditStudentBanners({page,out,capture}){
  const originalName=await page.locator('#sNameDisp').textContent();
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.student-identity').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','no opaque identity panel');
  assert.equal(await page.locator('.student-banner-header .student-roster-details').count(),0,'roster is outside artwork');
  const pets=await page.evaluate(()=>studentBannerCatalog.pets),levels=[0,10,20,30,40],rows=[];
  const tileWidth=358,tileHeight=216,tiles=[];
  for(const [index,petId] of pets.entries())for(const [column,level] of levels.entries()){
    await page.evaluate(({petId,level})=>{studentPet={pet_id:petId,pet_name:'สัตว์เลี้ยงทดสอบ'};updateGamiUI({level,totalPoints:level*5,pointsInLevel:0});renderStudentPet(studentPet,level);},{petId,level});
    await page.waitForFunction(({petId,level})=>studentSection.dataset.petTheme===petId&&levelCard.dataset.rank===String(Math.min(4,Math.floor(level/10)))&&studentBannerArt.complete&&!studentBannerArt.hidden&&(!level||studentRankArt.complete&&!studentRankArt.hidden)&&Array.from(studentAvatar.querySelectorAll('img')).every(img=>img.complete&&img.naturalWidth>0),{petId,level});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const rects=await page.evaluate(()=>{
      const header=document.querySelector('.student-banner-header').getBoundingClientRect();
      const selectors=['#sNameDisp','#levelRing','#shopCoinsBadge','.student-wallet>span'];
      return selectors.flatMap(selector=>{const el=document.querySelector(selector),range=document.createRange();range.selectNodeContents(el);return Array.from(range.getClientRects()).map(r=>({selector,x:r.x-header.x,y:r.y-header.y,width:r.width,height:r.height,color:getComputedStyle(el).color.match(/[\d.]+/g).slice(0,3).map(Number)}));});
    });
    const banner=page.locator('.student-banner-header');
    const front=await banner.screenshot({animations:'disabled'});
    await page.locator('.student-identity').evaluate(el=>{el.style.visibility='hidden';});
    const back=await banner.screenshot({animations:'disabled'});
    await page.locator('.student-identity').evaluate(el=>{el.style.visibility='';});
    const fg=await sharp(front).removeAlpha().raw().toBuffer({resolveWithObject:true}),bg=await sharp(back).removeAlpha().raw().toBuffer({resolveWithObject:true});
    let count=0,fail=0,min=21;const failingSelectors={};
    for(const rect of rects)for(let y=Math.max(0,Math.ceil(rect.y));y<Math.min(fg.info.height,rect.y+rect.height);y++)for(let x=Math.max(0,Math.ceil(rect.x));x<Math.min(fg.info.width,rect.x+rect.width);x++){
      const offset=(y*fg.info.width+x)*3,p=Array.from(fg.data.subarray(offset,offset+3)),b=Array.from(bg.data.subarray(offset,offset+3));
      const ink=Math.hypot(...p.map((c,i)=>c-rect.color[i])),difference=Math.hypot(...p.map((c,i)=>c-b[i]));
      if(difference<40||ink>difference*.3)continue;
      const value=contrast(rect.color,b);count++;min=Math.min(min,value);if(value<4.5){fail++;failingSelectors[rect.selector]=(failingSelectors[rect.selector]||0)+1;}
    }
    rows.push({petId,level,coreGlyphPixels:count,minimumContrast:min,below45:fail,failingFraction:fail/Math.max(1,count),failingSelectors});
    if(capture){
      const top=Math.floor(index/6)*6,row=index-top,sheet=Math.floor(index/6);
      const thumb=await sharp(front).resize(tileWidth,tileHeight-24,{fit:'contain',background:'#f6faf8'}).png().toBuffer();
      const label=Buffer.from('<svg width="358" height="24"><rect width="358" height="24" fill="white"/><text x="8" y="18" font-family="Arial" font-size="14">'+petId+' / Lv.'+level+'</text></svg>');
      if(!tiles[sheet])tiles[sheet]=[];tiles[sheet].push({input:thumb,left:column*tileWidth,top:row*tileHeight},{input:label,left:column*tileWidth,top:row*tileHeight+tileHeight-24});
    }
  }
  fs.writeFileSync(path.join(out,'banner-render-contrast.json'),JSON.stringify(rows,null,2)+'\n');
  if(capture)for(const [i,parts] of tiles.entries())await sharp({create:{width:tileWidth*5,height:Math.min(6,pets.length-i*6)*tileHeight,channels:3,background:'#fff'}}).composite(parts).png().toFile(path.join(out,'banner-matrix-'+(i+1)+'.png'));
  const issues=rows.filter(row=>row.failingFraction>.01);console.log('Rendered banner contrast candidates:',JSON.stringify(issues));
  assert.ok(rows.every(row=>row.coreGlyphPixels>100),'actual text sampled in every banner');
  for(const [petId,level,name,width,height,file] of [
    ['leafy',0,originalName,390,844,'prototype-leafy-0'],
    ['rocky',40,originalName,390,844,'prototype-rocky-40'],
    ['leafy',40,'เด็กหญิงชื่อยาวสำหรับทดสอบ นามสกุลยาวพิเศษสำหรับตรวจสอบการตัดบรรทัด',320,568,'prototype-long-320']
  ]){
    await page.setViewportSize({width,height});
    await page.evaluate(({petId,level,name})=>{sNameDisp.textContent=name;studentPet={pet_id:petId,pet_name:'สัตว์เลี้ยงทดสอบ'};updateGamiUI({level,totalPoints:level*5,pointsInLevel:0});renderStudentPet(studentPet,level);},{petId,level,name});
    await page.waitForFunction(id=>studentSection.dataset.petTheme===id&&studentBannerArt.complete&&!studentBannerArt.hidden,petId);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'long name reflows');
    assert.equal(await page.locator('#sNameDisp').evaluate(el=>el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1),false,'full name is not clipped');
    if(capture)await page.screenshot({path:path.join(out,file+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(name=>{sNameDisp.textContent=name;},originalName);
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
  assert.equal(await page.locator('.student-identity').evaluate(el=>getComputedStyle(el).gridRowStart),'2','large text uses stacked composition');
  const artHeight=await page.locator('#studentBannerArt').evaluate(el=>el.getBoundingClientRect().height);assert.ok(artHeight<=145,'art does not grow with scaled text');
  if(capture)await page.screenshot({path:path.join(out,'prototype-text-zoom.png'),fullPage:true});
  await page.evaluate(()=>document.documentElement.style.fontSize='');
  await page.route('**/leafy.webp?fixture-fail',route=>route.abort());
  await page.evaluate(()=>setStudentBannerImage(studentBannerArt,'./assets/student-banners/leafy.webp?fixture-fail'));
  await page.waitForFunction(()=>studentBannerArt.complete&&studentBannerArt.hidden);
  assert.equal(await page.locator('#sNameDisp').isVisible(),true,'missing image keeps identity');
  await page.evaluate(()=>{studentBannerKey='';renderStudentBanner();});await page.waitForFunction(()=>studentBannerArt.complete&&!studentBannerArt.hidden);
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.deepEqual(issues,[],'rendered text/artwork interference needs correction and visual review');
  console.log('PASS all21pet x5rank banner renders, transparent identity/roster separation, long-name reflow, stacked200%text, bounded artwork and missing-image fallback; inspect pixel contrast report and matrix as visual evidence.');
};
