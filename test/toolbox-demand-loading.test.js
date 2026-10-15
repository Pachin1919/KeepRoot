import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Registry } from '../src/registry.js';
import { ResourceControl } from '../src/resource-control.js';
import { startAtlasUiServer } from '../src/ui-server.js';

async function fixture(t) {
  fs.mkdirSync('test/.tmp', { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('test/.tmp/toolbox-demand-'));
  const workspace = path.join(directory, 'workspace'); fs.mkdirSync(workspace);
  const stateDir = path.join(directory, 'state'), registry = new Registry({ stateDir });
  const root = registry.adoptRoot({ rootPath: workspace, rootType: 'project_workspace', contentPolicy: 'structure_only' });
  const projects = ['Game', 'Other'].map(name => {
    const folder = path.join(workspace, name); fs.mkdirSync(path.join(folder, 'Data'), { recursive: true });
    const created = registry.create({ name, currentPath: name });
    registry.attachRoot(created.project_id, { rootId: root.root_id, relativePath: name, reason: 'Demand fixture' });
    return registry.show(created.project_id).project;
  });
  const control = new ResourceControl({ stateDir, ledger: registry.ledger, registry });
  const add = (project, name, content = 'value\n1\n') => {
    const file = path.join(workspace, project.name, 'Data', name); fs.writeFileSync(file, content);
    return control.identify({ filePath: file, project }).resource_id;
  };
  const csv = add(projects[0], 'selected.csv'), text = add(projects[0], 'code.md', '# Code');
  const foreign = add(projects[1], 'foreign.csv');
  const server = await startAtlasUiServer({ stateDir, registry, intake: { stateDir }, rules: {},
    resourceControl: control, projectRoot: path.resolve('.'), installationRoot: path.resolve('.') });
  const calls = { list: 0, detail: 0, summary: 0 }, folders = [];
  for (const [method, field] of [['projectResources', 'list'], ['projectResource', 'detail'], ['projectResourceSummaries', 'summary']]) {
    const original = control[method].bind(control);
    t.mock.method(control, method, (...args) => { calls[field]++; return original(...args); });
  }
  const readdir = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (folder, ...args) => {
    const absolute = path.resolve(folder);
    if (absolute.startsWith(workspace + path.sep)) folders.push(absolute);
    return readdir(folder, ...args);
  });
  t.after(async () => { await server.close(); control.dispose(); registry.dispose();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 }); });
  const get = async (tool = '') => {
    const url = new URL('/toolbox', server.workspace_url); url.searchParams.set('project_id', projects[0].id);
    if (tool) url.searchParams.set('tool', tool);
    const response = await fetch(url); return { status: response.status, html: await response.text() };
  };
  return { directory, workspace, projects, control, server, calls, folders, csv, text, foreign, add, get };
}

test('selected-Project Toolbox catalog loads no material details or destination folders', async t => {
  const f = await fixture(t), page = await f.get();
  assert.equal(page.status, 200);
  assert.equal([...page.html.matchAll(/data-toolbox-tool="[a-z]+"/gu)].length, 5);
  assert.deepEqual(f.calls, { list: 0, detail: 0, summary: 0 });
  assert.deepEqual(f.folders, []);
  assert.doesNotMatch(page.html, /name="resource_ids"/u);
});

test('table tools use one metadata batch and show only current-Project tables without folder scans', async t => {
  const f = await fixture(t), page = await f.get('pipeline');
  assert.equal(page.status, 200);
  assert.deepEqual(f.calls, { list: 0, detail: 0, summary: 1 });
  assert.deepEqual(f.folders, []);
  assert.ok(page.html.includes(`value="${f.csv}"`));
  assert.ok(!page.html.includes(`value="${f.text}"`) && !page.html.includes(`value="${f.foreign}"`));
});

test('public Markdown loads only selected-Project destinations and no table facts', async t => {
  const f = await fixture(t), page = await f.get('markdown');
  assert.equal(page.status, 200);
  assert.deepEqual(f.calls, { list: 0, detail: 0, summary: 0 });
  assert.ok(f.folders.some(folder => folder === path.join(f.workspace, 'Game')));
  assert.ok(!f.folders.some(folder => folder === path.join(f.workspace, 'Other')));
  assert.match(page.html, /<option value="Data"/u);
});

test('a new recorded table appears on the next tool request rather than waiting on a persistent cache', async t => {
  const f = await fixture(t); await f.get('aggregate');
  const added = f.add(f.projects[0], 'new.csv');
  const page = await f.get('aggregate');
  assert.equal(page.status, 200); assert.ok(page.html.includes(`value="${added}"`));
  assert.equal(f.calls.summary, 2); assert.equal(f.calls.detail, 0);
});
