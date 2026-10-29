const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'assets/profile-frames');

async function main() {
  const [action, id, source] = process.argv.slice(2);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/pets/manifest.json'), 'utf8'));
  if (action === '--inspect-pets') {
    const layers = [];
    for (let index = 0; index < catalog.pets.length; index++) {
      const pet = catalog.pets[index];
      const sprite = await sharp(path.join(root, pet.sheet)).extract({left:0,top:724,width:362,height:362}).resize(150,150).png().toBuffer();
      layers.push({input:sprite,left:(index%7)*170+10,top:Math.floor(index/7)*190+10});
      const label = Buffer.from('<svg width="170" height="24"><text x="85" y="18" text-anchor="middle" font-family="Arial" font-size="16" fill="#18222e">'+pet.id+'</text></svg>');
      layers.push({input:label,left:(index%7)*170,top:Math.floor(index/7)*190+160});
    }
    const output = path.join(root, 'tmp/profile-frames/pet-colors.png');
    fs.mkdirSync(path.dirname(output), {recursive:true});
    await sharp({create:{width:1190,height:570,channels:4,background:'#f2f5f7'}}).composite(layers).png().toFile(output);
    console.log(output);
    return;
  }
  if (action !== '--import' || !catalog.pets.some(pet => pet.id===id) || !source) {
    throw new Error('Use --inspect-pets or --import <pet-id> <generated-png>');
  }
  const metadata = await sharp(source).metadata();
  if (!metadata.hasAlpha || Math.min(metadata.width,metadata.height)<768) throw new Error('High resolution RGBA source required');
  const {data,info} = await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const alpha = (x,y) => data[(Math.floor(y)*info.width+Math.floor(x))*4+3];
  if (alpha(info.width/2,info.height/2)>0 || alpha(0,0)>0) throw new Error('Photo aperture and outside must be genuinely transparent');
  fs.mkdirSync(path.join(destination,'masters'), {recursive:true});
  fs.copyFileSync(source,path.join(destination,'masters',id+'.png'));
  await sharp(source).resize(640,640,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}})
    .webp({quality:90,alphaQuality:100,effort:6}).toFile(path.join(destination,id+'.webp'));
  console.log(id+': '+metadata.width+'x'+metadata.height+' master, '+fs.statSync(path.join(destination,id+'.webp')).size+' bytes WebP');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
