import assert from 'node:assert/strict';
import test from 'node:test';
import { alignGitDiffRows, renderProjectGitHistoryPanel, renderStageTabs } from '../src/ui/views/project-git-history-view.js';
import { renderRoundTimelineView } from '../src/ui/views/round-timeline-view.js';

const first = 'a'.repeat(40), second = 'b'.repeat(40), boundary = 'c'.repeat(40);
const model = extra => ({ project: { id: 'P', name: 'Project' }, git: { status: 'available', offset: 0, next_offset: 40, selected_commit_id: second,
  commits: [{ id: second, parents: [first, boundary], subject: '<script>Subject</script>', author: '<author>', authored_at: '2026-10-12T10:00:00Z', refs: 'HEAD -> main' }, { id: first, parents: [], subject: 'Root', author: 'Author', authored_at: '2026-10-10T10:00:00Z', refs: '' }],
  files: [{ path: 'folder/<name>.txt', status: 'M' }], diff: { path: 'folder/<name>.txt', binary: false, truncated: false, rows: [
    { kind: 'hunk', text: '@@ -1,2 +1,2 @@' }, { kind: 'remove', old_line: 1, new_line: null, text: '<old>' }, { kind: 'add', old_line: null, new_line: 1, text: '<new>' }, { kind: 'context', old_line: 2, new_line: 2, text: 'same' } ] }, ...extra } });

test('Git view uses actual parent links, bounded page facts and escaped labels instead of fake branch controls', () => {
  const html = renderProjectGitHistoryPanel(model(), { locale: 'zh-CN' });
  assert.match(html, /父提交 →/u); assert.match(html, /本页之外/u); assert.match(html, /起始提交/u);
  assert.match(html, new RegExp(`commit=${first}`, 'u')); assert.doesNotMatch(html, new RegExp(`commit=${boundary}`, 'u'));
  assert.match(html, /offset=40/u); assert.match(html, /本页 2/u);
  assert.match(html, /&lt;script&gt;Subject&lt;\/script&gt;/u); assert.match(html, /&lt;author&gt;/u);
  assert.match(html, /HEAD -&gt; main/u); assert.doesNotMatch(html, /<form|<button|<script>Subject/u);
  assert.match(html, /2026-10-12T10:00:00Z/u);
  assert.match(html, /file=folder%2F%3Cname%3E.txt/u);
});

test('two-column difference keeps hunk, old/new numbers and every source row when changed sides differ in length', () => {
  const aligned = alignGitDiffRows([{ kind: 'remove', old_line: 1, text: 'old1' }, { kind: 'remove', old_line: 2, text: 'old2' }, { kind: 'add', new_line: 1, text: 'new1' }, { kind: 'notice', text: 'bounded notice' }]);
  assert.equal(aligned.length, 3); assert.equal(aligned[0].before.text, 'old1'); assert.equal(aligned[0].after.text, 'new1');
  assert.equal(aligned[1].before.text, 'old2'); assert.equal(aligned[1].after, null); assert.equal(aligned[2].text, 'bounded notice');
  const html = renderProjectGitHistoryPanel(model(), { locale: 'en' });
  assert.match(html, /@@ -1,2 \+1,2 @@/u); assert.match(html, /git-diff-old-number">1/u); assert.match(html, /git-diff-new-number">1/u);
  assert.match(html, /git-line-remove/u); assert.match(html, /git-line-add/u); assert.match(html, /&lt;old&gt;/u); assert.match(html, /&lt;new&gt;/u);
  assert.match(html, /Parent version/u); assert.match(html, /This commit/u);
});

test('binary, truncated, unsupported and missing selection states remain explicit without executable controls', () => {
  const binary = renderProjectGitHistoryPanel(model({ diff: { path: 'folder/<name>.txt', binary: true, truncated: true, rows: [] }, files_truncated: true }), { locale: 'en' });
  assert.match(binary, /Binary file/u); assert.match(binary, /Difference truncated/u); assert.match(binary, /File list truncated/u);
  const unknown = renderProjectGitHistoryPanel(model({ status: 'unsupported', notice: '<safe notice>' }), { locale: 'en' });
  assert.match(unknown, /not supported/u); assert.match(unknown, /&lt;safe notice&gt;/u); assert.doesNotMatch(unknown, /git-diff-table/u);
  const empty = renderProjectGitHistoryPanel(model({ commits: [], selected_commit_id: null, files: [], diff: null }), { locale: 'en' });
  assert.match(empty, /No commits to display/u);
  const unsafe = renderProjectGitHistoryPanel(model({ files: [{ path: '../../outside', status: 'M' }], diff: null }), { locale: 'en' });
  assert.doesNotMatch(unsafe, /file=|\.\.\/\.\.\/outside/u);
});

test('Atlas stage tab retains Project and recovery form values while Git is a distinct read-only source', () => {
  const tabs = renderStageTabs('/projects/P', 'zh-CN', 'git'); assert.match(tabs, /href="\/projects\/P\/rounds\?view=git" aria-current="page"/u);
  const html = renderRoundTimelineView({ project: { id: 'P', name: 'Project' }, base: '/projects/P', round: { round_id: 'ROUND-1', label: 'Protected', revision: 7, current_digest: 'digest', head_node_id: 'N1', nodes: [{ node_id: 'N1', kind: 'before', files: [] }], paths: [] } }, { locale: 'en', csrfToken: 'csrf-stage' });
  assert.match(html, /name="csrf" value="csrf-stage"/u); assert.match(html, /name="action" value="preview_restore"/u);
  assert.match(html, /name="base_revision" value="7"/u); assert.match(html, /name="expected_digest" value="digest"/u);
  assert.match(html, /name="node_id" value="N1"/u);
  assert.match(html, /href="\/projects\/P\/rounds" aria-current="page"/u);
  assert.match(html, /href="\/projects\/P\/rounds\?view=git"/u);
});
