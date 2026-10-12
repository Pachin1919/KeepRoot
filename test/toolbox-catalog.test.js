import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToolboxView } from '../src/ui/views/toolbox-view.js';

const model = { project: { id: 'PRJ-fixture', name: 'Fixture' }, projects: [],
  resources: [{ resource_id: 'RES-fixture', name: 'Source.csv', relative_path: 'Data/Source.csv' }],
  folders: ['Results'], markdown: { request_key: 'fixture-markdown' } };
const main = value => renderToolboxView(value, { locale: 'zh-CN', csrfToken: 'fixture-csrf' }).split('<main')[1].split('</main>')[0];

test('Toolbox starts with five discoverable tools before any material selection', () => {
  const html = main(model);
  assert.equal([...html.matchAll(/data-toolbox-tool="[a-z]+"/gu)].length, 5);
  assert.match(html, /转换与整理/u);
  assert.match(html, /表格分析/u);
  assert.ok(html.indexOf('data-toolbox-tool=') < html.indexOf('<form'));
  assert.equal([...html.matchAll(/<section class="surface toolbox-setup[^"]*" hidden>/gu)].length, 2);
  assert.match(html, /tool=markdown#toolbox-config/u);
  assert.match(html, /tool=trend#toolbox-config/u);
});

test('Each chosen tool opens only its matching setup and keeps the submitted table operation', () => {
  for (const tool of ['markdown', 'pipeline', 'aggregate', 'pivot', 'trend']) {
    const html = main({ ...model, tool });
    assert.match(html, new RegExp('data-toolbox-tool="' + tool + '" aria-current="true"', 'u'));
    assert.equal([...html.matchAll(/<section class="surface toolbox-setup[^"]*" hidden>/gu)].length, 1);
    if (tool === 'markdown') assert.match(html, /toolbox-setup toolbox-conversion"><div/u);
    else assert.match(html, new RegExp('name="tool" value="' + tool + '" checked', 'u'));
  }
});

test('A failed URL draft opens conversion again and retains escaped inputs and request identity', () => {
  const html = main({ ...model, notice_key: 'network_error', markdown: {
    url: 'https://example.test/?a=<script>', folder: 'Results', name: 'retained.md', request_key: 'same-request',
  } });
  assert.match(html, /data-toolbox-tool="markdown" aria-current="true"/u);
  assert.match(html, /value="same-request"/u);
  assert.match(html, /value="retained.md"/u);
  assert.match(html, /a=&lt;script&gt;/u);
  assert.doesNotMatch(html, /a=<script>/u);
});
