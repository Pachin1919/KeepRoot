import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Registry } from '../src/registry.js';
import { SaveService } from '../src/save-service.js';
import { startAtlasUiServer } from '../src/ui-server.js';
import { createSavedWorkService } from '../src/ui/services/saved-work-service.js';
import { beginCurrentActivity, failCurrentActivity, readCurrentActivityState } from '../src/ui/current-activity.js';
import { renderActivityFragment } from '../src/ui/views/activity-view.js';
import vm from 'node:vm';

function fixture(t) {
 fs.mkdirSync('test/.tmp',{recursive:true});
 const dir=fs.mkdtempSync(path.resolve('test/.tmp/ui-navigation-performance-'));
 fs.mkdirSync(path.join(dir,'ui'));
 return dir;
}
const receipt=(id,project)=>({save_id:id,status:'executed',project:{id:project,name:project},target:{path:'example.md'},verification:{sha256:'a'.repeat(64)},created_at:'2026-10-14T00:00:00Z'});

test('Activity dismiss rejects an invalid token without removing the activity', async t => {
 const stateDir=fixture(t), registry=new Registry({stateDir});
 const activity=beginCurrentActivity({stateDir,filePath:path.join(stateDir,'item.txt')});
 failCurrentActivity({stateDir,activityId:activity.activity_id,error:new Error('failed')});
 const server=await startAtlasUiServer({stateDir,registry,rules:{},intake:{stateDir}});
 t.after(async()=>{await server.close();registry.dispose();fs.rmSync(stateDir,{recursive:true,force:true});});
 const response=await fetch(server.workspace_url+'activity/dismiss',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf:'invalid',activity_id:activity.activity_id})});
 assert.equal(response.status,403);
 assert.match(await response.text(),/session token is invalid/u);
 assert.equal(readCurrentActivityState(stateDir).items[0].activity_id,activity.activity_id);
 const html=await (await fetch(server.workspace_url+'activity')).text();
 const csrf=html.match(/name="csrf" value="([a-f0-9]+)"/u)?.[1]; assert.ok(csrf);
 const dismissed=await fetch(server.workspace_url+'activity/dismiss',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,activity_id:activity.activity_id})});
 assert.equal(dismissed.status,303);
 assert.equal(readCurrentActivityState(stateDir).items.length,0);
});

test('Projects loads one fresh Save projection per request, preserving each Project and user names', async t=>{
 const stateDir=fixture(t);
 const registry=new Registry({stateDir});
 const projects=['Atlas user project','Second','Third'].map(name=>({id:registry.create({name,currentPath:name}).project_id,name}));
 fs.writeFileSync(path.join(stateDir,'ui','saved-work.json'),JSON.stringify({items:[receipt('SAV-one',projects[0].id),receipt('SAV-two',projects[1].id)]}));
 const original=SaveService.prototype.projectRecord;
 let calls=0;
 SaveService.prototype.projectRecord=function(row){calls++;return row;};
 const server=await startAtlasUiServer({stateDir,registry,rules:{},intake:{stateDir}});
 t.after(async()=>{SaveService.prototype.projectRecord=original;await server.close();registry.dispose();fs.rmSync(stateDir,{recursive:true,force:true});});
 const page=await (await fetch(server.workspace_url+'projects')).text();
 assert.equal(calls,2,'Each Save must be projected once, rather than again for every Project.');
 assert.match(page,/Atlas user project/u);
 assert.match(page,/Keeproot saved this/u);
 calls=0;
 await fetch(server.workspace_url+'projects');
 assert.equal(calls,2,'A later request must get fresh state, not a persistent cached receipt.');
});

test('Projects selects the latest read or Save for each Project without mixing histories', async t=>{
 const stateDir=fixture(t),registry=new Registry({stateDir});
 const projects=['First','Second'].map(name=>({id:registry.create({name,currentPath:name}).project_id,name}));
 const work=(id,project,file,at)=>({work_id:`RWK-${id.repeat(36)}`,file_path:file,inspection_id:'inspection',cache_reference:'cache',source_fingerprint:{sha256:'a'.repeat(64)},inspect:{},project,inspected_at:at});
 fs.writeFileSync(path.join(stateDir,'ui','recent-work.json'),JSON.stringify({items:[work('1',projects[0],'first-new.txt','2026-10-15T00:00:00Z'),work('2',projects[1],'second-old.txt','2026-10-13T00:00:00Z')]}));
 fs.writeFileSync(path.join(stateDir,'ui','saved-work.json'),JSON.stringify({items:[receipt('SAV-one',projects[0].id),receipt('SAV-two',projects[1].id)]}));
 const original=SaveService.prototype.projectRecord;SaveService.prototype.projectRecord=function(row){return row;};
 const server=await startAtlasUiServer({stateDir,registry,rules:{},intake:{stateDir}});
 t.after(async()=>{SaveService.prototype.projectRecord=original;await server.close();registry.dispose();fs.rmSync(stateDir,{recursive:true,force:true});});
 const page=await (await fetch(server.workspace_url+'projects')).text();
 assert.match(page,/data-project-search="First first-new\.txt/u);assert.match(page,/data-project-search="Second example\.md/u);
 assert.doesNotMatch(page,/data-project-search="Second first-new\.txt/u);
});

test('Save snapshots keep status filtering and per-Project error state', t=>{
 const stateDir=fixture(t);
 t.after(()=>fs.rmSync(stateDir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(stateDir,'ui','saved-work.json'),JSON.stringify({items:[receipt('SAV-one','P1'),{...receipt('SAV-two','P2'),status:'undone',redo_available:false}]}));
 const service=createSavedWorkService({stateDir});
 const states=service.stateForProjects(['P1','P2','P3']);
 assert.deepEqual(states.get('P1').items.map(row=>row.save_id),['SAV-one']);
 assert.equal(states.get('P2').items.length,0);
 assert.equal(states.get('P3').items.length,0);
 fs.writeFileSync(path.join(stateDir,'ui','saved-work.json'),'{bad');
 assert.ok(service.stateForProjects(['P1']).get('P1').error);
});

test('Activity renders bounded history, reachable later pages and separates failed records from active work',()=>{
 const records=Array.from({length:120},(_,i)=>({activity_id:'ACT-'+i,status:'completed',file_path:`item-${i}.txt`,updated_at:new Date(Date.UTC(2026,9,14,0,i)).toISOString()}));
 const failed={activity_id:'ACT-old-failure',status:'failed',file_path:'failed.pdf',error_message:'Old parser failure'};
 const model={current_activity:[failed],recent_work:records};
 const first=renderActivityFragment(model,{locale:'en'});
 assert.equal((first.match(/data-activity-key=/g)??[]).length,51);
 assert.match(first,/Current work monitor · 0/u);
 assert.match(first,/Needs attention/u);
 assert.match(first,/No active work/u);
 assert.match(first,/1–50 \/ 120/u);
 assert.match(first,/href="\/activity\?page=2"/u);
 const second=renderActivityFragment({...model,history_page:'2'},{locale:'en'});
 assert.match(second,/51–100 \/ 120/u);
 const selected=renderActivityFragment({...model,selected_activity_key:'ACT-0'},{locale:'en'});
 assert.match(selected,/data-history-page="3"/u);
 assert.match(selected,/data-activity-key="ACT-0" open/u);
});

test('Activity coalesces refreshes and closes its stream and pending fetch when leaving the page',async()=>{
 const client=fs.readFileSync('src/ui/client.js','utf8');
 const start=client.indexOf("const activityRegion = document.querySelector('[data-activity-live]');");
 const end=client.indexOf('  if (activityRegion.dataset.importStatusHref)',start);
 const events=new Map(),windowEvents=new Map();
 let requests=0,closed=false,signal,finish;
 const region={dataset:{fragmentHref:'/activity/fragment',eventsHref:'/activity/events',historyPage:'2'},querySelector:()=>null,querySelectorAll:()=>[],contains:()=>false,dispatchEvent(){}};
 vm.runInNewContext(client.slice(start,end)+'\n}',{
  document:{activeElement:null,querySelector:()=>region,createElement:()=>({content:{querySelector:()=>({innerHTML:'rows',dataset:{historyPage:'2'}})}})},
  window:{location:{origin:'http://localhost'},addEventListener:(name,cb)=>windowEvents.set(name,cb),setTimeout(){assert.fail('No fallback expected');},clearTimeout(){}},
  URL,AbortController,CustomEvent:class{},
  fetch:(url,options)=>{requests++;assert.equal(url.searchParams.get('page'),'2');signal=options.signal;return new Promise(resolve=>{finish=()=>resolve({ok:true,text:async()=>'<section>rows</section>'});});},
  EventSource:class{addEventListener(name,cb){events.set(name,cb);}close(){closed=true;}},
 });
 const one=events.get('change')(),two=events.get('change')();
 assert.equal(requests,1,'Multiple change events must not queue duplicate requests.');
 windowEvents.get('pagehide')();
 assert.equal(closed,true);assert.equal(signal.aborted,true);
 finish();await Promise.all([one,two]);
 await events.get('change')();assert.equal(requests,1);
});
