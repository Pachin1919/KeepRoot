import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { projectDirectory, projectPath } from './ui/project-files.js';
import { isPathInside } from './paths.js';

const execute = promisify(execFile);
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MAX_BUFFER = 1024 * 1024;
const safeText = (value, limit) => String(value).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, limit);
function validPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/[\x00-\x1f\\]/.test(value) && !path.posix.isAbsolute(value)
    && !path.win32.isAbsolute(value) && !value.startsWith(':')
    && !value.split('/').some(part => part === '..' || part === '.' || !part);
}
function fail(status, notice) { const error = new Error(notice); error.status = status; throw error; }
function realDirectoryChain(target) {
  let cursor = path.resolve(target);
  while (true) {
    const stat = fs.lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsupported', '项目目录经过链接，暂不支持 Git 历史。');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
function repositoryRoot(registry, projectId, inspectMetadata = true) {
  const detail = registry.show(projectId);
  if (!detail?.project || detail.project.id !== projectId) fail('unavailable', '项目不可用。');
  const location = detail.location;
  if (typeof location?.root_path !== 'string' || typeof location.relative_path !== 'string'
    || path.isAbsolute(location.relative_path) || path.win32.isAbsolute(location.relative_path)) fail('unavailable', '项目目录不可用。');
  const boundary = path.resolve(location.root_path);
  realDirectoryChain(boundary);
  if (!isPathInside(boundary, path.resolve(boundary, location.relative_path))) fail('unavailable', '项目目录不可用。');
  projectPath(boundary, location.relative_path);
  const root = projectDirectory(location);
  if (!isPathInside(boundary, root)) fail('unavailable', '项目目录不可用。');
  const git = path.join(root, '.git');
  let stat;
  try { stat = fs.lstatSync(git); } catch (error) {
    if (error.code === 'ENOENT') fail('not_repository', '此项目根目录没有 Git 仓库。');
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsupported', '工作树或链接 Git 目录暂不支持。');
  // Git may follow refs, packed objects and config metadata. Inspect only this
  // named metadata tree, with an entry budget; never follow a link.
  const queue = inspectMetadata ? [git] : []; let entries = 0;
  while (queue.length) {
    for (const item of fs.readdirSync(queue.pop(), { withFileTypes: true })) {
      if (++entries > 20000) fail('unsupported', 'Git 元数据超出本次读取范围。');
      const target = path.join(item.parentPath, item.name);
      const info = fs.lstatSync(target);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) fail('unsupported', '链接 Git 元数据暂不支持。');
      if (info.isDirectory()) queue.push(target);
    }
  }
  for (const name of ['HEAD', 'config', 'refs', 'objects', 'packed-refs', 'objects/info']) {
    if (fs.existsSync(path.join(git, name))) projectPath(root, '.git/' + name);
  }
  for (const name of ['objects/info/alternates', 'objects/info/http-alternates', 'commondir']) {
    if (fs.existsSync(path.join(git, name))) fail('unsupported', '外部 Git 对象或共享工作树暂不支持。');
  }
  const config = path.join(git, 'config');
  if (fs.statSync(config).size > 65536) fail('unsupported', 'Git 配置超出本次读取范围。');
  const contents = fs.readFileSync(config, 'utf8');
  if (/^\s*\[\s*include(?:if)?\b/im.test(contents) || /^\s*(?:worktree|fsmonitor|partialclone|promisor|worktreeconfig)\s*=/im.test(contents)) fail('unsupported', '外部 Git 配置暂不支持。');
  return root;
}
function environment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_LITERAL_PATHSPECS: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat', GIT_NO_LAZY_FETCH: '1', LC_ALL: 'C' };
}
async function gitRead(root, args) {
  const overrides = ['safe.directory=' + root, 'core.fsmonitor=false', 'core.pager=cat', 'core.attributesFile=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'),
    'diff.external=', 'diff.renames=false', 'diff.algorithm=myers', 'log.showSignature=false', 'color.ui=false'];
  const result = await execute('git', ['--no-pager', '--no-replace-objects', ...overrides.flatMap(value => ['-c', value]),
    '--git-dir=' + path.join(root, '.git'), '--work-tree=' + root, ...args],
  { cwd: root, env: environment(), timeout: 5000, maxBuffer: MAX_BUFFER, encoding: 'utf8', windowsHide: true });
  return result.stdout;
}
// Mechanism adapted from GitHub Desktop's bounded log/first-parent diff and
// hunk counter design (c37f28a); no upstream implementation is copied.
function parseDiff(value, filePath) {
  const result = { path: filePath, binary: false, truncated: false, rows: [] };
  let oldLine = 0; let newLine = 0; let inHunk = false;
  for (const line of value.split('\n')) {
    if (/^Binary files .* differ$/.test(line)) { result.binary = true; continue; }
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    let row;
    if (header) { oldLine = Number(header[1]); newLine = Number(header[2]); inHunk = true; row = { kind: 'hunk', old_line: null, new_line: null, text: line }; }
    else if (inHunk && line.startsWith(' ')) row = { kind: 'context', old_line: oldLine++, new_line: newLine++, text: line.slice(1) };
    else if (inHunk && line.startsWith('-')) row = { kind: 'remove', old_line: oldLine++, new_line: null, text: line.slice(1) };
    else if (inHunk && line.startsWith('+')) row = { kind: 'add', old_line: null, new_line: newLine++, text: line.slice(1) };
    else if (inHunk && line.startsWith('\\')) row = { kind: 'notice', old_line: null, new_line: null, text: '文件末尾没有换行。' };
    if (!row) continue;
    if (result.rows.length >= 500) { result.truncated = true; break; }
    if (row.text.length > 2000) result.truncated = true;
    row.text = row.text.slice(0, 2000); result.rows.push(row);
  }
  return result;
}
export function createProjectGitService({ registry }) {
  return { async read({ projectId, offset = 0, commitId = null, filePath = null }) {
    const result = { project_id: projectId, status: 'unavailable', notice: null, commits: [], offset: 0, next_offset: null,
      selected_commit_id: null, files: [], files_truncated: false, diff: null };
    try {
      if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || (commitId !== null && (typeof commitId !== 'string' || !SHA.test(commitId)))
        || (filePath !== null && !validPath(filePath))) fail('unavailable', 'Git 历史选择无效，请重新选择。');
      result.offset = offset;
      const root = repositoryRoot(registry, projectId);
      const gitIdentity = fs.lstatSync(path.join(root, '.git'));
      // This is a read-only snapshot guard, not a guarantee against hostile
      // simultaneous mutation of Git metadata. Walk metadata once per read;
      // recheck authority and named metadata paths before each subprocess.
      const read = args => {
        if (repositoryRoot(registry, projectId, false) !== root) fail('unavailable', '项目目录已改变，请重新打开历史。');
        const current = fs.lstatSync(path.join(root, '.git'));
        if (current.dev !== gitIdentity.dev || current.ino !== gitIdentity.ino) fail('unavailable', 'Git 目录已改变，请重新打开历史。');
        return gitRead(root, args);
      };
      const head = (await read(['rev-parse', '--verify', '--quiet', 'HEAD'])).trim();
      if (!SHA.test(head)) fail('unavailable', 'Git 历史不可用。');
      const log = await read(['log', '--topo-order', '--max-count=41', '--skip=' + offset,
        '--format=%H%x00%P%x00%s%x00%an%x00%aI%x00%D', '--no-show-signature', '--no-color', '-z', head, '--']);
      const fields = log.split('\0'); const commits = [];
      for (let i = 0; i + 5 < fields.length; i += 6) {
        const id = fields[i].trim(); const parents = fields[i + 1].split(' ').filter(Boolean);
        if (!SHA.test(id) || !parents.every(parent => SHA.test(parent))) fail('unavailable', 'Git 历史格式不可用。');
        commits.push({ id, parents, subject: safeText(fields[i + 2], 160), author: safeText(fields[i + 3], 80), authored_at: fields[i + 4], refs: safeText(fields[i + 5], 240) });
      }
      result.commits = commits.slice(0, 40); result.next_offset = commits.length > 40 && offset + 40 <= 10000 ? offset + 40 : null;
      result.status = 'available';
      result.notice = '显示当前 HEAD 可达的提交；差异与第一父提交比较。未合并分支不在此列表中。';
      if (!result.commits.length) { result.notice = '此页没有提交。'; return result; }
      const selected = commitId === null ? result.commits[0] : result.commits.find(item => item.id === commitId);
      if (!selected) { result.notice = '此提交不在当前页，请重新选择。'; return result; }
      result.selected_commit_id = selected.id;
      const revision = selected.parents.length ? [selected.parents[0], selected.id] : [selected.id];
      const common = ['diff-tree', '--root', '--no-commit-id', '-r', '--no-renames', '--no-ext-diff', '--no-textconv'];
      const names = (await read([...common, '--name-status', '-z', ...revision, '--'])).split('\0');
      const files = [];
      for (let i = 0; i + 1 < names.length; i += 2) {
        if (!/^[AMDTUXB]$/.test(names[i]) || !validPath(names[i + 1])) continue;
        files.push({ path: names[i + 1], status: names[i] });
      }
      result.files = files.slice(0, 50); result.files_truncated = files.length > 50;
      if (filePath === null) return result;
      if (!result.files.some(item => item.path === filePath)) { result.notice = '此文件不在当前提交的文件列表中。'; return result; }
      try { result.diff = parseDiff(await read([...common, '--patch', '--no-color', '--unified=3', ...revision, '--', filePath]), filePath); }
      catch (error) {
        if (error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error;
        result.diff = { path: filePath, binary: false, truncated: true, rows: [{ kind: 'notice', old_line: null, new_line: null, text: '差异超过 1 MiB，无法在此显示。' }] };
      }
      return result;
    } catch (error) {
      result.status = error.status ?? 'unavailable';
      result.notice = error.status ? error.message : error.code === 'ENOENT' ? 'Git 未安装或项目目录不可用。' : 'Git 历史暂时不可用；仓库可能为空或超出读取范围。';
      return result;
    }
  } };
}
