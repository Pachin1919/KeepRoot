import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { installRuntime } from '../src/runtime-install.js';

const repo = path.resolve('.');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

test('installed Host discovers first registration without a picker and continues through Save using the resolved identity', {
  skip: process.platform !== 'win32', timeout: 120_000,
}, () => {
  const base = path.join(repo, 'test/.tmp/v20-host-onboarding-20261013');
  fs.mkdirSync(base, { recursive: true });
  const caseRoot = fs.mkdtempSync(path.join(base, 'host-'));
  const project = path.join(caseRoot, '中文 项目（演示）');
  const sibling = path.join(caseRoot, '相邻项目');
  fs.mkdirSync(path.join(project, '02_成果'), { recursive: true });
  fs.mkdirSync(sibling);
  const source = path.join(project, 'README.md');
  const sourceBytes = Buffer.from('# 明确标注的隔离素材\nHost 注册演示，不是用户资料。\n');
  fs.writeFileSync(source, sourceBytes);
  fs.writeFileSync(path.join(sibling, 'untouched.txt'), 'not authorized');
  const installRoot = path.join(caseRoot, 'install');
  const skillRoot = path.join(caseRoot, 'skill/atlas-file-governance');
  installRuntime({ sourceRoot: repo, installRoot, skillRoot, nodePath: process.execPath });
  const manifest = JSON.parse(fs.readFileSync(path.join(installRoot, 'atlas-install.json'), 'utf8'));
  const caller = { actor: 'agent', tool: 'isolated-host-acceptance', client_run_id: path.basename(caseRoot) };
  // Use the installed public launcher, never a Registry API or the installed Node entry.
  const invokeFile = path.join(caseRoot, 'invoke-launcher.ps1');
  fs.writeFileSync(invokeFile, 'param([string]$Launcher,[string]$ArgumentFile)\n$ErrorActionPreference="Stop"\n$atlasArgs=@(Get-Content -LiteralPath $ArgumentFile -Raw | ConvertFrom-Json)\n& $Launcher @atlasArgs\nexit $LASTEXITCODE\n');
  const pwsh = path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'PowerShell/7/pwsh.exe');
  assert.ok(fs.existsSync(pwsh));
  let sequence = 0;
  const receipts = [];
  function call(args, expectedExit = 0) {
    const argFile = path.join(caseRoot, `arguments-${++sequence}.json`);
    fs.writeFileSync(argFile, JSON.stringify([...args, '--json']));
    const env = { ...process.env };
    delete env.ATLAS_HOME;
    delete env.ATLAS_STATE_DIR;
    const result = spawnSync(pwsh, ['-NoProfile', '-File', invokeFile,
      '-Launcher', path.join(installRoot, 'atlas.cmd'), '-ArgumentFile', argFile], {
      cwd: caseRoot, env, encoding: 'utf8', windowsHide: true, timeout: 15_000,
    });
    fs.writeFileSync(path.join(caseRoot, `receipt-${sequence}.json`), result.stdout ?? '');
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, expectedExit, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, expectedExit === 0, result.stdout);
    assert.equal(envelope.protocol_version, 'atlas-cli.v1');
    receipts.push({ command: envelope.command, data: envelope.data });
    return expectedExit === 0 ? envelope.data : envelope.error;
  }
  function request(name, value) {
    const file = path.join(caseRoot, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  }
  const unresolved = call(['project', 'resolve', '--path', project]);
  assert.equal(unresolved.status, 'setup_required');
  assert.match(JSON.stringify(unresolved), /project register prepare/u);
  assert.equal(unresolved.project, null);
  const capabilities = call(['capabilities']);
  const guide = capabilities.product_entrypoints.current_product.command_guide;
  const registration = guide.find(item => item.commands.includes('project register prepare'));
  assert.ok(registration, 'A new Host must discover registration in the installed current-product guide.');
  assert.match(JSON.stringify(registration), /rootPolicy/u);
  assert.match(JSON.stringify(registration), /authorization/u);
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.match(skill, /current-project\.md/u);
  assert.match(skill, /supported remediation/u);
  const reference = fs.readFileSync(path.join(skillRoot, 'references/current-project.md'), 'utf8');
  assert.match(reference, /project register execute/u);
  const prepareFile = request('prepare', { path: project, rootPolicy: 'project_only',
    requestKey: 'register-project', name: '隔离演示项目', caller });
  const prepared = call(['project', 'register', 'prepare', '--request-file', prepareFile]);
  assert.equal(prepared.status, 'prepared');
  assert.equal(call(['project', 'resolve', '--path', project]).status, 'setup_required', 'Prepare must not register a Project.');
  assert.deepEqual(fs.readFileSync(source), sourceBytes);

  const executeFile = request('execute', { expectedRevision: prepared.revision,
    expectedDigest: prepared.digest, requestKey: 'execute-registration', caller,
    authorization: { path: project, reason: 'Test participant authorized registering this isolated folder.' } });
  const executed = call(['project', 'register', 'execute', prepared.registration_id, '--request-file', executeFile]);
  const resolved = call(['project', 'resolve', '--path', project]);
  assert.equal(resolved.status, 'resolved');
  assert.equal(path.resolve(resolved.root.current_path), project, 'Absent Root defaults exactly to the Project, never its parent.');
  assert.equal(path.resolve(resolved.location.root_path, resolved.location.relative_path), project);
  const inspected = call(['content', 'inspect', '--file', source, '--purpose', 'content']);
  assert.match(JSON.stringify(inspected), /Host 注册演示/u);
  assert.equal(call(['project', 'resolve', '--path', sibling]).status, 'setup_required', 'Registration does not bind sibling folders.');
  const replay = call(['project', 'register', 'execute', prepared.registration_id, '--request-file', executeFile]);
  assert.deepEqual(replay, executed, 'Same request replays the receipt without duplicate identities.');
  const second = call(['project', 'register', 'prepare', '--request-file', request('prepare-second', {
    path: project, rootPolicy: 'project_only', requestKey: 'second-registration', name: 'Not a rename', caller,
  })]);
  assert.match(JSON.stringify(second), new RegExp(resolved.project.id));
  assert.equal(call(['project', 'resolve', '--path', project]).project.name, '隔离演示项目');
  assert.deepEqual(fs.readFileSync(source), sourceBytes);

  const candidate = path.join(caseRoot, 'candidate.md');
  const resultBytes = Buffer.from('# Host 的下一步\n注册完成后由统一 Save 保存。\n');
  fs.writeFileSync(candidate, resultBytes);
  const targetRelative = '02_成果/Host成果.md';
  fs.mkdirSync(path.join(sibling, '02_成果'));
  const outside = call(['save', 'prepare', '--root', sibling,
    '--candidate-file', candidate, '--project', resolved.project.id, '--target', targetRelative,
    '--channel', 'host', '--request-key', 'wrong-root', '--tool', caller.tool,
    '--client-run-id', caller.client_run_id], 1);
  assert.match(outside.message, /outside Project/u);
  assert.equal(fs.existsSync(path.join(sibling, targetRelative)), false);
  const save = call(['save', 'prepare', '--root', resolved.root.current_path,
    '--candidate-file', candidate, '--project', resolved.project.id, '--target', targetRelative,
    '--channel', 'host', '--request-key', 'first-result', '--tool', caller.tool,
    '--client-run-id', caller.client_run_id]);
  assert.equal(save.status, 'prepared');
  assert.equal(fs.existsSync(path.join(project, targetRelative)), false);
  const saved = call(['save', 'execute', save.save_id, '--reason', 'Test participant approved the new isolated result.']);
  assert.equal(saved.verified, true);
  assert.match(saved.resource_id, /^RES-/u);
  assert.deepEqual(fs.readFileSync(path.join(project, targetRelative)), resultBytes);
  assert.equal(call(['project', 'resolve', '--path', path.dirname(path.join(project, targetRelative))]).project.id, resolved.project.id);
  assert.deepEqual(fs.readFileSync(source), sourceBytes);
  assert.equal(fs.readFileSync(path.join(sibling, 'untouched.txt'), 'utf8'), 'not authorized');
  const reopened = call(['project', 'resolve', '--path', project]);
  assert.equal(reopened.project.id, resolved.project.id);
  assert.equal(call(['save', 'show', save.save_id]).resource_id, saved.resource_id);
  fs.writeFileSync(path.join(caseRoot, 'acceptance.json'), JSON.stringify({
    scope: 'isolated installed launcher, not a second AI product or real user registration',
    source_hash_before: hash(sourceBytes), source_hash_after: hash(fs.readFileSync(source)),
    project_id: resolved.project.id, root: resolved.root.current_path, saved_resource_id: saved.resource_id,
    install_root: installRoot, state_root: manifest.state_path, calls: receipts.map(item => item.command),
  }, null, 2));
});
