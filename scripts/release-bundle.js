import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const folders=['assets','bin','src','schemas','python/src','.agents/skills/keeproot','fixtures/product-demo'];
const files=['package.json','python/pyproject.toml','install-atlas.ps1','start-preview.ps1','Install-Keeproot.cmd','Update-Keeproot.cmd','README.md',
 'scripts/runtime-manager.js','scripts/update-ui-shortcut.ps1','scripts/setup-keeproot.ps1','scripts/install-desktop-component.js','scripts/release-bundle.js','scripts/demo.js',
 'docs/Atlas V1 产品说明书.md','docs/Atlas V1 使用说明书.md','docs/Atlas V1 验收指南.md','fixtures/local-module/uppercase-prefix.json'];
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const allowed=relative=>files.includes(relative)||folders.some(folder=>relative.startsWith(folder+'/'));
function plainPath(root,relative){
 if(typeof relative!=='string'||!relative||relative.includes('\\')||relative.includes(':')||relative.includes('\0')||relative.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Release file path is outside the package.');
 if(!allowed(relative))throw Error('Release file path is not in the distribution list.');
 const target=path.resolve(root,...relative.split('/'));
 let cursor=root;
 if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Release root cannot be linked.');
 for(const part of relative.split('/')){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Release file path cannot be linked.');}
 if(!fs.lstatSync(target).isFile())throw Error('Release file is not a regular file.');
 return target;
}
function list(root){
 const result=[];
 const visit=(directory)=>{
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   if(entry.name==='__pycache__'||entry.isFile()&&/\.py[co]$/u.test(entry.name))continue;
   const file=path.join(directory,entry.name);
   if(entry.isSymbolicLink())throw Error('Distribution files cannot be linked.');
   if(entry.isDirectory())visit(file);
   else if(entry.isFile())result.push(path.relative(root,file).replaceAll('\\','/'));
   else throw Error('Distribution contains an unsupported file.');
  }
 };
 for(const folder of folders)visit(path.join(root,folder));
 for(const file of files){plainPath(root,file);result.push(file);}
 return result.sort();
}

export function verifyReleaseBundle(directory){
 const root=path.resolve(directory),file=path.join(root,'keeproot-release.json');
 if(fs.lstatSync(file).isSymbolicLink())throw Error('Release manifest cannot be linked.');
 if(fs.statSync(file).size>512*1024)throw Error('Release manifest is too large.');
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 if(manifest.format!=='keeproot-windows-release.v1'||!Array.isArray(manifest.files)||manifest.files.length>5000)throw Error('Release manifest is incompatible.');
 const seen=new Set();
 for(const entry of manifest.files){
  const source=plainPath(root,entry.path);
  if(seen.has(entry.path)||!/^[a-f0-9]{64}$/u.test(entry.sha256)||fs.statSync(source).size!==entry.bytes||digest(source)!==entry.sha256)throw Error('Release file Hash changed: '+entry.path);
  seen.add(entry.path);
 }
 if(JSON.stringify([...seen].sort())!==JSON.stringify(list(root)))throw Error('Release file list changed.');
 if(crypto.createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex')!==manifest.build)throw Error('Release build Hash changed.');
 if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version!==manifest.version)throw Error('Release version changed.');
 return manifest;
}

export function buildReleaseBundle({sourceRoot,outputRoot,archive=true}){
 const source=path.resolve(sourceRoot),output=path.resolve(outputRoot);
 const relativeFiles=list(source);
 fs.mkdirSync(output,{recursive:true});
 const directory=fs.mkdtempSync(path.join(output,'keeproot-windows-'));
 for(const relative of relativeFiles){
  const input=plainPath(source,relative),target=path.join(directory,...relative.split('/'));
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(input,target);
 }
 const manifest={format:'keeproot-windows-release.v1',version:JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8')).version,
  files:relativeFiles.map(relative=>({path:relative,bytes:fs.statSync(path.join(directory,relative)).size,sha256:digest(path.join(directory,relative))}))};
 manifest.build=crypto.createHash('sha256').update(JSON.stringify(manifest.files)).digest('hex');
 fs.writeFileSync(path.join(directory,'keeproot-release.json'),JSON.stringify(manifest,null,2)+'\n');
 verifyReleaseBundle(directory);
 if(!archive)return {directory,manifest};
 if(process.platform!=='win32')throw Error('Build the Windows ZIP on Windows; the staged package was retained.');
 const zip=path.join(output,`keeproot-windows-${manifest.version}-${manifest.build.slice(0,12)}.zip`);
 if(fs.existsSync(zip))throw Error('Preserve the existing Release ZIP.');
 const script=path.join(directory,'create-zip.ps1');
 fs.writeFileSync(script,"param([string]$Root,[string]$Target)\n$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n[IO.Compression.ZipFile]::CreateFromDirectory($Root,$Target,[IO.Compression.CompressionLevel]::Optimal,$false)\n");
 // Keep this technical helper outside the ZIP and use the staged distribution as its input.
 const helper=path.join(output,`create-zip-${manifest.build.slice(0,12)}.ps1`);fs.renameSync(script,helper);
 const archived=spawnSync('powershell.exe',['-NoProfile','-File',helper,'-Root',directory,'-Target',zip],{encoding:'utf8',windowsHide:true,timeout:60000});
 if(archived.status!==0||archived.error)throw Error(archived.error?.message??archived.stderr);
 const sha256=digest(zip);fs.writeFileSync(zip+'.sha256',sha256+'  '+path.basename(zip)+'\n',{flag:'wx'});
 return {directory,zip,sha256,manifest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  if(process.argv[2]==='--verify'){
   const manifest=verifyReleaseBundle(process.argv[3]);console.log(JSON.stringify({status:'verified',version:manifest.version,build:manifest.build,files:manifest.files.length}));
  }else if(process.argv[2]==='--output'){
   const bundle=buildReleaseBundle({sourceRoot:path.resolve(path.dirname(process.argv[1]),'..'),outputRoot:process.argv[3]});
   console.log(JSON.stringify({...bundle,manifest:{version:bundle.manifest.version,build:bundle.manifest.build,files:bundle.manifest.files.length}}));
  }else throw Error('Use --output <local directory> or --verify <extracted Release directory>.');
 }catch(error){console.error(JSON.stringify({status:'failed',message:error.message}));process.exitCode=1;}
}
