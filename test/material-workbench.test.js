import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { Registry } from '../src/registry.js';
import { createResourceControl } from '../src/resource-control.js';
import { startAtlasUiServer } from '../src/ui-server.js';
import { renderResourceReaderView } from '../src/ui/views/resource-reader-view.js';
import { renderProjectResourcesView } from '../src/ui/views/project-resources-view.js';
import { writeUiPreferences } from '../src/ui/preferences.js';

async function fixture(t, locale = null) {
  fs.mkdirSync('test/.tmp', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('test/.tmp/material-workbench-'));
  const stateDir = path.join(root, 'state'), workspace = path.join(root, 'workspace');
  for (const project of ['A', 'B']) fs.mkdirSync(path.join(workspace, project, 'Notes'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'A', 'Notes', 'note.md'), '# Actual material\n\nExact local content.');
  fs.writeFileSync(path.join(workspace, 'A', 'Notes', 'unregistered.txt'), 'Explicit registration required.');
  fs.writeFileSync(path.join(workspace, 'A', 'Notes', 'missing.txt'), 'Missing source.');
  fs.writeFileSync(path.join(workspace, 'B', 'Notes', 'note.md'), 'Foreign Project body.');
  const registry = new Registry({ stateDir });
  const adopted = registry.adoptRoot({ rootPath: workspace, rootType: 'project_workspace', contentPolicy: 'bounded_content' });
  const projects = ['A', 'B'].map(name => { const project = registry.create({ name, currentPath: name }); registry.attachRoot(project.project_id, { rootId: adopted.root_id, relativePath: name, reason: 'Material selection regression.' }); return registry.show(project.project_id).project; });
  const control = createResourceControl({ stateDir, ledger: registry.ledger });
  const resource = control.identify({ filePath: path.join(workspace, 'A', 'Notes', 'note.md'), project: projects[0] });
  const foreign = control.identify({ filePath: path.join(workspace, 'B', 'Notes', 'note.md'), project: projects[1] });
  const missing = control.identify({ filePath: path.join(workspace, 'A', 'Notes', 'missing.txt'), project: projects[0] });
  fs.unlinkSync(path.join(workspace, 'A', 'Notes', 'missing.txt'));
  if (locale) writeUiPreferences(stateDir, { locale });
  const server = await startAtlasUiServer({ stateDir, registry, resourceControl: control, rules: {}, runtime: {}, projectRoot: root, installationRoot: root });
  t.after(async () => { await server.close(); control.dispose(); registry.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  const base = `/projects/${projects[0].id}`;
  const get = url => fetch(new URL(url.replace(/^\//u, ''), server.workspace_url), { redirect: 'manual' });
  return { root, stateDir, control, server, base, get, resource, foreign, missing, projects };
}

test('material URL contract opens the same registered object and returns to scoped list without a loop', async t => {
  const f = await fixture(t);
  // Registered views do not invoke the separate filesystem discovery/observation operation.
  const scope = `${f.base}/resources?mode=files&folder=Notes&name_contains=note&membership=registered_local`;
  for (const selection of [`&path=Notes%2Fnote.md`, `&resource_id=${f.resource.resource_id}`, `&path=Notes%2Fnote.md&resource_id=${f.resource.resource_id}`]) {
    const response = await f.get(scope + selection);
    assert.equal(response.status, 303, 'Legacy material selection must directly enter the existing Reader.');
    const target = new URL(response.headers.get('location'), 'http://atlas.local');
    assert.equal(target.pathname, `${f.base}/resources/read`);
    assert.equal(target.searchParams.get('resource_id'), f.resource.resource_id);
    const list = new URL(target.searchParams.get('return_to'), 'http://atlas.local');
    assert.equal(list.searchParams.get('mode'), 'files'); assert.equal(list.searchParams.get('folder'), 'Notes'); assert.equal(list.searchParams.get('name_contains'), 'note');
    for (const key of ['path', 'resource_id', 'graph']) assert.equal(list.searchParams.has(key), false);
    const reader = await f.get(target.pathname + target.search); assert.equal(reader.status, 200);
    const body = await reader.text(); assert.match(body, /Exact local content/u); assert.match(body, new RegExp(`data-reader-resource-id="${f.resource.resource_id}"`, 'u'));
    const returned = await f.get(list.pathname + list.search); assert.equal(returned.status, 200); assert.equal(returned.headers.get('location'), null);
  }
  for (const selection of [`&resource_id=${f.foreign.resource_id}`, `&resource_id=${f.foreign.resource_id}&path=Notes%2Fnote.md`, `&resource_id=${f.missing.resource_id}`, `&path=Notes%2Funregistered.txt`, `&resource_id=${f.resource.resource_id}&path=Notes%2Funregistered.txt`, '&path=..%2FB%2FNotes%2Fnote.md']) {
    const response = await f.get(scope + selection); assert.notEqual(response.status, 303, `Unexpected redirect for ${selection}: ${response.headers.get('location')}`);
    assert.doesNotMatch(await response.text(), /Foreign Project body|data-resource-reader/u);
  }
  const graph = await f.get(scope + `&resource_id=${f.resource.resource_id}&graph=1`); assert.equal(graph.status, 200); assert.equal(graph.headers.get('location'), null);
  const detail = await f.get(`${f.base}/resources/detail?path=Notes%2Fnote.md`); assert.equal(detail.status, 200); assert.equal(detail.headers.get('location'), null);
  const ordinaryUnregistered = await f.get(`${f.base}/resources?path=Notes%2Funregistered.txt`);
  assert.equal(ordinaryUnregistered.status, 200); assert.doesNotMatch(await ordinaryUnregistered.text(), /data-resource-reader/u);
  assert.equal(f.control.projectResources(f.projects[0].id).length, 2, 'GET does not register an ordinary file.');
});

test('material Reader strips legacy selection from list return while preserving the exact scope', async t => {
  const f = await fixture(t);
  const returnTo = `${f.base}/resources?mode=cards&folder=Notes&name_contains=note&resource_id=${f.resource.resource_id}&path=Notes%2Fnote.md&graph=1`;
  const response = await f.get(`${f.base}/resources/read?` + new URLSearchParams({ resource_id: f.resource.resource_id, return_to: returnTo }));
  assert.equal(response.status, 200);
  const body = await response.text();
  const returnHref = body.match(/<header class="reader-toolbar"><a class="reader-button reader-back-command" href="([^"]+)"/u)?.[1];
  assert.ok(returnHref);
  const list = new URL(returnHref.replaceAll('&amp;', '&'), 'http://atlas.local');
  assert.equal(list.searchParams.get('mode'), 'cards'); assert.equal(list.searchParams.get('folder'), 'Notes'); assert.equal(list.searchParams.get('name_contains'), 'note');
  assert.equal(list.searchParams.has('resource_id'), false); assert.equal(list.searchParams.has('path'), false); assert.equal(list.searchParams.has('graph'), false);
  const returned = await f.get(list.pathname + list.search); assert.equal(returned.status, 200); assert.equal(returned.headers.get('location'), null);
});

test('material workbench keeps real content, same-page edit, folded facts and the normal navigation rail', () => {
  const base = '/projects/PRJ-material';
  const html = renderResourceReaderView({ project: { id: 'PRJ-material', name: 'Materials' }, reader: { resource_id: 'RES-one', name: 'note.md', relative_path: 'Notes/note.md', kind: 'markdown', text: '# Actual heading\n\n| Measure | Value |\n| --- | --- |\n| Total | 200 |', sha256: 'a'.repeat(64) }, resources: [{ resource_id: 'RES-one', name: 'note.md', relative_path: 'Notes/note.md' }], returnHref: base + '/resources?folder=Notes&resource_id=RES-one', relatedWorks: [] }, { locale: 'en', csrfToken: 'fixture-token', railStyle: '--app-rail-width: 228px;' });
  assert.match(html, /class="app-shell reader-shell" style="--app-rail-width: 228px;"/u);
  assert.match(html, /class="resource-reader reader-files-open" data-resource-reader/u);
  assert.match(html, /<h1 id="reader-heading-actual-heading">Actual heading<\/h1>/u);
  assert.match(html, /<table>[\s\S]*?<td>Total<\/td>[\s\S]*?<td>200<\/td>/u);
  assert.match(html, /data-reader-inline-edit/u); assert.match(html, /resources\/edit\?resource_id=RES-one&amp;expected_sha256=a{64}/u);
  assert.match(html, /<aside class="reader-source" id="reader-source" hidden>/u);
  assert.match(html, /<details class="reader-technical">/u);
  assert.match(html, /resources\/detail\?path=Notes%2Fnote.md/u);
  assert.doesNotMatch(html, /<div class="reader-task-actions"|<iframe/u);
  const css = fs.readFileSync('src/ui/styles/components.css', 'utf8');
  const workspace = fs.readFileSync('src/ui/styles/workspace.css', 'utf8');
  assert.match(css, /\.atlas-reader-body \.reader-files-open \.reader-layout \{ grid-template-columns: 200px minmax\(0, 1fr\)/u);
  assert.doesNotMatch(css, /reader-shell \{[^}]*60px|reader-files, \.atlas-reader-body \.reader-source \{[^}]*position: absolute/u);
  assert.doesNotMatch(workspace, /atlas-reader-body \.project-navigation \.nav-item[^}]*display: none/u);
  assert.match(css, /activity-workbench\[data-inspector-open="true"\][^}]*300px/u);
  assert.doesNotMatch(css, /\.activity-monitor \{[^}]*position: fixed|\.activity-monitor::backdrop|cursor: move/u);
});

test('material list has direct registered links and no empty metadata inspector', () => {
  const base = '/projects/PRJ-material';
  const html = renderProjectResourcesView({ mode: 'explorer', project: { id: 'PRJ-material', name: 'Materials' }, base, selected_folder_path: '', tree: { folders: [], files: [{ resource_id: 'RES-one', name: 'note.md', relative_path: 'note.md', type: 'MD' }] }, missing_sources: [] }, { locale: 'en', csrfToken: 'fixture-token' });
  assert.match(html, /workspace-resource-grid-list/u);
  assert.match(html, /class="workspace-resource-file" href="\/projects\/PRJ-material\/resources\/read\?resource_id=RES-one/u);
  assert.doesNotMatch(html, /<aside class="workspace-focus"|Choose a Resource/u);
  assert.doesNotMatch(html, /data-resource-list-toggle/u, 'A list without an inspector does not need a hide-list control.');
});

test('material Reader layout toggles keep one narrow side pane and preserve content and editing hooks', () => {
  const client = fs.readFileSync('src/ui/client.js', 'utf8');
  const start = client.indexOf('const readerSurface ='), end = client.indexOf('// Read-only event polling', start);
  const handlers = new Map(), classes = new Set();
  const element = () => ({ hidden: false, attributes: {}, addEventListener(type, handler) { handlers.set(this, { ...(handlers.get(this) ?? {}), [type]: handler }); }, setAttribute(key, value) { this.attributes[key] = value; }, focus() {} });
  const files = element(), source = element(), content = element(), filesToggle = element(), sourceToggle = element(), focusToggle = element();
  const selectors = { '#reader-files': files, '#reader-source': source, '#reader-content': content, '[data-reader-files-toggle]': filesToggle, '[data-reader-source-toggle]': sourceToggle, '[data-reader-focus-toggle]': focusToggle };
  const surface = { querySelector: selector => selectors[selector], classList: { toggle: (name, value) => value ? classes.add(name) : classes.delete(name) }, addEventListener() {} };
  let bound = 0;
  vm.runInNewContext(client.slice(start, end), { bindReaderInlineEditor() { bound++; }, document: { querySelector: () => surface }, window: { matchMedia: () => ({ matches: true, addEventListener() {} }) } });
  assert.equal(bound, 1); assert.equal(files.hidden, true); assert.equal(source.hidden, true); assert.equal(content.hidden, false);
  handlers.get(filesToggle).click(); assert.equal(files.hidden, false); assert.equal(source.hidden, true);
  handlers.get(sourceToggle).click(); assert.equal(files.hidden, true); assert.equal(source.hidden, false);
  handlers.get(filesToggle).click(); assert.equal(files.hidden, false); assert.equal(source.hidden, true);
  handlers.get(focusToggle).click(); assert.equal(files.hidden, true); assert.equal(source.hidden, true); assert.equal(classes.has('reader-focus-mode'), true);
});

test('Activity fragment refresh retains the current Chinese display language', async t => {
  const f = await fixture(t, 'zh-CN');
  const response = await f.get('/activity/fragment'); assert.equal(response.status, 200);
  const html = await response.text(); assert.match(html, /没有进行中的工作/u); assert.doesNotMatch(html, /No active work/u);
});
