import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { Registry } from '../src/registry.js';
import { createProjectRegistrationService } from '../src/project-registration-service.js';
import { createProjectOnboardingService } from '../src/ui/services/project-onboarding-service.js';

const base = path.resolve('test/.tmp/v20-host-onboarding-20261013');
const caller = { actor: 'agent', tool: 'Codex', client_run_id: 'registration-test' };
function setup(t, options = {}) {
  const home = path.join(base, crypto.randomUUID());
  const folder = path.join(home, '中文 空格 [Project]');
  const stateDir = path.join(home, 'state');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'README.md'), 'original bytes');
  const registry = new Registry({ stateDir });
  const service = createProjectRegistrationService({ stateDir, registry, ...options });
  t.after(() => registry.dispose());
  return { home, folder, stateDir, registry, service };
}
const prepare = (service, folder, requestKey = 'prepare') => service.prepare({ path: folder, rootPolicy: 'project_only', requestKey, caller });
const executeRequest = (row, requestKey = 'execute') => ({ expectedRevision: row.revision, expectedDigest: row.digest, requestKey, caller, authorization: { path: row.path, reason: 'User requested this exact Project registration.' } });

test('first registration prepares without metadata/source changes and atomically registers exact Project Root with replay', t => {
  const { folder, registry, service } = setup(t);
  const row = prepare(service, folder);
  assert.equal(row.status, 'prepared');
  assert.equal(row.root.path, folder);
  assert.equal(registry.listRoots().length, 0);
  assert.equal(registry.list().length, 0);
  assert.deepEqual(row.source_changes, []);
  assert.deepEqual(prepare(service, folder), row);
  assert.throws(() => service.prepare({ path: folder, name: 'other', requestKey: 'prepare', caller }), /key|intent/i);
  for (const patch of [{ expectedDigest: 'bad' }, { expectedRevision: 7 }, { authorization: null }, { authorization: { path: path.dirname(folder), reason: 'broad' } }]) {
    assert.throws(() => service.execute(row.registration_id, { ...executeRequest(row), ...patch }));
  }
  const result = service.execute(row.registration_id, executeRequest(row));
  assert.equal(result.status, 'registered');
  assert.equal(result.resolved.status, 'resolved');
  assert.equal(result.location.relative_path, '');
  assert.deepEqual(service.execute(row.registration_id, executeRequest(row)), result);
  assert.throws(() => service.execute(row.registration_id, { ...executeRequest(row), caller: { ...caller, tool: 'other' } }), /key|caller/i);
  assert.deepEqual(service.execute(row.registration_id, executeRequest(row, 'later-execute')), result);
  assert.throws(() => service.execute(row.registration_id, { ...executeRequest(row, 'later-execute'), caller: { ...caller, tool: 'other' } }), /key|caller/i);
  assert.deepEqual(service.recover(row.registration_id, executeRequest(row, 'later-recover')), result);
  assert.throws(() => service.recover(row.registration_id, { ...executeRequest(row, 'later-recover'), caller: { ...caller, tool: 'other' } }), /key|caller/i);
  const existing = service.prepare({ path: folder, name: 'Never rename', requestKey: 'new', caller });
  assert.equal(existing.status, 'already_registered');
  assert.equal(existing.project.id, result.project.id);
  assert.equal(existing.project.name, path.basename(folder));
  assert.equal(registry.list().length, 1);
  assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), 'original bytes');
});

test('already registered execute retains registration envelope and binds every accepted retry key', t => {
  const { folder, registry, service } = setup(t);
  const first = prepare(service, folder, 'first-existing');
  const original = service.execute(first.registration_id, executeRequest(first, 'first-execute'));
  const existing = service.prepare({ path: folder, name: 'Not a rename', requestKey: 'existing-preview', caller });
  const confirmed = service.execute(existing.registration_id, executeRequest(existing, 'existing-execute'));
  assert.throws(() => service.execute(existing.registration_id, {
    ...executeRequest(existing, 'existing-execute'), caller: { ...caller, tool: 'different-host' },
  }), /key|caller/i);
  assert.equal(confirmed.schema, 'atlas-project-registration.v1');
  assert.equal(confirmed.status, 'registered');
  assert.equal(confirmed.project.id, original.project.id);
  assert.equal(confirmed.project.name, original.project.name);
  assert.deepEqual(service.execute(existing.registration_id, executeRequest(existing, 'next-key')), confirmed);
  assert.throws(() => service.execute(existing.registration_id, {
    ...executeRequest(existing, 'next-key'), caller: { ...caller, tool: 'different-host' },
  }), /key|caller/i);
  assert.equal(registry.list().length, 1);
});

test('containing Root reuse and two same-basename directories keep separate identities', t => {
  const { home, folder, registry, service } = setup(t);
  const root = registry.adoptRoot({ rootPath: folder, rootType: 'workspace_container' });
  const first = path.join(folder, 'Same'); const second = path.join(home, 'Other', 'Same');
  fs.mkdirSync(first); fs.mkdirSync(second, { recursive: true });
  const a = prepare(service, first, 'a'); const b = prepare(service, second, 'b');
  assert.equal(a.root.id, root.root_id);
  const aa = service.execute(a.registration_id, executeRequest(a, 'a-execute'));
  // Root adoption by the other operation changes registration facts: prepare again.
  assert.throws(() => service.execute(b.registration_id, executeRequest(b, 'b-execute')), /changed|stale/i);
  const bb = prepare(service, second, 'b-new');
  const result = service.execute(bb.registration_id, executeRequest(bb, 'b-new-execute'));
  assert.notEqual(aa.project.id, result.project.id);
  assert.equal(registry.list().length, 2);
});

test('stale control metadata, replaced directories, state overlap and ancestor junctions refuse; internal junction stays untouched', t => {
  const { home, folder, stateDir, registry, service } = setup(t);
  assert.throws(() => prepare(service, home), /overlap/i);
  fs.mkdirSync(stateDir, { recursive: true });
  assert.throws(() => prepare(service, stateDir), /overlap/i);
  const row = prepare(service, folder);
  fs.writeFileSync(path.join(folder, 'README.md'), 'changed');
  assert.throws(() => service.execute(row.registration_id, executeRequest(row)), /changed|stale/i);
  const replaced = prepare(service, folder, 'replace');
  fs.renameSync(folder, `${folder}-old`);
  assert.throws(() => service.execute(replaced.registration_id, executeRequest(replaced)), /missing|unavailable/i);
  fs.mkdirSync(folder);
  assert.throws(() => service.execute(replaced.registration_id, executeRequest(replaced)), /changed|stale/i);
  const target = path.join(home, 'outside'); fs.mkdirSync(target);
  const junction = path.join(home, 'linked'); fs.symlinkSync(target, junction, 'junction');
  const child = path.join(target, 'Child'); fs.mkdirSync(child);
  assert.throws(() => prepare(service, path.join(junction, 'Child'), 'ancestor-link'), /link|junction/i);
  fs.symlinkSync(target, path.join(folder, 'internal-link'), 'junction');
  const safe = prepare(service, folder, 'internal');
  service.execute(safe.registration_id, executeRequest(safe, 'internal-execute'));
  assert.equal(fs.lstatSync(path.join(folder, 'internal-link')).isSymbolicLink(), true);
  assert.equal(registry.list().length, 1);
});

test('mid-commit failure rolls back all rows; reopened service recovers committed pending receipt without duplicates', t => {
  let crash = 'mid_commit';
  const { folder, stateDir, registry, service } = setup(t, { fault: stage => { if (stage === crash) throw Error(`injected ${stage}`); } });
  const row = prepare(service, folder);
  assert.throws(() => service.execute(row.registration_id, executeRequest(row)), /injected/);
  assert.equal(registry.listRoots().length, 0); assert.equal(registry.list().length, 0);
  crash = 'after_commit';
  assert.throws(() => service.recover(row.registration_id, executeRequest(row, 'recover-one')), /injected/);
  assert.equal(registry.list().length, 1);
  registry.dispose();
  const reopened = new Registry({ stateDir }); t.after(() => reopened.dispose());
  const recovery = createProjectRegistrationService({ stateDir, registry: reopened });
  const result = recovery.recover(row.registration_id, executeRequest(row, 'recover-two'));
  assert.equal(result.status, 'registered');
  assert.equal(reopened.list().length, 1); assert.equal(reopened.listRoots().length, 1);
  assert.equal(recovery.execute(row.registration_id, executeRequest(row)).project.id, result.project.id);
});

test('pending recovery refuses conflicting registration metadata and UI calls the same exact-scope service', t => {
  const { folder, registry, service } = setup(t, { fault: stage => { if (stage === 'after_commit') throw Error('injected'); } });
  const row = prepare(service, folder);
  assert.throws(() => service.execute(row.registration_id, executeRequest(row)), /injected/);
  const id = registry.list()[0].id;
  registry.evolve(id, { name: 'conflict' });
  assert.throws(() => service.recover(row.registration_id, executeRequest(row, 'recovery')), /changed|conflict/i);
  const other = setup(t);
  const ui = createProjectOnboardingService({ registry: other.registry });
  const result = ui.registerFolder(other.folder, 'UI Project');
  assert.equal(result.project.name, 'UI Project');
  assert.equal(other.registry.listRoots()[0].current_path, other.folder);
});

test('process exit after committed registration recovers the exact identity and original execute receipt', t => {
  const { folder, stateDir, registry, service } = setup(t);
  const code = `
    import { createProjectRegistrationService } from './src/project-registration-service.js';
    const { folder, stateDir, caller } = JSON.parse(process.argv[1]);
    const service = createProjectRegistrationService({ stateDir, fault: stage => { if (stage === 'after_commit') process.exit(17); } });
    const row = service.prepare({ path: folder, requestKey: 'process-prepare', caller });
    process.stdout.write(JSON.stringify(row) + '\\n');
    service.execute(row.registration_id, { expectedRevision: row.revision, expectedDigest: row.digest, requestKey: 'process-execute', caller, authorization: { path: folder, reason: 'User requested this exact Project registration.' } });
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, JSON.stringify({ folder, stateDir, caller })], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(child.status, 17, child.stderr);
  const row = JSON.parse(child.stdout.trim());
  assert.equal(service.show(row.registration_id).status, 'executing');
  assert.equal(registry.list().length, 1);
  const projectId = registry.list()[0].id;
  const result = service.recover(row.registration_id, executeRequest(row, 'process-recover'));
  assert.equal(result.project.id, projectId);
  assert.deepEqual(service.execute(row.registration_id, executeRequest(row, 'process-execute')), result);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.listRoots().length, 1);
  assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), 'original bytes');
});
