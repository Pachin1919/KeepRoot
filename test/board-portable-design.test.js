import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { BoardService } from '../src/board-service.js';
import { Registry } from '../src/registry.js';
import { createResourceControl } from '../src/resource-control.js';
import { SaveService } from '../src/save-service.js';
import { contentFileFingerprint } from '../src/content-inspection.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.resolve('test/.tmp/board-portable-design-'));
  const workspace = path.join(root, 'workspace');
  const projectRoot = path.join(workspace, 'Report');
  fs.mkdirSync(path.join(projectRoot, 'Data'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'Results'), { recursive: true });
  const stateDir = path.join(root, 'state');
  const registry = new Registry({ stateDir });
  const adopted = registry.adoptRoot({ rootPath: workspace, rootType: 'project_workspace', contentPolicy: 'bounded_content' });
  const project = registry.create({ name: 'Report', currentPath: 'Report' });
  registry.attachRoot(project.project_id, { rootId: adopted.root_id, relativePath: 'Report', reason: 'Portable document fixture.' });
  const control = createResourceControl({ stateDir, ledger: registry.ledger });
  const saves = new SaveService({ stateDir, resourceControl: control });
  const service = new BoardService({ stateDir, registry, resourceControl: control, saveService: saves });
  const material = (name, bytes) => {
    const filePath = path.join(projectRoot, 'Data', name);
    fs.writeFileSync(filePath, bytes);
    return { ...control.identify({ filePath, project: { id: project.project_id } }), filePath };
  };
  const result = (name, content, source, step = null) => {
    const candidate = path.join(stateDir, name); fs.writeFileSync(candidate, content);
    const fingerprint = contentFileFingerprint(source.filePath);
    const prepared = saves.prepare({ root: workspace, candidateFile: candidate, projectId: project.project_id,
      target: `Report/Results/${name}`, inputs: [source.filePath], origin: 'agent_generated', kind: 'intermediate', channel: 'work',
      requestKey: name, caller: { actor: 'agent', tool: 'portable-design-fixture', client_run_id: name },
      source: { path: source.filePath, resource_id: source.resource_id, fingerprint,
        sources: [{ path: source.filePath, resource_id: source.resource_id, fingerprint }], ...(step ? { recipe: { version: 1, steps: [step] } } : {}) },
      parameters: step ? { work_session_id: 'WORK-portable', table_work_save: { identity: { project_id: project.project_id, work_session_id: 'WORK-portable' } } } : {},
      intent: 'Portable result fixture.' });
    return saves.execute(prepared.save_id, { reason: 'Fixture participant reviewed result.' });
  };
  const board = (blocks) => {
    const created = service.createBoard({ projectId: project.project_id, title: '交付报告 <安全>' });
    return service.saveBoard({ projectId: project.project_id, boardId: created.board_id, title: created.title, baseRevision: created.revision, blocks });
  };
  const delivery = async (saved, name) => {
    const prepared = await service.preparePortableDelivery({ projectId: project.project_id, boardId: saved.board_id, baseRevision: saved.revision,
      target: `Results/${name}.html`, requestKey: name, caller: { actor: 'agent', tool: 'portable-design-fixture', client_run_id: name } });
    return { prepared, document: fs.readFileSync(saves.candidateSnapshot(prepared.save_id).path, 'utf8') };
  };
  t.after(() => { saves.dispose(); control.dispose(); registry.dispose(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });
  return { service, saves, project, projectRoot, material, result, board, delivery };
}

test('portable candidate renders safe Markdown in original block order with actual dates, evidence and offline attachments', async (t) => {
  const f = fixture(t);
  const original = 'name,value\n北区,12\n南区,9\n';
  const source = f.material('数据.csv', original);
  const unsafe = f.material('来源.html', '<script>alert("source")</script><img src="https://example.invalid/remote.png">');
  const result = f.result('成果.csv', original, source);
  const saved = f.board([
    { type: 'text', text: '# 说明\n\n**结论**与 `数据`。\n\n- 第一项\n- 第二项\n\n<script>alert("note")</script>\n\n![远程图](https://example.invalid/image.png)\n\n[危险](javascript:alert(1))' },
    { type: 'result_preview', save_id: result.save_id, version_policy: 'pinned_version' },
    { type: 'material_reference', resource_id: unsafe.resource_id, version_policy: 'follow_latest' },
    { type: 'text', text: '## 最后说明\n\n保留编排顺序。' },
  ]);
  const shown = f.service.showBoard(f.project.project_id, saved.board_id);
  const { document, prepared } = await f.delivery(saved, 'safe-document');
  assert.match(document, /<h2[^>]*>说明<\/h2>/u);
  assert.match(document, /<strong>结论<\/strong>/u);
  assert.match(document, /<code>数据<\/code>/u);
  assert.match(document, /<ul>\s*<li>第一项<\/li>\s*<li>第二项<\/li>/u);
  assert.match(document, /&lt;script&gt;alert/u);
  assert.doesNotMatch(document, /<script\b|<iframe\b|<link\b|<img[^>]+src="https?:|href="javascript:|\son\w+=/iu);
  assert.equal((document.match(/<h1>/gu) ?? []).length, 1);
  assert.match(document, /交付报告 &lt;安全&gt;/u);
  assert.ok(document.includes(`<time datetime="${shown.updated_at}">${shown.updated_at}</time>`));
  assert.ok(document.includes(`snapshot revision ${shown.revision}`));
  assert.deepEqual([...document.matchAll(/<section[^>]+data-block-id="([^"]+)"/gu)].map(match => match[1]), saved.blocks.map(block => block.block_id));
  const resultSection = document.slice(document.indexOf(`data-block-id="${saved.blocks[1].block_id}"`), document.indexOf(`data-block-id="${saved.blocks[2].block_id}"`));
  assert.match(resultSection, /pinned_version/u);
  assert.ok(resultSection.indexOf('<table>') < resultSection.indexOf('<details class="board-evidence">'));
  assert.match(resultSection, /<td>北区<\/td><td>12<\/td>/u);
  const attachment = document.match(/download="成果.csv" href="data:text\/csv;base64,([A-Za-z0-9+/=]+)"/u);
  assert.ok(attachment); assert.equal(Buffer.from(attachment[1], 'base64').toString(), original);
  assert.match(document, /<details class="board-material-preview"><summary>查看材料内容/u);
  assert.ok(document.includes(result.save_id)); assert.ok(document.includes(result.resource_id));
  assert.ok(document.includes(saved.blocks[1].recorded_sha256));
  assert.deepEqual(prepared.issues, []);
  assert.equal(fs.readFileSync(source.filePath, 'utf8'), original);
  assert.equal(fs.readFileSync(unsafe.filePath, 'utf8'), '<script>alert("source")</script><img src="https://example.invalid/remote.png">');
  assert.equal(fs.existsSync(path.join(f.projectRoot, 'Results', 'safe-document.html')), false, 'preparing must retain the Save confirmation step');
});

test('portable candidate keeps missing, oversized and bounded warnings visible while retaining usable inputs', async (t) => {
  const f = fixture(t);
  const kept = f.material('完整.txt', 'readable dependency');
  const missing = f.material('缺失.txt', 'will be absent');
  const oversized = f.material('过大.txt', Buffer.alloc(5 * 1024 * 1024 + 1, 65));
  const bounded = f.material('长文.txt', 'B'.repeat(65000));
  const saved = f.board([kept, missing, oversized, bounded].map(item => ({ type: 'material_reference', resource_id: item.resource_id, version_policy: 'follow_latest' })));
  fs.unlinkSync(missing.filePath);
  const { document, prepared } = await f.delivery(saved, 'warning-document');
  assert.equal(prepared.issues.length, 2);
  const sections = [...document.matchAll(/<section[^>]+data-block-id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/gu)];
  assert.deepEqual(sections.map(match => match[1]), saved.blocks.map(block => block.block_id));
  assert.match(sections[1][2], /class="issue">Not included:/u);
  assert.match(sections[2][2], /class="issue">Not included: file exceeds/u);
  assert.match(sections[3][2], /class="issue">部分内容预览/u);
  assert.ok(sections[3][2].indexOf('部分内容预览') < sections[3][2].indexOf('<details'));
  assert.match(document, /<section class="delivery-issues"><h2>Missing or not included<\/h2><ul>/u);
  assert.equal(fs.readFileSync(kept.filePath, 'utf8'), 'readable dependency');
  assert.equal(fs.statSync(oversized.filePath).size, 5 * 1024 * 1024 + 1);
  assert.equal(fs.readFileSync(bounded.filePath, 'utf8').length, 65000);
});

test('verified aggregate delivery leads with its authoritative table and folds duplicate bars and calculation evidence', async (t) => {
  const f = fixture(t);
  const source = f.material('输入.csv', 'district,amount\nNorth,12.5\nSouth,7\n');
  const result = f.result('合计.csv', 'district,amount\nNorth,12.5\nSouth,7\n', source,
    { operation: 'group-aggregate', dimension: 'district', measure: 'amount', formula: 'sum', unit: 'vehicles', null_policy: 'exclude' });
  const saved = f.board([{ type: 'result_preview', save_id: result.save_id, version_policy: 'pinned_version' }]);
  const shown = f.service.showBoard(f.project.project_id, saved.board_id);
  assert.equal(shown.blocks[0].analysis_projection?.grand_total, 19.5);
  const { document } = await f.delivery(saved, 'aggregate-document');
  const projection = document.slice(document.indexOf('<div class="board-analysis-projection">'));
  const tableEnd = projection.indexOf('</table>');
  assert.ok(tableEnd > 0 && tableEnd < projection.indexOf('<details class="board-chart">'));
  const table = projection.slice(0, tableEnd);
  assert.match(table, /<th>Category<\/th><th>Value<\/th>/u);
  assert.match(table, /<th scope="row">North<\/th><td>12.5 vehicles<\/td>/u);
  assert.doesNotMatch(table, /board-analysis-bar/u);
  assert.match(projection, /<details class="board-chart"><summary>相对数值图/u);
  assert.match(projection, /<details class="board-evidence"><summary>计算来源/u);
  for (const value of [result.save_id, source.resource_id, shown.blocks[0].recorded_sha256, '19.5', 'exclude']) assert.ok(document.includes(value));
  assert.doesNotMatch(document, /<script\b|<link\b|<iframe\b/iu);
});

test('verified trend delivery places monthly values before the collapsed offline chart', async (t) => {
  const f = fixture(t);
  const source = f.material('月度输入.csv', 'date,amount\n2026-01-01,10\n2026-02-01,20\n');
  const result = f.result('趋势.csv', 'month,sum:amount\n2026-01,10\n2026-02,20\n', source,
    { operation: 'trend-aggregate', date_field: 'date', measure: 'amount', formula: 'sum', unit: 'vehicles', null_policy: 'exclude', start_month: '2026-01', current_start_month: '2026-02', end_month: '2026-02' });
  const saved = f.board([{ type: 'result_preview', save_id: result.save_id, version_policy: 'pinned_version' }]);
  const shown = f.service.showBoard(f.project.project_id, saved.board_id);
  assert.equal(shown.blocks[0].dashboard_projection?.growth_percent, 100);
  const { document } = await f.delivery(saved, 'trend-document');
  const projection = document.slice(document.indexOf('<div class="board-analysis-projection">'));
  assert.match(projection, /<th scope="row">2026-01<\/th><td>10 vehicles<\/td>/u);
  assert.match(projection, /<th scope="row">2026-02<\/th><td>20 vehicles<\/td>/u);
  assert.ok(projection.indexOf('</table>') < projection.indexOf('<details class="board-chart">'));
  assert.match(projection, /<details class="board-chart"><summary>月度趋势图 · Monthly trend<\/summary><svg/u);
  assert.match(projection, /Growth 100%/u);
  assert.doesNotMatch(document, /<script\b|<img[^>]+src="https?:|<link\b/iu);
});
