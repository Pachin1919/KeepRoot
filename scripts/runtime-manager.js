#!/usr/bin/env node
import os from 'node:os';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installRuntime,
  uninstallRuntime,
} from '../src/runtime-install.js';
import { handshakeRuntime } from '../src/runtime-location.js';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function defaultInstallRoot() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Atlas');
}

function defaultSkillRoot() {
  const skillsHome = process.env.CODEX_HOME
    ? path.join(process.env.CODEX_HOME, 'skills')
    : path.join(os.homedir(), '.codex', 'skills');
  return path.join(skillsHome, 'atlas-file-governance');
}

function parse(args) {
  const result = { libraryRoots: [] };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--no-start-menu-shortcut') { result.noStartMenuShortcut = true; }
    else if (['--install-root', '--skill-root', '--node', '--library-root', '--shortcut-root'].includes(token)) {
      const value = args[++index];
      if (value === undefined) throw new Error(`${token} requires a value.`);
      if (token === '--install-root') result.installRoot = value;
      else if (token === '--skill-root') result.skillRoot = value;
      else if (token === '--node') result.nodePath = value;
      else if (token === '--shortcut-root') result.shortcutRoot = value;
      else result.libraryRoots.push(value);
    } else {
      throw new Error(`Unknown Runtime manager argument: ${token}`);
    }
  }
  result.installRoot ??= defaultInstallRoot();
  result.skillRoot ??= defaultSkillRoot();
  result.nodePath ??= process.execPath;
  return result;
}

function usage() {
  return `Atlas Runtime manager

Usage:
  node scripts/runtime-manager.js install [options]
  node scripts/runtime-manager.js locate [options]
  node scripts/runtime-manager.js upgrade [options]
  node scripts/runtime-manager.js uninstall [options]

Options:
  --install-root <path>  User Runtime/state root (default: %LOCALAPPDATA%\\Atlas)
  --skill-root <path>    User Skill directory (default: ~/.codex/skills/atlas-file-governance)
  --node <path>          Node.js 24+ executable
  --library-root <path>  Reject installation inside this governed Library; repeatable
  --shortcut-root <path> Explicit existing Windows shortcut directory; isolated tests use test/.tmp
  --no-start-menu-shortcut Skip shortcut writes
`;
}

function updateShortcut(options, remove = false) {
  if (process.platform !== 'win32' || options.noStartMenuShortcut
      || !(path.resolve(options.installRoot).toLowerCase() === path.resolve(defaultInstallRoot()).toLowerCase() || options.shortcutRoot)) return null;
  const target = path.join(process.env.SystemRoot || 'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const args = ['-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',path.join(sourceRoot,'scripts','update-ui-shortcut.ps1'),'-InstallRoot',options.installRoot];
  if (options.shortcutRoot) args.push('-ShortcutRoot', options.shortcutRoot);
  if (remove) args.push('-Remove');
  const updated = spawnSync(target, args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (updated.error || updated.status !== 0) return { status: 'failed', message: updated.error?.message || updated.stderr.trim() };
  try { return JSON.parse(updated.stdout); } catch { return { status: 'failed', message: 'Shortcut update returned no readable receipt.' }; }
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || ['--help', '-h', 'help'].includes(command)) {
    console.log(usage());
    return;
  }
  const options = parse(rest);
  let result;
  if (command === 'install' || command === 'upgrade') {
    result = installRuntime({ ...options, sourceRoot, operation: command });
    // Default Windows installation, or an explicitly isolated shortcut directory.
    if (['installed','upgraded','already_installed'].includes(result.status)) {
      const shortcut = updateShortcut(options); if (shortcut) result.ui_shortcut = shortcut;
    }
  } else if (command === 'locate') {
    result = handshakeRuntime({ installRoot: options.installRoot });
  } else if (command === 'uninstall') {
    // Verify ownership while the manifest and wrapper still exist.
    const shortcut = fs.existsSync(path.join(options.installRoot, 'atlas-install.json')) ? updateShortcut(options, true) : null;
    result = uninstallRuntime(options);
    if (shortcut) result.ui_shortcut = shortcut;
  } else {
    throw new Error(`Unknown Runtime manager command: ${command}`);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!['ready', 'installed', 'upgraded', 'already_installed', 'uninstalled', 'not_installed', 'removed'].includes(result.status)) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', message: error.message }, null, 2));
  process.exitCode = 1;
}
