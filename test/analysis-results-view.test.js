import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDataWorkView } from '../src/ui/views/data-work-view.js';

function fixture() {
  return {
    session_id: 'DWT-analysis', project_id: 'PRJ-analysis', revision: 3, preview_revision: 3,
    intent: 'District totals', mapping_complete: true,
    sources: [{ source_key: 'SRC-1', name: 'district.csv', status: 'ready', fingerprint: { sha256: 'a'.repeat(64) }, profile: { profile: { rows: 4, columns: 2, fields: [{ name: 'region' }, { name: 'amount' }] } } }],
    mapping: [], recipe: { version: 3, combine: { operation: 'concatenate' }, steps: [{ operation: 'group-aggregate', dimension: 'region', measure: 'amount', formula: 'sum', unit: 'units' }] },
    preview: { columns: ['region', 'sum'], rows: [['North', 120], ['South', 80]], preview: { rows_shown: 2, total_rows: 2 }, result_summary: { rows: 2, columns: 2 }, validation: { input_rows: 4, output_rows: 2, null_cells: 0, duplicate_rows: 0, conversion_failures: {} }, aggregation: { dimension: 'region', measure: 'amount', unit: 'units', included_rows: 3, excluded_rows: 1, grand_total: 200, groups: [{ value: 'North', sum: 120, rows: 2 }, { value: 'South', sum: 80, rows: 1 }] } },
    change_review: { status: 'fresh', items: [] },
  };
}
const model = session => ({ mode: 'sources', session, back_href: '/projects/PRJ-analysis/resources', csrf: 'fixture-token' });
const render = session => renderDataWorkView(model(session), { locale: 'en' });
const result = html => html.match(/<section[^>]*data-primary-result>[\s\S]*?<\/section>/u)?.[0] ?? '';
const table = html => result(html).match(/<table[^>]*data-result-table>[\s\S]*?<\/table>/u)?.[0] ?? '';

test('one authoritative result exposes total once, category POST and one Save entry', () => {
  const html = render(fixture()); const primary = result(html);
  assert.equal((primary.match(/<table /gu) ?? []).length, 1);
  for (const value of [120, 80, 200]) assert.equal((primary.match(new RegExp(`\\b${value}\\b`, 'gu')) ?? []).length, 1);
  assert.doesNotMatch(primary, /<svg|data-work-focus-bars|summary-strip/u);
  assert.equal((html.match(/href="\/work\/DWT-analysis\/save"/gu) ?? []).length, 1);
  assert.match(table(html), /<td>North<\/td><td>120<\/td><td>2<\/td>/u);
  assert.match(table(html), /method="post" action="\/work\/DWT-analysis\/action"/u);
  assert.match(table(html), /name="csrf" value="fixture-token"/u);
  assert.match(table(html), /name="base_revision" value="3"/u);
  assert.match(table(html), /name="category" value="North"/u);
  assert.match(html, /<details class="project-disclosure table-work-editor">/u);
});

test('post-aggregate field selection, sort and rename retain final output and focus identity', () => {
  const session = fixture();
  session.recipe.steps.push({ operation: 'select', columns: ['region', 'sum'] }, { operation: 'sort', column: 'sum', direction: 'asc' }, { operation: 'rename', from: 'region', to: 'Area <name>' });
  session.preview.columns = ['sum', 'Area <name>']; session.preview.rows = [[80, 'South'], [120, 'North']];
  const html = render(session); const primaryTable = table(html);
  assert.match(primaryTable, /<th>sum<\/th><th>Area &lt;name&gt;<\/th>/u);
  assert.match(primaryTable, /<tr><td>80<\/td><td>South<\/td><td>1<\/td>/u);
  assert.ok(primaryTable.indexOf('South') < primaryTable.indexOf('North'));
  assert.match(primaryTable, /name="category" value="South"/u);
  session.recipe.steps.push({ operation: 'select', columns: ['sum'] });
  session.preview.columns = ['sum']; session.preview.rows = [[80], [120]];
  session.preview.result_summary.columns = 1;
  const omitted = render(session);
  assert.doesNotMatch(table(omitted), /name="category"|<td>North/u);
  assert.match(result(omitted), /<details class="analysis-category-selector">/u);
  assert.match(result(omitted), /<option value="South">South<\/option>/u);
  const save = renderDataWorkView({ ...model(session), mode: 'save', projects: [{ id: session.project_id, name: 'Analysis', folders: [{ relative_path: 'Results' }] }] }, { locale: 'en' });
  assert.match(save, /action="\/work\/DWT-analysis\/save\/review"/u);
  const review = renderDataWorkView({ ...model(session), mode: 'review', stage: { stage_id: 'STG-analysis', revision: 3, staged: { sha256: 'b'.repeat(64) }, result: session.preview }, save: { project: { id: session.project_id, name: 'Analysis' }, target: 'Results/result.csv', relative_target: 'Results/result.csv', folder: 'Results', file_name: 'result.csv', format: 'csv' } }, { locale: 'en' });
  assert.match(review, /name="preview_revision" value="3"/u);
  assert.match(review, /2 rows · 1 columns/u);
  assert.match(review, /action="\/work\/DWT-analysis\/save\/confirm"/u);
});

test('focus clear and paged processed details preserve continuation', () => {
  const session = fixture(); session.recipe.steps.unshift({ operation: 'filter', column: 'region', operator: 'equals', value: 'North', focus: true });
  const html = render(session);
  assert.match(result(html), /name="action" value="clear_focus"/u);
  assert.match(result(html), /details\?offset=0&amp;limit=20/u);
  const details = renderDataWorkView({ ...model(session), mode: 'details', details: { focus: { field: 'region', value: 'North' }, offset: 20, limit: 20, next_offset: 40, rows: [['North', 10]], columns: ['region', 'amount'], total: 42, revision: 3, sources: [{ resource_id: 'RES-1', sha256: 'a'.repeat(64) }] } }, { locale: 'en' });
  assert.match(details, /details\?offset=0&amp;limit=20/u); assert.match(details, /details\?offset=40&amp;limit=20/u);
  assert.match(details, /href="\/work\/DWT-analysis"/u);
});

test('invalidated category preview retains active focus and a direct recompute action', () => {
  const session = fixture();
  session.recipe.steps.unshift({ operation: 'filter', column: 'region', value: 'North', focus: true });
  session.preview = null; session.preview_revision = null;
  const html = render(session);
  assert.match(html, /region = North/u);
  assert.match(html, /name="action" value="clear_focus"/u);
  assert.match(html, /name="action" value="preview"/u);
  assert.doesNotMatch(html, /details\?offset=0|href="\/work\/DWT-analysis\/save"/u);
});

test('empty, signed and escaped values remain visible with warning and explicit truncation', () => {
  const session = fixture(); session.preview.rows = [['', 0], ['<Returns>', -20]];
  session.preview.aggregation.groups = [{ value: '', sum: 0, rows: 1 }, { value: '<Returns>', sum: -20, rows: 1 }];
  session.preview.preview.total_rows = 42; session.preview.validation.conversion_failures = { '<amount>': 2 };
  const html = render(session); const primary = result(html);
  assert.match(table(html), /<td>\(Empty category\)<\/td><td>0<\/td>/u);
  assert.match(table(html), /<td>&lt;Returns&gt;<\/td><td>-20<\/td>/u);
  assert.match(table(html), /name="category" value="&lt;Returns&gt;"/u);
  assert.match(primary, /&lt;amount&gt;: 2/u); assert.match(primary, /42/u);
  assert.match(primary, /1 rows excluded/u);
  assert.doesNotMatch(primary, /<Returns>|<amount>/u);
  session.preview.rows = [];
  assert.match(table(render(session)), /No processed input rows/u);
});

test('pivot preserves final fields, shares, ranks and total row without a second total', () => {
  const session = fixture(); delete session.preview.aggregation;
  session.recipe.steps = [{ operation: 'pivot-aggregate', row_dimension: 'region', column_dimension: 'month', measure: 'amount' }];
  session.preview.pivot_aggregation = { included_rows: 3, excluded_rows: 1, grand_total: 200, unit: 'units' };
  session.preview.columns = ['region', 'January', '__total', '__share_percent', '__rank'];
  session.preview.rows = [['North', 120, 120, 60, 1], ['South', 80, 80, 40, 2], ['__TOTAL__', 200, 200, 100, null]];
  const primary = result(render(session));
  assert.equal((primary.match(/<table /gu) ?? []).length, 1);
  assert.match(primary, /<td>North<\/td><td>120<\/td><td>120<\/td><td>60%<\/td><td>1<\/td>/u);
  assert.match(primary, /<td>Total<\/td><td>200<\/td><td>200<\/td><td>100%<\/td><td><\/td>/u);
  assert.doesNotMatch(primary, /grand total 200/u);
});

test('nonanalytic fallback and stale or unready results enforce current-preview visibility', () => {
  const session = fixture(); delete session.preview.aggregation; session.recipe.steps = [{ operation: 'validate' }];
  assert.match(table(render(session)), /<td>North<\/td><td>120<\/td>/u);
  session.preview_revision = 2;
  assert.equal(result(render(session)), ''); assert.doesNotMatch(render(session), /href="\/work\/DWT-analysis\/save"/u);
  session.preview_revision = 3; session.sources[0].status = 'pending';
  assert.equal(result(render(session)), ''); assert.doesNotMatch(render(session), /href="\/work\/DWT-analysis\/save"/u);
});

test('Python pivot strings use canonical types without changing dimension IDs or shaped output', () => {
  const session = fixture(); delete session.preview.aggregation;
  session.recipe.steps = [{ operation: 'pivot-aggregate' }];
  session.preview.pivot_aggregation = {
    row_dimension: '地区', column_totals: [{ value: '一月' }, { value: '二月' }],
    output_columns: ['row:地区', 'column:1:一月', 'column:2:二月', 'total:金额', 'share_percent', 'dense_rank'],
    included_rows: 3, excluded_rows: 0, grand_total: 470, unit: '金额',
  };
  session.preview.columns = [...session.preview.pivot_aggregation.output_columns];
  session.preview.rows = [['001', '300.0', '100.0', '400.0', '85.11', '1.0'], ['__TOTAL__', '370.0', '100.0', '470.0', '100.0', null]];
  const html = table(renderDataWorkView(model(session), { locale: 'zh-CN' }));
  assert.match(html, /<th>地区<\/th><th>一月<\/th><th>二月<\/th>/u);
  assert.match(html, /<td>001<\/td><td>300<\/td><td>100<\/td><td>400<\/td><td>85\.11%<\/td><td>1<\/td>/u);
  session.recipe.steps.push({ operation: 'rename', from: 'share_percent', to: '比例' });
  session.preview.columns[4] = '比例';
  assert.match(table(render(session)), /<th>比例<\/th>/u);
  assert.match(table(render(session)), /<td>85\.11%<\/td>/u);
  assert.deepEqual(session.preview.rows[0], ['001', '300.0', '100.0', '400.0', '85.11', '1.0']);
});

test('verified Save opens the Reader with Resource and recorded hash', () => {
  const session = fixture();
  const html = renderDataWorkView({ ...model(session), mode: 'saved', record: { project: { id: session.project_id, name: 'Analysis' }, sources: [{ path: 'district.csv' }], output_status: 'verified', result_path: 'Results/result.csv', result_summary: { rows: 2, columns: 2 }, resource_id: 'RES-saved', verification: { sha256: 'b'.repeat(64) } } }, { locale: 'en' });
  assert.match(html, /resources\/read\?resource_id=RES-saved/u);
  assert.match(html, /expected_sha256=b{64}/u);
});

test('multiple analytic summaries keep one final table and selector truncation is explicit', () => {
  const session = fixture();
  session.preview.trend_aggregation = { previous_period: { total: 10 }, current_period: { total: 20 }, delta: 10, growth_percent: 100, included_rows: 3, excluded_empty_rows: 1, out_of_range_rows: 2 };
  session.preview.columns = ['sum']; session.preview.rows = [[120], [80]];
  session.recipe.steps.push({ operation: 'select', columns: ['sum'] });
  session.preview.aggregation.groups = Array.from({ length: 31 }, (_, index) => ({ value: `Category ${index}`, sum: index, rows: 1 }));
  const primary = result(render(session));
  assert.equal((primary.match(/data-result-table/gu) ?? []).length, 1);
  assert.equal((primary.match(/<option /gu) ?? []).length, 30);
  assert.match(primary, /Showing 30 of 31 categories/u);
  assert.match(primary, /Previous period 10 · current period 20 · change 10 · growth 100%/u);
  assert.match(primary, /1 empty measures excluded · 2 rows outside range/u);
});
