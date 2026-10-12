import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Registry } from '../src/registry.js';
import { startAtlasUiServer } from '../src/ui-server.js';
import { normalizeUiPreferences, readUiPreferences, uiPreferencesPath, writeUiPreferences } from '../src/ui/preferences.js';
import { renderSettingsView } from '../src/ui/views/settings-view.js';
import { uiStyles } from '../src/ui/styles.js';

test('Settings names the neutral palettes while retaining persisted IDs and independent accent choices', () => {
  for (const [locale, names] of [['en', ['Bright white', 'Cool blue-grey', 'Navy navigation', 'Green', 'Blue', 'Purple']], ['zh-CN', ['明亮白', '冷蓝灰', '深蓝导航', '绿色', '蓝色', '紫色']]]) {
    const html = renderSettingsView({ preferences: normalizeUiPreferences({ locale, theme: 'graphite', accent: 'vermilion' }) });
    const body = html.slice(html.indexOf('<body'));
    for (const name of names) assert.ok(body.includes(`<strong>${name}</strong>`));
    assert.match(body, /name="theme" value="graphite" checked/u);
    assert.match(body, /name="accent" value="vermilion" checked/u);
    for (const id of ['slate', 'graphite', 'warm_charcoal']) assert.ok(body.includes(`name="theme" value="${id}"`));
    for (const id of ['green', 'vermilion', 'amber']) assert.ok(body.includes(`name="accent" value="${id}"`));
    assert.doesNotMatch(body, /Post-Internet Plum|梅紫界面|鼠尾草导航|墨绿导航/u);
  }
});

test('local CJK typography separates UI, explicit reading choices and code in both Settings previews', () => {
  const css = uiStyles();
  assert.match(css, /--font-sans: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif/u);
  assert.match(css, /--reading-font: var\(--font-sans\)/u);
  assert.match(css, /html\[data-reading-font="serif"\] \{ --reading-font: Georgia/u);
  assert.match(css, /html\[data-reading-font="mono"\] \{ --reading-font: var\(--font-mono\)/u);
  assert.doesNotMatch(css, /\.reader-paper\s*\{[^}]*font-family:\s*var\(--font-sans\)/u, 'reading surfaces must honor the explicit reading preference');
  assert.match(css, /button, input, select, textarea, summary \{ font-family: inherit; \}/u);
  assert.match(css, /code, kbd, samp, pre \{ font-family: var\(--font-mono\); \}/u);
  assert.doesNotMatch(css, /font-weight:\s*(?:7[2-9]\d|[89]\d\d)/u);
  for (const locale of ['en', 'zh-CN']) {
    const preferences = normalizeUiPreferences({ locale, reading_font: 'serif' });
    const html = renderSettingsView({ preferences }, { csrfToken: 'font-csrf', returnHref: '/projects' });
    const body = html.slice(html.indexOf('<body'));
    assert.match(html, /data-reading-font="serif"/u);
    assert.match(body, /name="reading_font"><option value="inherit">[^<]+<\/option><option value="serif" selected>/u);
    assert.match(body, /class="settings-interface-sample"/u);
    assert.match(body, /class="settings-reading-sample"/u);
    assert.match(body, /class="settings-code-sample"/u);
    assert.match(body, /<code>const total = 120 \+ 80;<\/code>/u);
    assert.doesNotMatch(body, /settings\.(?:interface_font_help|reading_font_help|code_font_help|interface_sample_title)/u);
    assert.match(body, /name="csrf" value="font-csrf"/u);
    assert.match(body, /name="action" value="save"/u);
  }
});

test('paper and button hierarchy retain keyboard focus and reduced motion without blurring reading text', () => {
  const css = uiStyles();
  assert.match(css, /background-image: linear-gradient\([^\n]+atlas-paper-texture\.png/u);
  assert.match(css, /body\.atlas-reader-body \.reader-paper[^}]+background-color: var\(--surface-raised\)/u);
  assert.match(css, /body \.action-button:focus-visible[^}]+outline: 2px solid var\(--accent-strong\)/u);
  assert.match(css, /@supports \(backdrop-filter: blur\(4px\)\) \{ body \.action-button/u);
  assert.match(css, /html\[data-reduce-motion="true"\] :is\([^)]*\.action-button[^)]*\) \{ transition: none; transform: none; \}/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*@view-transition \{ navigation: none; \}\s*body :is\([^)]*\.action-button[^)]*\) \{ transition: none; transform: none; \}/u);
  assert.doesNotMatch(css, /reader-paper[^{}]*\{[^}]*backdrop-filter/u);
});

test('existing display preferences gain typography defaults and reject arbitrary font/CSS input', () => {
  fs.mkdirSync('test/.tmp', { recursive: true });
  const stateDir = fs.mkdtempSync(path.resolve('test/.tmp/settings-compat-'));
  try {
    const file = uiPreferencesPath(stateDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const previous = { schema: 'atlas-ui-preferences.v1', locale: 'zh-CN', theme: 'graphite', text_size: 'large', density: 'compact' };
    fs.writeFileSync(file, JSON.stringify(previous));
    const loaded = readUiPreferences(stateDir);
    assert.equal(loaded.theme, previous.theme);
    assert.equal(loaded.text_size, previous.text_size);
    assert.equal(loaded.font_family, 'system');
    assert.equal(loaded.reading_font, 'inherit');
    assert.equal(loaded.reading_spacing, 'comfortable');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), previous, 'reading does not rewrite legacy preferences');
    const invalid = normalizeUiPreferences({ font_family: 'url(https://example.test/font)', reading_font: '" onload="x', reading_spacing: '1000' });
    assert.equal(invalid.font_family, 'system');
    assert.equal(invalid.reading_font, 'inherit');
    assert.equal(invalid.reading_spacing, 'comfortable');
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});

test('Settings saves typography, preserves it for older forms, reopens and resets through the existing endpoint', async (t) => {
  fs.mkdirSync('test/.tmp', { recursive: true });
  const stateDir = fs.mkdtempSync(path.resolve('test/.tmp/settings-chain-'));
  const registry = new Registry({ stateDir });
  let server;
  t.after(async () => { if (server) await server.close(); registry.dispose(); fs.rmSync(stateDir, { recursive: true, force: true }); });
  writeUiPreferences(stateDir, { locale: 'en' });
  server = await startAtlasUiServer({ stateDir, registry, rules: {}, runtime: {} });
  const returnHref = '/work/DWT-existing/saved?work_id=SAV-existing';
  const open = async () => (await fetch(`${server.workspace_url}settings?return_to=${encodeURIComponent(returnHref)}`)).text();
  let html = await open();
  const post = (csrf, fields) => fetch(`${server.workspace_url}settings`, { method: 'POST', body: new URLSearchParams({ csrf, return_to: returnHref, ...fields }), redirect: 'manual' });
  let csrf = html.match(/name="csrf" value="([^"]+)"/u)[1];
  assert.match(html, /name="font_family"/u);
  assert.match(html, /name="reading_font"/u);
  assert.match(html, /name="reading_spacing"/u);
  const saved = await post(csrf, { action: 'save', locale: 'zh-CN', selected_theme: 'graphite', selected_accent: 'vermilion', text_size: 'large', density: 'compact', font_family: 'sans', reading_font: 'serif', reading_spacing: 'spacious', ui_scale: '110' });
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get('location'), returnHref);
  const current = readUiPreferences(stateDir);
  assert.equal(current.font_family, 'sans');
  assert.equal(current.reading_font, 'serif');
  assert.equal(current.reading_spacing, 'spacious');
  assert.equal(current.ui_scale, 110);
  const projects = await (await fetch(`${server.workspace_url}projects`)).text();
  assert.match(projects, /data-font-family="sans"/u);
  assert.match(projects, /data-reading-font="serif"/u);
  assert.match(projects, /data-reading-spacing="spacious"/u);
  await server.close(); server = null;
  server = await startAtlasUiServer({ stateDir, registry, rules: {}, runtime: {} });
  html = await open();
  assert.match(html, /name="reading_font"><option value="inherit">[^<]+<\/option><option value="serif" selected>/u);
  assert.match(html, /data-text-size="large"/u);
  csrf = html.match(/name="csrf" value="([^"]+)"/u)[1];
  const olderForm = await post(csrf, { action: 'save', locale: 'en', selected_theme: 'slate', text_size: 'comfortable' });
  assert.equal(olderForm.status, 303);
  assert.equal(readUiPreferences(stateDir).reading_font, 'serif');
  assert.equal(readUiPreferences(stateDir).reading_spacing, 'spacious');
  assert.equal(readUiPreferences(stateDir).ui_scale, 110);
  const reset = await post(csrf, { action: 'reset' });
  assert.equal(reset.status, 303);
  const defaults = readUiPreferences(stateDir);
  assert.equal(defaults.font_family, 'system');
  assert.equal(defaults.reading_font, 'inherit');
  assert.equal(defaults.reading_spacing, 'comfortable');
});
