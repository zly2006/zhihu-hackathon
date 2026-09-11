import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root=process.cwd();
const sources={
  player:'../characters/npc-male-gentle/stages/npc-male-gentle__post-graduation.png',
  lin:'../characters/npc-female-bright/stages/npc-female-bright__post-graduation.png',
  tao:'../characters/npc-female-gentle/stages/npc-female-gentle__post-graduation.png',
  shen:'../characters/npc-female-proud/stages/npc-female-proud__post-graduation.png',
};

function isBackdrop(pixel){return pixel[0]>238&&pixel[1]>238&&pixel[2]>238;}
function transparentBackdrop(data,width,height){
  const seen=new Uint8Array(width*height),queue=[];
  const add=(x,y)=>{const at=y*width+x;if(!seen[at]&&isBackdrop(data.subarray(at*3,at*3+3))){seen[at]=1;queue.push(at);}};
  for(let x=0;x<width;x++){add(x,0);add(x,height-1);}for(let y=1;y<height-1;y++){add(0,y);add(width-1,y);}
  for(let cursor=0;cursor<queue.length;cursor++){
    const at=queue[cursor],x=at%width,y=Math.floor(at/width);
    if(x)add(x-1,y);if(x+1<width)add(x+1,y);if(y)add(x,y-1);if(y+1<height)add(x,y+1);
  }
  const rgba=Buffer.alloc(width*height*4);
  for(let at=0;at<width*height;at++){rgba[at*4]=data[at*3];rgba[at*4+1]=data[at*3+1];rgba[at*4+2]=data[at*3+2];rgba[at*4+3]=seen[at]?0:255;}
  return rgba;
}

await fs.mkdir(path.join(root,'public','art'),{recursive:true});
for(const [name,relative] of Object.entries(sources)){
  const source=path.resolve(root,relative),image=sharp(source),meta=await image.metadata();
  if(!meta.width||!meta.height)throw new Error(`无法读取 ${source}`);
  const raw=await image.removeAlpha().raw().toBuffer();
  const rgba=transparentBackdrop(raw,meta.width,meta.height);
  await sharp(rgba,{raw:{width:meta.width,height:meta.height,channels:4}}).webp({quality:88,alphaQuality:100}).toFile(path.join(root,'public','art',`${name}.webp`));
}
await sharp(path.join(root,'public','art','cafe-rain.png')).webp({quality:84}).toFile(path.join(root,'public','art','cafe-rain.webp'));
