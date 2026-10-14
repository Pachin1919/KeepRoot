import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Registry } from '../src/registry.js';
import { createResourceControl } from '../src/resource-control.js';
import { ResourceRepository } from '../src/storage/repositories/resource-repository.js';
import { SaveService, activeSavedResourcePath, currentSavedResourceLocation } from '../src/save-service.js';

test('Project resource browsing loads location history in batches and keeps scope, identity and fresh reads', t => {
 fs.mkdirSync('test/.tmp',{recursive:true});
 const root=fs.mkdtempSync(path.resolve('test/.tmp/project-resource-performance-'));
 const stateDir=path.join(root,'state'),workspace=path.join(root,'workspace');
 fs.mkdirSync(path.join(workspace,'one'),{recursive:true});fs.mkdirSync(path.join(workspace,'two'));
 const registry=new Registry({stateDir});
 const adopted=registry.adoptRoot({rootPath:workspace,rootType:'project_workspace',contentPolicy:'bounded_content'});
 const project=name=>{const created=registry.create({name,currentPath:name});registry.attachRoot(created.project_id,{rootId:adopted.root_id,relativePath:name,reason:'performance fixture'});return {id:created.project_id,name};};
 const one=project('one'),two=project('two');
 const control=createResourceControl({stateDir,ledger:registry.ledger});
 t.after(()=>{control.dispose();registry.dispose();fs.rmSync(root,{recursive:true,force:true});});
 const add=(p,index)=>{const filePath=path.join(workspace,p.name,`${index}.txt`);fs.writeFileSync(filePath,`fixture ${p.name} ${index}`);return control.identify({filePath,project:p});};
 const sources=Array.from({length:12},(_,i)=>add(one,i));const foreign=add(two,'foreign');
 const repo=registry.ledger.resources,original=repo.locations.bind(repo);
 const expected=new Map(sources.map(source=>[source.resource_id,original(source.resource_id)]));
 let singleLocationReads=0;
 repo.locations=(id)=>{singleLocationReads++;return original(id);};
 const facts=control.projectResources(one.id);
 assert.equal(singleLocationReads,0,'Ordinary Project browsing must not issue one location query per Resource.');
 assert.equal(facts.length,12);
 const summaries=control.projectResourceSummaries(one.id);
 assert.equal(summaries.length,12);
 assert.ok(!summaries.some(fact=>fact.resource_id===foreign.resource_id));
 for(const fact of summaries){
   assert.deepEqual(fact.locations,expected.get(fact.resource_id));
   assert.equal(fact.external_change.status,'not_checked');
   assert.equal(fact.missing_record_archived,false);
 }
 const describe=repo.describe.bind(repo),actions=repo.listActions.bind(repo);
 repo.describe=()=>{throw Error('Browsing summaries must not describe every Resource');};
 repo.listActions=()=>{throw Error('Browsing summaries must not scan every action history');};
 assert.equal(control.projectResourceSummaries(one.id).length,12);
 repo.describe=describe;repo.listActions=actions;
 assert.ok(!facts.some(fact=>fact.resource_id===foreign.resource_id));
 for(const fact of facts)assert.deepEqual(fact.locations,expected.get(fact.resource_id));
 const save=new SaveService({stateDir,intake:{},resourceControl:control});
 const receipts=sources.map(source=>({save_id:'SAV-'+source.resource_id,project:one,resource_id:source.resource_id,target:{path:source.evidence.path,resource_path:path.basename(source.evidence.path)},source:{resource_id:source.resource_id,path:source.evidence.path},undo_available:true,redo_available:false}));
 const individual=receipts.map(row=>save.projectRecord(row));
 assert.deepEqual(save.projectRecords(receipts),individual,'Batch display projection must preserve the original paths, identities and recovery flags.');
 const db=registry.ledger.db,prepare=db.prepare.bind(db);let scalarLocationQueries=0;
 db.prepare=(sql,...args)=>{if(/FROM resource_locations WHERE resource_id=\?/u.test(sql))scalarLocationQueries++;return prepare(sql,...args);};
 save.projectRecords(receipts);
 assert.equal(scalarLocationQueries,0,'Save browsing must not repeat scalar location queries for every receipt.');
 db.prepare=prepare;
 registry.ledger.db.prepare('UPDATE projects SET name=? WHERE id=?').run('one renamed',one.id);
 assert.equal(save.projectRecords(receipts)[0].project.name,'one renamed','A later request must reread current Project facts.');
 const extra=add(one,'new');
 assert.ok(control.projectResources(one.id).some(fact=>fact.resource_id===extra.resource_id),'The batch is fresh per request.');
 assert.equal(control.projectResource(one.id,extra.resource_id).resource_id,extra.resource_id);
 assert.throws(()=>control.projectResource(one.id,foreign.resource_id),/unavailable/u);
});

test('Batch location reads preserve each ordered history, missing states and bounded SQL parameter counts', t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE resource_locations(id TEXT,resource_id TEXT,project_id TEXT,valid_from TEXT,status TEXT,path TEXT)');
 const insert=db.prepare('INSERT INTO resource_locations VALUES(?,?,?,?,?,?)');
 const ids=Array.from({length:805},(_,i)=>`resource-${i}`);
 for(const id of ids){insert.run(id+'-new',id,'one','2026-02-01','active',id+'.txt');insert.run(id+'-old',id,'one','2026-01-01','missing','old-'+id+'.txt');}
 insert.run('foreign','not-requested','two','2026-01-01','active','foreign.txt');
 const repo=new ResourceRepository({db});
 const rows=repo.locationsForResources([...ids,ids[0]]);
 assert.equal(rows.length,ids.length*2,'Duplicate requested IDs must not duplicate rows.');
 assert.ok(rows.every(row=>ids.includes(row.resource_id)));
 for(const id of [ids[0],ids[399],ids[400],ids.at(-1)])assert.deepEqual(rows.filter(row=>row.resource_id===id),repo.locations(id));
 assert.deepEqual(repo.locationsForResources([]),[]);
 // Missing, ambiguous and legacy path-only receipts must keep their original fallback.
 insert.run('ambiguous',ids[0],'one','2026-03-01','active','second.txt');
 const locationsByResource=new Map(ids.slice(0,2).map(id=>[id,repo.locationsForResources([id])]));
 for(const id of [ids[0],ids[1]]){
   const batchLocation=currentSavedResourceLocation(db,id,locationsByResource),singleLocation=currentSavedResourceLocation(db,id);
   assert.deepEqual(batchLocation && {...batchLocation},singleLocation && {...singleLocation});
   assert.equal(activeSavedResourcePath(db,'one',id,'original.txt',locationsByResource),activeSavedResourcePath(db,'one',id,'original.txt'));
 }
 db.prepare("UPDATE resource_locations SET status='missing' WHERE resource_id=?").run(ids[1]);
 locationsByResource.set(ids[1],repo.locationsForResources([ids[1]]));
 assert.equal(currentSavedResourceLocation(db,ids[1],locationsByResource),null);
 assert.equal(activeSavedResourcePath(db,'one',ids[1],'original.txt',locationsByResource),'original.txt');
 assert.equal(activeSavedResourcePath(db,'two',null,'foreign.txt',locationsByResource),'foreign.txt');
});
