import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Registry } from '../src/registry.js';
import { ResourceControl } from '../src/resource-control.js';
import { startAtlasUiServer } from '../src/ui-server.js';
import { beginCurrentActivity } from '../src/ui/current-activity.js';

async function fixture(t) {
  fs.mkdirSync('test/.tmp', { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('test/.tmp/reader-monitor-ui-'));
  const stateDir = path.join(directory, 'state'), workspace = path.join(directory, 'workspace');
  fs.mkdirSync(path.join(workspace, 'one'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'two'));
  const file = path.join(workspace, 'one', 'note.md'); fs.writeFileSync(file, '# Original document');
  const registry = new Registry({ stateDir });
  const root = registry.adoptRoot({ rootPath: workspace, rootType: 'project_workspace', contentPolicy: 'bounded_content' });
  const project = registry.create({ name: 'one', currentPath: 'one' }).project_id;
  const other = registry.create({ name: 'two', currentPath: 'two' }).project_id;
  for (const [id, relativePath] of [[project, 'one'], [other, 'two']]) registry.attachRoot(id, { rootId: root.root_id, relativePath, reason: 'Monitor fixture' });
  const control = new ResourceControl({ stateDir, registry });
  const resource = control.identify({ filePath: file, project: registry.show(project).project }).resource_id;
  const server = await startAtlasUiServer({ stateDir, registry, resourceControl: control, projectRoot: workspace, installationRoot: workspace });
  t.after(async () => { await server.close(); control.dispose(); registry.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { server, project, other, resource, file, stateDir };
}

test('monitor metadata denies a foreign or unregistered Resource through a JSON boundary', async t => {
  const f = await fixture(t);
  for (const [project, resource] of [[f.other, f.resource], [f.project, 'R-unregistered'], [f.project, '']]) {
    const response = await fetch(new URL(`/projects/${project}/resources/monitors?resource_id=${resource}`, f.server.workspace_url));
    assert.ok([403, 409].includes(response.status), `Denied request must use existing scope/conflict status, got ${response.status}`);
    const data = await response.json();
    assert.equal(data.ok, false); assert.equal(typeof data.error, 'string');
    assert.ok(data.error.length <= 500); assert.equal(data.current, undefined);
    assert.doesNotMatch(JSON.stringify(data), /Original document|note\.md/u);
  }
});

test('real metadata and initial Reader use the same exact Resource scope without rewriting its content', async t => {
  const f = await fixture(t);
  const selected = beginCurrentActivity({ stateDir: f.stateDir, filePath: f.file, resourceId: f.resource, project: { id: f.project, name: 'one' }, purpose: 'Actual fixture processing', caller: { agent: 'Fixture Host' } });
  beginCurrentActivity({ stateDir: f.stateDir, filePath: path.join(path.dirname(f.file), 'another.md'), project: { id: f.project, name: 'one' }, purpose: 'Excluded processing' });
  const url = new URL(`/projects/${f.project}/resources/monitors?resource_id=${f.resource}`, f.server.workspace_url);
  const response = await fetch(url); assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.equal(snapshot.ok, true); assert.equal(snapshot.project_id, f.project); assert.equal(snapshot.resource_id, f.resource);
  assert.equal(snapshot.current.items.length, 1); assert.equal(snapshot.current.items[0].id, selected.activity_id);
  assert.equal(snapshot.current.items[0].status, 'running'); assert.equal(snapshot.recent.items.length, 0);
  assert.doesNotMatch(JSON.stringify(snapshot), /note\.md|Original document|Excluded processing/u);
  const read = await fetch(new URL(`/projects/${f.project}/resources/read?resource_id=${f.resource}`, f.server.workspace_url));
  assert.equal(read.status, 200); const html = await read.text();
  assert.match(html, /Original document/u); assert.match(html, /Actual fixture processing/u);
  assert.doesNotMatch(html.slice(html.indexOf('<main')), /Excluded processing/u);
  assert.match(html, /data-reader-monitor-layout="a"/u);
  assert.match(html, /data-reader-monitor-layout="b"/u);
  assert.match(html, /data-reader-default-edit="true"/u);
  for (const id of ['reader-content', 'reader-graph', 'reader-source', 'reader-activity-monitor']) assert.equal((html.match(new RegExp(`id="${id}"`, 'gu')) ?? []).length, 1);
  assert.equal(fs.readFileSync(f.file, 'utf8'), '# Original document');
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
});

test('a malformed state stays explicit while Reader content remains readable and client assets stay closed', async t => {
  const f = await fixture(t);
  fs.mkdirSync(path.join(f.stateDir, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(f.stateDir, 'ui', 'current-activity.json'), '{invalid');
  const response = await fetch(new URL(`/projects/${f.project}/resources/read?resource_id=${f.resource}`, f.server.workspace_url));
  assert.equal(response.status, 200); const html = await response.text();
  assert.match(html, /Original document/u); assert.match(html, /Current activity could not be loaded/u);
  const url = new URL('/ui/reader-monitors.js', f.server.workspace_url);
  const asset = await fetch(url); assert.equal(asset.status, 200);
  assert.equal(await asset.text(), fs.readFileSync('src/ui/reader-monitors.js', 'utf8'));
  assert.equal(asset.headers.get('x-content-type-options'), 'nosniff');
  assert.match(asset.headers.get('content-security-policy'), /connect-src 'self'/u);
  assert.equal((await fetch(new URL('/ui/reader-monitors.js?file=other', f.server.workspace_url))).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 404);
  assert.equal((await fetch(new URL('/ui/reader-monitors.js/other', f.server.workspace_url))).status, 404);
});
