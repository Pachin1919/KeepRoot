import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { Registry } from '../src/registry.js';
import { startAtlasUiServer } from '../src/ui-server.js';

async function fixture(t) {
  fs.mkdirSync('test/.tmp', { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('test/.tmp/project-git-ui-'));
  const workspace = path.join(directory, 'workspace'), repo = path.join(workspace, 'project'), stateDir = path.join(directory, 'state');
  fs.mkdirSync(repo, { recursive: true });
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_AUTHOR_DATE: '2026-10-10T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-10T10:00:00Z' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture Author', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: repo, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch=main');
  fs.writeFileSync(path.join(repo, 'note.txt'), 'old committed line\ncontext\n');
  fs.writeFileSync(path.join(repo, 'deleted.txt'), 'deleted committed line\n');
  git('add', '--', 'note.txt', 'deleted.txt'); git('commit', '-m', '<img src=x> Root fixture');
  const first = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'note.txt'), 'new committed line\ncontext\n');
  fs.rmSync(path.join(repo, 'deleted.txt')); git('add', '--', 'note.txt', 'deleted.txt'); git('commit', '-m', 'Actual second commit');
  const second = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'note.txt'), 'UNCOMMITTED BODY MUST NOT APPEAR');
  const registry = new Registry({ stateDir });
  const root = registry.adoptRoot({ rootPath: workspace, rootType: 'project_workspace', contentPolicy: 'bounded_content' });
  const id = registry.create({ name: 'Project fixture', currentPath: 'project' }).project_id;
  registry.attachRoot(id, { rootId: root.root_id, relativePath: 'project', reason: 'Git history fixture' });
  const server = await startAtlasUiServer({ stateDir, registry, projectRoot: workspace, installationRoot: workspace });
  t.after(async () => { await server.close(); registry.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  const base = `/projects/${id}/rounds`;
  return { server, repo, id, first, second, git, base, url: query => new URL(`${base}?${new URLSearchParams(query)}`, server.workspace_url) };
}

test('Project stages opens actual read-only Git history and cannot POST a Git action', async t => {
  const f = await fixture(t);
  const response = await fetch(f.url({ view: 'git' })); assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('class="project-git-history"'), 'Expected the Git history panel');
  assert.ok(html.includes(f.second)); assert.ok(html.includes('Actual second commit'));
  const denied = await fetch(f.url({ view: 'git' }), { method: 'POST', body: new URLSearchParams({ action: 'restore' }) });
  assert.equal(denied.status, 405);
});

test('actual commit and deleted file selectors show committed two-column differences and preserve HEAD, index and working content', async t => {
  const f = await fixture(t);
  const before = { head: f.git('rev-parse', 'HEAD'), index: f.git('ls-files', '--stage'), status: f.git('status', '--porcelain=v1'), body: fs.readFileSync(path.join(f.repo, 'note.txt'), 'utf8') };
  const response = await fetch(f.url({ view: 'git', offset: '0', commit: f.second, file: 'note.txt' })); assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('<table class="git-diff-table"')); assert.ok(html.includes('old committed line')); assert.ok(html.includes('new committed line'));
  assert.ok(!html.includes('UNCOMMITTED BODY MUST NOT APPEAR'));
  assert.ok(html.includes(`commit=${f.first}`)); assert.ok(html.includes('2026-10-10T10:00:00'));
  assert.ok(html.includes('git-line-remove')); assert.ok(html.includes('git-line-add'));
  const deleted = await fetch(f.url({ view: 'git', commit: f.second, file: 'deleted.txt' })); assert.equal(deleted.status, 200);
  assert.ok((await deleted.text()).includes('deleted committed line'));
  const rootCommit = await fetch(f.url({ view: 'git', commit: f.first })); assert.equal(rootCommit.status, 200);
  assert.ok((await rootCommit.text()).includes('&lt;img src=x&gt; Root fixture'));
  assert.deepEqual({ head: f.git('rev-parse', 'HEAD'), index: f.git('ls-files', '--stage'), status: f.git('status', '--porcelain=v1'), body: fs.readFileSync(path.join(f.repo, 'note.txt'), 'utf8') }, before);
});

test('invalid selectors show safe notices and Atlas tab and unknown query mode keep the original recovery page', async t => {
  const f = await fixture(t);
  for (const query of [{ view: 'git', offset: '-1' }, { view: 'git', offset: '10001' }, { view: 'git', offset: '1.5' }, { view: 'git', commit: '--all' }, { view: 'git', commit: f.second, file: '../outside' }]) {
    const response = await fetch(f.url(query)); assert.equal(response.status, 409);
    const html = await response.text(); assert.ok(html.includes('class="project-git-history"')); assert.ok(!html.includes('<table class="git-diff-table"'));
    assert.ok(!html.includes(f.repo)); assert.ok(!html.includes('UNCOMMITTED BODY MUST NOT APPEAR'));
  }
  for (const query of [{}, { view: 'unknown' }]) {
    const response = await fetch(f.url(query)); assert.equal(response.status, 200); const html = await response.text();
    assert.ok(!html.includes('class="project-git-history"')); assert.ok(html.includes('round-protect-entry'));
    assert.ok(html.includes(`href="/projects/${f.id}/rounds" aria-current="page"`));
    assert.ok(html.includes(`href="/projects/${f.id}/rounds?view=git"`));
  }
});
