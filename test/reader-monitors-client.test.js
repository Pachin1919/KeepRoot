import assert from 'node:assert/strict';
import test from 'node:test';
import { initReaderMonitors, matchesReaderSnapshot } from '../src/ui/reader-monitors.js';

class Node {
  constructor(tag = 'DIV') { this.tagName = tag.toUpperCase(); this.dataset = {}; this.children = []; this.handlers = new Map(); this.attributes = {}; this.hidden = false; }
  set textContent(value) { this.value = String(value); this.children = []; }
  get textContent() { return (this.value ?? '') + this.children.map(child => child.textContent).join(''); }
  set innerHTML(value) { throw new Error(`Unsafe or remounted DOM: ${value}`); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...nodes) { this.children = nodes; this.value = ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, listener) { this.handlers.set(name, listener); }
  removeEventListener(name, listener) { if (this.handlers.get(name) === listener) this.handlers.delete(name); }
  querySelector() { return null; }
  click() { return this.handlers.get('click')?.({ currentTarget: this, target: this }); }
  focus() { this.focused = true; }
}
const snapshot = extra => ({ ok: true, project_id: 'P', resource_id: 'R', observed_at: '2026-10-12T10:00:00Z', current: { items: [], truncated: false, error: null }, recent: { items: [], truncated: false, error: null }, ...extra });
function harness({ narrow = false } = {}) {
  const root = new Node(); root.dataset = { readerProjectId: 'P', readerResourceId: 'R', readerMonitorHref: '/projects/P/resources/monitors?resource_id=R', readerMonitorLayout: 'a', readerMonitorMode: 'document', readerMonitorLanguage: 'en' };
  const classes = new Set(); root.classList = { contains: value => classes.has(value) };
  const records = new Node(), error = new Node(), content = new Node(), graph = new Node(), source = new Node(), activity = new Node(), retry = new Node('button');
  content.draft = 'Unsaved B'; graph.viewport = { scale: 1.7, x: 42, selected: 'node-2' };
  const layouts = ['a', 'b'].map(value => { const button = new Node('button'); button.dataset.readerMonitorLayout = value; return button; });
  const modes = ['document', 'monitors'].map(value => { const button = new Node('button'); button.dataset.readerMonitorMode = value; return button; });
  const nodes = { '[data-reader-monitor-records]': records, '[data-reader-monitor-error]': error, '#reader-content': content, '#reader-graph': graph, '#reader-source': source, '#reader-activity-monitor': activity, '[data-reader-monitor-retry]': retry };
  root.querySelector = selector => nodes[selector] ?? null;
  root.querySelectorAll = selector => selector === '[data-reader-monitor-layout]' ? layouts : modes;
  const doc = new Node(); doc.hidden = false; doc.createElement = tag => new Node(tag); doc.createDocumentFragment = () => new Node('fragment');
  const media = new Node(); media.matches = narrow;
  const win = new Node(); win.location = { href: 'http://atlas.local/projects/P/resources/read?resource_id=R', origin: 'http://atlas.local' }; win.matchMedia = () => media;
  const timers = new Map(), requests = []; let timerId = 0, observed;
  class Observer { constructor(callback) { this.callback = callback; observed = this; } observe() {} disconnect() { this.disconnected = true; } }
  const controller = initReaderMonitors(root, { document: doc, window: win,
    MutationObserver: Observer,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); },
  });
  const respond = (index, data, ok = true) => requests[index].resolve({ ok, json: async () => data });
  return { root, doc, win, media, records, error, content, graph, source, activity, retry, layouts, modes, timers, requests, controller, respond, classes, observed };
}

test('snapshot identity and bounded arrays reject stale selection and oversized responses', () => {
  assert.equal(matchesReaderSnapshot(snapshot(), 'P', 'R'), true);
  for (const value of [snapshot({ project_id: 'OTHER' }), snapshot({ resource_id: 'OLD' }), snapshot({ ok: false }), snapshot({ current: { items: Array(5).fill({}) } }), snapshot({ recent: null })]) assert.equal(matchesReaderSnapshot(value, 'P', 'R'), false);
});

test('A and B use the same draft and graph instance and narrow drawer restores keyboard focus', () => {
  const h = harness();
  assert.equal(h.graph.hidden, true); assert.equal(h.source.hidden, false);
  h.layouts[1].click(); assert.equal(h.graph.hidden, false); assert.equal(h.content.hidden, false);
  h.graph.hidden = true; h.observed.callback(); assert.equal(h.graph.hidden, false, 'legacy edit/readback visibility must retain the four-panel graph instance');
  h.layouts[0].click(); assert.equal(h.graph.hidden, true);
  assert.equal(h.content.draft, 'Unsaved B'); assert.deepEqual(h.graph.viewport, { scale: 1.7, x: 42, selected: 'node-2' });
  assert.equal(h.layouts[0].attributes['aria-pressed'], 'true');
  h.media.matches = true; h.controller.syncLayout(); assert.equal(h.timers.size, 0);
  h.modes[1].click(); assert.equal(h.root.dataset.readerMonitorMode, 'monitors'); assert.equal(h.timers.size, 1);
  h.root.handlers.get('keydown')({ key: 'Escape' });
  assert.equal(h.root.dataset.readerMonitorMode, 'document'); assert.equal(h.modes[1].focused, true);
  h.controller.cleanup();
  assert.equal(h.observed.disconnected, true);
});

test('graph visibility follows the authoritative mode before the bubbling click runs', () => {
  const h = harness();
  // A target listener has already chosen graph mode. An observer can run before
  // the parent click listener; it must not overwrite that mode with its old cache.
  h.classes.add('reader-graph-open'); h.content.hidden = true; h.graph.hidden = false;
  h.observed.callback();
  assert.equal(h.graph.hidden, false, 'the requested graph must stay visible');
  assert.equal(h.content.hidden, true, 'graph mode must not display the document instead');
  h.classes.delete('reader-graph-open'); h.observed.callback();
  assert.equal(h.graph.hidden, true); assert.equal(h.content.hidden, false);
  assert.equal(h.content.draft, 'Unsaved B');
  assert.deepEqual(h.graph.viewport, { scale: 1.7, x: 42, selected: 'node-2' });
  h.controller.cleanup();
});

test('metadata polling is 15 seconds, visible only, non-overlapping and uses safe text nodes', async () => {
  const h = harness();
  assert.equal([...h.timers.values()][0].ms, 15000); assert.equal(h.requests.length, 0);
  const request = h.controller.refresh(); await h.controller.refresh(); assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/projects/P/resources/monitors?resource_id=R');
  h.respond(0, snapshot({ current: { items: [{ label: '<script>name</script>', status: 'running', actor: 'Host', summary: '<img src=x>', updated_at: '2026-10-12T09:00:00Z' }], error: null } })); await request;
  assert.match(h.records.textContent, /<script>name<\/script>/u); assert.match(h.records.textContent, /<img src=x>/u);
  const rowTime = h.records.children[0].children[0].children[1].children[0].children.find(node => node.tagName === 'TIME');
  assert.equal(rowTime.dateTime, '2026-10-12T09:00:00Z');
  assert.doesNotMatch(rowTime.textContent, /T09:00:00Z/u);
  assert.equal(h.content.draft, 'Unsaved B'); assert.equal(h.error.hidden, true);
  h.doc.hidden = true; h.doc.handlers.get('visibilitychange')(); assert.equal(h.timers.size, 0);
  await h.controller.refresh(); assert.equal(h.requests.length, 1);
  h.doc.hidden = false; h.doc.handlers.get('visibilitychange')(); assert.equal(h.timers.size, 1);
  h.controller.cleanup(); assert.equal(h.timers.size, 0);
});

test('failure exposes retry, late responses are dropped and cleanup aborts outstanding metadata', async () => {
  const h = harness(); const first = h.controller.refresh();
  h.respond(0, snapshot({ resource_id: 'OLD' })); await first;
  assert.equal(h.error.hidden, false); assert.match(h.error.textContent, /Retry/u); assert.equal(h.records.textContent, '');
  const retry = h.retry.click(); assert.equal(h.requests.length, 2);
  h.respond(1, snapshot()); await retry; assert.equal(h.error.hidden, true);
  const pending = h.controller.refresh(); h.root.dataset.readerResourceId = 'NEW';
  const before = h.records.textContent; h.respond(2, snapshot({ current: { items: [{ label: 'Stale overwrite' }] } })); await pending;
  assert.equal(h.records.textContent, before); assert.equal(h.timers.size, 0);
  h.root.dataset.readerResourceId = 'R'; const final = h.controller.refresh();
  h.controller.cleanup(); assert.equal(h.requests[3].options.signal.aborted, true);
  h.respond(3, snapshot()); await final; assert.equal(h.timers.size, 0);
});
