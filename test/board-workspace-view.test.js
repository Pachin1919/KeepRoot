import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBoardView } from '../src/ui/views/board-view.js';

function page(blocks, overrides = {}) {
  return renderBoardView({ mode: 'detail', base: '/projects/P1', project: { id: 'P1', name: 'Board project' }, resources: [], results: [], folders: [{ relative_path: 'Results' }], board: { board_id: 'B1', title: 'District report', revision: 7, freshness: { status: 'needs_review' }, blocks }, ...overrides }, { locale: 'en', csrfToken: 'csrf-board' });
}
const main = html => html.slice(html.indexOf('<main'));

test('Board document keeps ordered identities, safe Markdown notes, editable fields and visible reference warnings', () => {
  const html = main(page([
    { block_id: 'M1', type: 'material_reference', name: 'Source', status: 'missing', reason: 'Source unavailable', version_policy: 'follow_latest', preview: { kind: 'text', content: 'Material body' } },
    { block_id: 'T1', type: 'text', text: '## Findings\n\n**North** leads.\n\n<script>alert(1)</script>\n\n![remote](https://example.com/a.png)' },
    { block_id: 'R1', type: 'result_preview', name: 'Totals', status: 'fresh', version_policy: 'pinned_version', preview: { kind: 'table', content: { columns: ['District', 'Total'], rows: [['North', 312.5]], row_count: 1 } } },
  ]));
  assert.deepEqual([...html.matchAll(/data-board-block-id="([^"]+)"/gu)].map(match => match[1]), ['M1', 'T1', 'R1']);
  assert.match(html, /<h2[^>]*>Findings<\/h2>/u);
  assert.match(html, /<strong>North<\/strong>/u);
  assert.doesNotMatch(html, /<script>|<img[^>]+https:\/\/example\.com/u);
  assert.match(html, /<details class="board-material-preview"><summary>Preview material<\/summary>/u);
  assert.match(html, /<p class="callout warn">Source unavailable<\/p>/u);
  assert.match(html, /class="board-version-policy">Follow latest/iu);
  assert.match(html, /<td>North<\/td><td>312\.5<\/td>/u);
  for (const action of ['edit-text', 'move-up', 'move-down', 'remove', 'policy']) assert.ok(html.includes(`name="action" value="${action}"`));
  assert.match(html, /name="block_id" value="T1"/u);
  for (const form of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gu)) {
    assert.match(form[0], /name="csrf" value="csrf-board"/u);
    assert.match(form[0], /name="base_revision" value="7"/u);
  }
});

test('Board sidebar exposes export and preserves the existing Save preparation contract', () => {
  const html = main(page([{ block_id: 'T1', type: 'text', text: 'Ready for delivery.' }], { notice: 'Review the changed source first.' }));
  assert.match(html, /class="board-workspace"><section class="board-document">/u);
  assert.match(html, /<aside class="board-sidebar"[\s\S]*id="portable-delivery" class="surface board-portable-delivery" open/u);
  assert.match(html, /action="\/projects\/P1\/boards\/B1\/export"/u);
  for (const field of ['folder', 'format', 'file_name']) assert.ok(html.includes(`name="${field}"`));
  assert.match(html, /<option value="html">HTML<\/option>/u);
  assert.match(html, /<option value="md">Markdown<\/option>/u);
  assert.match(html, /name="file_name" value="district-report.html"/u);
  assert.match(html, /file is written when Verified/u);
  assert.match(html, /Review the changed source first\./u);
  assert.match(html, /href="#portable-delivery">Prepare Delivery<\/a>/u);
  assert.match(main(page([], { folders: [] })), /type="submit" disabled>Review portable delivery/iu);
});

test('Board result keeps one table with technical evidence and optional chart collapsed', () => {
  const html = main(page([{ block_id: 'R1', type: 'result_preview', name: 'Totals', status: 'fresh', version_policy: 'pinned_version', analysis_projection: { kind: 'table_work_group_sum', complete: true, groups: [{ value: 'North', sum: 10 }], unit: 'rides', formula: 'sum', measure: 'amount', dimension: 'district', null_policy: 'exclude', grand_total: 10, group_count: 1, save_id: 'S1', result_sha256: 'hash1', board_snapshot_revision: 7 } }]));
  assert.equal((html.match(/<table\b/gu) ?? []).length, 1);
  assert.match(html, /<details class="board-relative-chart">/u);
  assert.match(html, /<details class="board-analysis-evidence">[\s\S]*hash1/u);
});
