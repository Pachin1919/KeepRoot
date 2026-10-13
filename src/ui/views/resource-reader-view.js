import { renderResourceGraphView } from './resource-graph-view.js';
import { renderReaderSourceContext } from './project-resources-view.js';
import { UI_DISPLAY_NAME } from '../brand.js';
import { escapeHtml, renderNav, renderTopbar, renderUiClientScript } from '../components.js';
import { uiStyles } from '../styles.js';
import { normalizeUiLocale, translateUi } from '../i18n.js';
import { renderMarkdown } from '../../markdown-reader.js';

function renderActivityMonitor(snapshot, error, h, label) {
  const states = { running: label('处理中','Running'), waiting: label('等待','Waiting'), failed: label('失败','Failed'), interrupted: label('已中断','Interrupted'), completed: label('已完成','Completed'), inspect: label('检查记录','Inspection record') };
  const purposes = { content: label('内容检查','Content inspection'), structure: label('结构检查','Structure inspection'), data: label('数据检查','Data inspection'), visual: label('视觉检查','Visual inspection') };
  const dateLabel = value => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(label('zh-CN','en'), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsed);
  };
  const section = (key, title) => {
    const data = snapshot?.[key];
    return `<section class="reader-monitor-records"><h3>${title}</h3>${data?.error ? `<p class="callout warn" role="status">${h(data.error)}</p>` : data ? (data.items?.length ? `<ul>${data.items.map(item => `<li><div><strong>${h(Object.hasOwn(purposes, item.label) ? purposes[item.label] : item.label)}</strong><span>${h(states[item.status] ?? label('信息不完整：','Information incomplete: ') + (item.status ?? ''))}</span></div>${item.actor ? `<small>${h(item.actor)}</small>` : ''}${item.summary ? `<p>${h(item.summary)}</p>` : ''}${item.updated_at ? `<time datetime="${h(item.updated_at)}">${h(dateLabel(item.updated_at))}</time>` : ''}</li>`).join('')}</ul>` : `<p class="reader-monitor-empty">${label('此材料没有已记录的处理。','No recorded processing for this material.')}</p>`) : ''}${data?.truncated ? `<p>${label('仅显示最近 4 条记录。','Only the latest 4 records are shown.')}</p>` : ''}</section>`;
  };
  return `<div data-reader-monitor-records>${section('current',label('当前处理','Current processing'))}${section('recent',label('最近记录','Recent records'))}${snapshot?.observed_at ? `<p class="reader-monitor-observed">${label('记录刷新：','Records refreshed: ')}<time datetime="${h(snapshot.observed_at)}">${h(dateLabel(snapshot.observed_at))}</time></p>` : ''}</div><p class="callout warn" role="status" data-reader-monitor-error${error ? '' : ' hidden'}>${h(error)}</p>`;
}

export function renderResourceReaderView(model, options = {}) {
  const h = value => escapeHtml(value ?? '');
  const t = key => translateUi(options.locale, `reader.${key}`, options.languageCatalog);
  const u = key => translateUi(options.locale, `toolbox.${key}`, options.languageCatalog);
  const project = model.project; const reader = model.reader ?? {};
  const base = `/projects/${encodeURIComponent(project.id)}`;
  const zh = normalizeUiLocale(options.locale).startsWith('zh');
  const label = (cn,en) => zh ? cn : en;
  const localHref = (href, fallback = `${base}/resources`) => {
    if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//') || /[\x00-\x20\\]/u.test(href)) return fallback;
    try { const url = new URL(href, 'http://atlas.local'); return url.origin === 'http://atlas.local' && ([`${base}/resources`,`${base}/search`,`${base}/files`,`${base}/resources/detail`].includes(url.pathname) && href.split(/[?#]/u)[0] === url.pathname) ? (() => { if (url.pathname === base+'/resources') for (const key of ['path','resource_id','graph','fragment']) url.searchParams.delete(key); return url.pathname+url.search; })() : fallback; } catch { return fallback; }
  };
  const returnHref = localHref(model.returnHref);
  const returnLabel = new URL(returnHref,'http://atlas.local').pathname === `${base}/search` ? label('返回搜索','Back to search') : t('return');
  const detailsHref = localHref(model.detailsHref, reader.relative_path ? base+'/resources/detail?'+new URLSearchParams({path:reader.relative_path,return_to:returnHref}) : returnHref);
  const returnQuery = new URL(returnHref, 'http://atlas.local').searchParams;
  const activityReturn = returnQuery.get('from') === 'activity' && returnQuery.get('activity') ? '/activity?selected='+encodeURIComponent(returnQuery.get('activity')) : null;
  const readHref = id => `${base}/resources/read?${new URLSearchParams({ resource_id: id, return_to: returnHref })}`;
  let imageUrl = null;
  let pdfUrl = null;
  try {
    const url = new URL(reader.image_url, 'http://atlas.local');
    if (url.origin === 'http://atlas.local' && url.pathname === `${base}/resources/read-image`
      && url.searchParams.get('resource_id') === reader.resource_id
      && url.searchParams.get('expected_sha256') === reader.sha256) imageUrl = url.pathname + url.search;
  } catch {}
  try {
    const url = new URL(reader.pdf_url, 'http://atlas.local');
    if (typeof reader.pdf_url === 'string' && reader.pdf_url.startsWith('/') && !/[\s\\]/u.test(reader.pdf_url)
      && url.origin === 'http://atlas.local' && url.pathname === `${base}/resources/read-pdf`
      && url.searchParams.get('resource_id') === reader.resource_id && /^[a-f0-9]{64}$/u.test(reader.sha256 ?? '')
      && url.searchParams.get('expected_sha256') === reader.sha256 && !url.hash) pdfUrl = url.pathname + url.search;
  } catch {}
  let body;
  if (model.notice) body = `<div class="reader-empty" role="alert"><h2>${h(t('unavailable'))}</h2><p>${h(model.notice)}</p><a href="${h(detailsHref)}">${h(t('details'))}</a></div>`;
  else if (reader.kind === 'markdown' && typeof reader.text === 'string') {
    const header = /^\uFEFF?---\r?\n([\s\S]{0,16384}?)\r?\n---(?:\r?\n|$)/u.exec(reader.text);
    const captured = header && /^source_url:/mu.test(header[1]) && /^capture_mode:/mu.test(header[1]);
    const metadata = header ? `<details class="reader-source-metadata"><summary>${h(captured ? u('source_metadata') : label('属性','Properties'))}</summary><pre>${h(header[1])}</pre></details>` : '';
    body = `<article class="reader-paper reader-markdown">${metadata}${renderMarkdown(header ? reader.text.slice(header[0].length) : reader.text, model.links ?? [])}</article>`;
  }
  else if (reader.kind === 'text' && typeof reader.text === 'string') body = `<article class="reader-paper"><pre class="reader-text">${h(reader.text)}</pre></article>`;
  else if (reader.kind === 'table' && reader.table) {
    const table = reader.table;
    const pageHref = (offset, sheet = table.sheet) => `${base}/resources/read?${new URLSearchParams({resource_id: reader.resource_id, expected_sha256: reader.sha256, offset: String(offset), return_to: returnHref, ...(sheet !== null ? {sheet} : {})})}`;
    const sheets = table.sheets.map(sheet => `<a class="reader-button" href="${h(pageHref(0, sheet))}"${sheet === table.sheet ? ' aria-current="page"' : ''}>${h(sheet)}</a>`).join('');
    const previous = table.offset > 0 ? `<a class="reader-button" href="${h(pageHref(table.offset - 50))}">${h(t('table_previous'))}</a>` : '';
    const next = table.offset + 50 < table.total_rows ? `<a class="reader-button" href="${h(pageHref(table.offset + 50))}">${h(t('table_next'))}</a>` : '';
    body = `<article class="reader-paper reader-table"><nav class="reader-table-controls" aria-label="${h(t('table_sheets'))}">${sheets}</nav><p class="reader-format-note">${h(t('table_format'))}</p><div class="reader-table-controls">${previous}<span>${table.total_rows ? table.offset + 1 : 0}–${Math.min(table.offset + 50, table.total_rows)} / ${table.total_rows}${table.truncated ? '+' : ''}</span>${next}</div>${table.truncated ? `<p role="status">${h(t('table_truncated'))}</p>` : ''}${table.warnings.length ? `<details class="reader-format-note"><summary>${h(t('table_warnings'))}</summary><ul>${table.warnings.map(warning => `<li>${h(t(`table_${warning}`))}</li>`).join('')}</ul></details>` : ''}<div class="reader-table-scroll" tabindex="0"><table><thead><tr><th scope="col">#</th>${table.columns.map(column => `<th scope="col">${h(column)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row => `<tr><th scope="row">${row.number}</th>${table.columns.map((_,index) => `<td>${h(row.cells[index] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${!table.rows.length ? `<p>${h(t('table_empty'))}</p>` : ''}</article>`;
  }
  else if (reader.kind === 'docx' && Array.isArray(reader.document?.blocks)) {
    const document = reader.document;
    const blocks = document.blocks.map(block => block.kind === 'table'
      ? `<div class="reader-table-scroll" tabindex="0"><table><tbody>${block.rows.map(row => `<tr>${row.map(cell => `<td>${h(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : `<${block.heading ? `h${block.heading}` : 'p'}>${h(block.text)}</${block.heading ? `h${block.heading}` : 'p'}>`).join('');
    body = `<article class="reader-paper reader-docx"><p class="reader-format-note">${h(t('docx_format'))}</p>${document.truncated ? `<p role="status" class="reader-format-note">${h(t('docx_truncated'))}</p>` : ''}${document.warnings?.length ? `<details class="reader-format-note"><summary>${h(t('docx_partial'))}</summary><ul>${document.warnings.map(warning => `<li>${h(t(`docx_${warning}`))}</li>`).join('')}</ul></details>` : ''}${blocks || `<p>${h(t('docx_empty'))}</p>`}</article>`;
  }
  else if (reader.kind === 'image' && imageUrl) body = `<div class="reader-image"><img src="${h(imageUrl)}" alt="${h(reader.name)}"></div>`;
  else if (reader.kind === 'pdf' && pdfUrl) {
    const messages = Object.fromEntries(['pdf_loading', 'pdf_rendering', 'pdf_error', 'pdf_changed', 'pdf_password', 'pdf_invalid', 'pdf_limit', 'pdf_page_limit', 'pdf_page_status'].map(key => [key, t(key)]));
    body = `<section class="reader-pdf" data-pdf-reader data-pdf-url="${h(pdfUrl)}" data-pdf-messages="${h(JSON.stringify(messages))}" aria-label="${h(t('pdf_document'))}"><div class="reader-pdf-toolbar"><button type="button" class="reader-button" data-pdf-prev disabled>${h(t('pdf_previous'))}</button><label for="reader-pdf-page">${h(t('pdf_page'))}</label><input id="reader-pdf-page" type="number" min="1" max="500" value="1" inputmode="numeric" data-pdf-page disabled><span data-pdf-total>/ —</span><button type="button" class="reader-button" data-pdf-next disabled>${h(t('pdf_next'))}</button><label for="reader-pdf-zoom">${h(t('pdf_zoom'))}</label><select id="reader-pdf-zoom" data-pdf-zoom disabled><option value="fit">${h(t('pdf_fit'))}</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></div><p class="reader-pdf-status" data-pdf-status role="status" aria-live="polite">${h(t('pdf_loading'))}</p><div class="reader-pdf-pages" data-pdf-stage aria-busy="true"><canvas data-pdf-canvas hidden aria-label="${h(t('pdf_canvas'))}"></canvas></div><noscript><p>${h(t('pdf_javascript'))}</p></noscript></section>`;
  }
  else body = `<div class="reader-empty"><h2>${h(t('unsupported'))}</h2><p>${h(t('unsupported_help'))}</p><a href="${h(detailsHref)}">${h(t('details'))}</a></div>`;
  const ownReadHref = readHref(reader.resource_id);
  const hidden = values => Object.entries(values).map(([name,value]) => '<input type="hidden" name="' + h(name) + '" value="' + h(value) + '">').join('');
  const readerUpdateId = model.manualUpdate?.update_id ?? model.manual?.readerUpdateId;
  const receiptContext = readerUpdateId ? {reader_update_id:readerUpdateId} : {};
  const editHref = base + '/resources/edit?' + new URLSearchParams({resource_id:reader.resource_id,expected_sha256:reader.sha256 ?? '',return_to:returnHref,...receiptContext});
  const manualAction = (update,operation,label,key) => '<form method="post" action="' + base + '/resources/edit/' + operation + '">' + hidden({csrf:options.csrfToken,resource_id:reader.resource_id,return_to:returnHref,...receiptContext,update_id:update.update_id,expected_revision:update.revision,expected_current_sha256:update.current?.sha256 ?? '',expected_proposed_sha256:update.proposed.sha256,request_key:key}) + '<button class="' + (operation === 'confirm' ? 'action-button' : 'reader-button') + '" type="submit">' + h(label) + '</button></form>';
  if (model.manual) {
    const m=model.manual, update=m.update;
    const warning = m.notice ? '<p class="callout warn" role="alert">' + h(m.notice) + '</p><p>' + h(u('error_help')) + '</p>' : '';
    const format = reader.kind === 'markdown' || /\.(md|markdown)$/iu.test(reader.relative_path ?? '') ? 'markdown' : 'text';
    const versions = update ? '<section class="reader-edit-versions"><h2>' + h(label('变化','Changes')) + '</h2><p class="reader-diff-legend"><span class="reader-diff-before">− ' + h(u('before')) + '</span><span class="reader-diff-after">+ ' + h(u('after')) + '</span></p><div data-reader-editor data-reader-format="' + format + '" hidden></div><textarea data-reader-original data-reader-source="' + h(JSON.stringify(update.current?.text ?? update.baseline.text)) + '" hidden>' + h(update.current?.text ?? update.baseline.text) + '</textarea><textarea name="text" data-reader-source="' + h(JSON.stringify(update.proposed.text)) + '" class="reader-diff-fallback" readonly aria-label="' + h(u('after')) + '">' + h(update.proposed.text) + '</textarea>' + (!update.proposed.text ? '<p class="muted">' + h(u('empty_text')) + '</p>' : '') + '<noscript><p>' + h(label('启用 JavaScript 查看逐行差异。','Enable JavaScript to view line differences.')) + '</p></noscript></section>' : '';
    const input = typeof m.text === 'string' ? '<form method="post" action="' + base + '/resources/edit/preview" data-draft-protect>' + hidden({csrf:options.csrfToken,resource_id:reader.resource_id,return_to:returnHref,...receiptContext,expected_sha256:m.inspected?.baseline.sha256 ?? m.expectedSha256 ?? '',expected_file_id:m.inspected?.identity.file_id ?? m.expectedFileId ?? '',request_key:m.requestKey}) + '<label class="visually-hidden" for="manual-text">' + h(u('edit')) + '</label><div data-reader-editor data-reader-format="' + format + '" hidden></div><textarea id="manual-text" name="text" data-reader-source="' + h(JSON.stringify(m.text)) + '" class="reader-text-editor" aria-label="' + h(u('edit')) + '" spellcheck="false">' + h(m.text) + '</textarea><div class="inline-actions"><button class="action-button">' + h(u('preview')) + '</button><a class="reader-button" href="' + h(m.readHref) + '">' + h(u('cancel')) + '</a></div></form>' : '';
    const control = update?.pending ? '<p class="callout warn">' + h(u('pending')) + '</p>' + manualAction(update,'recover',u('recover'),m.requestKey) : update && !m.notice && update.status === 'preview_ready' ? manualAction(update,'confirm',u('save'),m.requestKey) : '';
    body='<article class="reader-paper reader-edit"><nav class="reader-edit-switch"><a class="reader-button" href="' + h(m.readHref) + '">' + h(u('read')) + '</a><span aria-current="page">' + h(input ? u('edit') : label('变化','Changes')) + '</span>' + (update && !input ? '<a class="reader-button" href="' + h(editHref) + '" data-reader-inline-edit>' + h(u('edit')) + '</a>' : '') + '</nav>' + warning + input + versions + '<div class="inline-actions">' + control + (!input ? '<a class="reader-button" href="' + h(m.readHref) + '">' + h(u('cancel')) + '</a>' : '') + (m.notice ? '<a class="text-link" href="' + h(m.readHref) + '">' + h(u('reload')) + '</a>' : '') + '</div></article>';
  } else if (model.manualUpdate) {
    const update=model.manualUpdate;
    body='<section class="reader-edit-receipt" role="status"><p>' + h(u(update.pending ? 'pending' : update.status === 'undone' ? 'undone' : 'saved')) + '</p>' + (update.pending ? manualAction(update,'recover',u('recover'),'manual-recover:'+update.update_id+':'+update.revision) : update.status === 'applied' || update.status === 'executed' ? manualAction(update,'undo',u('undo'),'manual-undo:'+update.update_id+':'+update.revision) : '') + '</section>' + body;
  }
  let directActions='';
  const editableText = !model.notice && !model.editUnavailable && ['markdown','text'].includes(reader.kind) && /\.(?:md|markdown|txt)$/iu.test(reader.relative_path ?? '');
  const defaultEdit = editableText && !model.manual && !model.manualUpdate && !model.graphMode;
  if (!model.notice && !model.manual) {
    if (editableText) directActions += '<a class="reader-button reader-command-primary" href="' + h(editHref) + '" data-reader-inline-edit data-reader-edit-label="' + h(u('edit')) + '" data-reader-read-label="' + h(label('渲染阅读','Rendered reading')) + '" data-reader-read-href="' + h(ownReadHref + (readerUpdateId ? '&manual_update_id=' + encodeURIComponent(readerUpdateId) : '')) + '" aria-controls="reader-content">' + h(u('edit')) + '</a>';
    if (reader.kind === 'table') directActions += '<form method="post" action="' + base + '/toolbox/start">' + hidden({csrf:options.csrfToken,resource_ids:reader.resource_id,reader_resource_id:reader.resource_id,return_to:returnHref,tool:'pipeline'}) + '<button class="reader-button reader-command-primary reader-process-command">' + h(u('process')) + '</button></form>';
  }
  if (model.editUnavailable) directActions += '<button class="reader-button" type="button" disabled>' + h(u('edit')) + '</button>';
  const aiWorks=(model.relatedWorks ?? []).map(work => '<form method="post" action="' + base + '/handoffs">' + hidden({csrf:options.csrfToken,work_id:work.session_id,request_key:model.handoffRequestKey,goal:work.intent || reader.name}) + '<button class="reader-button">' + h(work.intent || work.session_id) + '</button></form>').join('');
  const ai = !model.manual ? '<details class="reader-ai"><summary class="reader-button">' + h(u('ai')) + '</summary><p>' + h(u(aiWorks ? 'ai_help' : 'ai_none')) + '</p>' + aiWorks + '</details>' : '';
  const button = (control, key, target, expanded) => `<button class="reader-button" type="button" data-reader-${control} aria-controls="${target}" aria-expanded="${expanded}"${control === 'focus-toggle' ? ' aria-pressed="false"' : ''}>${h(t(key))}</button>`;
  const folders = new Map();
  for (const item of model.resources ?? []) {
    const relative = String(item.relative_path ?? item.name ?? '').replaceAll('\\', '/');
    const folder = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push({ ...item, relative });
  }
  const files = [...folders].sort(([a], [b]) => a.localeCompare(b, options.locale, { numeric: true })).map(([folder, items]) => `<section class="reader-file-group"><h3 title="${h(folder)}">${h(folder || t('root_folder'))}<span>${items.length}</span></h3><ul>${items.map(item => `<li><a href="${h(readHref(item.resource_id))}" title="${h(item.relative)}" aria-label="${h(`${item.name} — ${item.relative}`)}"${item.resource_id === reader.resource_id ? ' aria-current="page"' : ''}><strong>${h(item.name)}</strong></a></li>`).join('')}</ul></section>`).join('');
  const edit = !model.notice && reader.relative_path ? `<form method="post" action="${h(`${base}/resources/open`)}"><input type="hidden" name="csrf" value="${h(options.csrfToken)}"><input type="hidden" name="path" value="${h(reader.relative_path)}"><button class="reader-button" type="submit">${h(t('external_edit'))}</button></form>` : '';
  const technical = `<details class="reader-technical"><summary>${h(t('technical'))}</summary><dl><dt>${h(t('path'))}</dt><dd>${h(reader.relative_path)}</dd><dt>${h(t('resource_id'))}</dt><dd>${h(reader.resource_id)}</dd><dt>SHA-256</dt><dd>${h(reader.sha256)}</dd><dt>${h(t('bytes'))}</dt><dd>${h(reader.bytes)}</dd></dl></details>`;
  const relationshipRows = (model.relationships?.edges ?? []).map(edge => {
    const node = model.relationships.nodes?.find(item => item.resource_id === edge.adjacent_resource_id);
    const href = readHref(edge.adjacent_resource_id);
    const note = typeof edge.evidence?.note === 'string' ? edge.evidence.note : typeof edge.evidence?.reason === 'string' ? edge.evidence.reason : '';
    return `<li><a href="${h(href)}">${h(node?.name ?? edge.adjacent_resource_id)}</a><small>${h(t(edge.direction === 'incoming' ? 'incoming' : 'outgoing'))} · ${h(edge.type === 'linked_to' ? t('linked_to') : edge.type)}</small>${note ? `<p>${h(note.slice(0, 120))}${note.length > 120 ? '…' : ''}</p>` : ''}<details><summary>${h(t('evidence'))}</summary><pre>${h(JSON.stringify(edge.evidence ?? {}, null, 2))}</pre></details></li>`;
  }).join('');
  const relationships = `<section class="reader-relationships"><h3>${h(t('stored_relationships'))}</h3><p>${h(t('not_verified'))}</p>${model.relationshipNotice ? `<p role="status">${h(model.relationshipNotice)}</p>` : relationshipRows ? `<ul>${relationshipRows}</ul>` : `<p>${h(t('no_relationships'))}</p>`}${model.relationships?.truncated ? `<p>${h(t('truncated'))}</p>` : ''}</section>`;
  const pdfScript = !model.notice && reader.kind === 'pdf' && pdfUrl ? '<script type="module" src="/ui/pdf-reader.js"></script>' : '';
  const more = edit ? `<details class="reader-actions-menu"><summary class="reader-button">${h(t('more_actions'))}</summary><div class="reader-actions-popover">${['pdf','docx','image'].includes(reader.kind) ? `<p>${h(u('external'))}</p>` : ''}${edit}</div></details>` : '';
  const graphOrigin = `${base}/resources/read?` + new URLSearchParams({resource_id:reader.resource_id,return_to:returnHref,graph:'1'});
  const graphView = model.resourceFocusGraph ? `<section id="reader-graph"${model.graphMode && !model.manual ? '' : ' hidden'}>${renderResourceGraphView(model.resourceFocusGraph,{locale:options.locale,returnHref:graphOrigin,workSessions:model.relatedWorks})}</section>` : '';
  const graphToggle = graphView && !model.manual ? `<button type="button" class="reader-button" data-reader-graph-toggle aria-controls="reader-graph" aria-pressed="${Boolean(model.graphMode)}" data-graph-label="${h(label('关系画布','Relationship canvas'))}" data-read-label="${h(label('阅读','Read'))}">${h(model.graphMode ? label('阅读','Read') : label('关系画布','Relationship canvas'))}</button>` : '';
  const monitorUnavailable = Boolean(model.notice || model.manual?.notice);
  const monitorHref = monitorUnavailable ? '' : `${base}/resources/monitors?${new URLSearchParams({resource_id:reader.resource_id ?? ''})}`;
  const monitorError = model.monitorError || (!model.monitorSnapshot ? label('此材料的处理记录暂不可用。','Processing records are unavailable for this material.') : '');
  const monitorActivity = `<section class="reader-activity-monitor" id="reader-activity-monitor" aria-label="${h(label('此材料的处理记录','Processing records for this material'))}"><header><h2>${h(label('此材料的处理','This material’s processing'))}</h2><button type="button" class="reader-button" data-reader-monitor-retry>${h(label('刷新记录','Refresh records'))}</button></header>${renderActivityMonitor(model.monitorSnapshot,monitorError,h,label)}</section>`;
  const layoutControls = `<div class="reader-command-group reader-monitor-layout-commands" role="group" aria-label="${h(label('工作区布局','Workspace layout'))}"><button type="button" class="reader-button" data-reader-monitor-layout="a" aria-pressed="true" aria-controls="reader-panels">${h(label('正文与双屏','Document + monitors'))}</button><button type="button" class="reader-button" data-reader-monitor-layout="b" aria-pressed="false" aria-controls="reader-panels">${h(label('四分视图','Four panels'))}</button></div>`;
  const narrowControls = `<div class="reader-monitor-mobile-controls" role="group" aria-label="${h(label('窄屏工作区','Narrow workspace'))}"><button type="button" class="reader-button" data-reader-monitor-mode="document" aria-pressed="true" aria-controls="reader-content">${h(label('正文','Document'))}</button><button type="button" class="reader-button" data-reader-monitor-mode="monitors" aria-pressed="false" aria-controls="reader-activity-monitor reader-source">${h(label('监视屏','Monitors'))}</button></div>`;
  const sourceVersion = `<p class="reader-opened-version">${h(label('打开时的版本','Version when opened'))} · ${h(reader.name ?? reader.resource_id)}${reader.bytes != null ? ` · ${h(reader.bytes)} bytes` : ''}</p>`;
  const sourceContext = model.sourceContext ? renderReaderSourceContext(model.sourceContext, options) : '';
  const editUnavailable = model.editUnavailable ? `<p class="reader-format-note" role="status" data-reader-edit-unavailable>${h(label('当前无法编辑：','Editing unavailable: '))}${h(model.editUnavailable)}</p>` : '';
  body = editUnavailable + body;
  const emptyRelationships = !relationshipRows && !model.relationshipNotice && !model.relationships?.truncated;
  return `<!doctype html><html lang="${normalizeUiLocale(options.locale)}" ${options.htmlAttributes ?? ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h(reader.name ?? t('title'))} · ${UI_DISPLAY_NAME}</title><style>${uiStyles()}</style>${renderUiClientScript(true)}<script type="module" src="/ui/reader-editor.js"></script>${pdfScript}<script type="module" src="/ui/reader-monitors.js"></script></head><body class="atlas-reader-body"><div class="app-shell reader-shell" style="${h(options.railStyle ?? '')}">${renderNav('Resources', { ...options, project: project, interactive: true, workspaceHref: '/projects', resourcesHref: returnHref, settingsHref: options.settingsHref, locale: options.locale, languageCatalog: options.languageCatalog })}<div class="workspace reader-workspace">${renderTopbar({ section: t('title'), project, locale: options.locale, languageCatalog: options.languageCatalog })}<main class="resource-reader reader-files-open${model.graphMode && !model.manual ? ' reader-graph-open' : ''}" data-resource-reader data-reader-monitors data-reader-project-id="${h(project.id)}" data-reader-monitor-href="${h(monitorHref)}" data-reader-monitor-layout="a" data-reader-monitor-mode="document" data-reader-monitor-language="${zh ? 'zh' : 'en'}" data-reader-default-edit="${defaultEdit}" data-reader-resource-id="${h(reader.resource_id)}" data-reader-edit-error="${h(u('inline_error'))}" data-reader-edit-discard="${h(u('inline_discard'))}" data-reader-edit-discard-action="${h(u('inline_discard_action'))}" data-reader-edit-keep="${h(u('inline_keep'))}" data-reader-relations-empty="${emptyRelationships}"><header class="reader-toolbar"><a class="reader-button reader-back-command" href="${h(returnHref)}">${h(returnLabel)}</a><h1 title="${h(reader.relative_path)}">${h(reader.name ?? t('title'))}</h1><div class="reader-toolbar-actions"><div class="reader-command-group reader-document-commands" role="group" aria-label="${h(label('文档模式','Document modes'))}">${directActions}${graphToggle}</div><div class="reader-command-group reader-view-commands" role="group" aria-label="${h(label('视图控制','View controls'))}">${button('files-toggle', 'files', 'reader-files', true)}${button('focus-toggle', 'focus', 'reader-content', false)}${button('source-toggle', 'source', 'reader-source', false)}${more}</div>${layoutControls}</div></header>${narrowControls}<p class="callout warn" role="alert" data-reader-edit-status hidden></p><div class="reader-layout"><nav class="reader-files" id="reader-files" aria-label="${h(t('files'))}"><h2>${h(t('files'))}</h2>${files}</nav><div class="reader-panels" id="reader-panels"><section class="reader-content" id="reader-content"${model.graphMode && !model.manual ? ' hidden' : ''} tabindex="-1" aria-label="${h(t('content'))}">${body}</section>${graphView || `<section id="reader-graph" hidden><p class="reader-monitor-empty">${h(label('此材料没有可用的已存关系图。','No stored graph is available for this material.'))}</p></section>`}${monitorActivity}<aside class="reader-source" id="reader-source" hidden><h2>${h(t('source'))}</h2>${sourceVersion}${sourceContext}<a class="text-link" href="${h(detailsHref)}">${h(t('details'))}</a>${activityReturn ? `<p><a class="text-link" href="${h(activityReturn)}">${h(label('返回活动','Back to Activity'))}</a></p>` : ''}${relationships}${ai}${technical}</aside><noscript><p><a href="${h(detailsHref)}">${h(label('查看材料来源详情','Open material source details'))}</a></p></noscript></div></div></main></div></div></body></html>`;
}
