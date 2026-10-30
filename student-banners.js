/* Cosmetic rank is independent of the existing pet evolution and economy. */
var studentBannerCatalog=null, studentBannerCatalogPromise=null, studentBannerKey='';
var studentBannerLastRank=null, studentBannerAnimation=null, studentBannerOwner='';
function studentBannerRank(level){return Math.min(4,Math.floor(Math.max(0,Number(level)||0)/10));}
function studentThemeMix(hex,white){
  if(!/^#[0-9a-f]{6}$/i.test(hex))hex='#176b60';
  var n=parseInt(hex.slice(1),16), channels=[n>>16,(n>>8)&255,n&255];
  return '#'+channels.map(function(channel){return Math.round(channel*(1-white)+255*white).toString(16).padStart(2,'0');}).join('');
}
function loadStudentBannerCatalog(){
  if(studentBannerCatalogPromise)return studentBannerCatalogPromise;
  studentBannerCatalogPromise=fetch('./assets/student-banners/manifest.json').then(function(response){if(!response.ok)throw new Error('Banner catalog unavailable');return response.json();})
    .then(function(catalog){if(!catalog || !Array.isArray(catalog.pets))throw new Error('Invalid banner catalog');studentBannerCatalog=catalog;return catalog;})
    .catch(function(){studentBannerCatalogPromise=null;return null;});
  return studentBannerCatalogPromise;
}
function setStudentBannerImage(image,url){
  var rankFrame=image.id==='studentRankArt'?document.getElementById('studentRankFrame'):null;
  if(!url){image.hidden=true;image.removeAttribute('src');if(rankFrame)rankFrame.style.removeProperty('--student-rank-image');return;}
  if(image.getAttribute('src')===url)return;
  image.hidden=true;
  image.onload=function(){if(image.getAttribute('src')===url && CU.role==='STUDENT'){if(rankFrame)rankFrame.style.setProperty('--student-rank-image','url("'+url+'")');image.hidden=false;}};
  image.onerror=function(){if(image.getAttribute('src')!==url)return;image.hidden=true;image.removeAttribute('src');if(rankFrame)rankFrame.style.removeProperty('--student-rank-image');studentBannerKey='';};
  image.src=url;
}
async function renderStudentBanner(){
  if(CU.role!=='STUDENT')return;
  var owner=studentUiIdentity(), petId=studentPet && studentPet.pet_id, level=getCurrentStudentLevel(), rank=studentBannerRank(level);
  var section=document.getElementById('studentSection'), card=document.getElementById('levelCard');
  if(!card)return;
  if(!profileFrameCatalog || !studentBannerCatalog){
    await Promise.all([loadProfileFrameCatalog(),loadStudentBannerCatalog()]);
    if(CU.role!=='STUDENT' || owner!==studentUiIdentity() || petId!==(studentPet && studentPet.pet_id) || level!==getCurrentStudentLevel())return;
  }
  var frame=profileFrameCatalog && profileFrameCatalog.frames.find(function(item){return item.petId===petId;});
  var theme=frame?frame.color:'#176b60';
  section.style.setProperty('--student-page-bg',studentThemeMix(theme,.97-rank*.035));
  // Darken the pet accent for readable text and progress on light artwork.
  var rgb=parseInt(theme.slice(1),16);
  section.style.setProperty('--student-accent','#'+[rgb>>16,(rgb>>8)&255,rgb&255].map(function(c){return Math.round(c*.48).toString(16).padStart(2,'0');}).join(''));
  section.dataset.petTheme=frame?petId:'none';card.dataset.rank=String(rank);
  var key=owner+':'+(frame?petId:'none')+':'+rank;
  if(key===studentBannerKey)return;
  var promoted=studentBannerOwner===owner && studentBannerLastRank!==null && rank>studentBannerLastRank;
  studentBannerKey=key;studentBannerOwner=owner;studentBannerLastRank=rank;
  var hasArt=frame && studentBannerCatalog && studentBannerCatalog.pets.indexOf(petId)!==-1;
  setStudentBannerImage(document.getElementById('studentBannerArt'),hasArt?'./assets/student-banners/'+petId+'.webp':'');
  setStudentBannerImage(document.getElementById('studentRankArt'),rank && studentBannerCatalog?'./assets/student-banners/rank-'+(rank*10)+'.webp':'');
  if(promoted && !matchMedia('(prefers-reduced-motion: reduce)').matches){
    card.classList.remove('student-banner-level-up');void card.offsetWidth;card.classList.add('student-banner-level-up');
    clearTimeout(studentBannerAnimation);studentBannerAnimation=setTimeout(function(){card.classList.remove('student-banner-level-up');},750);
  }
}
function resetStudentBanner(){
  clearTimeout(studentBannerAnimation);studentBannerKey='';studentBannerLastRank=null;studentBannerOwner='';
  var card=document.getElementById('levelCard');if(card)card.classList.remove('student-banner-level-up');
  ['studentBannerArt','studentRankArt'].forEach(function(id){var image=document.getElementById(id);if(image){image.onload=null;image.onerror=null;image.hidden=true;image.removeAttribute('src');}});
  var rankFrame=document.getElementById('studentRankFrame');if(rankFrame)rankFrame.style.removeProperty('--student-rank-image');
  var section=document.getElementById('studentSection');if(section){section.style.removeProperty('--student-page-bg');section.style.removeProperty('--student-accent');delete section.dataset.petTheme;}
}
if(typeof document!=='undefined'){
  document.addEventListener('DOMContentLoaded',function(){if(CU.role==='STUDENT')renderStudentBanner();});
  window.addEventListener('pagehide',function(){clearTimeout(studentBannerAnimation);});
}
if(typeof module!=='undefined' && module.exports)module.exports={studentBannerRank:studentBannerRank,studentThemeMix:studentThemeMix};
