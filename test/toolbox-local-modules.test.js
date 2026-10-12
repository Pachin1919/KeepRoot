import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToolboxView } from '../src/ui/views/toolbox-view.js';

test('Toolbox local tools escape metadata and link to review without executable forms', () => {
  const html = renderToolboxView({ project: { id: 'PRJ-fixture', name: 'Fixture' }, projects: [], resources: [],
    folders: [], local_modules: [{ module_id: 'local.fixture<script>', module_version: '<img src=x onerror=bad()>', enabled: false }] }, { locale: 'en' });
  const local = html.match(/<section[^>]*data-local-tools>[\s\S]*?<\/section>/u)?.[0];
  assert.ok(local);
  assert.match(local, /without a sandbox/u);
  assert.match(local, /Disabled/u);
  assert.match(local, /local\.fixture&lt;script&gt;/u);
  assert.doesNotMatch(local, /<script>|<img|<form|local-preview|package-install|local-change/u);
  assert.match(local, /\/modules\?project_id=PRJ-fixture#local-tool-local\.fixture%3Cscript%3E/u);
});
