import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const root=path.resolve('.'),powershell=path.join(process.env.SystemRoot ?? 'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
function ps(code){return spawnSync(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-Command','[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); '+code],{encoding:'utf8',windowsHide:true,timeout:30000});}
function fixture(){const scope=path.join(root,'test/.tmp/v20-network-launcher-20261010/shortcuts',crypto.randomUUID());const home=path.join(scope,'用户 Keeproot'),menu=path.join(scope,'Programs');fs.mkdirSync(path.join(home,'runtime','assets'),{recursive:true});fs.mkdirSync(menu);fs.writeFileSync(path.join(home,'atlas-ui.ps1'),'# fixture wrapper; never launched');fs.copyFileSync(path.join(root,'assets','keeproot.ico'),path.join(home,'runtime','assets','keeproot.ico'));fs.writeFileSync(path.join(home,'atlas-install.json'),JSON.stringify({install_format:'atlas-runtime-install.v1',runtime_path:path.join(home,'runtime')}));return {home,menu,scope};}
function createLink(file,wrapper,target=powershell){const args='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+wrapper+'"';const result=ps('$shell=New-Object -ComObject WScript.Shell; $link=$shell.CreateShortcut('+quote(file)+'); $link.TargetPath='+quote(target)+'; $link.Arguments='+quote(args)+'; $link.Description="fixture"; $link.Save()');assert.equal(result.status,0,result.stderr);}
function readLink(file){const result=ps('$shell=New-Object -ComObject WScript.Shell; $link=$shell.CreateShortcut('+quote(file)+'); [pscustomobject]@{target=$link.TargetPath;arguments=$link.Arguments;icon=$link.IconLocation;working=$link.WorkingDirectory;description=$link.Description} | ConvertTo-Json -Compress');assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
function update(f){return spawnSync(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(root,'scripts','update-ui-shortcut.ps1'),'-InstallRoot',f.home,'-ShortcutRoot',f.menu],{encoding:'utf8',windowsHide:true,timeout:30000});}

test('shortcut removal deletes only this installation entries and preserves foreign shortcut bytes', {skip:process.platform!=='win32',timeout:30000},()=>{
 const f=fixture(),old=path.join(f.menu,'Atlas UI.lnk'),current=path.join(f.menu,'Keeproot.lnk');
 createLink(old,path.join(f.home,'atlas-ui.ps1'));createLink(current,path.join(f.scope,'another','atlas-ui.ps1'));const foreign=fs.readFileSync(current);
 const removed=spawnSync(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(root,'scripts','update-ui-shortcut.ps1'),'-InstallRoot',f.home,'-ShortcutRoot',f.menu,'-Remove'],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(removed.status,0,removed.stderr);assert.equal(fs.existsSync(old),false);assert.deepEqual(fs.readFileSync(current),foreign);
});

test('PowerShell installer creates one Keeproot entry, respects no-shortcut and retains state on uninstall', {skip:process.platform!=='win32',timeout:60000},()=>{
 const scope=path.join(root,'test/.tmp/v20-host-onboarding-20261013/installer-'+crypto.randomUUID()),home=path.join(scope,'Install'),skill=path.join(scope,'Skill'),menu=path.join(scope,'Programs');fs.mkdirSync(menu,{recursive:true});
 const call=(command,extra=[])=>spawnSync(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(root,'install-atlas.ps1'),'-Command',command,'-InstallRoot',home,'-SkillRoot',skill,'-NodePath',process.execPath,'-ShortcutRoot',menu,...extra],{encoding:'utf8',windowsHide:true,timeout:30000});
 let result=call('install');assert.equal(result.status,0,result.stderr);assert.deepEqual(fs.readdirSync(menu),['Keeproot.lnk']);
 const link=readLink(path.join(menu,'Keeproot.lnk'));assert.equal(link.description,'Keeproot');assert.equal(link.icon,path.join(home,'runtime','assets','keeproot.ico')+',0');
 const marker=path.join(home,'state','retained-fixture.txt');fs.writeFileSync(marker,'keep state');const before=fs.readFileSync(path.join(menu,'Keeproot.lnk'));
 result=call('upgrade',['-NoStartMenuShortcut']);assert.equal(result.status,0,result.stderr);assert.deepEqual(fs.readFileSync(path.join(menu,'Keeproot.lnk')),before);assert.equal(fs.readFileSync(marker,'utf8'),'keep state');
 result=call('uninstall');assert.equal(result.status,0,result.stderr);assert.deepEqual(fs.readdirSync(menu),[]);assert.equal(fs.readFileSync(marker,'utf8'),'keep state');
});

test('Keeproot ICO contains usable Windows sizes and the existing K spine/branch geometry',()=>{
 const ico=fs.readFileSync(path.join(root,'assets','keeproot.ico'));assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);const count=ico.readUInt16LE(4),sizes=[];
 for(let i=0;i<count;i++){const entry=6+i*16,size=ico[entry]||256,offset=ico.readUInt32LE(entry+12),bytes=ico.readUInt32LE(entry+8);sizes.push(size);assert.ok(offset+bytes<=ico.length);assert.equal(ico.readUInt16LE(entry+6),32);assert.equal(ico.readInt32LE(offset+4),size);assert.equal(ico.readInt32LE(offset+8),size*2);
  if(size===32){const pixel=(x,y)=>Array.from(ico.subarray(offset+40+((size-1-y)*size+x)*4,offset+40+((size-1-y)*size+x)*4+4));assert.ok(pixel(8,16)[0]>200,'K spine');assert.ok(pixel(23,6)[0]>200,'K upper branch');assert.ok(pixel(23,25)[0]>200,'K lower branch');assert.ok(pixel(16,5)[0]<100,'gap away from branches');assert.equal(pixel(0,0)[3],0);}
 }
 assert.deepEqual(sizes,[16,24,32,48,64,128,256]);assert.equal(fs.readFileSync(path.join(root,'assets','atlas.ico')).length,4286,'legacy output retained');
});

test('real WScript shortcut renames only owned legacy entry, uses K icon and keeps the same hidden wrapper', {skip:process.platform!=='win32',timeout:30000},()=>{
 const f=fixture(),old=path.join(f.menu,'Atlas UI.lnk'),current=path.join(f.menu,'Keeproot.lnk'),wrapper=path.join(f.home,'atlas-ui.ps1');createLink(old,wrapper);const result=update(f);assert.equal(result.status,0,result.stderr);assert.equal(fs.existsSync(old),false);const link=readLink(current);assert.equal(link.target.toLowerCase(),powershell.toLowerCase());assert.equal(link.arguments,'-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+wrapper+'"');assert.equal(link.icon,path.join(f.home,'runtime','assets','keeproot.ico')+',0');assert.equal(link.working,f.home);assert.equal(link.description,'Keeproot');const again=update(f);assert.equal(again.status,0,again.stderr);assert.deepEqual(readLink(current),link);
});

test('foreign Keeproot entry is refused; another installation Atlas UI entry remains byte-for-byte', {skip:process.platform!=='win32',timeout:30000},()=>{
 const f=fixture(),old=path.join(f.menu,'Atlas UI.lnk'),current=path.join(f.menu,'Keeproot.lnk'),foreignWrapper=path.join(f.scope,'other','atlas-ui.ps1');createLink(old,foreignWrapper);const before=fs.readFileSync(old);let result=update(f);assert.equal(result.status,0,result.stderr);assert.deepEqual(fs.readFileSync(old),before);createLink(current,foreignWrapper);const foreign=fs.readFileSync(current);result=update(f);assert.notEqual(result.status,0);assert.match(result.stderr,/refusing overwrite/u);assert.deepEqual(fs.readFileSync(current),foreign);assert.deepEqual(fs.readFileSync(old),before);
});

test('launcher display uses Keeproot while Atlas technical identity and isolated-root boundary remain',()=>{
 const install=fs.readFileSync(path.join(root,'src/runtime-install.js'),'utf8'),manager=fs.readFileSync(path.join(root,'scripts/runtime-manager.js'),'utf8');assert.match(install,/Keeproot could not start\. Run atlas ui doctor/u);assert.match(install,/\$message, 'Keeproot', 'OK', 'Error'/u);assert.match(install,/atlas\.cmd/u);assert.match(install,/atlas-ui\.ps1/u);assert.match(manager,/path\.resolve\(options\.installRoot\)\.toLowerCase\(\) === path\.resolve\(defaultInstallRoot\(\)\)\.toLowerCase\(\)/u);assert.match(manager,/windowsHide:\s*true/u);assert.match(manager,/'-WindowStyle','Hidden'/u);
});
