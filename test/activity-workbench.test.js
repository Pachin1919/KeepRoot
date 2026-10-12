import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { renderActivityFragment, renderActivityView } from '../src/ui/views/activity-view.js';
import { renderTopbar } from '../src/ui/components.js';
import { initActivityWorkspace } from '../src/ui/activity-workspace.js';
import { Registry } from '../src/registry.js';
import { startAtlasUiServer } from '../src/ui-server.js';

const options = { locale: 'en', csrfToken: 'csrf-workbench' };
const item = (id, status = 'completed') => ({ activity_id: id, status, resource_name: `${id}.csv`, file_path: `Data/${id}.csv`, project: { id: 'PRJ-test', name: 'Analysis' }, purpose: 'Review totals', result_summary: { label: '2 rows · 3 fields' }, updated_at: '2026-10-11T08:00:00.000Z', initiated_by: { channel: 'host', agent: 'Codex' }, resource_href: `/projects/PRJ-test/resources?path=Data%2F${id}.csv&from=activity&activity=${id}` });

test('activity live refresh preserves actual transport status when the fragment replaces its rows', async () => {
  const client = fs.readFileSync('src/ui/client.js', 'utf8');
  const start = client.indexOf("const activityRegion = document.querySelector('[data-activity-live]');");
  const end = client.indexOf('  if (activityRegion.dataset.importStatusHref)', start);
  const callbacks = new Map();
  let connection = { textContent: 'Checking connection.' };
  let refreshes = 0;
  const region = {
    dataset: { fragmentHref: '/activity/fragment', eventsHref: '/activity/events', connectionLive: '本地活动正在实时更新。' },
    querySelector: selector => selector === '.activity-manager-connection' ? connection : null,
    querySelectorAll: () => [], contains: () => false,
    dispatchEvent: () => { refreshes++; },
    set innerHTML(value) { assert.equal(value, 'updated rows'); connection = { textContent: 'Checking connection.' }; },
  };
  vm.runInNewContext(client.slice(start, end) + '\n}', {
    document: { activeElement: null, querySelector: () => region, createElement: () => ({ content: { querySelector: () => ({ innerHTML: 'updated rows' }) } }) },
    window: { location: { origin: 'http://atlas.local' }, setTimeout: () => { throw Error('Unexpected fallback.'); } },
    URL, CustomEvent: class {},
    fetch: async () => ({ ok: true, text: async () => '<section>new rows</section>' }),
    EventSource: class { addEventListener(name, callback) { callbacks.set(name, callback); } },
  });
  callbacks.get('ready')();
  assert.equal(connection.textContent, '本地活动正在实时更新。');
  await callbacks.get('change')();
  assert.equal(refreshes, 1);
  assert.equal(connection.textContent, '本地活动正在实时更新。', 'A successful update must not revert the live indicator to checking.');
});

test('activity workbench renders compact empty status, true history and two bounded monitor consumers', () => {
  const html = renderActivityView({ current_activity: [], recent_work: [item('ACT-1')] }, options);
  const main = html.slice(html.indexOf('<main'));
  assert.match(main, /<div class="page-intro"><h1>Activity<\/h1><\/div>/u);
  assert.match(main, /<section class="activity-manager-empty" data-activity-current><span>No active work/u);
  assert.match(main, /activity-manager-toolbar[\s\S]*data-activity-current-open[\s\S]*activity-manager-empty[\s\S]*activity-manager-connection/u);
  assert.equal((main.match(/class="activity-manager-empty"/gu) ?? []).length, 1);
  assert.doesNotMatch(main, /activity-manager-empty"><h2|class="lede"/u);
  assert.match(main, /Completed local work/u);
  assert.match(main, /data-activity-current-open/u);
  assert.match(main, /data-activity-detail-open="ACT-1"/u);
  assert.equal((main.match(/<section class="activity-monitor" hidden role="region"/gu) ?? []).length, 2);
  assert.match(main, /<aside class="activity-inspector" data-activity-panels hidden>/u);
  assert.doesNotMatch(main, /<dialog|data-activity-monitor-handle/u);
  assert.ok(main.indexOf('activity-current-monitor" data-activity-monitor') > main.indexOf('2 rows · 3 fields'));
  assert.match(main, /type="module" src="\/ui\/activity-workspace.js"/u);
  const fragment = renderActivityFragment({ current_activity: [], recent_work: [] }, options);
  assert.doesNotMatch(fragment, /<dialog|<script/u);
});

test('activity workbench preserves source facts, real actions and exact selected Resource return', () => {
  const failed = { ...item('ACT-<bad>', 'failed'), error_message: 'Parser <stopped>', recovery_href: '/work/DWT-existing', recovery_label: 'Review input', verification: { sha256: 'a'.repeat(64) } };
  const html = renderActivityFragment({ current_activity: [item('ACT-running', 'running'), item('ACT-waiting', 'waiting'), failed], recent_work: [item('ACT-done')], selected_activity_key: 'ACT-<bad>' }, options);
  for (const status of ['In progress', 'Waiting', 'Failed', 'Completed']) assert.ok(html.includes(status));
  assert.match(html, /data-activity-key="ACT-&lt;bad&gt;" open/u);
  assert.match(html, /Parser &lt;stopped&gt;/u); assert.doesNotMatch(html, /Parser <stopped>/u);
  assert.match(html, /method="post" action="\/activity\/dismiss"/u);
  assert.match(html, /name="csrf" value="csrf-workbench"/u);
  assert.match(html, /name="activity_id" value="ACT-&lt;bad&gt;"/u);
  assert.match(html, /href="\/work\/DWT-existing"/u);
  assert.match(html, /&amp;from=activity&amp;activity=ACT-&lt;bad&gt;/u);
  assert.match(html, /<details class="activity-technical"><summary>Technical facts/u);
  assert.match(html, /a{64}/u);
});

test('workbench chrome retains Project identity, reachable search and compact typography scope', () => {
  const html = renderTopbar({ section: 'Work', project: { id: 'PRJ-<one>', name: 'Project <one>' }, resource: 'Data/<input>.csv' });
  assert.match(html, /href="\/projects\/PRJ-%3Cone%3E"/u);
  assert.match(html, /Project &lt;one&gt;/u); assert.match(html, /Data\/&lt;input&gt;\.csv/u);
  assert.match(html, /data-overlay-open="atlas-search"/u); assert.match(html, /Ctrl K/u);
  assert.doesNotMatch(html, /Keeproot Desktop/u);
  const layout = fs.readFileSync('src/ui/styles/layout.css', 'utf8');
  const components = fs.readFileSync('src/ui/styles/components.css', 'utf8');
  const workspace = fs.readFileSync('src/ui/styles/workspace.css', 'utf8');
  assert.match(layout, /\.topbar \{[\s\S]*?min-height: 44px/u);
  assert.match(layout, /\.page \{[^}]*padding: 16px 16px 32px/u);
  assert.match(layout, /\.topbar-context[^}]*display: flex/u);
  assert.match(components, /@media \(max-width: 759px\)[\s\S]*?\.activity-inspector/u);
  assert.match(components, /prefers-reduced-motion: no-preference[\s\S]*?html:not\(\[data-reduce-motion="true"\]\)/u);
  assert.doesNotMatch(workspace, /\.product-workspace-body h1 \{/u);
});

// Minimal DOM with the actual controller's required event, dialog, clone and focus interfaces.
function environment({ width = 1127, scale = 1, returnedSelection = null, stored = null } = {}) {
  const doc = { activeElement: null, documentElement: {} };
  class Element {
    constructor(dataset = {}, text = '') { this.dataset = dataset; this.style = {}; this.children = []; this.listeners = new Map(); this.selectors = new Map(); this.text = text; this.isConnected = true; this.open = false; this.hidden = true; this.attributes = new Map(); this.classes = new Set(); this.classList = { toggle: (key, enabled) => enabled ? this.classes.add(key) : this.classes.delete(key) }; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.text = value; this.children = []; }
    addEventListener(name, listener) { const list = this.listeners.get(name) ?? []; list.push(listener); this.listeners.set(name, list); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    fire(name, fields = {}) { const event = { target: this, preventDefault() {}, stopPropagation() {}, ...fields }; for (const listener of this.listeners.get(name) ?? []) listener(event); return event; }
    querySelector(selector) { return this.selectors.get(selector) ?? null; }
    querySelectorAll(selector) { if (selector === '[data-activity-key]') return this.rows ?? []; if (selector === '[data-activity-detail-open]') return []; return this.controls ?? []; }
    cloneNode() { const copy = new Element({ ...this.dataset }, this.textContent); copy.open = this.open; return copy; }
    replaceChildren(...children) { this.children = children; this.text = ''; }
    focus() { doc.activeElement = this; }
    remove() { this.isConnected = false; }
    close() { this.open = false; }
    show() { this.open = true; this.mode = 'nonmodal'; }
    showModal() { this.open = true; this.mode = 'modal'; }
    setPointerCapture(id) { this.captured = id; }
    getBoundingClientRect() { return { width: 320, height: 240, left: Number.parseFloat(this.style.left || '260') * scale, top: Number.parseFloat(this.style.top || '122') * scale }; }
    closest(selector) { if (selector === '.workspace') return workspace; if (selector === 'button, a') return null; return this.closestTrigger ?? null; }
    contains() { return true; }
    hasAttribute(name) { return name === 'data-activity-detail-open' && Boolean(this.dataset.activityDetailOpen); }
  }
  const root = new Element({ recordMissing: 'Record no longer present.' });
  const region = new Element({ selectedActivity: returnedSelection });
  const source = new Element({}, 'No work is in progress');
  region.selectors.set('[data-activity-current]', source);
  const row = (key, label) => { const value = new Element({ activityKey: key }, label); value.selectors.set('[data-activity-detail-open]', new Element({ activityDetailOpen: key })); return value; };
  region.rows = [row('ACT-one', 'First result'), row('ACT-two', 'Second result')];
  const createPanel = name => { const panel = new Element({ activityMonitor: name }); panel.selectors.set('[data-activity-monitor-body]', new Element()); panel.selectors.set('[data-activity-monitor-close]', new Element()); panel.selectors.set('[data-activity-monitor-handle]', new Element()); return panel; };
  const current = createPanel('current'), record = createPanel('record'), inspector = new Element();
  root.selectors.set('[data-activity-panels]', inspector);
  root.selectors.set('[data-activity-live]', region); root.selectors.set('[data-activity-monitor="current"]', current); root.selectors.set('[data-activity-monitor="record"]', record);
  root.selectors.set('[data-activity-current-open]', new Element());
  const topbar = new Element(); topbar.getBoundingClientRect = () => ({ bottom: 44 });
  const workspace = new Element(); workspace.getBoundingClientRect = () => ({ left: 228 }); workspace.selectors.set('.topbar', topbar);
  const win = { innerWidth: width, innerHeight: 900, addEventListener() {}, getComputedStyle: () => ({ getPropertyValue: () => String(scale) }) };
  const saved = new Map(stored ? [['atlas.activity.inspector.v2', JSON.stringify(stored)]] : []);
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const controller = initActivityWorkspace(root, { document: doc, window: win, storage });
  return { root, region, source, current, record, inspector, doc, win, saved, controller, row, Element };
}

test('activity workbench controller opens two fixed inspector sections and refreshes selected live facts in place', () => {
  const e = environment(); e.controller.openCurrent(); e.controller.select('ACT-two');
  assert.equal(e.current.hidden || e.record.hidden || e.inspector.hidden, false);
  assert.equal(e.root.dataset.inspectorOpen, 'true');
  assert.equal(e.current.open || e.record.open, false, 'the inspector never opens a dialog');
  const body = e.record.querySelector('[data-activity-monitor-body]');
  assert.equal(body.textContent, 'Second result');
  const before = { left: e.record.style.left, top: e.record.style.top };
  e.region.rows = [e.row('ACT-two', 'Updated same record'), e.row('ACT-one', 'First result')];
  e.source.textContent = 'Actual current result';
  e.root.fire('atlas:activity-refreshed');
  assert.equal(body.textContent, 'Updated same record'); assert.equal(e.region.dataset.selectedActivity, 'ACT-two');
  assert.deepEqual({ left: e.record.style.left, top: e.record.style.top }, before);
  assert.equal(e.record.hidden, false);
  assert.equal(e.current.querySelector('[data-activity-monitor-body]').textContent, 'Actual current result');
  e.region.rows = []; e.root.fire('atlas:activity-refreshed');
  assert.equal(body.textContent, 'Record no longer present.');
  const stored = [...e.saved.values()].join('');
  assert.doesNotMatch(stored, /Actual current result|Updated same record|First result/u);
});

test('activity workbench fixed inspector close and Escape restore focus and reclaim list space', () => {
  const e = environment(); e.controller.select('ACT-one');
  e.record.fire('keydown', { key: 'Escape' }); assert.equal(e.record.hidden, true);
  assert.equal(e.doc.activeElement, e.region.rows[0].querySelector('[data-activity-detail-open]'));
  assert.equal(e.inspector.hidden, true); assert.equal(e.root.dataset.inspectorOpen, 'false');
  e.controller.openCurrent(); e.controller.select('ACT-one');
  e.record.querySelector('[data-activity-monitor-close]').fire('click');
  assert.equal(e.record.hidden, true); assert.equal(e.current.hidden, false); assert.equal(e.inspector.hidden, false);
  e.current.querySelector('[data-activity-monitor-close]').fire('click');
  assert.equal(e.inspector.hidden, true);
});

test('activity workbench return selection preserves fixed presentation without content writes or coordinates', () => {
  const e = environment({ scale: 1.25, returnedSelection: 'ACT-two' });
  assert.equal(e.record.hidden, false); assert.equal(e.record.querySelector('[data-activity-monitor-body]').textContent, 'Second result');
  assert.deepEqual(e.record.style, {});
  const source = fs.readFileSync('src/ui/activity-workspace.js', 'utf8');
  assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest|\.submit\(|requestSubmit|setInterval|setTimeout|pointerdown|pointermove|showModal|zIndex/u);
  assert.doesNotMatch([...e.saved.values()].join(''), /position|left|top|Second result/u);
  const closed = environment({ stored: { selectedKey: 'ACT-two', record: false } });
  assert.equal(closed.record.hidden, true);
});

test('activity workbench module asset uses exact local GET mapping and rejects query, unknown path and POST', async t => {
  fs.mkdirSync('test/.tmp', { recursive: true });
  const stateDir = fs.mkdtempSync(path.resolve('test/.tmp/activity-workbench-'));
  const registry = new Registry({ stateDir });
  const server = await startAtlasUiServer({ stateDir, registry, rules: {} });
  t.after(async () => { await server.close(); registry.dispose(); fs.rmSync(stateDir, { recursive: true, force: true }); });
  const url = `${server.workspace_url}ui/activity-workspace.js`;
  const response = await fetch(url);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^text\/javascript/u);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await response.text(), fs.readFileSync('src/ui/activity-workspace.js', 'utf8'));
  assert.equal((await fetch(`${url}?path=other.js`)).status, 404);
  assert.equal((await fetch(`${url}/other.js`)).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 404);
});
