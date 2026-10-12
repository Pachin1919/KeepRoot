import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { uiStyles } from '../src/ui/styles.js';
import { renderResourceGraphView } from '../src/ui/views/resource-graph-view.js';

const client = fs.readFileSync(new URL('../src/ui/client.js', import.meta.url), 'utf8');
const hook = client.slice(client.indexOf('function initWorkbenchMotion('), client.indexOf('\nfunction navigateResourceReader('));
function harness({ reduced = false, enabled = true, observer = true } = {}) {
  const animations = [], observers = [], handlers = {}, mediaHandlers = {};
  const panels = ['reader-content', 'reader-graph', 'reader-source', 'reader-activity-monitor', 'reader-files'].map(id => ({
    id, hidden: false, visible: true, getClientRects() { return this.visible ? [{}] : []; },
    ...(enabled ? { animate(frames, options) { const animation = { cancelCount: 0, cancel() { this.cancelCount++; } }; animations.push({ panel: this, frames, options, animation }); return animation; } } : {}),
  }));
  const root = { querySelector: selector => panels.find(panel => '#' + panel.id === selector) };
  const html = { dataset: {} }, doc = { documentElement: html, querySelector: () => root };
  const preference = { matches: reduced, addEventListener: (name, fn) => { mediaHandlers[name] = fn; }, removeEventListener: name => { delete mediaHandlers[name]; } };
  const win = { matchMedia: () => preference, addEventListener: (name, fn) => { handlers[name] = fn; },
    ...(observer ? { MutationObserver: class { constructor(fn) { this.fn = fn; this.observed = []; observers.push(this); } observe(node, options) { this.observed.push({ node, options }); } disconnect() { this.disconnected = true; } } } : {}),
  };
  const controller = vm.runInNewContext(hook + '\ninitWorkbenchMotion(doc, win)', { doc, win, Map, Set });
  const emit = changes => observers[0].fn(changes);
  return { panels, root, html, preference, animations, observers, handlers, mediaHandlers, controller, emit };
}

test('panel changes animate a bounded visible set and cancel repeated feedback', () => {
  const h = harness();
  assert.equal(h.animations.length, 0);
  h.panels[1].hidden = true; h.panels[2].visible = false;
  h.emit([{ target: h.root, type: 'attributes' }]);
  assert.deepEqual(h.animations.map(item => item.panel.id), ['reader-content', 'reader-activity-monitor', 'reader-files']);
  assert.equal(h.animations[0].options.duration, 160);
  assert.deepEqual(Object.keys(h.animations[0].frames[0]), ['opacity', 'transform']);
  h.emit([{ target: h.panels[0], type: 'childList' }]);
  assert.equal(h.animations[0].animation.cancelCount, 1);
  assert.equal(h.animations.length, 4);
});

test('editor input, graph transforms and metadata replacement have no observed motion boundary', () => {
  const h = harness();
  const bindings = h.observers[0].observed;
  assert.equal(bindings.length, 6);
  for (const binding of bindings) assert.equal(binding.options.subtree, undefined);
  assert.equal(bindings.find(binding => binding.node.id === 'reader-content').options.childList, true);
  for (const binding of bindings.filter(binding => binding.node !== h.root && binding.node.id !== 'reader-content')) {
    assert.equal(binding.options.childList, false);
    assert.deepEqual([...binding.options.attributeFilter], ['hidden']);
  }
  h.emit([{ target: { id: 'editor' }, type: 'childList' }, { target: { id: 'graph-world' }, type: 'attributes' }, { target: { id: 'records' }, type: 'childList' }]);
  assert.equal(h.animations.length, 0);
  assert.doesNotMatch(hook, /preventDefault|fetch\(|replaceChildren|location\.|\.focus\(|setTimeout|innerHTML/u);
});

test('OS and Atlas reduced motion suppress feedback and cancel running animations', () => {
  const h = harness(); h.emit([{ target: h.root, type: 'attributes' }]);
  h.preference.matches = true; h.mediaHandlers.change();
  assert.ok(h.animations.every(item => item.animation.cancelCount === 1));
  h.emit([{ target: h.root, type: 'attributes' }]); assert.equal(h.animations.length, 5);
  h.preference.matches = false; h.html.dataset.reduceMotion = 'true'; h.observers[1].fn();
  h.emit([{ target: h.root, type: 'attributes' }]); assert.equal(h.animations.length, 5);
  const off = harness({ reduced: true }); off.emit([{ target: off.root, type: 'attributes' }]); assert.equal(off.animations.length, 0);
});

test('missing optional APIs fall back; pagehide disconnects and cancels without remounting', () => {
  const fallback = harness({ enabled: false }); fallback.emit([{ target: fallback.root, type: 'attributes' }]);
  assert.equal(fallback.animations.length, 0); assert.equal(harness({ observer: false }).controller, null);
  const h = harness(); h.emit([{ target: h.root, type: 'attributes' }]); h.handlers.pagehide();
  assert.ok(h.observers.every(item => item.disconnected)); assert.ok(h.animations.every(item => item.animation.cancelCount === 1));
  h.emit([{ target: h.root, type: 'attributes' }]); assert.equal(h.animations.length, 5);
});

test('progressive navigation keeps chrome static and honors both reduced motion paths', () => {
  const css = uiStyles();
  assert.match(css, /@view-transition\s*\{ navigation: auto; \}/u);
  assert.match(css, /@view-transition\s*\{ navigation: none; \}/u);
  assert.match(css, /atlas-nav[^}]*animation: none/su);
  assert.match(css, /html\[data-reduce-motion="true"\]::view-transition-old\(\*\)/u);
  assert.match(css, /atlas-page-in 160ms/u);
  assert.match(css, /--document-command: #1d4ed8/u); assert.match(css, /--window-command: #0f766e/u);
  assert.doesNotMatch(css, /transition:\s*(?:all|[^;]*(?:box-shadow|filter|grid-template|font-size))/u);
});

test('grouped canvas controls preserve deterministic selectors and accessible labels', () => {
  const html = renderResourceGraphView({ project_id: 'P', root_resource_id: 'R', nodes: [{ id: 'resource:R', kind: 'resource', resource_id: 'R', label: 'Note' }], edges: [] }, { locale: 'en' });
  assert.match(html, /role="group" aria-label="Zoom"/u); assert.match(html, /role="group" aria-label="Canvas view"/u);
  for (const selector of ['data-graph-scale="0.8"', 'data-graph-scale="1.25"', 'data-graph-fit', 'data-graph-focus', 'data-graph-zoom']) assert.ok(html.includes(selector));
  assert.match(html, /aria-label="Zoom out"/u); assert.match(html, /graph-control-icon" aria-hidden="true"/u);
});
