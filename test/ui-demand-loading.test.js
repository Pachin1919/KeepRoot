import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildProjectResourcesModel } from '../src/ui/read-model/project-resources-model.js';
import { renderResourceReaderView } from '../src/ui/views/resource-reader-view.js';

test('ordinary material browsing reads the chosen folder without peer contents or recursive traversal', t => {
  const root = fs.mkdtempSync(path.resolve('test/.tmp/demand-ui-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  fs.mkdirSync(path.join(root, 'nested/deeper'), {recursive:true});
  fs.writeFileSync(path.join(root, 'nested/a.md'), 'a');
  fs.writeFileSync(path.join(root, 'nested/deeper/peer.md'), 'peer');
  const original = fs.readdirSync;
  const visited = [];
  fs.readdirSync = function(file, ...args) { visited.push(path.resolve(file)); return original.call(this, file, ...args); };
  try {
    const model = buildProjectResourcesModel({project:{id:'p'},root,base:'/projects/p',recentWork:[],selectedFolderPath:'nested'});
    assert.equal(model.selected_folder_path, 'nested');
    assert.deepEqual(model.other_files.map(x=>x.relative_path), ['nested/a.md']);
    assert.ok(!visited.includes(path.join(root, 'nested/deeper')), 'unopened folders must not be traversed');
  } finally { fs.readdirSync = original; }
});

test('paged text exposes version-bound navigation and never starts the inline editor', () => {
  const html = renderResourceReaderView({project:{id:'p',name:'P'},reader:{resource_id:'r',name:'large.md',relative_path:'large.md',kind:'markdown',text:'# page',text_page:{offset:0,next_offset:64000,has_more:true,total_bytes:300000,version:'v1'}}});
  assert.match(html, /text_offset=64000/u);
  assert.match(html, /text_version=v1/u);
  assert.match(html, /data-reader-default-edit="false"/u);
  assert.doesNotMatch(html, /<a[^>]+data-reader-inline-edit/u);
});

test('missing focused parent retains its Resource recovery record and explicit unsafe folders reject', t => {
  const root = fs.mkdtempSync(path.resolve('test/.tmp/demand-missing-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const args = {project:{id:'p'},root,base:'/projects/p',recentWork:[],focusedResourceId:'r',resourceFacts:[{resource_id:'r',resource:{id:'r',status:'missing',display_name:'Missing'},path:path.join(root,'gone/a.md'),status:'missing',locations:[{project_id:'p',status:'missing'}]}]};
  const model = buildProjectResourcesModel(args);
  assert.equal(model.focused_resource.resource_id, 'r');
  assert.equal(model.focused_resource.open_available, false);
  assert.equal(model.selected_folder_path, '');
  assert.throws(() => buildProjectResourcesModel({...args,selectedFolderPath:'../outside'}), /outside this Project/u);
});
