import { UI_DISPLAY_NAME } from '../brand.js';
import { escapeHtml, renderNav, renderTopbar, renderUiClientScript } from '../components.js';
import { uiStyles } from '../styles.js';
import { normalizeUiLocale, translateUi } from '../i18n.js';

function searchSnippet(item, model) {
  if (model.scope !== 'body') return '';
  const source = item.catalog_index?.snippet;
  if (typeof source !== 'string' || !source.trim()) return '';
  const characters = [...source];
  const text = characters.slice(0, 400).join('');
  const terms = [...new Set(String(model.query ?? '').split(/[\s,，]+/u).map(term => term.trim().normalize('NFC')).filter(term => term.length >= 2 && term.length <= 64))].slice(0, 12).sort((a, b) => b.length - a.length);
  let output = '', position = 0;
  while (position < text.length) {
    const matches = terms.map(term => ({ term, index: text.indexOf(term, position) })).filter(match => match.index >= 0).sort((a, b) => a.index - b.index || b.term.length - a.term.length);
    const match = matches[0];
    if (!match) { output += escapeHtml(text.slice(position)); break; }
    output += escapeHtml(text.slice(position, match.index)) + `<mark>${escapeHtml(match.term)}</mark>`;
    position = match.index + match.term.length;
  }
  return `<span class="search-result-snippet">${output}${characters.length > 400 ? '…' : ''}</span>`;
}

function results(model, t) {
  if (!model.query) return `<section class="surface empty-state"><strong>${escapeHtml(t('empty'))}</strong><p>${escapeHtml(t('empty_detail'))}</p></section>`;
  if (!model.items.length) return `<section class="surface empty-state"><strong>${escapeHtml(t('no_matches'))}</strong><p>${escapeHtml(t('no_matches_detail').replaceAll('{query}', model.query))}</p></section>`;
  return `<section class="surface"><div class="search-results">${model.items.map((item) => {
    const href = item.href ?? (item.kind === 'project'
      ? `/projects/${encodeURIComponent(item.project_id)}/resources`
      : `/projects/${encodeURIComponent(item.project_id)}/resources?path=${encodeURIComponent(item.relative_path)}`);
    const kind = item.kind === 'project' ? t('project')
      : item.kind === 'relationship' ? t('relationship')
        : item.kind === 'activity' ? t('activity') : item.extension || t('file');
    const detail = item.detail ?? (item.kind === 'project' ? item.project_name : `${item.project_name} / ${item.relative_path}`);
    return `<a class="search-result" href="${escapeHtml(href)}"><span class="search-result-kind">${escapeHtml(kind)}</span><span class="search-result-content"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(detail)}</small>${searchSnippet(item, model)}</span><span aria-hidden="true">→</span></a>`;
  }).join('')}</div>${model.truncated ? `<p class="callout warn">${escapeHtml(t('truncated'))}</p>` : ''}</section>`;
}

export function renderSearchView(model, options = {}) {
  const t = (key) => translateUi(options.locale, `search.${key}`, options.languageCatalog);
  const zh=normalizeUiLocale(options.locale).startsWith('zh');
  const label=(cn,en)=>zh?cn:en;
  const h=escapeHtml;
  const project=model.project ?? options.project;
  const action=model.action ?? '/search';
  const index=model.index;
  const coverage=index?.coverage ?? {};
  const skipped=Object.entries(coverage).filter(([key,value])=>['hash_mismatch','unindexed_resources','unsupported_format','truncated'].includes(key) && Number(value)>0);
  const changedNotice=model.changedSources ? `<p class="callout warn">${h(label('当前可显示 '+model.items.length+' 项。部分来源在外部修改或已缺失，旧正文结果已隐藏。','Currently showing '+model.items.length+' items. Some sources changed externally or are missing; their old body results are hidden.'))}</p>` : '';
  const review=(model.changedSources || Number(coverage.hash_mismatch)>0) && model.reviewHref ? `<a class="reader-button" href="${h(model.reviewHref)}">${h(label('复核来源与当前版本','Review sources and current versions'))}</a>` : '';
  const refresh=model.refreshAction ? `<form method="post" action="${h(model.refreshAction)}" class="inline-actions"><input type="hidden" name="csrf" value="${h(options.csrfToken)}"><input type="hidden" name="q" value="${h(model.query)}"><button class="reader-button">${h(label('更新正文索引','Update body index'))}</button><small>${h(label('仅在 Workspace 已授权正文索引时可用。','Requires Workspace permission for bounded content indexing.'))}</small></form>` : '';
  const excluded=skipped.reduce((sum,[,value])=>sum+Number(value),0);
  const searchState=model.scope === 'body' ? `<section class="search-index-state" role="status">${model.notice ? `<p class="callout warn">${h(model.notice)}</p>` : ''}<div class="search-index-summary"><strong>${h(index?.status !== 'available' ? label('正文索引尚未就绪。先更新索引，再搜索。','The body index is unavailable. Update the index, then search.') : label('已注册材料正文 · '+model.items.length+' 项','Registered material bodies · '+model.items.length+' results'))}</strong>${skipped.length ? `<span class="status-pill status-warn">${h(label('未纳入：','Excluded: ')+excluded)}</span>` : ''}</div>${changedNotice}${review}<details class="search-index-details"><summary>${h(label('索引范围与更新','Index coverage and update'))}</summary>${skipped.length ? `<p>${h(label('有材料未纳入结果（索引过期或格式不支持）。未索引的材料可更新索引；版本不一致的材料需先复核当前版本。','Some materials are excluded because their index is stale or their format is unsupported. Update unindexed materials; review the current version of changed materials first.'))}</p>` : ''}${index?.completed_at ? `<small>${h(label('索引更新时间：','Index updated: '))}${h(index.completed_at)}</small>` : ''}${refresh}</details></section>` : '';
  const searchLede=model.scope === 'body' ? label('搜索已注册材料的正文索引，结果可直接打开阅读。','Search the body index of registered materials and open results to read.') : t('lede');
  const searchLabel=model.scope === 'body' ? label('正文关键词','Body keywords') : t('label');
  const scopeControl=project ? `<select name="scope" aria-label="${h(label('搜索范围','Search scope'))}"><option value="filename"${model.scope!=='body'?' selected':''}>${h(label('文件名','File names'))}</option><option value="body"${model.scope==='body'?' selected':''}>${h(label('正文（已注册材料）','Body (registered materials)'))}</option></select>` : '';
  return `<!doctype html><html lang="${normalizeUiLocale(options.locale)}" ${options.htmlAttributes ?? ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(t('title'))} · ${UI_DISPLAY_NAME}</title><style>${uiStyles()}</style>${renderUiClientScript(true)}</head><body><div class="app-shell" style="${escapeHtml(options.railStyle ?? '')}">${renderNav('', { ...options, project, interactive: true, workspaceHref: '/projects', settingsHref: options.settingsHref, locale: options.locale, languageCatalog: options.languageCatalog })}<div class="workspace">${renderTopbar({ section: t('title'), locale: options.locale, languageCatalog: options.languageCatalog })}<main class="page search-workbench"><div class="page-intro"><div><h1>${escapeHtml(t('title'))}</h1><p class="lede">${escapeHtml(searchLede)}</p></div></div><form class="surface search-page-form" method="get" action="${h(action)}"><label for="search-page-query">${escapeHtml(searchLabel)}</label><div>${scopeControl}<input id="search-page-query" name="q" type="search" value="${escapeHtml(model.query)}" autofocus><button class="action-button" type="submit">${escapeHtml(t('title'))}</button></div></form>${model.unavailable?.length ? `<p class="callout warn">${escapeHtml(t(model.unavailable.length === 1 ? 'unavailable_one' : 'unavailable').replaceAll('{count}', String(model.unavailable.length)))}</p>` : ''}${searchState}${results(model, t)}${model.more ? `<a class="reader-button" href="${h(model.more)}">${h(label('更多结果','More results'))}</a>` : ''}</main></div></div></body></html>`;
}
