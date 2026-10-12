import assert from 'node:assert/strict';
import test from 'node:test';
import { renderFileCompareView } from '../src/ui/views/file-compare-view.js';
import { renderRoundTimelineView } from '../src/ui/views/round-timeline-view.js';
import { renderProjectRulesView } from '../src/ui/views/project-rules-view.js';
import { renderModuleAvailabilityView } from '../src/ui/views/module-availability-view.js';
import { renderHandoffView } from '../src/ui/views/handoff-view.js';
import { renderBoardView } from '../src/ui/views/board-view.js';

const project = { id: 'P1', name: 'Example' }, base = '/projects/P1';
const options = { locale: 'en', csrfToken: 'csrf-operator' };
const main = html => html.slice(html.indexOf('<main'));
function hidden(html, name, value) {
  assert.ok(html.includes(`type="hidden" name="${name}" value="${value}"`), `${name} retains ${value}`);
}

test('compare groups workbook inputs while retaining selected files and exact field contract', () => {
  const html = main(renderFileCompareView({ mode: 'project-choose', project, compare_action: `${base}/compare`, choices: [{ relative_path: 'before.xlsx' }, { relative_path: 'after.xlsx' }], left_sheet: 'Sales', right_sheet: 'Sales', key_column: 'ID', period_column: 'Month', event_date_column: 'Date' }, options));
  assert.match(html, /action="\/projects\/P1\/compare"/u);
  hidden(html, 'csrf', options.csrfToken);
  assert.match(html, /<details class="compare-advanced" open>/u);
  for (const [name, value] of Object.entries({ left_sheet: 'Sales', right_sheet: 'Sales', key_column: 'ID', period_column: 'Month', event_date_column: 'Date' })) {
    assert.ok(html.includes(`name="${name}" maxlength="${name.endsWith('sheet') ? 31 : 1200}" value="${value}"`));
  }
  assert.match(html, /select name="left"/u);
  assert.match(html, /select name="right"/u);
  assert.match(html, /value="before.xlsx" selected/u);
  const unsupported = main(renderFileCompareView({ mode: 'unsupported', message: 'Unsupported combination' }, options));
  assert.match(unsupported, /Unsupported combination/u);
  assert.doesNotMatch(unsupported, /<form/u);
  const expired = main(renderFileCompareView({ mode: 'expired' }, { ...options, locale: 'zh-CN' }));
  assert.match(expired, /这份比较结果已过期/u);
  assert.match(expired, /重启后，重新选择同样的两个文件比较即可/u);
  assert.match(expired, /href="\/projects"/u);
  assert.doesNotMatch(expired, /无法比较这两份文件|<form/u);
});

test('comparison result preserves counts, review rows and original-opening identity', () => {
  const html = main(renderFileCompareView({ mode: 'result', comparison_id: 'CMP1', comparison: { sources: { left: { name: 'before.csv', sha256: 'a' }, right: { name: 'after.csv', sha256: 'b' } }, details: { status: 'ready', summary: { changed: 1, added: 2, repeated: 0 }, entries: [{ type: 'changed', key: ['A'], before: 'old', after: 'new' }, { type: 'unchanged', before: 'same', after: 'same' }], time_sources: {} } } }, options));
  assert.match(html, /data-comparison-details/u);
  assert.match(html, /old/u); assert.match(html, /new/u);
  hidden(html, 'comparison_id', 'CMP1'); hidden(html, 'side', 'left'); hidden(html, 'side', 'right');
  assert.match(html, /action="\/compare\/open-original"/u);
  assert.ok(html.indexOf('data-comparison-details') < html.indexOf('<details class="surface compare-context">'));
  assert.match(html, /<details class="surface-flat comparison-unchanged"><summary>Unchanged<\/summary>/u);
  assert.match(html, /class="surface-flat comparison-change"/u);
  assert.ok(html.indexOf('class="surface-flat comparison-change"') < html.indexOf('class="compare-statistics"'));
});

test('protected round list comes first and protection remains preview then token-bound confirmation', () => {
  const model = { project, base, rounds: [{ round_id: 'R1', label: 'Protected source', revision: 2 }], openWorks: [{ session_id: 'W1', intent: 'Review', revision: 4 }], folders: [{ relative_path: 'out' }] };
  const html = main(renderRoundTimelineView(model, options));
  assert.ok(html.indexOf('href="/projects/P1/rounds/R1"') < html.indexOf('<details class="surface round-protect-entry">'));
  hidden(html, 'action', 'preview_protect'); hidden(html, 'csrf', options.csrfToken);
  assert.match(html, /select name="work_id" required/u);
  assert.doesNotMatch(html, /name="action" value="protect"/u);
  const preview = main(renderRoundTimelineView({ ...model, protectPreview: { work_id: 'W1', work_revision: 4, resources: [{ resource_id: 'RES1', path: 'source.csv' }], files: [{ path: 'source.csv', bytes: 9, sha256: 'source-hash' }], save_target: 'out/new.csv', protection_token: 'protection-token' } }, options));
  hidden(preview, 'action', 'protect'); hidden(preview, 'protection_token', 'protection-token');
  assert.match(preview, /source-hash/u); assert.match(preview, /out\/new.csv/u);
});

test('rule review keeps basis, required reasons and original approve/reject/correct calls', () => {
  const html = main(renderProjectRulesView({ project, base, directories: ['out'], preview: { rule_change_id: 'RC1', status: 'prepared', candidate: { kind: 'placement', summary: 'Store results', basis: 'Reviewed destination', value: { target_subdirectory: 'out' } } }, active: [{ rule_id: 'RULE1', rule_version_id: 'RV1', kind: 'placement', summary: 'Confirmed destination', value: { target_subdirectory: 'out' } }] }, options));
  assert.match(html, /Reviewed destination/u);
  assert.match(html, /action="\/projects\/P1\/rules\/RC1"/u);
  for (const action of ['approve', 'reject', 'correct']) hidden(html, 'action', action);
  assert.equal((html.match(/name="reason" maxlength="500" required/gu) ?? []).length, 3);
  assert.match(html, /href="\/projects\/P1\/rules\/RULE1"/u);
  assert.match(html, /<details\b[^>]*><summary>Rule details<\/summary>/u);
  assert.match(html, /RV1/u);
});

test('local module selection opens configuration without executing and keeps permission/revision/output gates', () => {
  const html = main(renderModuleAvailabilityView({ modules: [], projects: [project], local_project: project, local_revision: 7, local_modules: [{ module_id: 'local.demo', module_version: '1', enabled: true, sha256: 'module-hash', permissions: ['node_full_account'] }], local_resources: [{ resource_id: 'RES1', name: 'source.txt' }], module_continue: { module_id: 'local.demo', resource_id: 'RES1', target: 'out/new.txt' } }, options));
  assert.match(html, /name="operator-local-module" open/u);
  assert.match(html, /data-local-module-run-notice/u);
  assert.match(html, /full account permissions/u);
  assert.ok(html.indexOf('data-local-module-run-notice') < html.indexOf('action="/modules/local-preview"'));
  assert.match(html, /action="\/modules\/local-preview"/u);
  hidden(html, 'expected_revision', '7'); hidden(html, 'project_id', 'P1');
  assert.match(html, /value="RES1" selected/u); assert.match(html, /name="target" value="out\/new.txt" required/u);
  assert.doesNotMatch(html, /on(?:click|toggle)=/u);
});

test('Handoff foregrounds unfinished work and exact links while preserving stale refusal and host permission', () => {
  const model = { project, base, resource_items: [{ id: 'RES1', name: 'Source', href: `${base}/resources?resource_id=RES1` }], handoff: { handoff_id: 'H1', work_id: 'W1', digest: 'digest', work_revision: 4, status: 'stale', reason: 'Source changed', changes: ['recoveries'], goal: 'Continue review', package: { resource_ids: ['RES1'], unfinished: ['Check next period'] } }, host_availability: { enabled: true } };
  const html = main(renderHandoffView(model, options));
  assert.ok(html.indexOf('Check next period') < html.indexOf('operator-host-session'));
  assert.match(html, /Source changed/u); assert.match(html, /href="\/work\/W1"/u);
  assert.match(html, /href="\/projects\/P1\/resources\?resource_id=RES1"/u);
  assert.doesNotMatch(html, /action="[^"]*host-sessions"/u);
  const current = main(renderHandoffView({ ...model, handoff: { ...model.handoff, status: 'current' }, host_request_key: 'start-key' }, options));
  hidden(current, 'expected_digest', 'digest'); hidden(current, 'expected_work_revision', '4'); hidden(current, 'handoff_id', 'H1');
  assert.match(current, /class="surface operator-host-session" open/u);
});

test('Board fixed blocks retain original order, stale warning, revisions and all actions', () => {
  const html = main(renderBoardView({ mode: 'detail', project, base, resources: [{ resource_id: 'RES1' }], results: [{ save_id: 'S1' }], folders: [{ relative_path: 'out' }], board: { board_id: 'B1', title: 'Result board', revision: 8, freshness: { status: 'needs_review' }, blocks: [{ block_id: 'M1', type: 'material_reference', resource_id: 'RES1', name: 'Source', status: 'needs_review', reason: 'Source changed', resource_href: `${base}/resources?resource_id=RES1`, version_policy: 'follow_latest' }, { block_id: 'T1', type: 'text', text: 'Review summary' }, { block_id: 'R1', type: 'result_preview', save_id: 'S1', name: 'Saved result', preview: { kind: 'table', content: { columns: ['Region', 'Total'], rows: [['North', 120], ['South', 80]], row_count: 2 } }, status: 'fresh', version_policy: 'pinned_version', result_href: '/work/W1' }] } }, options));
  const ids = [...html.matchAll(/data-board-block-id="([^"]+)"/gu)].map(match => match[1]);
  assert.deepEqual(ids, ['M1', 'T1', 'R1']);
  assert.match(html, /<td>North<\/td><td>120<\/td>/u);
  assert.match(html, /<td>South<\/td><td>80<\/td>/u);
  assert.match(html, /<p class="callout warn">Source changed<\/p>/u);
  hidden(html, 'base_revision', '8'); hidden(html, 'block_id', 'T1');
  for (const action of ['edit-text', 'move-up', 'move-down', 'policy', 'remove']) hidden(html, 'action', action);
  assert.match(html, /action="\/projects\/P1\/boards\/B1\/blocks\/update"/u);
  assert.match(html, /action="\/projects\/P1\/boards\/B1\/export"/u);
  assert.match(html, /<details id="portable-delivery" class="surface board-portable-delivery" open><summary>/u);
  assert.match(html, /<details class="surface board-add-blocks"><summary>/u);
  for (const type of ['text', 'material_reference', 'result_preview']) hidden(html, 'block_type', type);
});
