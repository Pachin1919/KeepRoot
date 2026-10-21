import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Registry } from '../src/registry.js';
import { createResourceControl } from '../src/resource-control.js';
import { Intake } from '../src/intake.js';
import { PreferenceRules } from '../src/preference-rules.js';
import { createModuleAvailabilityService } from '../src/module-availability.js';
import { startAtlasUiServer } from '../src/ui-server.js';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const actionFields=(html,action)=>{const form=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gu)].find(m=>m[1].includes('name="action" value="'+action+'"'));assert.ok(form,action);const params=new URLSearchParams();for(const m of form[1].matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gu))params.append(m[1],decode(m[2]));return params;};
const decode=v=>v.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
const fields=(html,action)=>{ const form=[...html.matchAll(/<form\b[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/gu)].find(m=>decode(m[1]).endsWith(action)); assert.ok(form,'form '+action); return Object.fromEntries([...form[2].matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gu)].map(m=>[m[1],decode(m[2])])); };

test('Project body search requires an explicit authorized index update, retains Reader return scope and excludes stale bodies', {timeout:30000}, async t=>{
 const f=await fixture(t,'bounded_content');
 const search=f.base+'/search?'+new URLSearchParams({q:'Content',scope:'body'});
 const unavailable=await f.get(search);
 assert.equal(unavailable.status,200);assert.match(unavailable.html,/body index is unavailable/u);
 assert.doesNotMatch(unavailable.html,/<a class="search-result"/u);
 const refresh=fields(unavailable.html,'/search-index');
 let response=await f.post(f.base+'/search-index',{...refresh,csrf:'wrong'});assert.equal(response.status,403);
 response=await f.post(f.base+'/search-index',refresh);assert.equal(response.status,303);
 const found=await f.get(response.headers.get('location'));
 assert.match(found.html,/<a class="search-result"/u);assert.match(found.html,/note.md/u);
 const href=decode(found.html.match(/<a class="search-result" href="([^"]+)"/u)[1]);
 const target=new URL(href,'http://atlas.local');assert.equal(target.searchParams.get('resource_id'),f.resourceId);assert.equal(target.searchParams.get('return_to'),search);
 const read=await f.get(href);assert.ok(read.html.includes('href="'+search.replaceAll('&','&amp;')+'"'));
 const editor=await f.get(f.base+'/resources/edit?'+new URLSearchParams({resource_id:f.resourceId,expected_sha256:hash(fs.readFileSync(f.file)),return_to:search}));
 assert.equal(fields(editor.html,'/edit/preview').return_to,search);
 fs.writeFileSync(f.file,'External change without the old term');
 const stale=await f.get(search);assert.doesNotMatch(stale.html,/<a class="search-result"/u);assert.match(stale.html,/sources changed externally or are missing/u);assert.match(stale.html,/Review sources and current versions/u);
 response=await f.post(f.base+'/search-index',fields(stale.html,'/search-index'));assert.equal(response.status,303);
 const current=await f.get(search);assert.doesNotMatch(current.html,/<a class="search-result"/u);
 fs.unlinkSync(f.file);const missing=await f.get(search);assert.doesNotMatch(missing.html,/<a class="search-result"/u);assert.match(missing.html,/sources changed externally or are missing/u);
 const assets=await f.get('/assets/codemirror/reader-editor.js');assert.equal(assets.status,200);
 assert.equal((await f.get('/assets/codemirror/../editor-entry.js')).status,404);
});

test('Body indexing keeps structure-only content permission and Reader return URLs reject foreign and normalized escape paths', {timeout:30000}, async t=>{
 const f=await fixture(t);
 const search=await f.get(f.base+'/search?q=Content&scope=body');
 const response=await f.post(f.base+'/search-index',fields(search.html,'/search-index'));assert.equal(response.status,409);assert.match(await response.text(),/does not authorize bounded content/u);
 for(const back of [f.base+'/files?dir=Notes',f.base+'/search?q=Content&scope=body']) {
   const editor=await f.get(f.base+'/resources/edit?'+new URLSearchParams({resource_id:f.resourceId,expected_sha256:hash(fs.readFileSync(f.file)),return_to:back}));
   assert.equal(fields(editor.html,'/edit/preview').return_to,back);
 }
 for(const back of ['/projects/'+f.projects[1].id+'/search?q=Content','//evil.test/x','javascript:alert(1)',f.base+'/resources/../search?q=Content',f.base+'/resources/%2e%2e/search',f.base+'/search%2fother',f.base+'/files\\other']) {
   const editor=await f.get(f.base+'/resources/edit?'+new URLSearchParams({resource_id:f.resourceId,expected_sha256:hash(fs.readFileSync(f.file)),return_to:back}));
   assert.equal(fields(editor.html,'/edit/preview').return_to,f.base+'/resources',back);
 }
});
async function fixture(t,contentPolicy='structure_only'){
 const root=fs.mkdtempSync(path.resolve('test/.tmp/toolbox-reader-')); const stateDir=path.join(root,'state'),workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
 const registry=new Registry({stateDir}); const adopted=registry.adoptRoot({rootPath:workspace,rootType:'project_workspace',contentPolicy});
 const projects=['A','B'].map(folder=>{fs.mkdirSync(path.join(workspace,folder));const p=registry.create({name:folder,currentPath:folder});registry.attachRoot(p.project_id,{rootId:adopted.root_id,relativePath:folder,reason:'UI fixture'});return registry.show(p.project_id).project;});
 const control=createResourceControl({stateDir,ledger:registry.ledger}), intake=new Intake({stateDir}),rules=new PreferenceRules({stateDir,ledger:registry.ledger});
 const file=path.join(workspace,'A','note.md');fs.writeFileSync(file,'# Original\nContent\n'); const csv=path.join(workspace,'A','data.csv');fs.writeFileSync(csv,'region,value\nNorth,20\nSouth,10\n'); const other=path.join(workspace,'B','other.txt');fs.writeFileSync(other,'B text');
 const identify=(file,project)=>control.identify({filePath:file,project}).resource_id;
 const resourceId=identify(file,projects[0]),tableId=identify(csv,projects[0]),otherId=identify(other,projects[1]);
 const server=await startAtlasUiServer({stateDir,registry,rules,intake,resourceControl:control,runtime:{},projectRoot:path.resolve('.'),installationRoot:path.resolve('.')});
 t.after(async()=>{await server.close();intake.dispose();control.dispose();registry.dispose();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:20});});
 const base='/projects/'+projects[0].id, back=base+'/resources?folder=Notes&resource_id='+resourceId+'&path=note.md';
 const get=async route=>{const response=await fetch(new URL(route,server.workspace_url));return {status:response.status,html:await response.text()};};
 const post=(route,values)=>fetch(new URL(route,server.workspace_url),{method:'POST',redirect:'manual',body:new URLSearchParams(values)});
 const edit=()=>get(base+'/resources/edit?'+new URLSearchParams({resource_id:resourceId,expected_sha256:hash(fs.readFileSync(file)),return_to:back}));
 return {root,stateDir,registry,projects,file,csv,resourceId,tableId,otherId,base,back,listBack:base+'/resources?folder=Notes',get,post,edit};
}
test('Toolbox chooses verified Project, refuses foreign IDs and paused module, and starts the existing Work review', {timeout:30000}, async t=>{
 const f=await fixture(t);const none=await f.get('/toolbox');assert.equal(none.status,200);assert.match(none.html,/Choose a Project/u);assert.match(none.html,/aria-disabled="true"/u);assert.match(none.html,/data-icon="toolbox"/u);
 const missing=await f.get('/toolbox?project_id=missing');assert.match(missing.html,/data-project-context="unavailable"/u);
 const chosen=await f.get('/toolbox?project_id='+f.projects[0].id);const form=fields(chosen.html,'/toolbox/start');assert.ok(chosen.html.includes(f.tableId));assert.ok(!chosen.html.includes('value="'+f.otherId+'"'));
 const start=values=>f.post(f.base+'/toolbox/start',{...form,resource_ids:f.tableId,tool:'pivot',...values});
 let response=await start({resource_ids:f.otherId});assert.equal(response.status,303);assert.match(response.headers.get('location'),/^\/toolbox/u);
 response=await start({csrf:'wrong'});assert.equal(response.status,403);
 const modules=createModuleAvailabilityService({stateDir:f.stateDir});let m=modules.get('atlas.table-work');modules.change({moduleId:m.module_id,enabled:false,expectedRevision:m.revision,requestKey:'pause',reason:'UI test'});
 response=await start({});assert.equal(response.status,303);const paused=await f.get('/toolbox?project_id='+f.projects[0].id);assert.match(paused.html,/processing is unavailable/u);assert.doesNotMatch(paused.html,/<form[^>]+toolbox\/start/u);
 m=modules.get('atlas.table-work');modules.change({moduleId:m.module_id,enabled:true,expectedRevision:m.revision,requestKey:'resume',reason:'UI test'});
 response=await start({});assert.equal(response.status,303);assert.equal(response.headers.get('location'),f.base+'/work/review');const review=await f.get(response.headers.get('location'));assert.match(review.html,/Pivot table/u);assert.match(review.html,/data.csv/u);
 const commit=fields(review.html,'/work/commit');response=await f.post(f.base+'/work/commit',{...commit,target:'new'});assert.equal(response.status,303);assert.match(response.headers.get('location'),/^\/work\/DWT-/u);
 const workHref=response.headers.get('location');const work=await f.get(workHref);assert.equal(work.status,200);assert.match(work.html,/toolbox-work-hint[^>]*>Pivot table/u);assert.match(work.html,/name="action" value="prepare_sources"/u);response=await f.post(workHref+'/action',actionFields(work.html,'prepare_sources'));assert.equal(response.status,303);const prepared=await f.get(workHref);assert.match(prepared.html,/name="action" value="confirm_mapping"/u);response=await f.post(workHref+'/action',actionFields(prepared.html,'confirm_mapping'));assert.equal(response.status,303);const aligned=await f.get(workHref);assert.match(aligned.html,/<details class="recipe-option" open><summary>[^<]*Pivot/u);
 const read=await f.get(f.base+'/resources/read?'+new URLSearchParams({resource_id:f.tableId,return_to:f.back}));assert.equal(read.status,200);assert.match(read.html,/Process and analyse table/u);assert.match(read.html,/Prepare AI handoff/u);const process=fields(read.html,'/toolbox/start');response=await f.post(f.base+'/toolbox/start',process);assert.equal(response.status,303);
 const readerReview=await f.get(response.headers.get('location'));
 const readerBack=[...readerReview.html.matchAll(/href="([^"]+)"/gu)]
   .map(match=>new URL(decode(match[1]),'http://atlas.local'))
   .find(url=>url.origin==='http://atlas.local'&&url.pathname===f.base+'/resources/read'&&url.searchParams.get('resource_id')===f.tableId);
 assert.ok(readerBack,'review links back to the selected Reader resource');
 assert.equal(readerBack.searchParams.get('return_to'),f.listBack,'nested return retains folder scope; Reader identity is separate');
 const cancel=fields(readerReview.html,'/work/cancel');response=await f.post(f.base+'/work/cancel',cancel);const cancelled=new URL(response.headers.get('location'),'http://atlas.local');assert.equal(cancelled.searchParams.get('resource_id'),f.tableId);assert.equal(cancelled.searchParams.get('return_to'),f.listBack);
 const settings=await f.get('/settings?project_id='+f.projects[0].id+'&return_to='+encodeURIComponent('/toolbox?project_id='+f.projects[0].id));const csrf=settings.html.match(/name="csrf" value="([^"]+)"/u)[1];response=await f.post('/settings?project_id='+f.projects[0].id,{csrf,action:'save',return_to:'/toolbox?project_id='+f.projects[0].id});assert.equal(new URL(response.headers.get('location'),'http://atlas.local').pathname,'/toolbox');
});
test('Reader full Unicode draft previews without writing, confirms same Resource, reads receipt and Undo', {timeout:30000}, async t=>{
 const f=await fixture(t), original=fs.readFileSync(f.file);const read=await f.get(f.base+'/resources/read?resource_id='+f.resourceId+'&return_to='+encodeURIComponent(f.back));assert.match(read.html,/Edit text/u);assert.match(read.html,/No related Table Work/u);assert.doesNotMatch(read.html,/<form[^>]+\/handoffs/u);
 const editor=await f.edit();assert.equal(editor.status,200);assert.match(editor.html,/data-draft-protect/u);assert.match(editor.html,/<textarea[^>]*name="text"/u);const form=fields(editor.html,'/edit/preview');assert.deepEqual(fs.readFileSync(f.file),original);
 const draft='更新材料。\n'.repeat(1600);assert.ok(Buffer.byteLength(draft)>8192);let response=await f.post(f.base+'/resources/edit/preview',{...form,text:draft});assert.equal(response.status,200);const preview=await response.text();assert.deepEqual(fs.readFileSync(f.file),original);assert.match(preview,/Current text/u);assert.match(preview,/Proposed text/u);assert.match(preview,/Save this text/u);const confirm=fields(preview,'/edit/confirm');
 response=await f.post(f.base+'/resources/edit/confirm',confirm);assert.equal(response.status,303);assert.equal(fs.readFileSync(f.file,'utf8'),draft);const target=new URL(response.headers.get('location'),'http://atlas.local');assert.equal(target.searchParams.get('resource_id'),f.resourceId);assert.equal(target.searchParams.get('return_to'),f.listBack);
 const saved=await f.get(response.headers.get('location'));assert.equal(saved.status,200);assert.match(saved.html,/Earlier Save receipts/u);assert.match(saved.html,/Undo text edit/u);const undo=fields(saved.html,'/edit/undo');response=await f.post(f.base+'/resources/edit/undo',undo);assert.equal(response.status,303);assert.deepEqual(fs.readFileSync(f.file),original);
 const emptyEditor=await f.edit();const emptyForm=fields(emptyEditor.html,'/edit/preview');response=await f.post(f.base+'/resources/edit/preview',{...emptyForm,text:''});assert.equal(response.status,200);const emptyPreview=await response.text();assert.match(emptyPreview,/Empty text/u);assert.deepEqual(fs.readFileSync(f.file),original);response=await f.post(f.base+'/resources/edit/confirm',fields(emptyPreview,'/edit/confirm'));assert.equal(response.status,303);assert.equal(fs.statSync(f.file).size,0);
});

test('Reader keeps a saved receipt through edit cancel, rejects foreign receipt context and replaces it after another save', {timeout:30000}, async t=>{
 const f=await fixture(t);
 let editor=await f.edit();let response=await f.post(f.base+'/resources/edit/preview',{...fields(editor.html,'/edit/preview'),text:'First saved\n'});
 let preview=await response.text();response=await f.post(f.base+'/resources/edit/confirm',fields(preview,'/edit/confirm'));
 const firstHref=response.headers.get('location'),firstId=new URL(firstHref,'http://atlas.local').searchParams.get('manual_update_id');assert.ok(firstId);
 const saved=await f.get(firstHref);const editHref=decode(saved.html.match(/href="([^"]+)" data-reader-inline-edit/u)[1]);
 assert.equal(new URL(editHref,'http://atlas.local').searchParams.get('reader_update_id'),firstId);
 editor=await f.get(editHref);assert.equal(editor.status,200);const editForm=fields(editor.html,'/edit/preview');assert.equal(editForm.reader_update_id,firstId);
 const back=[...editor.html.matchAll(/href="([^"]+)"/gu)].map(m=>new URL(decode(m[1]),'http://atlas.local')).find(url=>url.pathname===f.base+'/resources/read'&&url.searchParams.get('manual_update_id')===firstId);
 assert.ok(back);assert.equal(back.searchParams.get('resource_id'),f.resourceId);assert.equal(back.searchParams.get('return_to'),f.listBack);
 const cancelled=await f.get(back.pathname+back.search);assert.match(cancelled.html,/Undo text edit/u);
 for(const [base,id,sha] of [[f.base,f.tableId,hash(fs.readFileSync(f.csv))],['/projects/'+f.projects[1].id,f.otherId,hash(Buffer.from('B text'))]]) {
   const foreign=await f.get(base+'/resources/edit?'+new URLSearchParams({resource_id:id,expected_sha256:sha,reader_update_id:firstId}));
   assert.equal(foreign.status,409);assert.doesNotMatch(foreign.html,/<form[^>]+resources\/edit\/preview/u);
 }
 response=await f.post(f.base+'/resources/edit/preview',{...editForm,text:'Second saved\n'});assert.equal(response.status,200);preview=await response.text();
 const secondForm=fields(preview,'/edit/confirm');assert.equal(secondForm.reader_update_id,firstId);
 response=await f.post(f.base+'/resources/edit/confirm',secondForm);assert.equal(response.status,303);
 const secondHref=new URL(response.headers.get('location'),'http://atlas.local');assert.equal(secondHref.searchParams.getAll('manual_update_id').length,1);assert.notEqual(secondHref.searchParams.get('manual_update_id'),firstId);
 const secondSaved=await f.get(secondHref.pathname+secondHref.search);response=await f.post(f.base+'/resources/edit/undo',fields(secondSaved.html,'/edit/undo'));assert.equal(response.status,303);assert.equal(fs.readFileSync(f.file,'utf8'),'First saved\n');
});
test('Reader rejects CSRF, stale Hash and cross-Project manual refs, retains failed draft and handles no-op', {timeout:30000}, async t=>{
 const f=await fixture(t);let editor=await f.edit(),form=fields(editor.html,'/edit/preview');const original=fs.readFileSync(f.file);
 let response=await f.post(f.base+'/resources/edit/preview',{...form,csrf:'wrong',text:'draft'});assert.equal(response.status,403);assert.deepEqual(fs.readFileSync(f.file),original);
 response=await f.post(f.base+'/resources/edit/preview',{...form,text:original.toString()});assert.equal(response.status,303);assert.deepEqual(fs.readFileSync(f.file),original);
 response=await f.post(f.base+'/resources/edit/preview',{...form,resource_id:f.otherId,text:'foreign'});assert.equal(response.status,409);assert.deepEqual(fs.readFileSync(f.file),original);
 response=await f.post(f.base+'/resources/edit/preview',{...form,text:'proposed'});const preview=await response.text();assert.equal(response.status,200);const confirm=fields(preview,'/edit/confirm');response=await f.post('/projects/'+f.projects[1].id+'/resources/edit/confirm',{...confirm,resource_id:f.otherId});assert.equal(response.status,409);assert.deepEqual(fs.readFileSync(f.file),original);
 fs.writeFileSync(f.file,'External edit');response=await f.post(f.base+'/resources/edit/confirm',confirm);assert.equal(response.status,409);assert.equal(fs.readFileSync(f.file,'utf8'),'External edit');assert.match(await response.text(),/proposed/u);
 response=await f.post(f.base+'/resources/edit/preview',{...form,request_key:'stale-draft',text:'Preserved draft <unsafe>'});assert.equal(response.status,409);const failed=await response.text();assert.match(failed,/Preserved draft &lt;unsafe&gt;/u);assert.match(failed,/Reload current file/u);assert.equal(fs.readFileSync(f.file,'utf8'),'External edit');
 editor=await f.edit();form=fields(editor.html,'/edit/preview');response=await f.post(f.base+'/resources/edit/preview',{...form,text:'x'.repeat(256*1024+1)});assert.equal(response.status,409);assert.equal(fs.readFileSync(f.file,'utf8'),'External edit');
});

test('Reader keeps the same document readable when the local editor runtime is unavailable', {timeout:30000}, async t=>{
 const f=await fixture(t), original=fs.readFileSync(f.file);
 const prior=process.env.ATLAS_CONTENT_PYTHON;
 process.env.ATLAS_CONTENT_PYTHON=path.join(f.root,'unavailable-python.exe');
 t.after(()=>{if(prior==null)delete process.env.ATLAS_CONTENT_PYTHON;else process.env.ATLAS_CONTENT_PYTHON=prior;});
 const result=await f.edit();
 assert.equal(result.status,409);
 assert.match(result.html,/<h1\b[^>]*>Original<\/h1>/u);
 assert.match(result.html,/data-reader-edit-unavailable/u);
 assert.match(result.html,/data-reader-default-edit="false"/u);
 assert.doesNotMatch(result.html.slice(result.html.indexOf('<body')),/<form\b[^>]*data-reader-inline-edit/u);
 assert.match(result.html,new RegExp(`data-reader-resource-id="${f.resourceId}"`,'u'));
 assert.deepEqual(fs.readFileSync(f.file),original);
});

test('Reader source context opens one exact Resource without enumerating the Project tree', {timeout:30000}, async t=>{
 const f=await fixture(t), original=fs.readFileSync(f.file), projectRoot=path.dirname(f.file);
 const originalReadDir=fs.readdirSync;
 let treeReads=0;
 fs.readdirSync=function(directory,...args){
  if(path.resolve(String(directory)).toLowerCase()===projectRoot.toLowerCase())treeReads++;
  return originalReadDir.call(fs,directory,...args);
 };
 try {
  const read=await f.get(f.base+'/resources/read?'+new URLSearchParams({resource_id:f.resourceId,return_to:f.back}));
  assert.equal(read.status,200);
  assert.equal(treeReads,0,'ordinary Reader context must not browse the Project tree');
  assert.match(read.html,new RegExp(`data-context-resource-id="${f.resourceId}"`,'u'));
  assert.match(read.html,/content-location\?resource_id=/u);
  assert.match(read.html,/document-updates\/new\?resource_id=/u);
  assert.match(read.html,/document-update-batches\/new/u);
  assert.deepEqual(fs.readFileSync(f.file),original);
 } finally {fs.readdirSync=originalReadDir;}
});
