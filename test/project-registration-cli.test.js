import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

test('CLI discovery resolve remediation and registration commands perform first registration without GUI', () => {
  const home = path.resolve('test/.tmp/v20-host-onboarding-20261013', crypto.randomUUID());
  const folder = path.join(home, '中文 [Host Project]'); fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ATLAS_STATE_DIR: path.join(home, 'state') }; delete env.ATLAS_HOME;
  const cli = (...args) => {
    const result = spawnSync(process.execPath, ['bin/atlas.js', ...args, '--json'], { env, encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const json = JSON.parse(result.stdout); assert.equal(json.ok, true); return json.data;
  };
  const capability = cli('capabilities');
  assert.ok(JSON.stringify(capability).includes('project register prepare'));
  const help = spawnSync(process.execPath, ['bin/atlas.js', '--help'], { env, encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.match(help.stdout, /project register prepare/);
  const resolve = cli('project', 'resolve', '--path', folder);
  assert.equal(resolve.status, 'setup_required'); assert.equal(resolve.remediation.supported, true);
  const caller = { actor: 'agent', tool: 'Codex', client_run_id: 'cli-test' };
  const request = path.join(home, 'request.json');
  fs.writeFileSync(request, JSON.stringify({ path: folder, rootPolicy: 'project_only', requestKey: 'p', caller }));
  const prepared = cli('project', 'register', 'prepare', '--request-file', request);
  assert.deepEqual(cli('project', 'register', 'show', prepared.registration_id), prepared);
  fs.writeFileSync(request, JSON.stringify({ expectedRevision: prepared.revision, expectedDigest: prepared.digest, requestKey: 'e', caller, authorization: { path: folder, reason: 'User authorized exact directory.' } }));
  const result = cli('project', 'register', 'execute', prepared.registration_id, '--request-file', request);
  assert.equal(result.status, 'registered');
  assert.equal(cli('project', 'resolve', '--path', folder).project.id, result.project.id);
});
