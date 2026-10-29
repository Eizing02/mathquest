const fs=require('node:fs');
const path=require('node:path');
const sharp=require('sharp');
async function main(){
  const source=path.resolve(__dirname,'../apple-touch-icon.png');
  const out=path.resolve(__dirname,'../assets/app-icons');
  const png={compressionLevel:9,palette:true,colours:256,quality:100,effort:8};
  fs.mkdirSync(out,{recursive:true});
  for(const size of [180,192,512]){
    await sharp(source).resize(size,size,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).png(png).toFile(path.join(out,'icon-'+size+'.png'));
  }
  const inset=await sharp(source).resize(356,356).flatten({background:'#ffffff'}).png().toBuffer();
  await sharp({create:{width:512,height:512,channels:3,background:'#ffffff'}}).composite([{input:inset,gravity:'centre'}]).png(png).toFile(path.join(out,'icon-maskable-512.png'));
  console.log('Prepared app icons from the existing logo; original untouched.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
