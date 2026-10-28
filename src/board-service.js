import crypto from 'node:crypto';
import fs from 'node:fs';
import { assertRecoveryWritable } from './storage/recovery-write-guard.js';
import path from 'node:path';
import { contentFileFingerprint, runDataWork } from './content-inspection.js';
import { Registry } from './registry.js';
import { createResourceControl } from './resource-control.js';
import { SaveService } from './save-service.js';
import { createSavedWorkService, savedResultFreshness, savedResultOutput } from './ui/services/saved-work-service.js';
import { buildResourceImpactLanes } from './ui/services/resource-impact-service.js';
import { renderMarkdown } from './markdown-reader.js';

const BLOCK_TYPES = new Set(['material_reference', 'text', 'result_preview']);
const VERSION_POLICIES = new Set(['follow_latest', 'pinned_version']);
const MAX_BLOCKS = 50;
const MAX_TEXT_LENGTH = 20_000;
const MAX_EMBED_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_EMBED_BYTES = 20 * 1024 * 1024;
const MAX_READABLE_PREVIEW_CHARS = 64_000;
const MAX_TABLE_PREVIEW_ROWS = 5;
const MAX_ANALYSIS_BYTES = 5 * 1024 * 1024;
const MAX_ANALYSIS_GROUPS = 500;

const now = () => new Date().toISOString();
const requiredText = (value, label, maximum = 120) => {
  const normalized = String(value ?? '').trim().normalize('NFC');
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) throw new Error(`${label} is too long.`);
  return normalized;
};
const portable = (value) => String(value ?? '').replaceAll('\\', '/').replace(/^\.\//u, '');
const html = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

const MIME_TYPES = new Map([
  ['.csv', 'text/csv'], ['.tsv', 'text/tab-separated-values'], ['.txt', 'text/plain'], ['.md', 'text/markdown'],
  ['.json', 'application/json'], ['.html', 'text/html'], ['.pdf', 'application/pdf'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.gif', 'image/gif'], ['.webp', 'image/webp'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);

function conflict(message, details = {}) {
  const error = new Error(message);
  error.code = 'ATLAS_STATE_CONFLICT';
  error.details = details;
  return error;
}

function statusLabel(status) {
  return status === 'needs_review' ? 'Needs review' : status === 'missing' ? 'Missing' : status === 'contained' ? 'Pinned version' : 'Fresh';
}

function dataUri(filePath, typePath = filePath) {
  const mime = MIME_TYPES.get(path.extname(typePath).toLowerCase()) ?? 'application/octet-stream';
  return { mime, uri: `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}` };
}

function readablePreview(filePath, mime) {
  if (!mime.startsWith('text/') && mime !== 'application/json') return '';
  const text = fs.readFileSync(filePath, 'utf8').slice(0, 64_000);
  return `<pre>${html(text)}</pre>`;
}

function readableTablePreview(preview) {
  const content = preview?.kind === 'table' ? preview.content : null;
  if (!content?.columns?.length) return '';
  const head = `<tr>${content.columns.map((column) => `<th>${html(column)}</th>`).join('')}</tr>`;
  const body = (content.rows ?? []).map((row) => `<tr>${content.columns.map((_, index) => `<td>${html(row[index] ?? '')}</td>`).join('')}</tr>`).join('');
  const summary = `<p><small>${html(content.row_count ?? content.rows?.length ?? 0)} rows${content.sheet ? ` · ${html(content.sheet)}` : ''}${content.bounded ? ' · preview bounded' : ''}</small></p>`;
  return `${summary}<div class="table-scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function analysisProjectionHtml(projection) {
  if (!projection?.complete) return '';
  if (projection.kind === 'table_work_group_sum') {
    const max = Math.max(1, ...projection.groups.map((item) => Math.abs(item.sum)));
    const rows = projection.groups.map((item) => `<tr><th scope="row">${html(item.value || '(Empty category)')}</th><td>${html(item.sum)} ${html(projection.unit)}</td></tr>`).join('');
    const bars = projection.groups.map((item) => {
      const width = Math.round(Math.abs(item.sum) / max * 100);
      const sign = item.sum < 0 ? 'negative' : item.sum > 0 ? 'positive' : 'zero';
      const left = item.sum < 0 ? `<span style="display:block;justify-self:end;width:${width}%;height:.8rem;background:#b95743"></span>` : '';
      const right = item.sum > 0 ? `<span style="display:block;width:${width}%;height:.8rem;background:#647d62"></span>` : '';
      return `<tr><th scope="row">${html(item.value || '(Empty category)')}</th><td>${html(item.sum)} ${html(projection.unit)}</td><td><span class="board-analysis-bar" role="img" data-sign="${sign}" aria-label="${html(item.value)}: ${html(item.sum)} ${html(projection.unit)}" style="display:inline-grid;grid-template-columns:1fr 1px 1fr;align-items:center;width:180px;height:.8rem">${left}<span style="height:.8rem;background:#4d4943"></span>${right}</span></td></tr>`;
    }).join('');
    return `<div class="board-analysis-projection"><p><strong>${html(projection.formula)}(${html(projection.measure)}) by ${html(projection.dimension)}</strong> · ${html(projection.unit)} · empty values ${html(projection.null_policy)}</p><p><strong>Total: ${html(projection.grand_total)} ${html(projection.unit)}</strong> · ${html(projection.group_count)} groups</p><div class="table-scroll"><table><thead><tr><th>Category</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div><details class="board-chart"><summary>相对数值图 · Relative bars</summary><div class="table-scroll"><table><thead><tr><th>Category</th><th>Value</th><th>Relative bar</th></tr></thead><tbody>${bars}</tbody></table></div></details>${analysisSourceHtml(projection)}</div>`;
  }
  if (projection.kind === 'table_work_pivot_sum') {
    const columns = projection.column_order ?? [];
    const rows = projection.matrix.map((item) => `<tr><th scope="row">${html(item.row || '(Empty category)')}</th>${item.values.map((value) => `<td>${html(value)}</td>`).join('')}<td>${html(item.total)}</td><td>${item.share_percent == null ? '—' : `${html(item.share_percent)}%`}</td><td>${html(item.rank ?? '—')}</td></tr>`).join('');
    return `<div class="board-analysis-projection"><p><strong>Pivot ${html(projection.row_dimension)} × ${html(projection.column_dimension)}</strong> · sum(${html(projection.measure)}) · ${html(projection.unit)} · empty values ${html(projection.null_policy)}</p><p><strong>Grand total: ${html(projection.grand_total)} ${html(projection.unit)}</strong></p><div class="table-scroll"><table><thead><tr><th>${html(projection.row_dimension)}</th>${columns.map((value) => `<th>${html(value)}</th>`).join('')}<th>Total</th><th>Share</th><th>Rank</th></tr></thead><tbody>${rows}</tbody></table></div>${analysisSourceHtml(projection)}</div>`;
  }
  if (projection.kind === 'table_work_trend_sum') {
    const points = projection.monthly_totals;
    const values = points.map((item) => item.sum);
    const min = Math.min(0, ...values); const max = Math.max(0, ...values); const span = Math.max(1, max - min);
    const chartPoints = points.map((item, index) => `${20 + index * (760 / Math.max(1, points.length - 1))},${170 - ((item.sum - min) / span) * 130}`).join(' ');
    const rows = points.map((item) => `<tr><th scope="row">${html(item.month)}</th><td>${html(item.sum)} ${html(projection.unit)}</td></tr>`).join('');
    return `<div class="board-analysis-projection"><p><strong>${html(projection.date_field)} · ${html(projection.start_month)}–${html(projection.end_month)}</strong> · sum(${html(projection.measure)}) · ${html(projection.unit)} · empty values ${html(projection.null_policy)}</p><p>Previous ${html(projection.previous_period.start_month)}–${html(projection.previous_period.end_month)}: ${html(projection.previous_period.total)} ${html(projection.unit)} · Current ${html(projection.current_period.start_month)}–${html(projection.current_period.end_month)}: ${html(projection.current_period.total)} ${html(projection.unit)} · Change ${html(projection.delta)} ${html(projection.unit)} · Growth ${projection.growth_percent == null ? '—' : `${html(projection.growth_percent)}%`}</p><div class="table-scroll"><table><thead><tr><th>Month</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div><details class="board-chart"><summary>月度趋势图 · Monthly trend</summary><svg role="img" aria-label="Monthly trend" viewBox="0 0 800 190" width="100%" height="190"><line x1="20" y1="${170 - ((0 - min) / span) * 130}" x2="780" y2="${170 - ((0 - min) / span) * 130}" stroke="#9b958a"/><polyline points="${chartPoints}" fill="none" stroke="#647d62" stroke-width="3"/>${points.map((item, index) => `<text x="${20 + index * (760 / Math.max(1, points.length - 1))}" y="${170 - ((item.sum - min) / span) * 130 - 8}" text-anchor="middle">${html(item.sum)}</text>`).join('')}</svg></details>${analysisSourceHtml(projection)}</div>`;
  }
  return '';
}

function analysisSourceHtml(projection) {
  return `<details class="board-evidence"><summary>计算来源 · Calculation sources</summary><p><small>Derived from verified Save ${html(projection.save_id)} · Result Resource ${html(projection.resource_id ?? 'not recorded')} · Source Resources ${html((projection.source_resource_ids ?? []).join(', ') || 'not recorded')} · SHA-256 ${html(projection.result_sha256)} · Board snapshot revision ${html(projection.board_snapshot_revision)}.</small></p></details>`;
}

function portableBlockEvidence(block) {
  return `<details class="board-evidence"><summary>文件与版本来源 · File evidence</summary><dl><dt>Resource</dt><dd>${html(block.resource_id ?? 'not recorded')}</dd><dt>Save</dt><dd>${html(block.save_id ?? 'not recorded')}</dd><dt>Path</dt><dd>${html(block.recorded_path ?? block.path ?? 'not recorded')}</dd><dt>SHA-256</dt><dd>${html(block.recorded_sha256 ?? 'not recorded')}</dd><dt>Recorded</dt><dd>${html(block.recorded_at ?? block.recorded_modified_at ?? 'not recorded')}</dd><dt>Block</dt><dd>${html(block.block_id)}</dd><dt>Status</dt><dd>${html(block.reason ?? block.status)}</dd></dl></details>`;
}

const PORTABLE_STYLE = `:root{color-scheme:light}*{box-sizing:border-box}body{font:16px/1.8 "Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;max-width:920px;margin:48px auto;padding:0 32px;color:#252a31;background:#fff}header{padding-bottom:28px;border-bottom:2px solid #252a31}h1{font-size:2rem;line-height:1.35;margin:12px 0;overflow-wrap:anywhere}h2{font-size:1.4rem;line-height:1.45;margin:0 0 16px}h3,h4,h5,h6{font-size:1.1rem;line-height:1.5}main>section,.delivery-issues{padding:28px 0;border-bottom:1px solid #e1e5e9}p{margin:10px 0}a{color:#28597c;text-underline-offset:3px;overflow-wrap:anywhere}img{display:block;max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7f9;padding:16px;border-radius:6px}code{font-family:Consolas,monospace;font-size:.9em}blockquote{border-left:3px solid #bac8d3;margin:16px 0;padding:0 18px;color:#4d5964}.table-scroll{overflow:auto;margin:18px 0}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;border-bottom:1px solid #e1e5e9;padding:10px 12px;white-space:nowrap}thead{background:#f5f7f9}details{margin:16px 0;padding:12px 16px;background:#f7f9fa;border-radius:6px}summary{cursor:pointer;font-size:.9rem;font-weight:600;color:#53616d}small,.block-version{color:#53616d;font-size:.85rem}.issue{color:#923f25;background:#fff5ef;border-left:3px solid #b5603a;padding:10px 14px}.board-evidence dl{display:grid;grid-template-columns:90px minmax(0,1fr);gap:8px;font-size:.85rem}.board-evidence dd{margin:0;overflow-wrap:anywhere}.board-evidence dt{color:#53616d}.document-date{display:flex;gap:8px 20px;flex-wrap:wrap}.board-analysis-projection{margin-top:18px}.board-analysis-projection svg{max-width:100%;height:auto}@media(max-width:600px){body{margin:24px auto;padding:0 18px}h1{font-size:1.65rem}main>section{padding:22px 0}th,td{padding:8px}details{padding:10px}}@media print{body{max-width:none;margin:0;padding:0;font-size:11pt}details{break-inside:avoid}.table-scroll{overflow:visible}a{color:inherit}}`;

function analysisProjectionMarkdown(projection) {
  if (!projection?.complete) return '';
  const sourceLine = `Source: Save \`${projection.save_id}\` · Result Resource \`${projection.resource_id ?? 'not recorded'}\` · Source Resources \`${(projection.source_resource_ids ?? []).join(', ') || 'not recorded'}\` · SHA-256 \`${projection.result_sha256}\` · Board snapshot revision ${projection.board_snapshot_revision}.`;
  let lines;
  if (projection.kind === 'table_work_group_sum') {
    lines = [`Calculation: \`${projection.formula}(${projection.measure}) by ${projection.dimension}\` · Unit: ${projection.unit} · Empty values: ${projection.null_policy}`, `Total: **${projection.grand_total} ${projection.unit}** · ${projection.group_count} groups`, '', '| Category | Value |', '| --- | ---: |', ...projection.groups.map((item) => `| ${(item.value || '(Empty category)').replaceAll('|', '\\|').replaceAll('\n', ' ')} | ${item.sum} ${projection.unit} |`)];
  } else if (projection.kind === 'table_work_pivot_sum') {
    lines = [`Pivot: \`${projection.row_dimension} × ${projection.column_dimension}\` · sum(${projection.measure}) · Unit: ${projection.unit} · Empty values: ${projection.null_policy}`, `Grand total: **${projection.grand_total} ${projection.unit}**`, '', `| ${projection.row_dimension} | ${projection.column_order.join(' | ')} | Total | Share | Rank |`, `| ${['---', ...projection.column_order.map(() => '---:'), '---:', '---:', '---:'].join(' | ')} |`, ...projection.matrix.map((row) => `| ${(row.row || '(Empty category)').replaceAll('|', '\\|')} | ${row.values.join(' | ')} | ${row.total} | ${row.share_percent == null ? '—' : `${row.share_percent}%`} | ${row.rank ?? '—'} |`)];
  } else if (projection.kind === 'table_work_trend_sum') {
    lines = [`Trend: \`${projection.date_field}\` ${projection.start_month}–${projection.end_month} · sum(${projection.measure}) · Unit: ${projection.unit} · Empty values: ${projection.null_policy}`, `Previous ${projection.previous_period.start_month}–${projection.previous_period.end_month}: **${projection.previous_period.total} ${projection.unit}**`, `Current ${projection.current_period.start_month}–${projection.current_period.end_month}: **${projection.current_period.total} ${projection.unit}**`, `Change: **${projection.delta} ${projection.unit}** · Growth: **${projection.growth_percent == null ? '—' : `${projection.growth_percent}%`}**`, '', '| Month | Total |', '| --- | ---: |', ...projection.monthly_totals.map((item) => `| ${item.month} | ${item.sum} ${projection.unit} |`)];
  } else return '';
  lines.push('', sourceLine);
  return lines.join('\n');
}

function parseDelimitedRow(line, delimiter) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) { values.push(value); value = ''; }
    else value += character;
  }
  values.push(value);
  return values;
}

function parseDelimitedText(text, delimiter) {
  const rows = []; let row = []; let value = ''; let quoted = false; let closedQuote = false; let fieldStarted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') { quoted = false; closedQuote = true; }
      else value += character;
      continue;
    }
    if (closedQuote && character !== delimiter && character !== '\r' && character !== '\n') return null;
    if (character === '"' && !fieldStarted && value.length === 0) { quoted = true; fieldStarted = true; continue; }
    if (character === delimiter) { row.push(value); value = ''; closedQuote = false; fieldStarted = false; continue; }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value); value = ''; closedQuote = false; fieldStarted = false;
      if (row.some((cell) => cell !== '') || rows.length === 0) rows.push(row);
      row = []; continue;
    }
    value += character; fieldStarted = true;
  }
  if (quoted) return null;
  if (value !== '' || row.length || text.endsWith(delimiter)) { row.push(value); rows.push(row); }
  return rows;
}

function decimalParts(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d+))?$/u);
  if (!match) return null;
  const scale = match[3]?.length ?? 0;
  const coefficient = BigInt(`${match[1] === '-' ? '-' : ''}${match[2]}${match[3] ?? ''}`);
  return { coefficient, scale };
}

function sumDecimalText(values) {
  const parts = values.map(decimalParts);
  if (parts.some((item) => item == null)) return null;
  const scale = Math.max(0, ...parts.map((item) => item.scale));
  const total = parts.reduce((sum, item) => sum + item.coefficient * (10n ** BigInt(scale - item.scale)), 0n);
  const negative = total < 0n; const digits = String(negative ? -total : total).padStart(scale + 1, '0');
  const text = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.0+$/u, '').replace(/(\.\d*?)0+$/u, '$1') : digits;
  const normalized = negative && text !== '0' ? `-${text}` : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? { text: normalized, number } : null;
}

function delimitedPreview(filePath, delimiter) {
  const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '').split(/\r?\n/u).filter((line) => line.length > 0);
  const columns = parseDelimitedRow(lines[0] ?? '', delimiter);
  return {
    columns,
    rows: lines.slice(1, MAX_TABLE_PREVIEW_ROWS + 1).map((line) => parseDelimitedRow(line, delimiter)),
    row_count: Math.max(0, lines.length - 1),
    bounded: lines.length - 1 > MAX_TABLE_PREVIEW_ROWS,
  };
}

export class BoardService {
  constructor({ stateDir, registry = null, resourceControl = null, saveService = null,
    projectRoot = undefined, installationRoot = undefined, pythonPath = null, runDataWorkFn = runDataWork }) {
    this.stateDir = path.resolve(stateDir);
    this.registry = registry ?? new Registry({ stateDir: this.stateDir });
    this.ownsRegistry = registry == null;
    this.resourceControl = resourceControl ?? createResourceControl({ stateDir: this.stateDir, ledger: this.registry.ledger });
    this.ownsResourceControl = resourceControl == null;
    this.saveService = saveService ?? new SaveService({ stateDir: this.stateDir, resourceControl: this.resourceControl });
    this.ownsSaveService = saveService == null;
    this.savedWork = createSavedWorkService({ stateDir: this.stateDir, saveService: this.saveService });
    this.repository = this.registry.ledger.boards;
    this.projectRoot = projectRoot;
    this.installationRoot = installationRoot;
    this.pythonPath = pythonPath;
    this.runDataWorkFn = runDataWorkFn;
  }

  #project(projectId) {
    const project = this.registry.list().find((item) => item.id === projectId && item.status === 'active');
    if (!project) throw new Error('The selected Project is not available.');
    const location = this.registry.show(project.id).location;
    if (!location?.root_path || location.relative_path == null) throw new Error('The selected Project does not have an available local location.');
    const workspaceRoot = path.resolve(location.root_path);
    const projectRoot = path.resolve(workspaceRoot, ...String(location.relative_path).split('/').filter(Boolean));
    return { project: { id: project.id, name: project.name }, workspaceRoot, projectRoot, relativePath: portable(location.relative_path) };
  }

  #storedBoard(projectId, boardId) {
    this.#project(projectId);
    const board = this.repository.byId(boardId);
    if (!board || board.project_id !== projectId) throw new Error('Board is unavailable in this Project.');
    return board;
  }

  #materialSnapshot(projectId, resourceId) {
    const fact = this.resourceControl.projectResource(projectId, resourceId, { refresh: true });
    const current = fact.external_change?.current;
    return {
      resource_id: resourceId,
      recorded_path: fact.path ?? fact.last_known_location?.path ?? null,
      recorded_sha256: current?.sha256 ?? fact.content_hash ?? null,
      recorded_bytes: current?.bytes ?? fact.bytes ?? null,
      recorded_modified_at: current?.modified_at ?? fact.modified_at ?? null,
    };
  }

  #resultSnapshot(projectId, saveId) {
    const result = this.savedWork.find(saveId);
    if (!result || result.project?.id !== projectId) throw new Error('Result Save is unavailable in this Project boundary.');
    return {
      save_id: saveId,
      recorded_path: result.result_path ?? null,
      recorded_sha256: result.verification?.sha256 ?? result.result_fingerprint?.sha256 ?? null,
      recorded_at: result.executed_at ?? result.created_at ?? null,
    };
  }

  #normalizeBlocks(projectId, inputs, currentBlocks = []) {
    if (!Array.isArray(inputs) || inputs.length > MAX_BLOCKS) throw new Error(`Board supports at most ${MAX_BLOCKS} Blocks.`);
    const currentById = new Map(currentBlocks.map((item) => [item.block_id, item]));
    return inputs.map((input, ordinal) => {
      if (!input || !BLOCK_TYPES.has(input.type)) throw new Error('Board Block type must be material_reference, text, or result_preview.');
      const prior = input.block_id ? currentById.get(input.block_id) : null;
      const blockId = prior?.block_id ?? `BLK-${crypto.randomUUID()}`;
      if (input.type === 'text') {
        const text = requiredText(input.text, 'Board text', MAX_TEXT_LENGTH);
        return { block_id: blockId, ordinal, type: 'text', text };
      }
      const versionPolicy = String(input.version_policy ?? 'follow_latest');
      if (!VERSION_POLICIES.has(versionPolicy)) throw new Error('Board reference policy must be follow_latest or pinned_version.');
      if (input.type === 'material_reference') {
        const resourceId = requiredText(input.resource_id, 'Material Resource id', 100);
        const same = prior?.type === input.type && prior.resource_id === resourceId;
        return { ...(same ? prior : this.#materialSnapshot(projectId, resourceId)), block_id: blockId, ordinal, type: input.type,
          version_policy: versionPolicy };
      }
      const saveId = requiredText(input.save_id, 'Result Save id', 100);
      const same = prior?.type === input.type && prior.save_id === saveId;
      return { ...(same ? prior : this.#resultSnapshot(projectId, saveId)), block_id: blockId, ordinal, type: input.type,
        version_policy: versionPolicy };
    });
  }

  createBoard({ projectId, title }) {
    assertRecoveryWritable(this.resourceControl.ledger.db, { projectId });
    this.#project(projectId);
    return this.repository.create({ projectId, title: requiredText(title, 'Board title'), at: now() });
  }

  listBoards(projectId) {
    this.#project(projectId);
    return this.repository.list(projectId).map((item) => ({ ...item, desktop_href: `/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(item.board_id)}` }));
  }

  saveBoard({ projectId, boardId, title, blocks, baseRevision }) {
    assertRecoveryWritable(this.resourceControl.ledger.db, { projectId });
    const current = this.#storedBoard(projectId, boardId);
    if (Number(baseRevision) !== current.revision) throw conflict('Board changed after it was opened.', { board_id: boardId, current_revision: current.revision });
    const normalized = this.#normalizeBlocks(projectId, blocks, current.blocks);
    return this.repository.save({ projectId, boardId, title: requiredText(title, 'Board title'), blocks: normalized, baseRevision: Number(baseRevision), at: now() });
  }

  #projectMaterialBlock(projectId, block) {
    let fact;
    try { fact = this.resourceControl.projectResource(projectId, block.resource_id, { refresh: true }); }
    catch {
      return { ...block, name: block.resource_id, path: block.recorded_path, status: 'missing', status_label: 'Missing', reason: 'The referenced Material is no longer available in this Project.', resource_href: `/projects/${encodeURIComponent(projectId)}/resources?resource_id=${encodeURIComponent(block.resource_id)}` };
    }
    const state = fact.external_change?.status ?? 'not_checked';
    const currentSha256 = fact.external_change?.current?.sha256 ?? fact.content_hash ?? null;
    const matchesRecorded = Boolean(currentSha256 && block.recorded_sha256 && currentSha256 === block.recorded_sha256);
    let status = 'fresh'; let reason = 'The Material matches the recorded Board version.';
    if (state === 'missing' || !fact.path) { status = 'missing'; reason = 'The referenced Material is missing.'; }
    else if (!matchesRecorded && block.version_policy === 'follow_latest') { status = 'needs_review'; reason = 'The followed Material no longer matches the version recorded by this Board. Review the current file before updating the reference.'; }
    else if (!matchesRecorded) { status = 'needs_review'; reason = 'The pinned Material version is no longer available at this path. Restore that version or explicitly update the Board reference.'; }
    return { ...block, name: fact.resource?.display_name ?? path.basename(fact.path ?? block.recorded_path ?? block.resource_id), path: fact.path ?? block.recorded_path,
      current_sha256: currentSha256, updated_at: fact.modified_at ?? null,
      status, status_label: statusLabel(status), reason, resource_href: fact.desktop_href };
  }

  #projectResultBlock(projectId, block) {
    const result = this.savedWork.find(block.save_id);
    if (!result || result.project?.id !== projectId) return { ...block, name: block.save_id, path: block.recorded_path, status: 'missing', status_label: 'Missing', reason: 'The referenced Result is unavailable in this Project.', result_href: null };
    const output = savedResultOutput(result);
    const freshness = savedResultFreshness(result, { output });
    const isTableWorkAnalysis = this.#tableWorkAnalysisStep(result) != null;
    const inputsCurrent = !isTableWorkAnalysis || this.#tableWorkInputsCurrent(projectId, result);
    const status = !inputsCurrent ? 'needs_review' : freshness.status === 'pinned' ? 'fresh' : freshness.status === 'undone' || freshness.status === 'not_checked' ? 'needs_review' : freshness.status;
    const workId = result.parameters?.work_session_id ?? null;
    return { ...block, name: path.basename(result.result_path ?? block.recorded_path ?? block.save_id), path: result.result_path ?? block.recorded_path,
      current_sha256: output.sha256,
      updated_at: result.executed_at ?? result.created_at ?? null, resource_id: result.resource_id ?? null,
      status, status_label: statusLabel(status), reason: !inputsCurrent ? 'A source used by this saved Table Work Result changed; review the Source before using its analysis.' : freshness.reason,
      work_id: workId, result_href: workId ? `/work/${encodeURIComponent(workId)}/saved?work_id=${encodeURIComponent(block.save_id)}` : result.resources_href ?? null };
  }

  #tableWorkAnalysisStep(result) {
    if (!result?.parameters?.table_work_save?.identity) return null;
    const recipe = result.source?.recipe ?? result.recipe ?? result.parameters?.recipe;
    const step = recipe?.steps?.find((item) => ['group-aggregate', 'pivot-aggregate', 'trend-aggregate'].includes(item?.operation)) ?? null;
    return step?.formula === 'sum' && step.null_policy === 'exclude' && typeof step.unit === 'string' && step.unit.trim()
      ? { recipe, step } : null;
  }

  #tableWorkInputsCurrent(projectId, result) {
    const project = this.#project(projectId);
    const sources = result.source?.sources ?? [];
    if (!sources.length) return false;
    for (const source of sources) {
      if (!source.resource_id || !source.path || !source.fingerprint?.sha256) return false;
      const resolved = path.resolve(source.path); const relative = path.relative(project.projectRoot, resolved);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
      try {
        const stat = fs.lstatSync(resolved);
        if (!stat.isFile() || stat.isSymbolicLink()) return false;
        if (contentFileFingerprint(resolved).sha256 !== source.fingerprint.sha256) return false;
      } catch { return false; }
      try {
        const registered = this.resourceControl.projectResource(projectId, source.resource_id, { refresh: false });
        if (path.resolve(registered.path ?? '') !== resolved) return false;
      } catch { return false; }
    }
    return true;
  }

  #tableWorkAnalysisInputs(projectId, block) {
    if (block.type !== 'result_preview') return [];
    const result = this.savedWork.find(block.save_id);
    if (!this.#tableWorkAnalysisStep(result)) return [];
    if (result.project?.id !== projectId || !this.#tableWorkInputsCurrent(projectId, result)) {
      throw conflict('A source used by this saved Table Work Result changed; refresh the Board before preparing delivery.');
    }
    return (result.source?.sources ?? []).map((source) => path.resolve(source.path));
  }

  #tableWorkAnalysis(projectId, block) {
    const result = this.savedWork.find(block.save_id);
    const tableWork = this.#tableWorkAnalysisStep(result);
    if (!tableWork || result.status !== 'executed' || result.project?.id !== projectId
      || block.status !== 'fresh' || !block.recorded_sha256 || !block.path
      || !this.#tableWorkInputsCurrent(projectId, result)) return null;
    const project = this.#project(projectId);
    const filePath = path.resolve(block.path); const relative = path.relative(project.projectRoot, filePath);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ANALYSIS_BYTES) return null;
      const current = contentFileFingerprint(filePath);
      if (current.sha256 !== block.recorded_sha256) return null;
      const bytes = fs.readFileSync(filePath);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '');
      const extension = path.extname(filePath).toLowerCase();
      if (extension !== '.csv' && extension !== '.tsv') return null;
      const rows = parseDelimitedText(text, extension === '.tsv' ? '\t' : ',');
      if (!rows?.length || rows.length > MAX_ANALYSIS_GROUPS + 1) return null;
      const projection = this.#parseTableWorkDashboardResult(rows, tableWork.step, result);
      if (!projection) return null;
      projection.save_id = result.save_id; projection.resource_id = result.resource_id ?? null;
      projection.source_resource_ids = result.source.sources.map((item) => item.resource_id).filter(Boolean);
      projection.project_id = projectId; projection.result_sha256 = block.recorded_sha256; projection.board_snapshot_revision = null;
      const validation = result.result_summary?.validation;
      if (Number.isSafeInteger(validation?.input_rows)) projection.input_rows = validation.input_rows;
      return projection;
    } catch { return null; }
  }

  #parseTableWorkDashboardResult(rows, step, result) {
    const number = (value) => {
      if (value == null || value === '' || !decimalParts(value)) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const common = { formula: step.formula, unit: step.unit.trim(), null_policy: step.null_policy };
    if (step.operation === 'group-aggregate') {
      const { dimension, measure } = step; const header = rows[0];
      const dimensionIndex = header.indexOf(dimension); const measureIndex = header.indexOf(measure);
      if (dimensionIndex < 0 || measureIndex < 0 || dimensionIndex === measureIndex || rows.length - 1 > MAX_ANALYSIS_GROUPS) return null;
      const groups = []; const sums = []; const seen = new Set();
      for (const row of rows.slice(1)) {
        if (row.length !== header.length || row[dimensionIndex] == null || row[measureIndex] == null) return null;
        const value = row[dimensionIndex]; const sum = number(row[measureIndex]);
        if (sum == null || seen.has(value)) return null;
        seen.add(value); groups.push({ value, sum }); sums.push(row[measureIndex]);
      }
      const grandTotal = sumDecimalText(sums);
      if (!grandTotal) return null;
      return { ...common, kind: 'table_work_group_sum', dimension, measure, group_count: groups.length, grand_total: grandTotal.number, groups, complete: true };
    }
    if (step.operation === 'pivot-aggregate') {
      const { row_dimension: rowDimension, column_dimension: columnDimension, measure } = step; const header = rows[0];
      const rowIndex = header.indexOf(`row:${rowDimension}`); const totalIndex = header.indexOf(`total:${measure}`);
      const shareIndex = header.indexOf('share_percent'); const rankIndex = header.indexOf('dense_rank');
      const columns = header.map((name, index) => ({ name, index })).filter(({ name }) => /^column:\d+:/u.test(name));
      if (rowIndex !== 0 || totalIndex < 0 || shareIndex < 0 || rankIndex < 0 || columns.length < 1 || columns.length > 12
        || header.length !== columns.length + 4 || rows.length < 2 || rows.length > 42) return null;
      const columnOrder = [];
      for (let index = 0; index < columns.length; index += 1) {
        const match = columns[index].name.match(/^column:(\d+):(.*)$/u);
        if (!match || Number(match[1]) !== index + 1) return null;
        columnOrder.push(match[2]);
      }
      const data = rows.slice(1); const totalRow = data.at(-1); const categoryRows = data.slice(0, -1);
      if (categoryRows.length > 40 || totalRow.length !== header.length || totalRow[rankIndex] !== '') return null;
      const grandTotal = number(totalRow[totalIndex]); const totalShare = number(totalRow[shareIndex]);
      if (grandTotal == null || totalShare !== (grandTotal === 0 ? null : 100)) return null;
      const categorySet = new Set(); const matrix = []; const rowTotals = [];
      for (const row of categoryRows) {
        if (row.length !== header.length || categorySet.has(row[rowIndex])) return null;
        categorySet.add(row[rowIndex]);
        const values = columns.map(({ index }) => number(row[index])); const total = number(row[totalIndex]);
        const share = number(row[shareIndex]); const rank = number(row[rankIndex]);
        if (values.some((value) => value == null) || total == null || (grandTotal === 0 ? share !== null : share == null) || rank == null || !Number.isInteger(rank)) return null;
        const computed = sumDecimalText(columns.map(({ index }) => row[index]));
        if (!computed || computed.number !== total) return null;
        matrix.push({ row: row[rowIndex], values, total, share_percent: share, rank });
        rowTotals.push({ value: row[rowIndex], sum: total, share_percent: share, rank });
      }
      const columnTotals = columns.map(({ name, index }) => {
        const value = number(totalRow[index]);
        return value == null ? null : { value: name.replace(/^column:\d+:/u, ''), sum: value };
      });
      if (!columnTotals.length || columnTotals.some((item) => !item)) return null;
      const rowSum = sumDecimalText(categoryRows.map((row) => row[totalIndex]));
      if (!rowSum || rowSum.number !== grandTotal) return null;
      matrix.push({ row: totalRow[rowIndex], values: columnTotals.map((item) => item.sum), total: grandTotal, share_percent: totalShare, rank: null });
      return { ...common, kind: 'table_work_pivot_sum', row_dimension: rowDimension, column_dimension: columnDimension, measure,
        column_order: columnOrder, column_totals: columnTotals, row_totals: rowTotals, matrix, grand_total: grandTotal, complete: true };
    }
    if (step.operation === 'trend-aggregate') {
      const { date_field: dateField, measure, start_month: startMonth, current_start_month: currentStartMonth, end_month: endMonth } = step; const header = rows[0];
      if (header.length !== 2 || header[0] !== 'month' || header[1] !== `sum:${measure}` || rows.length < 2 || rows.length > 25) return null;
      const monthNumber = (value) => {
        const match = String(value).match(/^(\d{4})-(\d{2})$/u);
        if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
        return Number(match[1]) * 12 + Number(match[2]) - 1;
      };
      const start = monthNumber(startMonth); const currentStart = monthNumber(currentStartMonth); const end = monthNumber(endMonth);
      if (start == null || currentStart == null || end == null || currentStart <= start || end < currentStart
        || currentStart - start !== end - currentStart + 1 || end - start + 1 > 24 || rows.length - 1 !== end - start + 1) return null;
      const monthlyTotals = [];
      for (let index = 1; index < rows.length; index += 1) {
        const month = rows[index][0]; const expected = `${String(Math.floor((start + index - 1) / 12)).padStart(4, '0')}-${String((start + index - 1) % 12 + 1).padStart(2, '0')}`;
        const sum = number(rows[index][1]);
        if (rows[index].length !== 2 || month !== expected || sum == null) return null;
        monthlyTotals.push({ month, sum });
      }
      const previousTotal = sumDecimalText(monthlyTotals.slice(0, currentStart - start).map((item) => String(item.sum)));
      const currentTotal = sumDecimalText(monthlyTotals.slice(currentStart - start).map((item) => String(item.sum)));
      if (!previousTotal || !currentTotal) return null;
      const delta = currentTotal.number - previousTotal.number;
      const growth = previousTotal.number ? Number((delta / previousTotal.number * 100).toFixed(2)) : null;
      return { ...common, kind: 'table_work_trend_sum', date_field: dateField, measure, start_month: startMonth, current_start_month: currentStartMonth,
        end_month: endMonth, monthly_totals: monthlyTotals,
        previous_period: { start_month: startMonth, end_month: monthlyTotals[currentStart - start - 1].month, total: previousTotal.number },
        current_period: { start_month: currentStartMonth, end_month: endMonth, total: currentTotal.number }, delta, growth_percent: growth, complete: true };
    }
    return null;
  }

  #exactBlockFile(block) {
    if (block.type === 'result_preview' && block.version_policy === 'pinned_version') {
      const result = this.savedWork.find(block.save_id);
      const expected = block.recorded_sha256 ?? result?.verification?.sha256 ?? result?.result_fingerprint?.sha256 ?? result?.candidate?.sha256 ?? null;
      if (result?.result_path && expected) {
        try {
          const current = contentFileFingerprint(result.result_path);
          if (current.sha256 === expected) return current.file_path;
        } catch { /* unavailable below */ }
      }
      try {
        const snapshot = this.saveService.candidateSnapshot(block.save_id);
        if (expected && snapshot.sha256 === expected) return snapshot.path;
      } catch { /* unavailable below */ }
    }
    if (!block.path || !block.recorded_sha256) return null;
    try {
      const fingerprint = contentFileFingerprint(block.path);
      return fingerprint.sha256 === block.recorded_sha256 ? fingerprint.file_path : null;
    } catch { return null; }
  }

  #tablePreview(filePath, extension, expectedSha256) {
    if (extension === '.csv' || extension === '.tsv') return delimitedPreview(filePath, extension === '.tsv' ? '\t' : ',');
    if (extension !== '.xlsx') return null;
    const options = {
      filePath, expectedSha256, action: 'profile', pythonPath: this.pythonPath,
      ...(this.projectRoot ? { projectRoot: this.projectRoot } : {}),
      ...(this.installationRoot ? { installationRoot: this.installationRoot } : {}),
    };
    let profile = this.runDataWorkFn(options);
    if (profile.status === 'sheet_required' && profile.sheets?.length) {
      const firstSheet = typeof profile.sheets[0] === 'string' ? profile.sheets[0] : profile.sheets[0]?.name;
      if (!firstSheet) return null;
      profile = this.runDataWorkFn({ ...options, sheet: firstSheet });
    }
    const sample = profile.profile?.sample;
    if (!sample) return null;
    return {
      columns: sample.columns ?? [], rows: (sample.rows ?? []).slice(0, MAX_TABLE_PREVIEW_ROWS),
      row_count: profile.profile?.rows ?? null,
      bounded: Number(profile.profile?.rows ?? 0) > MAX_TABLE_PREVIEW_ROWS,
      sheet: profile.sheet ?? profile.sheets?.[0] ?? null,
    };
  }

  #readableBlockPreview(projectId, boardId, block) {
    if (block.type === 'text') return null;
    const filePath = this.#exactBlockFile(block);
    if (!filePath) return null;
    const extension = path.extname(block.path ?? block.recorded_path ?? filePath).toLowerCase();
    const mime = MIME_TYPES.get(extension) ?? 'application/octet-stream';
    if (mime.startsWith('image/')) return {
      kind: 'image',
      content: `/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(boardId)}/blocks/${encodeURIComponent(block.block_id)}/content`,
      mime, bytes: fs.lstatSync(filePath).size,
    };
    if (extension === '.csv' || extension === '.tsv' || extension === '.xlsx') {
      try {
        const content = this.#tablePreview(filePath, extension, block.recorded_sha256);
        return content ? { kind: 'table', content } : null;
      } catch (error) {
        return { kind: 'unavailable', content: `Table preview unavailable: ${error.message}`.slice(0, MAX_READABLE_PREVIEW_CHARS) };
      }
    }
    if (mime.startsWith('text/') || mime === 'application/json') {
      const content = fs.readFileSync(filePath, 'utf8').slice(0, MAX_READABLE_PREVIEW_CHARS);
      return { kind: 'text', content, bounded: fs.lstatSync(filePath).size > Buffer.byteLength(content, 'utf8') };
    }
    return null;
  }

  showBoard(projectId, boardId) {
    const board = this.#storedBoard(projectId, boardId);
    const blocks = board.blocks.map((block) => {
      const projected = block.type === 'material_reference' ? this.#projectMaterialBlock(projectId, block)
        : block.type === 'result_preview' ? this.#projectResultBlock(projectId, block) : { ...block, status: 'fresh', status_label: 'Fresh' };
      const preview = this.#readableBlockPreview(projectId, boardId, projected);
      if (projected.type === 'result_preview') {
        const analysis = this.#tableWorkAnalysis(projectId, projected);
        if (analysis) analysis.board_snapshot_revision = board.revision;
        const savedAnalysis = analysis?.kind === 'table_work_group_sum'
          ? this.savedWork.find(projected.save_id) : null;
        const tableWorkIdentity = savedAnalysis?.parameters?.table_work_save?.identity;
        return { ...projected, ...(preview ? { preview } : {}), ...(analysis ? { dashboard_projection: analysis } : {}),
          ...(analysis?.kind === 'table_work_group_sum' ? { analysis_projection: analysis } : {}),
          ...(analysis?.kind === 'table_work_group_sum' && (tableWorkIdentity?.work_session_id ?? tableWorkIdentity?.session_id)
            ? { table_work_session_id: tableWorkIdentity.work_session_id ?? tableWorkIdentity.session_id } : {}) };
      }
      return preview ? { ...projected, preview } : projected;
    });
    const works = this.registry.ledger.workSessions.listForProject(projectId, { limit: 100, offset: 0 }).sessions;
    const results = this.savedWork.listForProject(projectId);
    const impactLanes = [];
    for (const block of blocks.filter((item) => item.type === 'material_reference')) {
      const resource = { resource_id: block.resource_id, name: block.name, path: block.path,
        desktop_href: block.resource_href, external_change: { status: block.status === 'needs_review' ? 'changed' : block.status === 'missing' ? 'missing' : 'unchanged' } };
      const lanes = buildResourceImpactLanes({ resource, workSessions: works, savedWork: results });
      impactLanes.push(...lanes.map((lane) => ({ ...lane, board: { board_id: boardId, block_id: block.block_id, href: `/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(boardId)}` } })));
      if (!lanes.length) impactLanes.push({
        source: { resource_id: block.resource_id, name: block.name, path: block.path, change_state: block.status, version_policy: block.version_policy },
        work: null, results: [], impact: { status: block.status, label: block.status_label, reason: block.reason },
        board: { board_id: boardId, block_id: block.block_id, href: `/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(boardId)}` },
        actions: { resource_context: block.resource_href, open_work: null, open_result: null },
      });
    }
    return { ...board, blocks, impact_lanes: impactLanes, desktop_href: `/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(boardId)}`,
      freshness: { status: blocks.some((item) => item.status === 'missing') ? 'missing' : blocks.some((item) => item.status === 'needs_review') ? 'needs_review' : 'fresh' } };
  }

  listResourceReferences(projectId, resourceId) {
    this.#project(projectId);
    return this.repository.list(projectId).flatMap((board) => board.blocks.flatMap((block) => {
      let relation = null;
      if (block.type === 'material_reference' && block.resource_id === resourceId) relation = 'material_reference';
      if (block.type === 'result_preview') {
        const result = this.savedWork.find(block.save_id);
        if (result?.project?.id === projectId || result?.project_id === projectId) {
          if (result.resource_id === resourceId) relation = 'result_preview';
          else if ((result.sources ?? []).some((source) => source.resource_id === resourceId)) relation = 'source_of_result_preview';
        }
      }
      if (!relation) return [];
      return [{
        board_id: board.board_id, block_id: block.block_id, title: board.title, revision: board.revision,
        version_policy: block.version_policy, relation,
        href: `/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(board.board_id)}`,
      }];
    }));
  }

  resolveBlockContent(projectId, boardId, blockId) {
    const block = this.showBoard(projectId, boardId).blocks.find((item) => item.block_id === blockId);
    if (!block) throw new Error('Board Block is unavailable.');
    const filePath = this.#exactBlockFile(block);
    if (!filePath) throw new Error('The recorded Board content is unavailable.');
    const mime = MIME_TYPES.get(path.extname(filePath).toLowerCase());
    const stat = fs.lstatSync(filePath);
    if (!mime?.startsWith('image/') || !stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_EMBED_BYTES) {
      throw new Error('Board image preview is unavailable.');
    }
    return { file_path: filePath, mime, bytes: stat.size };
  }

  #portableHtml(board) {
    let embeddedBytes = 0;
    const inputs = [];
    const issues = [];
    const sections = [];
    for (const block of board.blocks) {
      if (block.type === 'text') {
        // Keep the document title as the only level-one heading.
        const markdown = renderMarkdown(block.text).replace(/<(\/?)h([1-6])\b/gu, (_, closing, level) => `<${closing}h${Math.min(6, Number(level) + 1)}`);
        sections.push(`<section class="text" data-block-id="${html(block.block_id)}">${markdown}</section>`);
        continue;
      }
      let filePath = block.path;
      let snapshot = null;
      if (block.type === 'result_preview' && block.version_policy === 'pinned_version') {
        try { snapshot = this.saveService.candidateSnapshot(block.save_id); filePath = snapshot.path; } catch { /* fall back to current verified file */ }
      }
      let stat = null;
      try { stat = fs.lstatSync(filePath); } catch { /* reported below */ }
      const currentMatches = block.type === 'result_preview' && snapshot
        ? snapshot.sha256 === block.recorded_sha256
        : block.current_sha256 && block.current_sha256 === block.recorded_sha256;
      const unavailable = !stat?.isFile() || stat.isSymbolicLink() || block.status === 'missing' || !currentMatches;
      if (unavailable) {
        issues.push(`${block.name ?? block.recorded_path ?? block.block_id}: ${block.reason ?? 'The referenced file is unavailable.'}`);
        sections.push(`<section data-block-id="${html(block.block_id)}"><h2>${html(block.name ?? 'Reference')}</h2><p class="block-version">${html(block.version_policy)} · ${html(block.status_label ?? statusLabel(block.status))}</p><p class="issue">Not included: ${html(block.reason ?? 'Unavailable')}</p>${portableBlockEvidence(block)}</section>`);
        continue;
      }
      if (stat.size > MAX_EMBED_BYTES || embeddedBytes + stat.size > MAX_TOTAL_EMBED_BYTES) {
        issues.push(`${block.name}: file exceeds the portable delivery size limit.`);
        sections.push(`<section data-block-id="${html(block.block_id)}"><h2>${html(block.name)}</h2><p class="block-version">${html(block.version_policy)} · ${html(block.status_label ?? statusLabel(block.status))}</p><p class="issue">Not included: file exceeds the portable delivery size limit.</p>${portableBlockEvidence(block)}</section>`);
        continue;
      }
      embeddedBytes += stat.size;
      const project = this.#project(board.project_id);
      const inputPath = block.type === 'result_preview' && snapshot ? block.path : filePath;
      if (inputPath && path.resolve(inputPath).startsWith(`${project.workspaceRoot}${path.sep}`)) {
        try {
          const inputFacts = contentFileFingerprint(inputPath);
          if (inputFacts.sha256 === block.recorded_sha256) inputs.push(path.resolve(inputPath));
        } catch { /* the issue list already describes unavailable content */ }
      }
      inputs.push(...this.#tableWorkAnalysisInputs(board.project_id, block));
      const encoded = dataUri(filePath, block.path ?? block.recorded_path ?? filePath); const name = block.name ?? path.basename(filePath);
      const analysis = analysisProjectionHtml(block.dashboard_projection ?? block.analysis_projection);
      const contentPreview = analysis || (encoded.mime.startsWith('image/') ? `<img src="${encoded.uri}" alt="${html(name)}">`
        : block.preview?.kind === 'table' ? readableTablePreview(block.preview) : readablePreview(filePath, encoded.mime));
      const preview = block.type === 'material_reference' && contentPreview ? `<details class="board-material-preview"><summary>查看材料内容 · Material preview</summary>${contentPreview}</details>` : contentPreview;
      const warning = `${block.reason && block.status !== 'fresh' ? `<p class="issue">${html(block.reason)}</p>` : ''}${block.preview?.kind === 'unavailable' ? `<p class="issue">${html(block.preview.content)}</p>` : ''}${!analysis && (block.preview?.bounded || block.preview?.content?.bounded || encoded.mime.startsWith('text/') && stat.size > MAX_READABLE_PREVIEW_CHARS) ? '<p class="issue">部分内容预览 · Preview bounded; download the attachment for full content.</p>' : ''}`;
      sections.push(`<section data-block-id="${html(block.block_id)}"><h2>${html(name)}</h2><p class="block-version">${html(block.type === 'result_preview' ? '固定成果 · Selected Result' : '材料引用 · Material dependency')} · ${html(block.version_policy)} · ${html(block.status_label ?? statusLabel(block.status))}</p>${warning}${preview}<p><a download="${html(name)}" href="${encoded.uri}">Download ${html(name)}</a></p>${portableBlockEvidence(block)}</section>`);
    }
    const issueList = issues.length ? `<ul>${issues.map((item) => `<li>${html(item)}</li>`).join('')}</ul>` : '<p>None.</p>';
    const date = board.updated_at ?? board.created_at;
    const document = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(board.title)}</title><style>${PORTABLE_STYLE}</style></head><body><header><small>离线交付文档 · Atlas portable Board · snapshot revision ${board.revision}</small><h1>${html(board.title)}</h1><p class="document-date"><span>看板版本 · Revision ${board.revision}</span><span>更新时间 · ${date ? `<time datetime="${html(date)}">${html(date)}</time>` : 'not recorded'}</span></p><p>This self-contained document reflects the Board snapshot revision ${board.revision}. 附件已内嵌，可离线阅读与下载。</p><details class="board-evidence"><summary>看板身份 · Board evidence</summary><p>Board ${html(board.board_id)} · Project ${html(board.project_id)} · Created ${html(board.created_at ?? 'not recorded')}</p></details></header><main>${sections.join('')}</main><section class="delivery-issues"><h2>Missing or not included</h2>${issueList}</section></body></html>`;
    return { html: document, inputs: [...new Set(inputs)], issues, embedded_bytes: embeddedBytes };
  }

  #portableMarkdown(board) {
    const inputs = []; const issues = []; const sections = [`# ${board.title}`, '', `Atlas Board snapshot · revision ${board.revision}`, ''];
    for (const block of board.blocks) {
      if (block.type === 'text') { sections.push(block.text, ''); continue; }
      const filePath = this.#exactBlockFile(block);
      const matches = filePath && block.current_sha256 === block.recorded_sha256 && block.status === 'fresh';
      if (!matches) {
        issues.push(`${block.name ?? block.block_id}: ${block.reason ?? 'The referenced file is unavailable or changed.'}`);
        sections.push(`## ${block.name ?? 'Reference'}`, '', `Not included: ${block.reason ?? 'The referenced file is unavailable or changed.'}`, '');
        continue;
      }
      const project = this.#project(board.project_id); const relative = path.relative(project.projectRoot, filePath);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        issues.push(`${block.name}: the reference is outside this Project.`);
        sections.push(`## ${block.name}`, '', 'Not included: the reference is outside this Project.', '');
        continue;
      }
      const facts = contentFileFingerprint(filePath);
      if (facts.sha256 !== block.recorded_sha256) {
        issues.push(`${block.name}: the saved version changed.`);
        sections.push(`## ${block.name}`, '', 'Not included: the saved version changed.', '');
        continue;
      }
      inputs.push(path.resolve(block.path ?? filePath));
      inputs.push(...this.#tableWorkAnalysisInputs(board.project_id, block));
      sections.push(`## ${block.name}`, '', `Type: ${block.type} · ${block.version_policy}`, `Resource: ${block.resource_id ?? 'not recorded'} · Save: ${block.save_id ?? 'not recorded'} · SHA-256: ${block.recorded_sha256}`, '');
      const analysis = analysisProjectionMarkdown(block.dashboard_projection ?? block.analysis_projection);
      if (analysis) sections.push(analysis, '');
      else if (block.preview?.kind === 'text') sections.push(block.preview.content.slice(0, MAX_READABLE_PREVIEW_CHARS), '');
      else if (block.preview?.kind === 'table') {
        const table = block.preview.content; sections.push(`Rows shown: ${table.row_count ?? table.rows?.length ?? 0}${table.bounded ? ' (preview bounded)' : ''}.`, '', `Columns: ${(table.columns ?? []).join(' | ')}`, ...((table.rows ?? []).map((row) => row.map((value) => String(value ?? '').replaceAll('|', '\\|')).join(' | '))), '');
      } else if (block.type === 'result_preview') sections.push('Selected Result is included as a dependency; no additional readable projection is available.', '');
      else sections.push('Material is recorded as a dependency; its full contents are not reproduced in this Markdown snapshot.', '');
    }
    sections.push('## Missing or not included', '', ...(issues.length ? issues.map((item) => `- ${item}`) : ['None.']));
    return { markdown: `${sections.join('\n')}\n`, inputs: [...new Set(inputs)], issues };
  }

  async preparePortableDelivery({ projectId, boardId, baseRevision, target, caller, requestKey }) {
    const board = this.showBoard(projectId, boardId);
    if (Number(baseRevision) !== board.revision) throw conflict('Board changed after the portable delivery was opened.', { board_id: boardId, current_revision: board.revision });
    if (!caller?.tool || !caller?.client_run_id) throw new Error('Portable delivery requires caller tool and client run id.');
    const project = this.#project(projectId);
    const relativeTarget = portable(target);
    const extension = path.extname(relativeTarget).toLowerCase();
    if (!relativeTarget || path.posix.isAbsolute(relativeTarget) || relativeTarget === '..' || relativeTarget.startsWith('../') || !['.html', '.md'].includes(extension)) throw new Error('Portable delivery target must be one new HTML or Markdown file inside the Project.');
    const absoluteTarget = path.resolve(project.projectRoot, ...relativeTarget.split('/'));
    const targetRelative = path.relative(project.projectRoot, absoluteTarget);
    if (!targetRelative || targetRelative === '..' || targetRelative.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelative)) throw new Error('Portable delivery target must remain inside the Project.');
    const parent = path.dirname(absoluteTarget); const parentStat = fs.lstatSync(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new Error('Portable delivery requires an existing non-linked destination folder.');
    const analyzedResults = board.blocks.filter((block) => block.type === 'result_preview' && this.#tableWorkAnalysisStep(this.savedWork.find(block.save_id)));
    if (analyzedResults.some((block) => block.status !== 'fresh')) throw conflict('A Table Work Result or one of its Sources changed; refresh the Board before preparing delivery.');
    const portableDocument = extension === '.md' ? this.#portableMarkdown(board) : this.#portableHtml(board);
    if (!portableDocument.inputs.length) throw new Error('Portable delivery requires at least one fresh Material or Result dependency inside the Project.');
    const candidateDir = path.join(this.stateDir, 'tmp', 'board-delivery'); fs.mkdirSync(candidateDir, { recursive: true });
    const candidatePath = path.join(candidateDir, `${boardId}-r${board.revision}-${crypto.randomUUID()}${extension}`);
    fs.writeFileSync(candidatePath, extension === '.md' ? portableDocument.markdown : portableDocument.html, { encoding: 'utf8', flag: 'wx' });
    const workspaceTarget = portable(path.join(project.relativePath, relativeTarget));
    const prepared = this.saveService.prepare({
      root: project.workspaceRoot, candidateFile: candidatePath, projectId, target: workspaceTarget,
      inputs: portableDocument.inputs, origin: 'agent_generated', kind: 'report', role: 'report', relationType: 'derived_from',
      channel: caller.actor === 'user' ? 'desktop' : 'host', requestKey, caller,
      source: { kind: 'board_delivery', board_id: boardId, board_revision: board.revision, sources: board.blocks.filter((item) => item.resource_id).map((item) => ({ resource_id: item.resource_id, path: item.path, version_policy: item.version_policy })) },
      parameters: { board_id: boardId, board_revision: board.revision, portable_format: extension === '.md' ? 'markdown_snapshot' : 'self_contained_html' },
      resultSummary: { block_count: board.blocks.length, board_revision: board.revision, embedded_bytes: portableDocument.embedded_bytes ?? null, missing_count: portableDocument.issues.length },
      intent: 'Save one reviewed portable Board delivery.',
    });
    return { ...prepared, board_id: boardId, board_revision: board.revision, portable_format: extension === '.md' ? 'markdown_snapshot' : 'self_contained_html', issues: portableDocument.issues };
  }

  dispose() {
    if (this.ownsSaveService) this.saveService.dispose();
    if (this.ownsResourceControl) this.resourceControl.dispose();
    if (this.ownsRegistry) this.registry.dispose();
  }
}

export function createBoardService(options) { return new BoardService(options); }
