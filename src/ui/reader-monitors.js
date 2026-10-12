// Reader layout and bounded metadata refresh. This controller never edits content.
export function matchesReaderSnapshot(snapshot, projectId, resourceId) {
  return Boolean(snapshot?.ok === true && snapshot.project_id === projectId && snapshot.resource_id === resourceId
    && snapshot.current && snapshot.recent && ['current', 'recent'].every(key => Array.isArray(snapshot[key].items) && snapshot[key].items.length <= 4));
}

export function initReaderMonitors(root, env = {}) {
  if (!root || root.dataset.readerMonitorsReady) return null;
  const doc = env.document ?? document, win = env.window ?? window;
  const fetchSnapshot = env.fetch ?? win.fetch.bind(win);
  const later = env.setTimeout ?? win.setTimeout.bind(win), cancel = env.clearTimeout ?? win.clearTimeout.bind(win);
  const projectId = root.dataset.readerProjectId, resourceId = root.dataset.readerResourceId;
  const language = root.dataset.readerMonitorLanguage === 'zh';
  const text = (cn, en) => language ? cn : en;
  const purposes = { content: text('内容检查','Content inspection'), structure: text('结构检查','Structure inspection'), data: text('数据检查','Data inspection'), visual: text('视觉检查','Visual inspection') };
  const dateLabel = value => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(language ? 'zh-CN' : 'en', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsed);
  };
  const records = root.querySelector('[data-reader-monitor-records]'), error = root.querySelector('[data-reader-monitor-error]');
  const source = root.querySelector('#reader-source'), graph = root.querySelector('#reader-graph'), content = root.querySelector('#reader-content');
  const activity = root.querySelector('#reader-activity-monitor'), retry = root.querySelector('[data-reader-monitor-retry]');
  const narrow = win.matchMedia('(max-width: 1000px)');
  const layoutButtons = [...root.querySelectorAll('[data-reader-monitor-layout]')].filter(button => button.tagName === 'BUTTON');
  const modeButtons = [...root.querySelectorAll('[data-reader-monitor-mode]')].filter(button => button.tagName === 'BUTTON');
  const sourceToggle = root.querySelector('[data-reader-source-toggle]');
  const Observer = env.MutationObserver ?? win.MutationObserver;
  let timer = null, controller = null, busy = false, disposed = false, generation = 0;
  let endpoint = null;
  try {
    const url = new URL(root.dataset.readerMonitorHref, win.location.href);
    if (url.origin === win.location.origin && url.pathname === `/projects/${encodeURIComponent(projectId)}/resources/monitors`
      && url.searchParams.get('resource_id') === resourceId && [...url.searchParams.keys()].length === 1 && !url.hash) endpoint = url.pathname + url.search;
  } catch {}
  root.dataset.readerMonitorsReady = 'true';
  const sameReader = () => root.dataset.readerProjectId === projectId && root.dataset.readerResourceId === resourceId;
  const visible = () => !doc.hidden && sameReader() && !root.classList.contains('reader-focus-mode')
    && (!narrow.matches || root.dataset.readerMonitorMode === 'monitors');
  const clearTimer = () => { if (timer !== null) cancel(timer); timer = null; };
  const schedule = () => { clearTimer(); if (!disposed && visible() && endpoint && !busy) timer = later(refresh, 15000); };
  const showError = message => { if (error) { error.textContent = message; error.hidden = false; } };
  const append = (parent, tag, value, className) => {
    const node = doc.createElement(tag); node.textContent = String(value ?? '');
    if (className) node.className = className;
    parent.appendChild(node); return node;
  };
  const render = snapshot => {
    if (!records) return;
    const fragment = doc.createDocumentFragment();
    const states = { running: text('处理中','Running'), waiting: text('等待','Waiting'), failed: text('失败','Failed'), interrupted: text('已中断','Interrupted'), completed: text('已完成','Completed'), inspect: text('检查记录','Inspection record') };
    for (const [key, title] of [['current', text('当前处理','Current processing')], ['recent', text('最近记录','Recent records')]]) {
      const data = snapshot[key], section = doc.createElement('section'); section.className = 'reader-monitor-records';
      append(section, 'h3', title);
      if (data.error) append(section, 'p', data.error, 'callout warn');
      else if (!data.items.length) append(section, 'p', text('此材料没有已记录的处理。','No recorded processing for this material.'), 'reader-monitor-empty');
      else {
        const list = doc.createElement('ul');
        for (const item of data.items) {
          const row = doc.createElement('li'), heading = doc.createElement('div');
          append(heading, 'strong', Object.hasOwn(purposes, item.label) ? purposes[item.label] : item.label); append(heading, 'span', states[item.status] ?? text('信息不完整：','Information incomplete: ') + (item.status ?? ''));
          row.appendChild(heading);
          if (item.actor) append(row, 'small', item.actor);
          if (item.summary) append(row, 'p', item.summary);
          if (item.updated_at) { const date = append(row, 'time', dateLabel(item.updated_at)); date.dateTime = item.updated_at; }
          list.appendChild(row);
        }
        section.appendChild(list);
      }
      if (data.truncated) append(section, 'p', text('仅显示最近 4 条记录。','Only the latest 4 records are shown.'));
      fragment.appendChild(section);
    }
    if (snapshot.observed_at) {
      const observation = append(fragment, 'p', text('记录刷新：','Records refreshed: '), 'reader-monitor-observed');
      const date = append(observation, 'time', dateLabel(snapshot.observed_at)); date.dateTime = snapshot.observed_at;
    }
    records.replaceChildren(fragment);
    if (error) { error.hidden = true; error.textContent = ''; }
  };
  async function refresh() {
    clearTimer();
    if (disposed || busy || !visible() || !endpoint) return;
    busy = true; controller = new AbortController(); const requestGeneration = ++generation;
    retry?.setAttribute('aria-busy', 'true');
    try {
      const response = await fetchSnapshot(endpoint, { signal: controller.signal, headers: { accept: 'application/json' }, cache: 'no-store' });
      const snapshot = await response.json();
      if (disposed || requestGeneration !== generation || !sameReader() || !visible()) return;
      if (!response.ok || !matchesReaderSnapshot(snapshot, projectId, resourceId)) throw new Error('Metadata unavailable');
      render(snapshot);
    } catch (failure) {
      if (!disposed && sameReader() && failure.name !== 'AbortError' && requestGeneration === generation) showError(text('处理记录刷新失败；可重试。正文和草稿仍保留。','Processing records could not refresh. Retry; the document and draft are retained.'));
    } finally {
      busy = false; controller = null; retry?.removeAttribute('aria-busy'); schedule();
    }
  }
  const syncLayout = () => {
    const focus = root.classList.contains('reader-focus-mode'), four = root.dataset.readerMonitorLayout === 'b' && !narrow.matches;
    // The editor owns this mode. Observers may run between target/bubbling
    // listeners; derived hidden flags must never override the chosen mode.
    const graphOnly = root.classList.contains('reader-graph-open');
    const setHidden = (node, value) => { if (node && node.hidden !== value) node.hidden = value; };
    setHidden(source, focus); setHidden(activity, focus);
    setHidden(graph, focus || (!four && !graphOnly));
    setHidden(content, !focus && !four && graphOnly);
    sourceToggle?.setAttribute('aria-expanded', String(!focus));
    for (const button of layoutButtons) button.setAttribute('aria-pressed', String(button.dataset.readerMonitorLayout === root.dataset.readerMonitorLayout));
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.readerMonitorMode === root.dataset.readerMonitorMode));
    if (!visible() && busy) { generation++; controller?.abort(); }
    schedule();
  };
  const onLayout = event => { root.dataset.readerMonitorLayout = event.currentTarget.dataset.readerMonitorLayout; syncLayout(); };
  const onMode = event => { root.dataset.readerMonitorMode = event.currentTarget.dataset.readerMonitorMode; syncLayout(); };
  const onExistingControl = event => {
    const control = event.target.closest?.('[data-reader-source-toggle], [data-reader-files-toggle], [data-reader-focus-toggle], [data-reader-graph-toggle], [data-reader-inline-edit]');
    if (!control) return;
    if (control.matches('[data-reader-source-toggle]')) root.dataset.readerMonitorMode = 'monitors';
    syncLayout();
    if (control.matches('[data-reader-source-toggle]')) source?.querySelector('a')?.focus();
  };
  const onVisibility = () => { if (doc.hidden) { clearTimer(); generation++; controller?.abort(); } else schedule(); };
  const onEscape = event => {
    if (event.key !== 'Escape') return;
    if (event.key === 'Escape' && narrow.matches && root.dataset.readerMonitorMode === 'monitors') {
      root.dataset.readerMonitorMode = 'document'; syncLayout(); modeButtons.find(button => button.dataset.readerMonitorMode === 'monitors')?.focus();
    } else syncLayout();
  };
  const cleanup = () => {
    if (disposed) return; disposed = true; generation++; clearTimer(); controller?.abort(); observer?.disconnect();
    doc.removeEventListener('visibilitychange', onVisibility); win.removeEventListener('pagehide', cleanup); narrow.removeEventListener('change', syncLayout);
    root.removeEventListener('click', onExistingControl); root.removeEventListener('keydown', onEscape);
    retry?.removeEventListener('click', refresh);
    for (const button of layoutButtons) button.removeEventListener('click', onLayout);
    for (const button of modeButtons) button.removeEventListener('click', onMode);
    delete root.dataset.readerMonitorsReady;
  };
  for (const button of layoutButtons) button.addEventListener('click', onLayout);
  for (const button of modeButtons) button.addEventListener('click', onMode);
  retry?.addEventListener('click', refresh); root.addEventListener('click', onExistingControl); root.addEventListener('keydown', onEscape);
  doc.addEventListener('visibilitychange', onVisibility); win.addEventListener('pagehide', cleanup); narrow.addEventListener('change', syncLayout);
  const observer = Observer ? new Observer(syncLayout) : null;
  observer?.observe(root, { attributes: true, attributeFilter: ['class'] });
  if (graph) observer?.observe(graph, { attributes: true, attributeFilter: ['hidden'] });
  syncLayout();
  return { cleanup, refresh, syncLayout };
}

if (typeof document !== 'undefined') {
  const start = () => initReaderMonitors(document.querySelector('[data-reader-monitors]'));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
