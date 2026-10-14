import { UI_DISPLAY_NAME } from '../brand.js';
import { escapeHtml, renderNav, renderTopbar, renderUiClientScript } from '../components.js';
import { uiStyles } from '../styles.js';
import { normalizeUiLocale, translateUi } from '../i18n.js';

function fileName(filePath) {
  return String(filePath ?? '').split(/[\\/]/u).pop() || 'Resource';
}

function time(value, t, locale) {
  if (!value) return t('not_available');
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? t('not_available') : date.toLocaleString(normalizeUiLocale(locale));
}

function initiatorLabel(item, t) {
  if (item.initiated_by?.channel === 'host') return item.initiated_by.agent || t('host');
  if (item.initiated_by?.channel === 'desktop') return `${UI_DISPLAY_NAME} Desktop`;
  return UI_DISPLAY_NAME;
}

function statusInfo(item, current, t) {
  const raw = String(item.status ?? (current ? 'running' : 'completed')).toLowerCase();
  if (raw === 'waiting') return { key: 'waiting', label: t('waiting') };
  if (['failed', 'interrupted'].includes(raw)) return { key: 'failed', label: t(raw === 'interrupted' ? 'interrupted' : 'failed') };
  if (['running', 'in progress', 'in_progress'].includes(raw)) return { key: 'running', label: t('running') };
  return { key: 'completed', label: t('done') };
}

function resourceName(item) {
  return item.resource_name || item.file_name || fileName(item.file_path);
}

function detailContent(item, current, csrfToken, t) {
  const purpose = item.purpose ? `<p><strong>${escapeHtml(t('purpose'))}</strong>${escapeHtml(item.purpose)}</p>` : '';
  const result = item.result_summary?.label ?? item.result_label ?? item.result;
  const resultLine = result ? `<p><strong>${escapeHtml(t('result'))}</strong>${escapeHtml(result)}</p>` : '';
  const error = item.error_message ?? item.error;
  const errorLine = error ? `<p class="activity-manager-error"><strong>${escapeHtml(t('reason'))}</strong>${escapeHtml(error)}</p>` : '';
  const recovery = item.recovery_href
    ? `<a class="action-button action-button-secondary" href="${escapeHtml(item.recovery_href)}">${escapeHtml(item.recovery_label ?? t('choose'))}</a>`
    : '';
  const dismiss = current && ['failed', 'interrupted'].includes(String(item.status ?? '').toLowerCase())
    ? `<form method="post" action="/activity/dismiss"><input type="hidden" name="csrf" value="${escapeHtml(csrfToken ?? '')}"><input type="hidden" name="activity_id" value="${escapeHtml(item.activity_id ?? '')}"><button class="action-button action-button-secondary" type="submit">${escapeHtml(t('dismiss'))}</button></form>`
    : '';
  const technical = [['Activity', item.activity_id], ['Work', item.work_id], ['Save', item.save_id], ['Resource', item.resource_id], [t('path'), item.file_path], ['SHA-256', item.verification?.sha256]].filter(([, value]) => value);
  const technicalDetail = technical.length ? `<details class="activity-technical"><summary>${escapeHtml(t('technical'))}</summary><dl>${technical.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl></details>` : '';
  const facts = purpose || resultLine || errorLine ? `${purpose}${resultLine}${errorLine}` : `<p>${escapeHtml(t('no_details'))}</p>`;
  return `<div class="activity-manager-detail"><div>${facts}</div>${recovery}${dismiss}${technicalDetail}</div>`;
}

function renderRow(item, { current = false, csrfToken, selectedActivityKey = null, t, locale } = {}) {
  const status = statusInfo(item, current, t);
  const name = resourceName(item);
  const resource = item.resource_href
    ? `<a href="${escapeHtml(item.resource_href)}">${escapeHtml(name)}</a>`
    : `<strong>${escapeHtml(name)}</strong>`;
  const updatedValue = item.updated_at ?? item.last_continued_at ?? item.inspected_at;
  const key = String(item.activity_id ?? item.work_id ?? item.file_path ?? name);
  const selected = selectedActivityKey === key;
  return `<details class="activity-manager-row is-${status.key}${selected ? ' is-selected' : ''}" data-activity-key="${escapeHtml(key)}"${selected ? ' open' : ''}><summary><span class="activity-manager-mark" aria-hidden="true"></span><span class="activity-manager-resource">${resource}<small>${escapeHtml(item.project?.name ?? t('no_project'))}</small>${status.key === 'failed' && (item.error_message ?? item.error) ? `<small class="activity-manager-error">${escapeHtml(item.error_message ?? item.error)}</small>` : ''}</span><span class="activity-manager-status">${escapeHtml(status.label)}</span><span class="activity-manager-initiator">${escapeHtml(initiatorLabel(item, t))}</span><time datetime="${escapeHtml(updatedValue ?? '')}">${escapeHtml(time(updatedValue, t, locale))}</time><button type="button" class="activity-monitor-trigger" data-activity-detail-open="${escapeHtml(key)}" aria-expanded="false" aria-controls="activity-record-monitor">${escapeHtml(t('detail_window'))}</button></summary>${detailContent(item, current, csrfToken, t)}</details>`;
}

function currentSection(items, csrfToken, selectedActivityKey, t, locale) {
  if (items.length) return `<section class="activity-manager-section" data-activity-current><div class="activity-manager-section-heading"><h2>${escapeHtml(t('active'))} <small>${items.length}</small></h2></div><div class="activity-manager-list">${items.map((item) => renderRow(item, { current: true, csrfToken, selectedActivityKey, t, locale })).join('')}</div></section>`;
  return `<section class="activity-manager-empty" data-activity-current><span>${escapeHtml(t('no_active'))}</span></section>`;
}

function recentSection(items, csrfToken, selectedActivityKey, t, locale, pagination) {
  if (!items.length) return '';
  const pager = pagination.total > 50 ? `<nav class="activity-pagination" aria-label="${escapeHtml(t('history_pages'))}">${pagination.page > 1 ? `<a href="/activity?page=${pagination.page - 1}">${escapeHtml(t('previous'))}</a>` : ''}<span>${pagination.start + 1}–${pagination.start + items.length} / ${pagination.total}</span>${pagination.start + items.length < pagination.total ? `<a href="/activity?page=${pagination.page + 1}">${escapeHtml(t('next'))}</a>` : ''}</nav>` : '';
  return `<section class="activity-manager-section"><div class="activity-manager-section-heading"><h2>${escapeHtml(t('completed'))} <small>${pagination.total}</small></h2>${pager}</div><div class="activity-manager-list">${items.map((item) => renderRow(item, { csrfToken, selectedActivityKey, t, locale })).join('')}</div></section>`;
}

export function renderActivityFragment(model, options = {}) {
  const t = (key) => translateUi(options.locale, `activity.${key}`, options.languageCatalog);
  const storedCurrent = model.current_activity ?? [];
  const current = storedCurrent.filter(item => !['failed', 'interrupted'].includes(item.status));
  const attention = storedCurrent.filter(item => ['failed', 'interrupted'].includes(item.status));
  const history = [...(model.recent_work ?? [])].sort((a,b) => String(b.updated_at ?? b.last_continued_at ?? b.inspected_at ?? '').localeCompare(String(a.updated_at ?? a.last_continued_at ?? a.inspected_at ?? '')));
  const selectedIndex = history.findIndex(item => String(item.activity_id ?? item.work_id) === model.selected_activity_key);
  const requested = model.history_page == null && selectedIndex >= 0 ? Math.floor(selectedIndex / 50) + 1 : Number(model.history_page);
  const page = Math.min(Math.max(1, Number.isSafeInteger(requested) ? requested : 1), Math.max(1, Math.ceil(history.length / 50)));
  const start = (page - 1) * 50;
  const recent = history.slice(start, start + 50);
  const emptyStatus = current.length ? '' : currentSection(current, options.csrfToken, model.selected_activity_key, t, options.locale);
  const activeSection = current.length ? currentSection(current, options.csrfToken, model.selected_activity_key, t, options.locale) : '';
  const attentionSection = attention.length ? `<section class="activity-manager-section" data-activity-attention><div class="activity-manager-section-heading"><h2>${escapeHtml(t('attention'))} <small>${attention.length}</small></h2></div><div class="activity-manager-list">${attention.map(item => renderRow(item, { current: true, csrfToken: options.csrfToken, selectedActivityKey: model.selected_activity_key, t, locale: options.locale })).join('')}</div></section>` : '';
  return `<section class="activity-manager" data-activity-live data-history-page="${page}" data-events-href="/activity/events" data-fragment-href="/activity/fragment" data-connection-lost="${escapeHtml(t('connection_lost'))}" data-connection-live="${escapeHtml(t('connection_live'))}" data-connection-poll="${escapeHtml(t('connection_poll'))}"${model.selected_activity_key ? ` data-selected-activity="${escapeHtml(model.selected_activity_key)}"` : ''}${model.import_status_href ? ` data-import-status-href="${escapeHtml(model.import_status_href)}"` : ''}><div class="activity-manager-toolbar"><button type="button" class="activity-monitor-trigger" data-activity-current-open aria-expanded="false" aria-controls="activity-current-monitor">${escapeHtml(t('current_window'))} · ${current.length}</button>${emptyStatus}<p class="activity-manager-connection" aria-live="polite">${escapeHtml(t('connection'))}</p></div>${model.current_activity_error ? `<p class="callout warn" data-activity-current-error>${escapeHtml(t('current_error'))}</p>` : ''}${activeSection}${attentionSection}${model.recent_work_error ? `<p class="callout warn">${escapeHtml(t('recent_error'))}</p>` : ''}${recentSection(recent, options.csrfToken, model.selected_activity_key, t, options.locale, {page,start,total:history.length})}</section>`;
}

export function renderActivityView(model, options = {}) {
  const t = (key) => translateUi(options.locale, `activity.${key}`, options.languageCatalog);
  return `<!doctype html><html lang="${normalizeUiLocale(options.locale)}" ${options.htmlAttributes ?? ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${UI_DISPLAY_NAME} ${escapeHtml(t('title'))}</title><style>${uiStyles()}</style>${renderUiClientScript(true)}</head><body class="product-workspace-body activity-workbench-body"><div class="app-shell" style="${escapeHtml(options.railStyle ?? '')}">${renderNav('Activity', { ...options, project: options.project, interactive: true, workspaceHref: options.workspaceHref, settingsHref: options.settingsHref, locale: options.locale, languageCatalog: options.languageCatalog })}<div class="workspace">${renderTopbar({ section: t('title'), locale: options.locale, languageCatalog: options.languageCatalog })}<main class="page activity-workbench" data-activity-workbench data-inspector-open="false" data-record-missing="${escapeHtml(t('record_missing'))}"><div class="page-intro"><h1>${escapeHtml(t('title'))}</h1></div>${renderActivityFragment(model, options)}<aside class="activity-inspector" data-activity-panels hidden>${[ ['current', 'current_window'], ['record', 'detail_window'] ].map(([name, label]) => `<section class="activity-monitor" hidden role="region" id="activity-${name}-monitor" data-activity-monitor="${name}" aria-labelledby="activity-${name}-title"><header class="activity-monitor-header" ><h2 id="activity-${name}-title">${escapeHtml(t(label))}</h2><button type="button" data-activity-monitor-close aria-label="${escapeHtml(t('close_window'))}">×</button></header><div class="activity-monitor-body" data-activity-monitor-body></div></section>`).join('')}</aside></main><script type="module" src="/ui/activity-workspace.js"></script></div></div></body></html>`;
}
