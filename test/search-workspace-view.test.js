import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSearchView } from '../src/ui/views/search-view.js';

const model = {
  project: { id: 'PRJ-search', name: 'Search project' }, action: '/projects/PRJ-search/search',
  query: '北区', scope: 'body', changedSources: true,
  reviewHref: '/projects/PRJ-search/resources', refreshAction: '/projects/PRJ-search/search/index',
  index: { status: 'available', completed_at: '2026-10-11T03:00:00Z', coverage: { unindexed_resources: 2, hash_mismatch: 1 } },
  items: [{ kind: 'file', name: '报告.md', project_id: 'PRJ-search', project_name: 'Search project', relative_path: '资料/报告.md', href: '/projects/PRJ-search/resources/read?resource_id=RES-search&return_to=%2Fprojects%2FPRJ-search%2Fsearch' }],
};

test('compact body search keeps coverage exclusions visible and exact Reader, query and authorized refresh actions', () => {
  const html = renderSearchView(model, { locale: 'zh-CN', csrfToken: 'csrf-search' });
  const main = html.slice(html.indexOf('<main'));
  assert.match(main, /class="page search-workbench"/u);
  const beforeDetails = main.slice(0, main.indexOf('<details class="search-index-details">'));
  assert.match(beforeDetails, /未纳入：3/u);
  assert.match(beforeDetails, /旧正文结果已隐藏/u);
  assert.match(beforeDetails, /href="\/projects\/PRJ-search\/resources"/u);
  assert.match(main, /name="scope"[^]*value="body" selected/u);
  assert.match(main, /name="q"[^]*value="北区"/u);
  assert.match(main, /method="post" action="\/projects\/PRJ-search\/search\/index"/u);
  assert.match(main, /name="csrf" value="csrf-search"/u);
  assert.match(main, /仅在 Workspace 已授权正文索引时可用/u);
  assert.match(main, /href="\/projects\/PRJ-search\/resources\/read\?resource_id=RES-search&amp;return_to=/u);
  assert.match(main, /报告\.md/u);
});

test('unavailable body index is explicit and does not invent results or grant refresh permission', () => {
  const html = renderSearchView({ ...model, query: '<script>', items: [], index: { status: 'unavailable' }, refreshAction: null, reviewHref: null, changedSources: false }, { locale: 'en' });
  const main = html.slice(html.indexOf('<main'));
  assert.match(main, /The body index is unavailable/u);
  assert.doesNotMatch(main, /Update body index|method="post"|RES-search|<script>/u);
  assert.match(main, /value="&lt;script&gt;"/u);
});
