import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createSavedWorkService } from '../src/ui/services/saved-work-service.js';

test('Single saved Work lookup resolves current location only for the selected receipt', t => {
  const root = fs.mkdtempSync(path.resolve('test/.tmp/saved-work-lookup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'ui'));
  const items = [1, 2, 3].map(n => ({ save_id: `SAV-fixture-${n}`, project: { id: 'PRJ-fixture' },
    target: { path: path.join(root, `original-${n}.csv`) }, resource_id: `RES-fixture-${n}`,
    status: 'executed', verification: { sha256: String(n).repeat(64) } }));
  fs.writeFileSync(path.join(root, 'ui/saved-work.json'), JSON.stringify({ items }));
  const resolved = [];
  const service = createSavedWorkService({ stateDir: root, saveService: { projectRecord(row) {
    resolved.push(row.save_id);
    return { ...row, target: { path: path.join(root, `moved-${row.save_id}.csv`) } };
  } } });
  const selected = service.find('SAV-fixture-2');
  assert.deepEqual(resolved, ['SAV-fixture-2']);
  assert.equal(selected.work_id, 'SAV-fixture-2');
  assert.equal(selected.resource_id, 'RES-fixture-2');
  assert.equal(selected.result_path, path.join(root, 'moved-SAV-fixture-2.csv'));
  assert.equal(selected.result_fingerprint.sha256, '2'.repeat(64));
  assert.equal(service.find('SAV-absent'), null);
  assert.deepEqual(resolved, ['SAV-fixture-2']);
});
