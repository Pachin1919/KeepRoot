import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createProjectGitService } from '../src/project-git-service.js';

test('foreign Project identity is refused before Git execution', async () => {
  const service = createProjectGitService({ registry: { show: () => ({ project: { id: 'foreign' }, location: { root_path: process.cwd(), relative_path: '' } }) } });
  const result = await service.read({ projectId: 'fixture' });
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.commits, []);
});

const git = (root, args, env = {}) => execFileSync('git', ['-c', 'safe.directory=' + root, '-c', 'user.name=Atlas fixture', '-c', 'user.email=fixture@example.invalid', ...args], {
  cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', ...env }, windowsHide: true,
}).trim();
function fixture(t) {
  const root = fs.mkdtempSync(path.resolve('test/.tmp/project-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-b', 'main']);
  const service = createProjectGitService({ registry: { show: id => ({ project: { id }, location: { root_path: root, relative_path: '' } }) } });
  return { root, service, read: options => service.read({ projectId: 'fixture', ...options }),
    commit(subject, date = '2026-10-01T12:00:00+08:00') {
      git(root, ['add', '-A']); git(root, ['commit', '-m', subject], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
      return git(root, ['rev-parse', 'HEAD']);
    } };
}
function state(root) {
  return { head: git(root, ['rev-parse', 'HEAD']), index: fs.readFileSync(path.join(root, '.git/index')).toString('hex'),
    status: git(root, ['status', '--porcelain']), contents: fs.readFileSync(path.join(root, 'text.txt'), 'utf8') };
}

test('actual root, modified, deleted and binary diffs preserve HEAD/index/dirty files', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'text.txt'), 'first\nkept\n');
  fs.writeFileSync(path.join(f.root, 'deleted.txt'), 'gone\n');
  const initial = f.commit('root <unsafe>');
  fs.writeFileSync(path.join(f.root, 'text.txt'), 'changed\nkept\n');
  fs.rmSync(path.join(f.root, 'deleted.txt'));
  fs.writeFileSync(path.join(f.root, 'binary.dat'), Buffer.from([0, 1, 2, 3]));
  const modified = f.commit('modified', '2026-10-02T12:00:00+08:00');
  fs.writeFileSync(path.join(f.root, 'text.txt'), 'dirty working content\n');
  const before = state(f.root);
  const inherited = process.env.GIT_DIR; process.env.GIT_DIR = path.join(f.root, 'not-a-repository');
  let history;
  try { history = await f.read({}); }
  finally { if (inherited === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = inherited; }
  assert.equal(history.status, 'available');
  assert.deepEqual(history.commits.map(item => item.id), [modified, initial]);
  assert.deepEqual(history.commits[0].parents, [initial]);
  assert.deepEqual(history.commits[1].parents, []);
  assert.equal(history.commits[0].authored_at, '2026-10-02T12:00:00+08:00');
  assert.equal(history.commits[0].author, 'Atlas fixture');
  assert.match(history.commits[0].refs, /main/);
  assert.equal(history.commits[1].subject, 'root <unsafe>');
  assert.deepEqual(history.files.map(item => [item.path, item.status]), [['binary.dat', 'A'], ['deleted.txt', 'D'], ['text.txt', 'M']]);
  const diff = (await f.read({ commitId: modified, filePath: 'text.txt' })).diff;
  assert.deepEqual(diff.rows.filter(row => row.kind !== 'hunk'), [
    { kind: 'remove', old_line: 1, new_line: null, text: 'first' },
    { kind: 'add', old_line: null, new_line: 1, text: 'changed' },
    { kind: 'context', old_line: 2, new_line: 2, text: 'kept' },
  ]);
  const deleted = (await f.read({ commitId: modified, filePath: 'deleted.txt' })).diff;
  assert.equal(deleted.rows[1].kind, 'remove'); assert.equal(deleted.rows[1].text, 'gone');
  assert.equal((await f.read({ commitId: modified, filePath: 'binary.dat' })).diff.binary, true);
  assert.equal((await f.read({ commitId: initial, filePath: 'text.txt' })).diff.rows[1].new_line, 1);
  assert.deepEqual(state(f.root), before);
});

test('selectors are bounded to the actual page and returned paths', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'text.txt'), 'a\n'); const id = f.commit('first');
  for (const options of [{ offset: -1 }, { offset: 10001 }, { offset: '0' }, { commitId: '--all' }, { filePath: '../escape' }, { filePath: '/absolute' }, { filePath: 'C:/absolute' }, { filePath: ':!text.txt' }, { filePath: 'text.txt\0' }]) {
    assert.equal((await f.read(options)).status, 'unavailable');
  }
  for (const options of [{ commitId: 'a'.repeat(40) }, { offset: 1, commitId: id }, { commitId: id, filePath: 'absent.txt' }]) {
    const result = await f.read(options); assert.equal(result.diff, null); assert.ok(result.notice);
  }
});

test('root containment, linked Project directories and .git junctions refuse access', async t => {
  const f = fixture(t); const outside = fs.mkdtempSync(path.resolve('test/.tmp/project-git-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const malicious = createProjectGitService({ registry: { show: id => ({ project: { id }, location: { root_path: f.root, relative_path: '../' + path.basename(outside) } }) } });
  assert.equal((await malicious.read({ projectId: 'fixture' })).status, 'unavailable');
  const linked = path.join(outside, 'linked'); fs.symlinkSync(f.root, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const service = createProjectGitService({ registry: { show: id => ({ project: { id }, location: { root_path: outside, relative_path: 'linked' } }) } });
  assert.notEqual((await service.read({ projectId: 'fixture' })).status, 'available');
  const linkedGit = path.join(outside, '.git'); fs.symlinkSync(path.join(f.root, '.git'), linkedGit, process.platform === 'win32' ? 'junction' : 'dir');
  const other = createProjectGitService({ registry: { show: id => ({ project: { id }, location: { root_path: outside, relative_path: '' } }) } });
  assert.equal((await other.read({ projectId: 'fixture' })).status, 'unsupported');
});

test('parent repositories, gitfiles, external alternates and includes are explicit', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, 'nested'));
  const nested = createProjectGitService({ registry: { show: id => ({ project: { id }, location: { root_path: f.root, relative_path: 'nested' } }) } });
  assert.equal((await nested.read({ projectId: 'fixture' })).status, 'not_repository');
  fs.writeFileSync(path.join(f.root, 'nested/.git'), 'gitdir: ../.git');
  assert.equal((await nested.read({ projectId: 'fixture' })).status, 'unsupported');
  fs.writeFileSync(path.join(f.root, '.git/objects/info/alternates'), '../../elsewhere');
  assert.equal((await f.read({})).status, 'unsupported');
  fs.rmSync(path.join(f.root, '.git/objects/info/alternates'));
  fs.appendFileSync(path.join(f.root, '.git/config'), '\n[include]\n path = ../../outside\n');
  assert.equal((await f.read({})).status, 'unsupported');
});

test('empty and unavailable Git return concise facts without stderr paths', async t => {
  const f = fixture(t); const empty = await f.read({});
  assert.equal(empty.status, 'unavailable'); assert.deepEqual(empty.commits, []); assert.ok(empty.notice);
  const saved = process.env.PATH; process.env.PATH = '';
  try { const unavailable = await f.read({}); assert.equal(unavailable.status, 'unavailable'); assert.ok(!unavailable.notice.includes(f.root)); }
  finally { process.env.PATH = saved; }
});

test('real merge parents and first-parent diff are retained', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'text.txt'), 'base\n'); const base = f.commit('base');
  git(f.root, ['checkout', '-b', 'topic']); fs.writeFileSync(path.join(f.root, 'topic.txt'), 'topic\n'); const topic = f.commit('topic');
  git(f.root, ['checkout', 'main']); fs.writeFileSync(path.join(f.root, 'main.txt'), 'main\n'); const main = f.commit('main');
  git(f.root, ['merge', '--no-ff', 'topic', '-m', 'merge'], { GIT_AUTHOR_DATE: '2026-10-03T12:00:00+08:00', GIT_COMMITTER_DATE: '2026-10-03T12:00:00+08:00' });
  const result = await f.read({});
  assert.deepEqual(result.commits[0].parents, [main, topic]); assert.ok(result.commits.some(item => item.id === base));
  assert.deepEqual(result.files, [{ path: 'topic.txt', status: 'A' }]);
  assert.equal((await f.read({ filePath: 'topic.txt' })).diff.rows[1].text, 'topic');
});

test('row, text and file limits show explicit truncation', async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.root, 'long.txt'), 'x'.repeat(2100) + '\n' + 'line\n'.repeat(510));
  for (let i = 0; i < 51; i++) fs.writeFileSync(path.join(f.root, `z${String(i).padStart(2, '0')}.txt`), 'fixture\n');
  const id = f.commit('limits'); const result = await f.read({ commitId: id, filePath: 'long.txt' });
  assert.equal(result.files.length, 50); assert.equal(result.files_truncated, true);
  assert.equal(result.diff.rows.length, 500); assert.equal(result.diff.truncated, true);
  assert.ok(result.diff.rows.every(row => row.text.length <= 2000));
});
