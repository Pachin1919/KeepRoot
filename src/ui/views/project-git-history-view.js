import { escapeHtml } from '../components.js';
import { normalizeUiLocale } from '../i18n.js';

// Original HTML adapts Desktop's bounded commit list and before/after row layout.
// No upstream parser, React component or Git execution code is copied.
const h = value => escapeHtml(value ?? '');
const sha = value => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(value ?? '');
const localFile = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\\]/u.test(value)
  && !value.startsWith('/') && !value.startsWith(':') && !/^[a-z]:/iu.test(value) && !value.split('/').some(part => part === '..' || part === '.');
function copy(locale) { return normalizeUiLocale(locale) === 'zh-CN' ? (cn, en) => cn : (cn, en) => en; }

export function renderStageTabs(base, locale, selected = 'atlas') {
  const label = copy(locale);
  return `<nav class="stage-history-tabs" aria-label="${label('历史来源', 'History source')}"><a href="${h(`${base}/rounds`)}"${selected === 'atlas' ? ' aria-current="page"' : ''}>${label('Atlas 存档', 'Atlas records')}</a><a href="${h(`${base}/rounds?view=git`)}"${selected === 'git' ? ' aria-current="page"' : ''}>${label('Git 历史', 'Git history')}</a></nav>`;
}

export function alignGitDiffRows(rows) {
  const result = []; let removed = [], added = [];
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++) result.push({ kind: 'change', before: removed[index] ?? null, after: added[index] ?? null });
    removed = []; added = [];
  };
  for (const row of rows ?? []) {
    if (row.kind === 'remove') { if (added.length) flush(); removed.push(row); }
    else if (row.kind === 'add') added.push(row);
    else { flush(); result.push(row.kind === 'context' ? { kind: 'context', before: row, after: row } : { kind: row.kind, text: row.text }); }
  }
  flush(); return result;
}

export function renderProjectGitHistoryPanel(model, options = {}) {
  const label = copy(options.locale), project = model.project ?? {};
  const base = `/projects/${encodeURIComponent(project.id ?? '')}`;
  const data = model.git ?? { status: 'unavailable', commits: [], files: [] };
  const commits = (data.commits ?? []).filter(commit => sha(commit.id));
  const ids = new Set(commits.map(commit => commit.id));
  const offset = Number.isSafeInteger(data.offset) && data.offset >= 0 ? data.offset : 0;
  const selected = commits.find(commit => commit.id === data.selected_commit_id);
  const files = selected ? (data.files ?? []).filter(file => localFile(file.path)) : [];
  const href = (commitId = null, file = null, page = offset) => {
    const query = new URLSearchParams({ view: 'git', offset: String(page) });
    if (commitId && ids.has(commitId)) query.set('commit', commitId);
    if (file && files.some(item => item.path === file)) query.set('file', file);
    return `${base}/rounds?${query}`;
  };
  const date = value => {
    if (!value) return '';
    const parsed = new Date(value);
    const display = Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(normalizeUiLocale(options.locale), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsed);
    return `<time datetime="${h(value)}">${h(display)}</time>`;
  };
  const parents = commit => (commit.parents ?? []).map(parent => ids.has(parent)
    ? `<a href="${h(href(parent))}">${h(parent.slice(0, 8))}</a>`
    : `<span class="git-parent-boundary">${h(parent.slice(0, 8))} · ${label('本页之外', 'outside this page')}</span>`).join(' · ');
  const list = commits.length ? `<ol class="git-commit-list">${commits.map(commit => `<li><a class="git-commit-link" href="${h(href(commit.id))}"${selected?.id === commit.id ? ' aria-current="page"' : ''}><span class="git-commit-node" aria-hidden="true"></span><strong>${h(commit.subject)}</strong><small>${h(commit.id.slice(0, 8))} · ${h(commit.author)}</small>${date(commit.authored_at)}${commit.refs?.length ? `<span class="git-ref-label">${h(Array.isArray(commit.refs) ? commit.refs.join(' · ') : commit.refs)}</span>` : ''}</a><div class="git-parent-links"><span>${commit.parents?.length ? label('父提交 →', 'Parents →') : label('起始提交', 'Root commit')}</span> ${parents(commit)}</div></li>`).join('')}</ol>` : `<p class="git-empty">${label('没有可显示的提交。', 'No commits to display.')}</p>`;
  const paging = `<nav class="git-history-pagination" aria-label="${label('提交分页', 'Commit pages')}">${offset ? `<a href="${h(href(null, null, Math.max(0, offset - 40)))}">${label('较新提交', 'Newer commits')}</a>` : ''}${Number.isSafeInteger(data.next_offset) && data.next_offset > offset && data.next_offset <= 10000 ? `<a href="${h(href(null, null, data.next_offset))}">${label('较早提交', 'Older commits')}</a>` : ''}<span>${label('本页', 'This page')} ${commits.length} · ${label('起始位置', 'Offset')} ${offset}</span></nav>`;
  const selectedMeta = selected ? `<header class="git-selected-commit"><h2>${h(selected.subject)}</h2><p>${h(selected.author)} · ${date(selected.authored_at)}</p><details><summary>${label('提交标识与父提交', 'Commit identity and parents')}</summary><code>${h(selected.id)}</code><p>${parents(selected) || label('无父提交。', 'No parents.')}</p></details></header>` : `<p class="git-empty">${label('选择一个提交查看已提交文件。', 'Select a commit to inspect committed files.')}</p>`;
  const fileList = selected ? `<nav class="git-file-list" aria-label="${label('提交文件', 'Committed files')}">${files.map(file => `<a href="${h(href(selected.id, file.path))}"${data.diff?.path === file.path ? ' aria-current="page"' : ''}><span>${h(file.status)}</span><code>${h(file.path)}</code></a>`).join('') || `<p>${label('此提交没有可显示的文件变更。', 'No file changes to display for this commit.')}</p>`}${data.files_truncated ? `<p class="callout warn">${label('文件列表已截断，最多显示 50 个。', 'File list truncated to 50 entries.')}</p>` : ''}</nav>` : '';
  const beforeLabel = selected && !selected.parents?.length ? label('空版本', 'Empty version') : label('父版本', 'Parent version');
  const diff = selected && files.some(file => file.path === data.diff?.path) ? data.diff : null;
  const cell = (row, side) => `<td class="git-diff-number git-diff-${side}-number">${h(side === 'old' ? row?.old_line : row?.new_line)}</td><td class="git-diff-code git-diff-${side}${row?.kind === 'remove' ? ' git-line-remove' : row?.kind === 'add' ? ' git-line-add' : ''}"><pre><code>${h(row?.text)}</code></pre></td>`;
  const diffView = diff ? `<section class="git-diff-panel" aria-label="${label('已提交文件差异', 'Committed file difference')}"><h3>${h(diff.path)}</h3><p class="git-diff-legend"><span>− ${beforeLabel}</span><span>+ ${label('此提交', 'This commit')}</span></p>${diff.binary ? `<p class="callout">${label('二进制文件：没有可显示的文本差异。', 'Binary file: no text difference is available.')}</p>` : `<table class="git-diff-table"><thead><tr><th colspan="2">${beforeLabel}</th><th colspan="2">${label('此提交', 'This commit')}</th></tr></thead><tbody>${alignGitDiffRows(diff.rows).map(row => ['hunk', 'notice'].includes(row.kind) ? `<tr class="git-diff-note"><td colspan="4">${h(row.text)}</td></tr>` : `<tr class="git-diff-${row.kind}">${cell(row.before, 'old')}${cell(row.after, 'new')}</tr>`).join('')}</tbody></table>${!diff.rows?.length ? `<p>${label('没有文本差异。', 'No text difference.')}</p>` : ''}`}${diff.truncated ? `<p class="callout warn">${label('差异已截断；只显示有界文本片段。', 'Difference truncated; only a bounded text excerpt is shown.')}</p>` : ''}</section>` : selected && files.length ? `<p class="git-empty">${label('选择文件查看差异。', 'Select a file to read its difference.')}</p>` : '';
  const statusNotice = ({ not_repository: label('此项目根目录没有独立 Git 仓库。', 'This Project root has no independent Git repository.'), unsupported: label('此仓库布局暂不支持读取历史。', 'This repository layout is not supported for history reading.'), unavailable: label('Git 历史暂不可用。', 'Git history is unavailable.') })[data.status];
  return `<section class="project-git-history"><div class="page-intro"><div><h1>${label('Git 历史', 'Git history')}</h1><p class="lede">${label('选择提交，再选择文件查看变化。', 'Select a commit, then a file to inspect changes.')}</p></div><span class="status-pill">${label('只读', 'Read only')}</span></div>${statusNotice ? `<p class="callout warn" role="status">${h(statusNotice)}</p>${data.notice ? `<p class="git-safe-notice">${h(data.notice)}</p>` : ''}` : data.notice ? `<details class="git-safe-notice"><summary>${label('读取范围', 'Read scope')}</summary><p>${h(data.notice)}</p></details>` : ''}${data.status === 'available' ? `<div class="git-history-workbench"><aside class="git-history-commits" aria-label="${label('提交历史', 'Commit history')}">${list}${paging}</aside><section class="git-history-detail">${selectedMeta}${fileList}${diffView}</section></div>` : `<p class="git-empty">${label('可返回 Atlas 存档继续查看保护与恢复。', 'Return to Atlas records to inspect protection and recovery.')}</p>`}</section>`;
}
