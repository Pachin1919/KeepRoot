import assert from 'node:assert/strict';import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';import test from 'node:test';
import {buildProjectResourcesModel} from '../src/ui/read-model/project-resources-model.js';

test('Resource history is indexed once per request while preserving identity, order and activity precedence', t => {
 const root=fs.mkdtempSync(path.resolve('test/.tmp/resource-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let projectReads=0,sourceReads=0;const recentWork=[],savedWork=[],currentActivity=[],resourceFacts=[];
 const project={id:'p'},at='2026-10-27T01:00:00Z';
 for(let i=0;i<30;i++){
  const file=path.join(root,`${i}.csv`),id=`r${i}`;fs.writeFileSync(file,'value\n1\n');resourceFacts.push({resource_id:id,path:file});
  recentWork.push({get project(){projectReads++;return project;},resource_id:id,file_path:file,work_id:`w${i}`,inspected_at:at,inspect:{}});
  savedWork.push({resource_id:id,work_id:`s${i}`,result_path:file,get source_path(){sourceReads++;return file;}});
  currentActivity.push({get project(){projectReads++;return project;},resource_id:id,file_path:file,status:'waiting',updated_at:at});
 }
 const firstFile=resourceFacts[0].path;
 recentWork.unshift({project:{id:'foreign'},resource_id:'r0',file_path:firstFile,work_id:'foreign',inspect:{}});
 currentActivity.unshift({project,resource_id:'r0',file_path:firstFile,status:'failed',updated_at:'2026-10-26T01:00:00Z'});
 savedWork.push({work_id:'legacy',result_path:path.join(root,'old.csv'),sources:[{resource_id:'r0',path:firstFile},{path:firstFile}]});
 const args={project,root,base:'/projects/p',recentWork,savedWork,currentActivity,resourceFacts};
 const first=buildProjectResourcesModel(args),record=first.created_work.find(item=>item.resource_id==='r0');
 assert.equal(record.work.work_id,'w0');assert.equal(record.activity.status,'waiting');assert.deepEqual(record.created_work.map(item=>item.work_id),['s0','legacy']);
 assert.equal(projectReads,60);assert.equal(sourceReads,60,'one source index read and one displayed source_path per Save');
 currentActivity[1].status='running';projectReads=0;sourceReads=0;
 const second=buildProjectResourcesModel(args);assert.equal(second.created_work.find(item=>item.resource_id==='r0').activity.status,'running');
 assert.equal(projectReads,60);assert.equal(sourceReads,60);
});
test('Resource list uses recorded facts without inspecting Sources; explicit fingerprints still detect changes',t=>{
 const root=fs.mkdtempSync(path.resolve('test/.tmp/resource-page-cache-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const source=path.join(root,'来源.csv');const content='名称,值\n甲,1\n';fs.writeFileSync(source,content);const sha=crypto.createHash('sha256').update(content).digest('hex');
 let factPaths=0;const resourceFacts=[];const savedWork=[];
 for(let i=0;i<40;i++){const file=path.join(root,`结果${i}.csv`);fs.writeFileSync(file,'值\n1\n');const id=`RES-${i}`;resourceFacts.push({resource_id:id,get path(){factPaths++;return file;}});savedWork.push({resource_id:id,work_id:`WORK-${i}`,result_path:file,created_at:'2026-10-04T01:00:00Z',version_policy:'follow_latest',sources:[{path:source,fingerprint:{sha256:sha}}]});}
 const args={project:{id:'PRJ-cache',name:'研究'},root,base:'/projects/PRJ-cache',recentWork:[],savedWork,resourceFacts};
 const originalOpen=fs.openSync;let sourceReads=0;fs.openSync=function(file,...args){if(typeof file==='string'&&path.resolve(file)===source)sourceReads++;return originalOpen.call(this,file,...args);};
 try {
  const first=buildProjectResourcesModel(args);assert.equal(first.created_work.length,40);assert.ok(first.created_work.every(x=>x.saved_work.source_status==='Not checked'));
  assert.equal(sourceReads,0,'ordinary listing must not fingerprint source content');assert.ok(factPaths<=resourceFacts.length*3,`fact path lookup should be bounded; observed ${factPaths}`);
  fs.appendFileSync(source,'乙,2\n');sourceReads=0;const second=buildProjectResourcesModel(args);assert.equal(sourceReads,0);assert.ok(second.created_work.every(x=>x.saved_work.source_status==='Not checked'));assert.notEqual(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),sha,'explicit check still observes the changed source');
 }finally{fs.openSync=originalOpen;}
});
