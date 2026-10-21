import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Registry } from '../src/registry.js';
import { ResourceControl } from '../src/resource-control.js';
import { createResourceReaderService } from '../src/resource-reader-service.js';

const conflict = { code: 'ATLAS_STATE_CONFLICT' };
function fixture(t, text, name = 'large.md') {
  const root = fs.mkdtempSync(path.resolve('test/.tmp/large-reader-'));
  const workspace = path.join(root, 'workspace'); const directory = path.join(workspace, 'reading');
  fs.mkdirSync(directory, { recursive: true });
  const registry = new Registry({ stateDir: path.join(root, 'state') });
  const adopted = registry.adoptRoot({ rootPath: workspace, rootType: 'project_workspace', contentPolicy: 'structure_only' });
  const projectId = registry.create({ name: 'reading', currentPath: 'reading' }).project_id;
  registry.attachRoot(projectId, { rootId: adopted.root_id, relativePath: 'reading', reason: 'Paged reader fixture.' });
  const control = new ResourceControl({ stateDir: path.join(root, 'state'), registry });
  const service = createResourceReaderService({ registry, resourceControl: control });
  const file = path.join(directory, name); fs.writeFileSync(file, text);
  t.after(() => { control.dispose(); registry.dispose(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }); });
  return { file, directory, service, projectId, control,
    register: () => service.registerProjectFile({ projectId, relativePath: name }),
    read: (resourceId, options = {}) => service.read({ projectId, resourceId, ...options }) };
}

test('large JSON registers and reads bounded UTF-8 pages with stale continuation rejection', t => {
  const text = '{"message":"' + '中文🙂'.repeat(50000) + '"}';
  const f = fixture(t, text, 'large.json'), id = f.register().resource_id;
  const first = f.read(id);
  assert.equal(first.kind, 'text'); assert.ok(first.text_page.has_more);
  assert.ok(Buffer.byteLength(first.text) <= 65536);
  let output = first.text, page = first;
  while (page.text_page.has_more) {
    page = f.read(id, {textOffset:page.text_page.next_offset,expectedTextVersion:first.text_page.version});
    output += page.text;
  }
  assert.equal(output, text);
  fs.appendFileSync(f.file, '\n');
  assert.throws(() => f.read(id,{textOffset:first.text_page.next_offset,expectedTextVersion:first.text_page.version}), conflict);
});

test('large UTF-8 Markdown registers and reconstructs exactly through bounded byte pages', t => {
  const text = '\uFEFF# Large\r\n' + '中文🙂 line\r\n'.repeat(30000);
  const f = fixture(t, text); const id = f.register().resource_id;
  const originalRead = fs.readSync; const originalReadFile = fs.readFileSync; const calls = [];
  fs.readSync = (...args) => { calls.push(args[3]); assert.ok(args[1].length <= 65540); return originalRead(...args); };
  fs.readFileSync = (file, ...args) => { assert.notEqual(path.resolve(String(file)), f.file); return originalReadFile(file, ...args); };
  let output = ''; let offset = 0; let version;
  try {
    do {
      const page = f.read(id, { textOffset: offset, expectedTextVersion: version });
      assert.equal(page.sha256, null); assert.equal(page.text_page.offset, offset);
      assert.equal(page.text_page.total_bytes, Buffer.byteLength(text));
      assert.ok(Buffer.byteLength(page.text) <= 65536); assert.ok(!page.text.includes('\uFFFD'));
      version ??= page.text_page.version; assert.equal(page.text_page.version, version);
      output += page.text; offset = page.text_page.next_offset;
      if (!page.text_page.has_more) break;
    } while (true);
  } finally { fs.readSync = originalRead; fs.readFileSync = originalReadFile; }
  assert.equal(output, text); assert.equal(offset, Buffer.byteLength(text)); assert.ok(calls.length > 1);
});

test('paged reader rejects malformed offsets, UTF-8 interior offsets and stale or foreign tokens', t => {
  const f = fixture(t, 'x' + '🙂'.repeat(80000), 'large.txt'); const id = f.register().resource_id;
  const first = f.read(id); const version = first.text_page.version;
  assert.equal(first.text_page.next_offset, 65533, 'Page ends before the split four-byte character');
  const next = f.read(id, { textOffset: first.text_page.next_offset, expectedTextVersion: version });
  assert.ok(next.text.startsWith('🙂')); assert.ok(!next.text.includes('\uFFFD'));
  const end = f.read(id, { textOffset: first.bytes, expectedTextVersion: version });
  assert.equal(end.text, ''); assert.equal(end.text_page.has_more, false);
  for (const textOffset of [-1, 0.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => f.read(id, { textOffset, expectedTextVersion: version }), conflict);
  assert.throws(() => f.read(id, { textOffset: first.text_page.next_offset }), conflict);
  assert.throws(() => f.read(id, { textOffset: 2, expectedTextVersion: version }), conflict);
  assert.throws(() => f.read(id, { expectedTextVersion: 'stale' }), conflict);
  const other = path.join(f.directory, 'other.txt'); fs.copyFileSync(f.file, other);
  const otherId = f.service.registerProjectFile({ projectId: f.projectId, relativePath: 'other.txt' }).resource_id;
  assert.throws(() => f.read(otherId, { expectedTextVersion: version }), conflict);
  fs.appendFileSync(f.file, 'changed');
  assert.throws(() => f.read(id, { textOffset: first.text_page.next_offset, expectedTextVersion: version }), conflict);
});

test('large-page reads reject invalid UTF-8 and concurrent changes; links use only the selected page', t => {
  const f = fixture(t, '[First](#first)\n' + 'x'.repeat(70000) + '\n[Later](#later)\n' + '中文'.repeat(40000));
  const id = f.register().resource_id; const first = f.read(id);
  const links = f.service.resolveLinks({ projectId: f.projectId, resourceId: id, textOffset: 0,
    expectedTextVersion: first.text_page.version, targets: [ { syntax: 'relative_markdown', raw: '#first' }, { syntax: 'relative_markdown', raw: '#later' } ] });
  assert.equal(links[0].status, 'resolved'); assert.equal(links[1].reason, 'not_in_source');
  const originalRead = fs.readSync; let changed = false;
  fs.readSync = (...args) => { const n = originalRead(...args); if (!changed) { changed = true; fs.appendFileSync(f.file, 'changed'); } return n; };
  try { assert.throws(() => f.read(id), conflict); } finally { fs.readSync = originalRead; }
  fs.writeFileSync(f.file, Buffer.concat([Buffer.from([0xc3, 0x28]), Buffer.alloc(300000, 120)]));
  assert.throws(() => f.read(id), conflict);
});
