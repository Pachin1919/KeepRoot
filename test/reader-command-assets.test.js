import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Registry } from '../src/registry.js';
import { startAtlasUiServer } from '../src/ui-server.js';
import { uiStyles } from '../src/ui/styles.js';

test('Reader command icons are bundled same-origin SVG assets under the existing image policy', async t => {
  const directory = fs.mkdtempSync(path.resolve('test/.tmp/reader-command-assets-'));
  const stateDir = path.join(directory, 'state');
  const registry = new Registry({ stateDir });
  const server = await startAtlasUiServer({ stateDir, registry, projectRoot: path.resolve('.') });
  t.after(async () => { await server.close(); registry.ledger.close(); });
  const css = uiStyles();
  assert.doesNotMatch(css, /--reader-command-icon:\s*url\("data:/u);
  for (const name of ['back', 'edit', 'read', 'graph', 'files', 'focus', 'source', 'more', 'table']) {
    const url = `/ui/reader-icons/${name}.svg`;
    assert.ok(css.includes(url), `${name} is used by a reader command`);
    const response = await fetch(new URL(url, server.workspace_url));
    assert.equal(response.status, 200, `${name} is served`);
    assert.match(response.headers.get('content-type'), /^image\/svg\+xml/u);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const svg = await response.text();
    assert.match(svg, /viewBox="0 0 24 24"/u);
    assert.doesNotMatch(svg, /<script|<foreignObject|\bon\w+=|(?:href|src)=/u);
  }
  const missing = await fetch(new URL('/ui/reader-icons/not-an-asset.svg', server.workspace_url));
  assert.equal(missing.status, 404);
});
