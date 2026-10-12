#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_BRAND_MARK } from '../src/ui/brand.js';

const size = 32;
const rowBytes = size * 4;
const pixels = Buffer.alloc(rowBytes * size);

function insideMark(x, y) {
  const left = 8 + Math.floor((23 - y) * 0.28);
  const right = 23 - Math.floor((23 - y) * 0.28);
  const legs = y >= 7 && y <= 25 && (Math.abs(x - left) <= 1 || Math.abs(x - right) <= 1);
  const bar = y >= 17 && y <= 19 && x >= left && x <= right;
  return legs || bar;
}

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const offset = ((size - 1 - y) * size + x) * 4;
    const corner = Math.min(x, y, size - 1 - x, size - 1 - y);
    const visible = corner >= 4 || ((x >= 2 && x < 30) && (y >= 2 && y < 30));
    const mark = insideMark(x, y);
    pixels[offset] = mark ? 236 : 54;
    pixels[offset + 1] = mark ? 244 : 88;
    pixels[offset + 2] = mark ? 240 : 55;
    pixels[offset + 3] = visible ? 255 : 0;
  }
}

const bitmapHeader = Buffer.alloc(40);
bitmapHeader.writeUInt32LE(40, 0);
bitmapHeader.writeInt32LE(size, 4);
bitmapHeader.writeInt32LE(size * 2, 8);
bitmapHeader.writeUInt16LE(1, 12);
bitmapHeader.writeUInt16LE(32, 14);
bitmapHeader.writeUInt32LE(pixels.length, 20);
const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
const image = Buffer.concat([bitmapHeader, pixels, mask]);

const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = size;
entry[1] = size;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(image.length, 8);
entry.writeUInt32LE(header.length + entry.length, 12);

// Rasterize the existing straight-edged K paths; no second brand drawing.
function polygons(d) {
 const tokens=d.match(/[MLHVZmlhvz]|-?\d+(?:\.\d+)?/gu) ?? [];let i=0,command='',x=0,y=0,start=null,current=[],result=[];
 while(i<tokens.length){if(/^[a-z]$/iu.test(tokens[i]))command=tokens[i++];
  if(command.toLowerCase()==='z'){if(current.length)result.push(current);current=[];[x,y]=start;command='';continue;}
  const relative=command===command.toLowerCase(),kind=command.toLowerCase();
  if(kind==='m'||kind==='l'){let nx=Number(tokens[i++]),ny=Number(tokens[i++]);x=relative?x+nx:nx;y=relative?y+ny:ny;if(kind==='m'){start=[x,y];command=relative?'l':'L';}}
  else if(kind==='h'){const n=Number(tokens[i++]);x=relative?x+n:n;}else if(kind==='v'){const n=Number(tokens[i++]);y=relative?y+n:n;}else throw new Error('Unsupported product mark path command.');
  current.push([x,y]);
 }return result;
}
function contains(points,x,y){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function keeprootIcon() {
 const paths=[...UI_BRAND_MARK.matchAll(/<path d="([^"]+)"([^>]*)\/?>/gu)].map(m=>({polygons:polygons(m[1]),opacity:Number(m[2].match(/opacity="([^"]+)"/u)?.[1]??1)}));
 if(!paths.length)throw new Error('The product K paths are unavailable.');
 const sizes=[16,24,32,48,64,128,256],images=sizes.map(size=>{
  const pixels=Buffer.alloc(size*size*4),mask=Buffer.alloc(Math.ceil(size/32)*4*size),samples=4;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   let alpha=0,red=0,green=0,blue=0;
   for(let sy=0;sy<samples;sy++)for(let sx=0;sx<samples;sx++){
    const px=(x+(sx+.5)/samples)*30/size,py=(y+(sy+.5)/samples)*30/size;
    const cx=Math.max(3,Math.min(27,px)),cy=Math.max(3,Math.min(27,py));if((px-cx)**2+(py-cy)**2>9)continue;
    let cover=0;for(const mark of paths)if(mark.polygons.some(points=>contains(points,px,py)))cover=mark.opacity+cover*(1-mark.opacity);
    alpha++;red+=55+(240-55)*cover;green+=88+(244-88)*cover;blue+=54+(236-54)*cover;
   }
   const offset=((size-1-y)*size+x)*4;if(alpha){pixels[offset]=Math.round(blue/alpha);pixels[offset+1]=Math.round(green/alpha);pixels[offset+2]=Math.round(red/alpha);pixels[offset+3]=Math.round(alpha/samples**2*255);}else{const stride=Math.ceil(size/32)*4;mask[(size-1-y)*stride+Math.floor(x/8)]|=128>>(x%8);}
  }
  const header=Buffer.alloc(40);header.writeUInt32LE(40,0);header.writeInt32LE(size,4);header.writeInt32LE(size*2,8);header.writeUInt16LE(1,12);header.writeUInt16LE(32,14);header.writeUInt32LE(pixels.length,20);return Buffer.concat([header,pixels,mask]);
 });
 const header=Buffer.alloc(6);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=6+16*sizes.length;
 const entries=sizes.map((size,i)=>{const entry=Buffer.alloc(16);entry[0]=size===256?0:size;entry[1]=entry[0];entry.writeUInt16LE(1,4);entry.writeUInt16LE(32,6);entry.writeUInt32LE(images[i].length,8);entry.writeUInt32LE(offset,12);offset+=images[i].length;return entry;});return Buffer.concat([header,...entries,...images]);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 if(!process.argv.includes('--keeproot-only')){const output=path.join(root,'assets','atlas.ico');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,Buffer.concat([header,entry,image]));console.log(output);}
 const output=path.join(root,'assets','keeproot.ico');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,keeprootIcon());console.log(output);
}
