import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildReleaseBundle, verifyReleaseBundle } from '../scripts/release-bundle.js';
import { installRuntime, locateInstalledRuntime } from '../src/runtime-install.js';
import { Registry } from '../src/registry.js';
import crypto from 'node:crypto';

test('Windows Release contains only distribution files; modified and escaped files are refused before installation', t => {
 fs.mkdirSync('test/.tmp',{recursive:true});
 const root=fs.mkdtempSync(path.resolve('test/.tmp/windows-release-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:50}));
 const bundle=buildReleaseBundle({sourceRoot:path.resolve('.'),outputRoot:root,archive:false});
 const manifest=verifyReleaseBundle(bundle.directory);
 assert.ok(manifest.files.some(file=>file.path==='.agents/skills/keeproot/SKILL.md'));
 assert.ok(manifest.files.some(file=>file.path==='assets/keeproot.ico'));
 assert.ok(manifest.files.some(file=>file.path==='fixtures/product-demo/本期.csv'));
 assert.ok(manifest.files.some(file=>file.path==='fixtures/local-module/uppercase-prefix.json'));
 assert.ok(!manifest.files.some(file=>/^(?:AGENTS\.md|\.atlas\/|test\/|docs\/Atlas 当前开发|\.codex\/)/u.test(file.path)));
 const file=path.join(bundle.directory,'src/ui/client.js'),previous=fs.readFileSync(file);
 fs.appendFileSync(file,'\nchanged');assert.throws(()=>verifyReleaseBundle(bundle.directory),/changed|Hash/iu);fs.writeFileSync(file,previous);
 const manifestFile=path.join(bundle.directory,'keeproot-release.json');
 const original=fs.readFileSync(manifestFile),escaped=JSON.parse(original);
 escaped.files.push({path:'../outside.txt',sha256:'a'.repeat(64)});
 fs.writeFileSync(manifestFile,JSON.stringify(escaped));assert.throws(()=>verifyReleaseBundle(bundle.directory),/path|outside/iu);fs.writeFileSync(manifestFile,original);
 assert.equal(verifyReleaseBundle(bundle.directory).version,manifest.version);
});

test('Desktop setup failure does not initialize or rewrite the existing Project database', {skip:process.platform!=='win32'}, t=>{
 const root=fs.mkdtempSync(path.resolve('test/.tmp/windows-desktop-state-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:50}));
 const installRoot=path.join(root,'install'),skillRoot=path.join(root,'skill');
 installRuntime({sourceRoot:path.resolve('.'),installRoot,skillRoot,nodePath:process.execPath});
 const registry=new Registry({stateDir:path.join(installRoot,'state')});
 registry.create({name:'Keep this Project',currentPath:'example'});registry.dispose();
 const database=path.join(installRoot,'state/ledger.sqlite');
 const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(database)).digest('hex');
 const before=hash();
 const attempt=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
  ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('install-atlas.ps1'),'-Command','upgrade','-InstallRoot',installRoot,'-SkillRoot',skillRoot,'-NodePath',process.execPath,'-DesktopPythonPath',path.join(root,'missing-python.exe'),'-NoStartMenuShortcut'],
  {encoding:'utf8',windowsHide:true,timeout:30000});
 assert.notEqual(attempt.status,0,'A missing interpreter must remain a failure.');
 assert.equal(hash(),before,'Installing a component must not open or mutate Project/Save/recovery state.');
});

test('Windows setup installs and updates the same isolated Runtime while preserving state, and rejects an invalid package', {skip:process.platform!=='win32'}, t=>{
 const root=fs.mkdtempSync(path.resolve('test/.tmp/windows-setup-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:50}));
 const first=buildReleaseBundle({sourceRoot:path.resolve('.'),outputRoot:path.join(root,'first'),archive:false});
 const installRoot=path.join(root,'安装');
 const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 const codexHome=path.join(root,'codex-home');
 const run=(bundle,mode)=>spawnSync(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(bundle.directory,'scripts/setup-keeproot.ps1'),'-Mode',mode,'-InstallRoot',installRoot,'-NodePath',process.execPath,'-RuntimeOnly','-NoStartMenuShortcut','-NoLaunch'],{encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,CODEX_HOME:codexHome}});
 const installed=run(first,'Install');assert.equal(installed.status,0,installed.stderr||installed.stdout);
 const before=locateInstalledRuntime(installRoot);assert.equal(before.status,'ready');assert.equal(before.manifest.skill_path,path.join(codexHome,'skills','keeproot'));
 const marker=path.join(installRoot,'state','user-data.txt');fs.writeFileSync(marker,'keep my data');
 const source=path.join(root,'next-source');fs.cpSync(first.directory,source,{recursive:true});fs.appendFileSync(path.join(source,'src/ui/client.js'),'\n// Next preview fixture.\n');
 const second=buildReleaseBundle({sourceRoot:source,outputRoot:path.join(root,'second'),archive:false});
 const updated=run(second,'Update');assert.equal(updated.status,0,updated.stderr||updated.stdout);
 const after=locateInstalledRuntime(installRoot);assert.equal(after.status,'ready');assert.notEqual(after.manifest.runtime_sha256,before.manifest.runtime_sha256);assert.equal(fs.readFileSync(marker,'utf8'),'keep my data');
 fs.appendFileSync(path.join(second.directory,'src/ui/client.js'),'\ninvalid');
 const invalid=run(second,'Update');assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/Hash|changed/iu);
 assert.equal(locateInstalledRuntime(installRoot).manifest.runtime_sha256,after.manifest.runtime_sha256);assert.equal(fs.readFileSync(marker,'utf8'),'keep my data');
});
