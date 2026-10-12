import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Registry } from '../src/registry.js';
import { Catalog } from '../src/catalog.js';
import { createProjectViewService } from '../src/project-view-service.js';

function fixture(t) {
  fs.mkdirSync(path.resolve('test/.tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.resolve('test/.tmp/search-snippets-'));
  const stateDir = path.join(root, 'state');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(path.join(workspace, 'A'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'B'), { recursive: true });
  const registry = new Registry({ stateDir });
  const adopted = registry.adoptRoot({ rootPath: workspace, rootType: 'project_workspace', contentPolicy: 'bounded_content' });
  const projects = ['A', 'B'].map((name) => {
    const project = registry.create({ name, currentPath: name });
    registry.attachRoot(project.project_id, { rootId: adopted.root_id, relativePath: name, reason: 'Search snippet fixture.' });
    return { ...project, name };
  });
  const service = createProjectViewService({ stateDir, registry });
  const catalog = new Catalog({ stateDir, registry });
  t.after(() => {
    catalog.dispose(); service.dispose(); registry.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const add = (name, text, project = projects[0], register = true) => {
    const filePath = path.join(workspace, project.name, name);
    fs.writeFileSync(filePath, text);
    const resource = register ? service.resources.identify({ filePath, project: { id: project.project_id, name: project.name } }) : null;
    return { filePath, resource };
  };
  const search = (terms, options = {}) => service.evaluateConfiguration({
    projectId: projects[0].project_id,
    config: { membership: 'registered_local', fulltext: { terms, match: 'any' } },
    limit: 20, ...options,
  });
  return { stateDir, projects, service, catalog, add, search };
}

test('registered search returns real bounded Unicode body context for the first matching term', (t) => {
  const f = fixture(t);
  const body = '😀'.repeat(500) + '前文通勤后文' + '🚲'.repeat(600);
  const item = f.add('body.txt', body);
  const generation = f.catalog.update({ projectId: f.projects[0].project_id });
  const result = f.search(['交通', '通勤']);
  assert.equal(result.members.length, 1);
  const member = result.members[0];
  assert.equal(member.resource_id, item.resource.resource_id);
  assert.equal(member.catalog_index.generation_id, generation.generation_id);
  assert.equal(member.catalog_index.content_hash, member.catalog_index.registered_content_hash);
  assert.equal(member.catalog_index.snippet, [...body].slice(422, 822).join(''));
  assert.equal([...member.catalog_index.snippet].length, 400);
  assert.match(member.catalog_index.snippet, /前文通勤后文/u);
  assert.equal(Object.hasOwn(member.catalog_index, 'body'), false);
  assert.equal(member.file_verification, 'not_checked');
});

test('registered search handles long and literal SQL-special terms without markup or full bodies', (t) => {
  const f = fixture(t);
  const longTerm = 'representative-search-term';
  const literal = "50%_\\' OR 1=1 --";
  const longBody = 'a'.repeat(550) + longTerm + ' context ' + 'b'.repeat(600);
  f.add('long.txt', longBody);
  f.add('literal.txt', `before ${literal} after`);
  f.add('noise.txt', '50 percent and unrelated data');
  f.catalog.update({ projectId: f.projects[0].project_id });
  const long = f.search([longTerm]);
  assert.equal(long.members.length, 1);
  assert.equal(long.members[0].catalog_index.snippet, longBody.slice(470, 870));
  const special = f.search([literal]);
  assert.equal(special.members.length, 1);
  assert.equal(special.members[0].catalog_index.snippet, `before ${literal} after`);
});

test('title-only matches return indexed title and body wins over earlier metadata-only term', (t) => {
  const f = fixture(t);
  f.add('交通标题.txt', 'ordinary body without search terms');
  f.add('交通正文.txt', 'a'.repeat(500) + '通勤正文上下文' + 'b'.repeat(500));
  f.catalog.update({ projectId: f.projects[0].project_id });
  const result = f.search(['交通', '通勤']);
  assert.equal(result.members.length, 2);
  const title = result.members.find((member) => member.name === '交通标题.txt');
  assert.equal(title.catalog_index.snippet, '交通标题');
  const body = result.members.find((member) => member.name === '交通正文.txt');
  assert.match(body.catalog_index.snippet, /通勤正文上下文/u);
  assert.equal(body.catalog_index.snippet.includes('交通正文'), false);
});

test('registered snippets preserve index availability, Project, registration, Hash and missing-file boundaries', (t) => {
  const f = fixture(t);
  const target = f.add('target.txt', '交通原始正文');
  const changed = f.add('changed.txt', '交通旧正文');
  const missing = f.add('missing.txt', '交通已删除正文');
  const invalidated = f.add('invalidated.txt', '交通失效正文');
  f.add('unregistered.txt', '交通未登记正文', f.projects[0], false);
  f.add('foreign.txt', '交通其他项目正文', f.projects[1]);
  assert.equal(f.search(['交通']).fulltext_index.status, 'index_unavailable');
  assert.deepEqual(f.search(['交通']).members, []);
  f.catalog.update({ projectId: f.projects[0].project_id });
  f.catalog.update({ projectId: f.projects[1].project_id });
  const first = f.search(['交通'], { limit: 1 });
  assert.equal(first.known_total, 4);
  assert.ok(first.continuation);
  const second = f.search(['交通'], { limit: 1, continuation: first.continuation });
  assert.notEqual(first.members[0].resource_id, second.members[0].resource_id);
  assert.match(second.members[0].catalog_index.snippet, /交通/u);
  f.catalog.invalidate(f.search(['交通']).members.find((member) => member.resource_id === invalidated.resource.resource_id).catalog_index.entry_id);
  assert.throws(() => f.search(['交通'], { limit: 1, continuation: first.continuation }), (error) => error.code === 'ATLAS_EVALUATION_CHANGED');
  fs.writeFileSync(changed.filePath, '交通已经改变且长度不同的正文');
  fs.rmSync(missing.filePath);
  f.catalog.update({ projectId: f.projects[0].project_id });
  // invalidate again after refresh, which legitimately indexes the still-present file.
  f.catalog.invalidate(f.search(['交通']).members.find((member) => member.resource_id === invalidated.resource.resource_id).catalog_index.entry_id);
  f.add('unindexed.txt', '交通未索引正文');
  const result = f.search(['交通']);
  assert.deepEqual(result.members.map((member) => member.resource_id), [target.resource.resource_id]);
  assert.equal(result.members[0].catalog_index.snippet, '交通原始正文');
  assert.equal(result.fulltext_index.coverage.hash_mismatch, 1);
  assert.equal(result.fulltext_index.coverage.unindexed_resources, 3);
});
