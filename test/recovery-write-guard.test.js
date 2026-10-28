import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Registry } from '../src/registry.js';
import { createResourceControl } from '../src/resource-control.js';
import { assertRecoveryWritable } from '../src/storage/recovery-write-guard.js';

test('Recovery guard checks every Resource in a batch, including the last SQL chunk', t => {
  const root = fs.mkdtempSync(path.resolve('test/.tmp/recovery-guard-batch-'));
  const db = new DatabaseSync(path.join(root, 'ledger.sqlite'));
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  db.exec('CREATE TABLE resource_locations(resource_id TEXT,project_id TEXT,status TEXT); CREATE TABLE recovery_rounds(id TEXT,project_id TEXT,state_json TEXT)');
  const ids = Array.from({ length: 405 }, (_, index) => `resource-${index}`);
  const insert = db.prepare('INSERT INTO resource_locations VALUES(?,?,?)');
  for (const id of ids) insert.run(id, 'project-one', 'active');
  db.prepare('INSERT INTO recovery_rounds VALUES(?,?,?)').run('round-pending', 'project-other', JSON.stringify({ pending_restore: { id: 'restore' }, resource_ids: [ids.at(-1)] }));
  assert.throws(() => assertRecoveryWritable(db, { projectId: 'project-one', resourceIds: ids }), { code: 'ATLAS_RECOVERY_INCOMPLETE' });
  assert.doesNotThrow(() => assertRecoveryWritable(db, { resourceIds: ids.slice(0, -1) }));
  db.prepare('UPDATE recovery_rounds SET state_json=?').run(JSON.stringify({ pending_restore: null, resource_ids: ids }));
  assert.doesNotThrow(() => assertRecoveryWritable(db, { resourceIds: ids }));
});

test('Recovery guard scans shared Project journals once for a multi-Resource request', t => {
  const root = fs.mkdtempSync(path.resolve('test/.tmp/recovery-guard-'));
  const stateDir = path.join(root, 'state'), registry = new Registry({ stateDir });
  const control = createResourceControl({ stateDir, ledger: registry.ledger });
  t.after(() => { control.dispose(); registry.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
  const project = registry.create({ name: 'One', currentPath: 'One' });
  const resourceIds = ['one.txt', 'two.txt'].map(name => {
    const filePath = path.join(root, name); fs.writeFileSync(filePath, name);
    return control.identify({ filePath, project: { id: project.project_id } }).resource_id;
  });
  const directories = ['project-moves', 'project-memberships'].map(name => path.join(stateDir, name));
  for (const directory of directories) fs.mkdirSync(directory);
  let reads = 0; const readdir = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (directory, ...args) => { if (directories.includes(directory)) reads++; return readdir(directory, ...args); });
  assertRecoveryWritable(registry.ledger.db, { projectId: project.project_id, resourceIds: [...resourceIds, ...resourceIds] });
  assert.equal(reads, 2);
  fs.writeFileSync(path.join(directories[0], 'invalid.json'), '{}');
  assert.throws(() => assertRecoveryWritable(registry.ledger.db, { resourceIds }), { code: 'ATLAS_STATE_CONFLICT' }, 'A later call must inspect current journals again.');
});
