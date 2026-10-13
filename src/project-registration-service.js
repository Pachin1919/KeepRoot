import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Registry } from './registry.js';
import { isPathInside } from './paths.js';
import { withStateLock } from './state-lock.js';
import { ProjectRepository } from './storage/repositories/project-repository.js';
import { ProjectContextRepository } from './storage/repositories/project-context-repository.js';
import { captureProjectIdentity } from './project-identity.js';

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const conflict = message => Object.assign(new Error(message), { code: 'ATLAS_STATE_CONFLICT' });
const invalid = message => Object.assign(new Error(message), { code: 'INVALID_ARGUMENT' });
const equal = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const SCHEMA = 'atlas-project-registration.v1';
const MAX_RECORD = 512 * 1024;

// Ancestors are measured individually; internal links are never traversed.
function ancestors(directory, allowMissing = false) {
  let cursor = path.parse(directory).root;
  const result = [];
  for (const part of ['', ...directory.slice(cursor.length).split(path.sep).filter(Boolean)]) {
    if (part) cursor = path.join(cursor, part);
    let stat;
    try { stat = fs.lstatSync(cursor, { bigint: true }); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') break; throw conflict('Registration path is missing or unavailable.'); }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw conflict('Registration requires real directories without ancestor links or junctions.');
    result.push({ path: cursor, dev: String(stat.dev), ino: String(stat.ino), birthtime: String(stat.birthtimeNs) });
  }
  return result;
}

function controlIdentity(directory) {
  const controls = [];
  for (const name of ['AGENTS.md', 'README.md', 'README.txt', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']) {
    const file = path.join(directory, name);
    let stat; try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink() || !stat.isFile()) { controls.push({ path: name, kind: 'unsupported_link_or_nonfile' }); continue; }
    if (stat.size > 1024 * 1024) { controls.push({ path: name, kind: 'over_budget', size: stat.size, mtime: stat.mtimeMs }); continue; }
    controls.push({ path: name, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
  }
  // .git may itself be a junction. Do not open its config through a link.
  const git = path.join(directory, '.git');
  let linkedGit = false;
  if (fs.existsSync(git)) {
    const stat = fs.lstatSync(git);
    linkedGit = stat.isSymbolicLink();
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      const config = path.join(git, 'config');
      if (fs.existsSync(config)) {
        const configStat = fs.lstatSync(config);
        if (configStat.isFile() && !configStat.isSymbolicLink() && configStat.size <= 1024 * 1024) {
          controls.push({ path: '.git/config', sha256: crypto.createHash('sha256').update(fs.readFileSync(config)).digest('hex') });
        }
      }
    }
  }
  // Retain the existing relocation identity vocabulary, while independently
  // freezing bounded control facts for registration. A linked .git is excluded.
  const evidence = { schema: 'atlas-project-identity.v1', git_remote: null, manifest: null, control_hashes: controls.filter(item => ['AGENTS.md', 'README.md', 'README.txt'].includes(item.path) && item.sha256) };
  const captured = linkedGit ? { status: 'insufficient_evidence', evidence, stable_signals: [], signature_hash: hash(evidence) }
    : captureProjectIdentity(directory);
  return { ...captured, registration_controls: controls };
}

function caller(value) {
  if (!value || !['agent', 'user'].includes(value.actor) || typeof value.tool !== 'string' || !value.tool.trim()
      || typeof value.client_run_id !== 'string' || !value.client_run_id.trim()) throw invalid('Registration requires caller actor, tool and client_run_id.');
  return copy(value);
}
function requestKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw invalid('Registration requires a stable requestKey up to 256 characters.');
  return value;
}

export function createProjectRegistrationService({ stateDir, registry = null, fault = () => {} }) {
  stateDir = path.resolve(stateDir);
  const owned = !registry;
  registry ??= new Registry({ stateDir });
  if (!equal(registry.stateDir, stateDir)) throw invalid('Registration state and Registry must match.');
  const directory = path.join(stateDir, 'project-registration');
  const storage = () => {
    ancestors(stateDir, true);
    // Check existing paths before recursive creation, including the lock directory.
    ancestors(directory, true); ancestors(path.join(stateDir, 'locks'), true);
    fs.mkdirSync(directory, { recursive: true });
    ancestors(directory);
  };
  const locked = callback => { storage(); return withStateLock(stateDir, callback); };
  const recordPath = id => {
    if (!/^REG-[a-f0-9-]{36}$/u.test(id ?? '')) throw invalid('Invalid registration_id.');
    return path.join(directory, `${id}.json`);
  };
  const read = id => {
    const file = recordPath(id); ancestors(directory);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_RECORD) throw conflict('Registration record is linked or exceeds its bounded budget.');
    const row = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (row.schema !== SCHEMA || row.registration_id !== id || row.revision !== 1
        || !['prepared', 'already_registered', 'executing', 'registered'].includes(row.status)
        || row.digest !== hash(row.preview)) throw conflict('Registration record identity or digest is invalid.');
    return row;
  };
  const write = row => {
    ancestors(directory);
    const file = recordPath(row.registration_id);
    if (fs.existsSync(file)) { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw conflict('Registration record path is linked or invalid.'); }
    const bytes = JSON.stringify(row); if (Buffer.byteLength(bytes) > MAX_RECORD) throw conflict('Registration record exceeds its bounded budget.');
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx');
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.renameSync(temp, file); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  };
  const metadata = () => {
    const roots = registry.projectContext.listRoots({ adoptedOnly: false });
    const projects = registry.list();
    if (roots.length + projects.length > 1000) throw conflict('Registration metadata exceeds its bounded record budget.');
    return copy({ roots, projects, locations: projects.map(p => registry.projectContext.getActiveLocation(p.id)), identities: projects.map(p => registry.projectContext.getActiveIdentity(p.id)) });
  };
  const inspect = folder => {
    const chain = ancestors(folder);
    if (isPathInside(folder, stateDir) || isPathInside(stateDir, folder)) throw conflict('Project directory and Atlas state must not overlap.');
    return { ancestors: chain, identity: controlIdentity(folder) };
  };
  const view = row => copy({ schema: SCHEMA, registration_id: row.registration_id, status: row.status, revision: row.revision,
    digest: row.digest, path: row.preview.intent.path, project_scope: row.preview.intent.path, root: row.preview.root,
    project: row.preview.existing?.project ?? null, source_changes: [],
    boundary: 'Metadata registration only; internal links and arbitrary nested file content are not traversed or frozen.',
    next_action: row.status === 'prepared' ? `atlas project register execute ${row.registration_id} --request-file <authorized-request.json> --json`
      : row.status === 'executing' ? `atlas project register recover ${row.registration_id} --request-file <authorized-request.json> --json`
        : `atlas project resolve --path ${JSON.stringify(row.preview.intent.path)} --json` });
  const validate = (row, options) => {
    if (options.expectedRevision !== row.revision || options.expectedDigest !== row.digest) throw conflict('Registration revision or digest changed; use show before confirming.');
    const key = requestKey(options.requestKey); const who = caller(options.caller);
    const authority = options.authorization;
    if (!authority || typeof authority.path !== 'string' || !path.isAbsolute(authority.path) || !equal(authority.path, row.preview.intent.path)
        || typeof authority.reason !== 'string' || !authority.reason.trim()) throw invalid('Registration authorization must name the exact prepared Project path and a nonempty user task reason.');
    const digest = hash({ key, caller: who, expectedRevision: options.expectedRevision, expectedDigest: options.expectedDigest, authorization: authority });
    const prior = row.requests.find(r => r.key === key);
    if (prior && prior.digest !== digest) throw conflict('Registration request key already binds different caller or intent.');
    return { key, digest, caller: who, authorization: copy(authority) };
  };
  const rememberReplay = (row, request) => {
    if (!row.requests.some(item => item.key === request.key)) {
      row.requests.push(request);
      write(row);
    }
    return copy(row.receipt);
  };
  const revalidate = row => {
    if (hash(inspect(row.preview.intent.path)) !== hash(row.preview.directory)) throw conflict('Project directory identity or control metadata changed after prepare.');
  };
  const committed = row => {
    const plan = row.pending;
    const db = registry.ledger.db;
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(plan.project_id);
    if (!project) return false;
    const root = registry.projectContext.getRoot(plan.root_id).root;
    const location = registry.projectContext.getActiveLocation(plan.project_id);
    const identity = registry.projectContext.getActiveIdentity(plan.project_id);
    const expectedRoot = row.preview.root.strategy === 'reuse' ? row.preview.root.facts
      : { id: plan.root_id, current_path: row.preview.root.path, status: 'active', governance_status: 'adopted', root_type: 'project_workspace', content_policy: 'structure_only', adopted_at: plan.at, created_at: plan.at, updated_at: plan.at };
    if (hash(root) !== hash(expectedRoot) || project.name !== row.preview.intent.name || project.current_path !== plan.relative_path
        || project.status !== 'active' || project.created_at !== plan.at || project.updated_at !== plan.at
        || project.parent_project_id !== null || project.lineage_json !== '{"split_from":[]}'
        || location?.id !== plan.location_id || location.root_id !== plan.root_id || location.relative_path !== plan.relative_path
        || location.reason !== plan.reason || location.valid_from !== plan.at
        || identity?.identity_id !== plan.identity_id || identity.signature_hash !== row.preview.directory.identity.signature_hash) {
      throw conflict('Committed registration metadata conflicts with its frozen facts.');
    }
    return true;
  };
  const finish = row => {
    const resolved = registry.resolvePath(row.preview.intent.path);
    const receipt = { schema: SCHEMA, registration_id: row.registration_id, status: 'registered', revision: row.revision, digest: row.digest,
      path: row.preview.intent.path, root: resolved.root, project: resolved.project, location: resolved.location, resolved, source_changes: [] };
    row.status = 'registered'; row.receipt = copy(receipt); write(row); return copy(receipt);
  };
  const apply = row => {
    const plan = row.pending;
    registry.ledger.transaction(() => {
      const db = registry.ledger.db;
      const context = new ProjectContextRepository({ db, transaction: cb => cb() });
      const projects = new ProjectRepository({ db, transaction: cb => cb() });
      if (row.preview.root.strategy === 'adopt_exact') context.adoptRoot({ currentPath: row.preview.root.path, rootType: 'project_workspace', contentPolicy: 'structure_only', adoptedAt: plan.at, rootId: plan.root_id });
      projects.create({ projectId: plan.project_id, name: row.preview.intent.name, currentPath: plan.relative_path, aliases: [], status: 'active', splitFrom: [], createdAt: plan.at, registrationRootId: plan.root_id });
      fault('mid_commit');
      context.attachLocation({ projectId: plan.project_id, rootId: plan.root_id, relativePath: plan.relative_path, reason: plan.reason, attachedAt: plan.at, locationId: plan.location_id });
      context.recordIdentity({ projectId: plan.project_id, signature: row.preview.directory.identity, reason: plan.reason, recordedAt: plan.at, identityId: plan.identity_id });
    });
    fault('after_commit');
    if (!committed(row)) throw conflict('Registration commit was not found.');
    return finish(row);
  };
  return {
    prepare(options) { return locked(() => {
      if (typeof options.path !== 'string' || !path.isAbsolute(options.path)) throw invalid('Registration requires an absolute existing folder path.');
      if ((options.rootPolicy ?? 'project_only') !== 'project_only' || options.rootPath || options.authorizedRootPath) throw invalid('Only project_only exact-folder registration is supported.');
      const folder = path.resolve(options.path);
      const name = (options.name ?? path.basename(folder)).trim().normalize('NFC');
      if (!name || name.length > 256) throw invalid('Registration requires a display name up to 256 characters.');
      const intent = { path: folder, name, rootPolicy: 'project_only', requestKey: requestKey(options.requestKey), caller: caller(options.caller) };
      const files = fs.readdirSync(directory).filter(name => name.endsWith('.json'));
      if (files.length > 1000) throw conflict('Registration journal exceeds its record budget.');
      for (const file of files) {
        const previous = read(file.slice(0, -5));
        if (previous.preview.intent.requestKey === intent.requestKey) {
          if (hash(previous.preview.intent) !== hash(intent)) throw conflict('Registration request key already identifies different intent or caller.');
          return view(previous);
        }
      }
      const folderFacts = inspect(folder); const baseline = metadata();
      const existingLocation = registry.projectContext.listActiveLocations().find(l => equal(path.resolve(l.root_path, l.relative_path), folder));
      const existing = existingLocation ? registry.resolvePath(folder) : null;
      const containing = registry.listRoots().filter(root => isPathInside(root.current_path, folder)).sort((a, b) => b.current_path.length - a.current_path.length)[0];
      if (!containing && baseline.roots.some(root => isPathInside(folder, root.current_path) || equal(folder, root.current_path))) throw conflict('Selected Project overlaps existing Root metadata.');
      const root = containing ? { strategy: 'reuse', id: containing.id, path: containing.current_path, facts: containing }
        : { strategy: 'adopt_exact', id: null, path: folder };
      const preview = { intent, directory: folderFacts, metadata: baseline, root, existing };
      const row = { schema: SCHEMA, registration_id: `REG-${crypto.randomUUID()}`, revision: 1, digest: hash(preview), status: existing ? 'already_registered' : 'prepared', preview, requests: [], pending: null };
      write(row); return view(row);
    }); },
    show(id) { return locked(() => view(read(id))); },
    execute(id, options) { return locked(() => {
      const row = read(id); const request = validate(row, options);
      if (row.receipt) return rememberReplay(row, request);
      revalidate(row);
      if (row.status === 'already_registered') {
        if (hash(metadata()) !== hash(row.preview.metadata)) throw conflict('Registration metadata changed after prepare.');
        row.requests.push(request);
        return finish(row);
      }
      if (row.status !== 'prepared') throw conflict('Registration is pending; use recover.');
      if (hash(metadata()) !== hash(row.preview.metadata)) throw conflict('Registration metadata changed after prepare.');
      row.pending = { project_id: `PRJ-${crypto.randomUUID()}`, root_id: row.preview.root.id ?? `ROOT-${crypto.randomUUID()}`,
        location_id: `LOC-${crypto.randomUUID()}`, identity_id: `PID-${crypto.randomUUID()}`, at: new Date().toISOString(),
        relative_path: path.relative(row.preview.root.path, row.preview.intent.path).replaceAll('\\', '/'), reason: `Project registration ${id}: ${request.authorization.reason}` };
      row.requests.push(request); row.status = 'executing'; write(row);
      return apply(row);
    }); },
    recover(id, options) { return locked(() => {
      const row = read(id); const request = validate(row, options);
      if (row.receipt) return rememberReplay(row, request);
      if (row.status !== 'executing' || !row.pending) throw conflict('Registration has no pending operation to recover.');
      revalidate(row);
      if (!row.requests.some(r => r.key === request.key)) { row.requests.push(request); write(row); }
      if (committed(row)) return finish(row);
      if (hash(metadata()) !== hash(row.preview.metadata)) throw conflict('Registration metadata changed or conflicts with the pending operation.');
      return apply(row);
    }); },
    dispose() { if (owned) registry.dispose(); },
  };
}
