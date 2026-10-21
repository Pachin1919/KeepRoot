import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildResourceFocusGraph, buildResourceImpactLanes } from '../src/ui/services/resource-impact-service.js';

const resource = { resource_id: 'RES-selected', external_change: { status: 'not_checked' } };
const work = (session, extra = {}) => ({ project_id: 'PRJ-a', session_id: session, revision: 1,
  freshness: { status: 'fresh' }, sources: [{ resource_id: resource.resource_id, status: 'ready' }], ...extra });
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t) {
  fs.mkdirSync('test/.tmp', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('test/.tmp/resource-impact-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 }));
  const output = path.join(root, 'result.csv'); fs.writeFileSync(output, 'region,amount\nNorth,120\n');
  return { root, output, saved: { project_id: 'PRJ-a', save_id: 'SAV-one', work_id: 'SAV-one',
    result_path: output, result_fingerprint: { sha256: hash(output) }, status: 'executed', version_policy: 'pinned_version' } };
}

test('unchecked source chains stay unchecked despite a recorded fresh Work', () => {
  const lanes = buildResourceImpactLanes({ resource, workSessions: [work('WORK-a')] });
  assert.equal(lanes[0].impact.status, 'not_checked');
  const graph = buildResourceFocusGraph({ projectId: 'PRJ-a', resource, impactLanes: lanes,
    relationshipFocus: { project_id: 'PRJ-a', root_resource_id: resource.resource_id,
      nodes: [{ resource_id: resource.resource_id }], edges: [] } });
  assert.equal(graph.edges[0].impact.label, 'Not checked');
  assert.equal(graph.nodes.find(node => node.kind === 'work').freshness.status, 'not_checked');
  assert.equal(buildResourceImpactLanes({ resource: { ...resource, external_change: { status: 'unchanged' } },
    workSessions: [work('WORK-unchecked', { freshness: { status: 'not_checked' } })] })[0].impact.status, 'not_checked');
});

test('Save joins retain alias matching, input order and Project isolation without duplicate results', () => {
  const a = work('WORK-a', { latest_save_id: 'SAV-current' });
  const b = work('WORK-a', { project_id: 'PRJ-b' });
  const saves = [
    { project_id: 'PRJ-b', save_id: 'SAV-foreign', parameters: { work_session_id: 'WORK-a' }, status: 'undone' },
    { project: { id: 'PRJ-a' }, save_id: 'SAV-history', parameters: { work_session_id: 'WORK-a' }, status: 'undone' },
    { project_id: 'PRJ-a', work_id: 'SAV-current', save_id: 'SAV-current', parameters: { work_session_id: 'WORK-a' }, status: 'undone' },
    { project_id: 'PRJ-a', save_id: 'SAV-unrelated', status: 'undone' },
  ];
  const lanes = buildResourceImpactLanes({ resource, workSessions: [a, b], savedWork: saves });
  assert.deepEqual(lanes[0].results.map(item => item.save_id), ['SAV-history', 'SAV-current']);
  assert.deepEqual(lanes[1].results.map(item => item.save_id), ['SAV-foreign']);
});

test('many matching Works use a bounded pass over unrelated Save records', () => {
  let projectReads = 0;
  const saves = Array.from({ length: 500 }, (_, index) => ({
    get project() { projectReads++; return { id: 'PRJ-a' }; }, save_id: `SAV-unrelated-${index}`,
  }));
  const works = Array.from({ length: 100 }, (_, index) => work(`WORK-${index}`));
  const lanes = buildResourceImpactLanes({ resource, workSessions: works, savedWork: saves });
  assert.equal(lanes.length, works.length);
  assert.ok(lanes.every(lane => lane.results.length === 0));
  assert.ok(projectReads <= saves.length * 4, `Save metadata reread ${projectReads} times`);
});

test('a shared Save output is checked once per request and external edits are seen on the next request', t => {
  const f = fixture(t), original = fs.openSync; let outputReads = 0;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    if (file === f.output) outputReads++;
    return original(file, ...args);
  });
  const works = [work('WORK-a', { latest_save_id: f.saved.save_id }), work('WORK-b', { latest_save_id: f.saved.save_id })];
  const input = { resource, workSessions: works, savedWork: [f.saved] };
  let lanes = buildResourceImpactLanes(input);
  assert.ok(lanes.every(lane => lane.results[0].output_state === 'verified'));
  assert.equal(outputReads, 1, 'Repeated Work pointers must not rehash the same output.');
  fs.writeFileSync(f.output, 'changed externally');
  lanes = buildResourceImpactLanes(input);
  assert.ok(lanes.every(lane => lane.results[0].output_state === 'changed' && lane.impact.status === 'needs_review'));
  assert.equal(outputReads, 2, 'Verification must not be cached across requests.');
});

test('known changes retain follow/pin policy and Work review takes priority over unchecked state', () => {
  const changed = { ...resource, external_change: { status: 'changed' } };
  const following = work('WORK-follow');
  const pinned = work('WORK-pinned', { sources: [{ resource_id: resource.resource_id, version_policy: 'pinned_version' }] });
  const lanes = buildResourceImpactLanes({ resource: changed, workSessions: [following, pinned] });
  assert.deepEqual(lanes.map(lane => lane.impact.status), ['needs_review', 'contained']);
  assert.equal(buildResourceImpactLanes({ resource,
    workSessions: [work('WORK-review', { freshness: { status: 'needs_review', reason: 'Review required' } })] })[0].impact.status, 'needs_review');
});

test('checked immutable Save inputs warn when they changed even if Work and current metadata are unchecked', t => {
  const f = fixture(t), source = path.join(f.root, 'source.csv');
  fs.writeFileSync(source, 'old source'); const recorded = hash(source); fs.writeFileSync(source, 'new source');
  const saved = { ...f.saved, version_policy: 'follow_latest', sources: [{ path: source, fingerprint: { sha256: recorded } }] };
  const lanes = buildResourceImpactLanes({ resource, workSessions: [work('WORK-a', { latest_save_id: saved.save_id })], savedWork: [saved] });
  assert.equal(lanes[0].results[0].freshness.status, 'needs_review');
  assert.equal(lanes[0].impact.status, 'needs_review');
});
