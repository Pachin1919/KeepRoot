import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Registry } from '../src/registry.js';
import { ResourceControl } from '../src/resource-control.js';
import { beginCurrentActivity } from '../src/ui/current-activity.js';
import { upsertRecentWork } from '../src/ui/recent-work.js';
import { createReaderMonitorService } from '../src/reader-monitor-service.js';

function fixture(t) {
  const directory = fs.mkdtempSync(path.resolve('test/.tmp/reader-monitors-'));
  const stateDir = path.join(directory, 'state');
  const workspace = path.join(directory, 'workspace');
  const source = path.join(workspace, 'selected');
  fs.mkdirSync(source, { recursive: true });
  const file = path.join(source, 'selected.md');
  fs.writeFileSync(file, '# Selected\n');
  const registry = new Registry({ stateDir });
  const root = registry.adoptRoot({ rootPath: workspace, rootType: 'project_workspace', contentPolicy: 'bounded_content' });
  const { project_id: projectId } = registry.create({ name: 'Selected', currentPath: 'selected' });
  registry.attachRoot(projectId, { rootId: root.root_id, relativePath: 'selected', reason: 'Monitor fixture' });
  const control = new ResourceControl({ stateDir, registry });
  const project = registry.show(projectId).project;
  const resource = control.identify({ filePath: file, project });
  t.after(() => { control.dispose(); registry.dispose(); });
  const service = createReaderMonitorService({ registry, resourceControl: control, stateDir });
  return { directory, workspace, source, file, stateDir, registry, control, project, projectId, root, resource, service };
}

test('monitor returns bounded actual metadata only for exact selected Project and Resource path', t => {
  const f = fixture(t);
  const activityIds = [];
  for (let index = 0; index < 5; index++) {
    activityIds.push(beginCurrentActivity({ stateDir: f.stateDir, filePath: f.file, resourceId: f.resource.resource_id,
      project: f.project, purpose: `inspect ${index}`, caller: { actor: 'agent', agent: 'Reader' } }).activity_id);
  }
  const otherFile = path.join(f.source, 'other.md'); fs.writeFileSync(otherFile, 'Other');
  beginCurrentActivity({ stateDir: f.stateDir, filePath: otherFile, project: f.project, purpose: 'Excluded path' });
  beginCurrentActivity({ stateDir: f.stateDir, filePath: f.file, project: { id: 'foreign', name: 'Foreign' }, purpose: 'Excluded Project' });
  beginCurrentActivity({ stateDir: f.stateDir, filePath: f.file, resourceId: 'foreign-resource', project: f.project, purpose: 'Excluded identity' });
  const recent = upsertRecentWork({ stateDir: f.stateDir, filePath: f.file, resourceId: f.resource.resource_id,
    project: f.project, inspect: { purpose: 'content', maxCharacters: 4000 }, sourceFingerprint: { sha256: 'fixture' },
    inspectionId: 'actual-inspection', cacheReference: 'private-cache', initiatedBy: { actor: 'agent', agent: 'Reader' },
    resultSummary: { label: 'Read selected document' } });
  const before = fs.readFileSync(f.file);
  const readFile = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (target, ...args) => {
    assert.ok(!sameFile(target, f.file), 'metadata must not read the source body');
    return readFile(target, ...args);
  });
  t.mock.method(fs, 'writeFileSync', () => { assert.fail('monitor must not write state or source'); });
  const snapshot = f.service.read({ projectId: f.projectId, resourceId: f.resource.resource_id });
  assert.equal(snapshot.project_id, f.projectId); assert.equal(snapshot.resource_id, f.resource.resource_id);
  assert.ok(Number.isFinite(Date.parse(snapshot.observed_at)));
  assert.equal(snapshot.current.items.length, 4); assert.equal(snapshot.current.truncated, true);
  assert.equal(snapshot.current.error, null); assert.equal(snapshot.recent.error, null);
  assert.ok(snapshot.current.items.every(item => activityIds.includes(item.id)));
  assert.equal(snapshot.recent.items[0].id, recent.work_id);
  assert.equal(snapshot.recent.items[0].summary, 'Read selected document');
  for (const item of [...snapshot.current.items, ...snapshot.recent.items]) {
    assert.deepEqual(Object.keys(item).sort(), ['actor', 'id', 'kind', 'label', 'status', 'summary', 'updated_at']);
    assert.ok(item.label.length <= 160); assert.ok((item.actor ?? '').length <= 80); assert.ok((item.summary ?? '').length <= 240);
  }
  assert.doesNotMatch(JSON.stringify(snapshot), /private-cache|actual-inspection|source_fingerprint|file_path/);
  assert.ok(!JSON.stringify(snapshot).includes(f.file)); assert.deepEqual(readFile(f.file), before);
});

test('monitor denies foreign, unregistered, mismatched, missing and linked Resource before state reads', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.workspace, 'foreign'));
  const other = f.registry.create({ name: 'Foreign', currentPath: 'foreign' });
  f.registry.attachRoot(other.project_id, { rootId: f.root.root_id, relativePath: 'foreign', reason: 'Foreign fixture' });
  const readFile = fs.readFileSync;
  let stateReads = 0;
  t.mock.method(fs, 'readFileSync', (target, ...args) => {
    if (String(target).endsWith('current-activity.json') || String(target).endsWith('recent-work.json')) stateReads++;
    return readFile(target, ...args);
  });
  assert.throws(() => f.service.read({ projectId: other.project_id, resourceId: f.resource.resource_id }), /Resource|Project/);
  assert.throws(() => f.service.read({ projectId: f.projectId, resourceId: 'not-registered' }), /Resource/);
  const outside = path.join(f.workspace, 'outside.md'); fs.writeFileSync(outside, 'Outside');
  const mismatch = f.control.identify({ filePath: outside, project: f.project });
  assert.throws(() => f.service.read({ projectId: f.projectId, resourceId: mismatch.resource_id }), /Project|Resource/);
  fs.unlinkSync(f.file);
  assert.throws(() => f.service.read({ projectId: f.projectId, resourceId: f.resource.resource_id }), /Resource/);
  const nested = path.join(f.source, 'nested');
  const linkedTarget = path.join(f.workspace, 'linked-target');
  fs.mkdirSync(nested); fs.mkdirSync(linkedTarget);
  const nestedFile = path.join(nested, 'linked.md'); fs.writeFileSync(nestedFile, 'Nested');
  fs.writeFileSync(path.join(linkedTarget, 'linked.md'), 'Linked target');
  const linked = f.control.identify({ filePath: nestedFile, project: f.project });
  assert.ok(path.resolve(nested).startsWith(`${path.resolve('test/.tmp')}${path.sep}`));
  fs.unlinkSync(nestedFile); fs.rmdirSync(nested);
  fs.symlinkSync(linkedTarget, nested, 'junction');
  assert.throws(() => f.service.read({ projectId: f.projectId, resourceId: linked.resource_id }), /Resource/);
  assert.equal(stateReads, 0);
});

function sameFile(left, right) { return path.resolve(String(left)).toLowerCase() === path.resolve(right).toLowerCase(); }

test('monitor distinguishes unavailable metadata from empty and never checks source content', t => {
  const f = fixture(t);
  const selection = { projectId: f.projectId, resourceId: f.resource.resource_id };
  const empty = f.service.read(selection);
  assert.deepEqual(empty.current, { items: [], truncated: false, error: null });
  assert.deepEqual(empty.recent, { items: [], truncated: false, error: null });
  fs.mkdirSync(path.join(f.stateDir, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(f.stateDir, 'ui/current-activity.json'), '{invalid');
  fs.writeFileSync(path.join(f.stateDir, 'ui/recent-work.json'), '{invalid');
  fs.writeFileSync(f.file, '# Changed after registration\n');
  const snapshot = f.service.read(selection);
  assert.equal(snapshot.current.error, 'Current activity could not be loaded.');
  assert.equal(snapshot.recent.error, 'Recent Work could not be loaded.');
  assert.deepEqual(snapshot.current.items, []); assert.deepEqual(snapshot.recent.items, []);
  assert.doesNotMatch(JSON.stringify(snapshot), /verified|sha256|Changed after registration/);
});
