import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { contentFileFingerprint } from '../src/content-inspection.js';
import { createSavedWorkService, savedResultFreshness } from '../src/ui/services/saved-work-service.js';
import { Registry } from '../src/registry.js';
import { createResourceControl } from '../src/resource-control.js';
import { createSaveService } from '../src/save-service.js';

test('Saved Work returns the full receipt and preserves identity and bytes through read, Undo and Redo', t => {
  const root=fs.mkdtempSync(path.resolve('test/.tmp/saved-work-return-')),stateDir=path.join(root,'state'),workspace=path.join(root,'workspace'),projectRoot=path.join(workspace,'A');
  fs.mkdirSync(path.join(projectRoot,'Results'),{recursive:true});
  const sourcePath=path.join(projectRoot,'source.csv'),stagedPath=path.join(root,'candidate.csv');
  fs.writeFileSync(sourcePath,'value\n1\n');fs.writeFileSync(stagedPath,'sum\n1\n');
  const registry=new Registry({stateDir}),adopted=registry.adoptRoot({rootPath:workspace,rootType:'project_workspace',contentPolicy:'bounded_content'}),created=registry.create({name:'A',currentPath:'A'});
  registry.attachRoot(created.project_id,{rootId:adopted.root_id,relativePath:'A',reason:'Saved Work return regression'});
  const project={id:created.project_id,name:'A'},control=createResourceControl({stateDir,ledger:registry.ledger}),resource=control.identify({filePath:sourcePath,project}),save=createSaveService({stateDir,resourceControl:control});
  t.after(()=>{save.dispose();control.dispose();registry.dispose();fs.rmSync(root,{recursive:true,force:true});});
  const service=createSavedWorkService({stateDir,saveService:save}),sourceFingerprint=contentFileFingerprint(sourcePath);
  const request={project,root:workspace,projectRoot,folder:'Results',fileName:'summary.csv',stagedPath,sourcePath,sourceFingerprint,sourceResourceId:resource.resource_id,requestKey:'return-chain',caller:{tool:'test',client_run_id:'return-chain'},parameters:{fixture:true},resultSummary:{rows:1,columns:1}};
  const saved=service.save(request);
  assert.equal(saved.status,'executed');assert.equal(saved.result_fingerprint.bytes,fs.statSync(stagedPath).size);assert.ok(saved.candidate.sha256);
  assert.equal(saved.sources[0].resource_id,resource.resource_id);assert.deepEqual(service.find(saved.save_id),{...saved,origin_project:saved.project,project:{...saved.project,current_path:'A',path:projectRoot}});
  assert.equal(contentFileFingerprint(saved.result_path).sha256,saved.verification.sha256);
  service.undo(saved.save_id);assert.equal(fs.existsSync(saved.result_path),false);assert.equal(service.find(saved.save_id).status,'undone');
  service.redo(saved.save_id);const redone=service.find(saved.save_id);
  assert.equal(redone.resource_id,saved.resource_id);assert.deepEqual(redone.source,saved.source);assert.equal(contentFileFingerprint(redone.result_path).sha256,saved.verification.sha256);
  fs.appendFileSync(sourcePath,'2\n');assert.throws(()=>service.save({...request,fileName:'stale.csv',requestKey:'stale'}),/Source changed before Save/u);assert.equal(fs.existsSync(path.join(projectRoot,'Results','stale.csv')),false);
});

test('saved result checks its own recorded sources after the Work accepts newer versions', t => {
  const root = fs.mkdtempSync(path.resolve('test/.tmp/result-freshness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.csv'); const output = path.join(root, 'result.csv');
  fs.writeFileSync(source, 'amount\n30\n'); fs.writeFileSync(output, 'total\n30\n');
  const record = { status: 'executed', result_path: output, result_fingerprint: contentFileFingerprint(output),
    version_policy: 'follow_latest', sources: [{ path: source, fingerprint: contentFileFingerprint(source), version_policy: 'follow_latest' }] };
  assert.equal(savedResultFreshness(record).status, 'fresh');
  fs.writeFileSync(source, 'amount\n40\n');
  assert.equal(savedResultFreshness(record, { sourceFreshness: { status: 'fresh' } }).status, 'needs_review');
  const currentWork = { sourceFreshness: { status: 'fresh' }, versionPolicy: 'pinned_version' };
  assert.equal(savedResultFreshness(record, currentWork).status, 'needs_review', 'a newer Work policy and baseline cannot relabel the saved output');
  assert.equal(savedResultFreshness({ ...record, version_policy: 'pinned_version', sources: record.sources.map(s => ({ ...s, version_policy: 'pinned_version' })) }, { versionPolicy: 'follow_latest' }).status, 'pinned');
  assert.equal(savedResultFreshness({ ...record, sources: [{ ...record.sources[0], fingerprint: contentFileFingerprint(source) }] }).status, 'fresh');
  fs.renameSync(source, `${source}.held`);
  assert.equal(savedResultFreshness(record).status, 'needs_review');
  assert.equal(savedResultFreshness({ ...record, sources: [] }).status, 'not_checked');
  assert.equal(contentFileFingerprint(output).sha256, record.result_fingerprint.sha256);
});

test('mixed saved results ignore pinned source changes but check followed source versions', t => {
  const root = fs.mkdtempSync(path.resolve('test/.tmp/result-freshness-mixed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pinned = path.join(root, 'pinned.csv'); const followed = path.join(root, 'followed.csv'); const output = path.join(root, 'out.csv');
  for (const file of [pinned, followed, output]) fs.writeFileSync(file, 'v\n1\n');
  const record = { status: 'executed', result_path: output, result_fingerprint: contentFileFingerprint(output), version_policy: 'mixed', sources: [
    { path: pinned, fingerprint: contentFileFingerprint(pinned), version_policy: 'pinned_version' },
    { path: followed, fingerprint: contentFileFingerprint(followed), version_policy: 'follow_latest' },
  ] };
  fs.writeFileSync(pinned, 'v\n2\n');
  assert.equal(savedResultFreshness(record, { sourceFreshness: { status: 'needs_review' } }).status, 'fresh');
  fs.writeFileSync(followed, 'v\n2\n');
  assert.equal(savedResultFreshness(record).status, 'needs_review');
});
