// Fixed Activity inspector consumes the existing live fragment, not a second state store.
export function initActivityWorkspace(root, { document: doc = globalThis.document, window: win = globalThis.window, storage = win?.sessionStorage } = {}) {
  if (!root || root.dataset.activityWorkbenchReady) return null;
  const region = root.querySelector('[data-activity-live]');
  const inspector = root.querySelector('[data-activity-panels]');
  const current = root.querySelector('[data-activity-monitor="current"]');
  const record = root.querySelector('[data-activity-monitor="record"]');
  if (!region || !inspector || !current || !record) return null;
  const panels = [current, record];
  const bodies = new Map(panels.map(panel => [panel, panel.querySelector('[data-activity-monitor-body]')]));
  const triggers = new Map();
  const storageKey = 'atlas.activity.inspector.v2';
  const returnedSelection = region.dataset.selectedActivity || null;
  let selectedKey = returnedSelection;
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(storageKey) || '{}') || {}; } catch {}
  if (!selectedKey && typeof saved.selectedKey === 'string') selectedKey = saved.selectedKey;
  const rowFor = key => [...region.querySelectorAll('[data-activity-key]')].find(row => row.dataset.activityKey === key);
  const persist = () => {
    try { storage?.setItem(storageKey, JSON.stringify({ selectedKey, current: !current.hidden, record: !record.hidden })); } catch {}
  };
  const layout = () => {
    inspector.hidden = panels.every(panel => panel.hidden);
    root.dataset.inspectorOpen = String(!inspector.hidden);
    root.querySelector('[data-activity-current-open]')?.setAttribute('aria-expanded', String(!current.hidden));
    region.querySelectorAll('[data-activity-detail-open]').forEach(button => {
      button.setAttribute('aria-expanded', String(!record.hidden && button.dataset.activityDetailOpen === selectedKey));
    });
  };
  const copy = (panel, elements) => {
    const body = bodies.get(panel);
    const controls = [...body.querySelectorAll('a, button, input, select, summary, [tabindex]')];
    const focusIndex = controls.indexOf(doc.activeElement);
    body.replaceChildren(...elements.map(element => element.cloneNode(true)));
    body.querySelectorAll('[data-activity-detail-open]').forEach(button => button.remove());
    if (focusIndex >= 0) [...body.querySelectorAll('a, button, input, select, summary, [tabindex]')][focusIndex]?.focus({ preventScroll: true });
  };
  const sync = () => {
    const source = region.querySelector('[data-activity-current]');
    const error = region.querySelector('[data-activity-current-error]');
    if (source) copy(current, [error, source].filter(Boolean));
    if (selectedKey) {
      region.dataset.selectedActivity = selectedKey;
      const row = rowFor(selectedKey);
      region.querySelectorAll('[data-activity-key]').forEach(item => item.classList.toggle('is-selected', item.dataset.activityKey === selectedKey));
      if (row) {
        const snapshot = row.cloneNode(true); snapshot.open = true;
        copy(record, [snapshot]);
      } else bodies.get(record).textContent = root.dataset.recordMissing;
    }
    layout();
  };
  const close = (panel, restore = true) => {
    panel.hidden = true;
    layout();
    if (restore) {
      const original = triggers.get(panel);
      const fallback = panel === record ? rowFor(selectedKey)?.querySelector('[data-activity-detail-open]') : root.querySelector('[data-activity-current-open]');
      (original?.isConnected ? original : fallback)?.focus({ preventScroll: true });
    }
    persist();
  };
  const open = (panel, trigger = null) => {
    if (trigger) triggers.set(panel, trigger);
    panel.hidden = false;
    sync();
    panel.querySelector('[data-activity-monitor-close]')?.focus({ preventScroll: true });
    persist();
  };
  root.addEventListener('click', event => {
    const trigger = event.target.closest('[data-activity-current-open], [data-activity-detail-open]');
    if (!trigger || !root.contains(trigger)) return;
    event.preventDefault(); event.stopPropagation();
    if (trigger.hasAttribute('data-activity-detail-open')) {
      selectedKey = trigger.dataset.activityDetailOpen;
      open(record, trigger);
    } else open(current, trigger);
  });
  root.addEventListener('atlas:activity-refreshed', sync);
  panels.forEach(panel => {
    panel.querySelector('[data-activity-monitor-close]').addEventListener('click', () => close(panel));
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(panel); }
    });
  });
  root.dataset.activityWorkbenchReady = 'true';
  sync();
  if (saved.current === true) open(current);
  if (selectedKey && (returnedSelection || saved.record === true)) open(record);
  return { sync, openCurrent: () => open(current), select: key => { selectedKey = key; open(record); }, close };
}
if (typeof document !== 'undefined') initActivityWorkspace(document.querySelector('[data-activity-workbench]'));