import path from 'node:path';
import { savedResultFreshness } from './saved-work-service.js';

function sourceChangeState(resource, source) {
  if (['missing', 'changed', 'moved'].includes(source?.status)) return source.status;
  if (['missing', 'changed'].includes(resource?.external_change?.status)) return resource.external_change.status;
  return resource?.external_change?.status ?? source?.status ?? 'not_checked';
}

function impactFor({ changeState, versionPolicy, work, results }) {
  const outputIssue = results.find((item) => ['changed', 'missing_source', 'undone'].includes(item.output_state));
  if (outputIssue) {
    const detail = outputIssue.output_state === 'missing_source' ? 'is missing' : outputIssue.output_state === 'changed' ? 'changed after Save' : 'was undone';
    return { status: 'needs_review', label: 'Needs review', reason: `Saved Result ${outputIssue.name} ${detail}.` };
  }
  const reviewedResult = results.find(item => item.freshness?.status === 'needs_review');
  if (reviewedResult) return { status: 'needs_review', label: 'Needs review',
    reason: `Saved Result ${reviewedResult.name} has followed Sources that need review.` };
  if (['changed', 'moved', 'missing'].includes(changeState)) {
    if (versionPolicy === 'pinned_version') {
      return { status: 'contained', label: 'Pinned impact', reason: `The Source is ${changeState}, but this Work is pinned to its recorded version.` };
    }
    return { status: 'needs_review', label: 'Needs review', reason: `The followed Source is ${changeState}; review this Work and its Results.` };
  }
  if (work.freshness?.status === 'needs_review') return { status: 'needs_review', label: 'Needs review', reason: work.freshness.reason ?? 'This Work needs review.' };
  if (!['unchanged', 'fresh'].includes(changeState) || work.freshness?.status !== 'fresh'
    || results.some(item => item.freshness?.status === 'not_checked')) {
    return { status: 'not_checked', label: 'Not checked', reason: 'This chain has no current verification for all followed Sources and Results.' };
  }
  return { status: 'fresh', label: 'Fresh', reason: 'The Source, Work, and recorded Results have no known impact requiring review.' };
}

export function buildResourceImpactLanes({ resource, workSessions = [], savedWork = [] }) {
  const resourceId = resource?.resource_id ?? resource?.resource?.id ?? null;
  if (!resourceId) return [];
  // Index only Works that consume the selected Resource. One Save pass replaces
  // a full Save-list scan per Work; empty pointers never count as matching IDs.
  const matches = [], byProject = new Map();
  const add = (index, key, match) => {
    if (typeof key !== 'string' || !key) return;
    const entries = index.get(key) ?? []; entries.push(match); index.set(key, entries);
  };
  for (const work of workSessions) {
    if (!work.project_id) continue;
    const source = work.sources?.find(item => item.resource_id === resourceId);
    if (!source) continue;
    const match = { work, source, saves: [] }; matches.push(match);
    let index = byProject.get(work.project_id);
    if (!index) { index = { sessions: new Map(), latest: new Map() }; byProject.set(work.project_id, index); }
    add(index.sessions, work.session_id, match); add(index.latest, work.latest_save_id, match);
  }
  if (!matches.length) return [];
  for (const item of savedWork) {
    const recipients = new Set();
    for (const projectId of new Set([item.project?.id, item.project_id])) {
      const index = byProject.get(projectId); if (!index) continue;
      for (const group of [index.sessions.get(item.parameters?.work_session_id),
        index.latest.get(item.work_id), index.latest.get(item.save_id)]) {
        for (const match of group ?? []) recipients.add(match);
      }
    }
    for (const match of recipients) match.saves.push(item);
  }
  // Verification lives only in this call. Save freshness owns its immutable
  // inputs; checking the same Save for two Work pointers must not rehash it.
  const checkedSaves = new Map();
  return matches.map(({ work, source, saves }) => {
      const changeState = sourceChangeState(resource, source);
      const versionPolicy = source?.version_policy ?? 'follow_latest';
      const results = saves.map((item) => {
        if (!checkedSaves.has(item)) checkedSaves.set(item, savedResultFreshness(item));
        const freshness = { ...checkedSaves.get(item) };
        const outputState = freshness.output_status;
        const saveId = item.save_id ?? item.work_id;
        return {
          save_id: saveId,
          resource_id: item.resource_id ?? null,
          name: path.basename(item.result_path ?? saveId),
          path: item.result_path ?? null,
          output_state: outputState,
          freshness,
          href: `/work/${encodeURIComponent(work.session_id)}/saved?work_id=${encodeURIComponent(item.work_id ?? saveId)}`,
        };
      });
      const impact = impactFor({ changeState, versionPolicy, work, results });
      return {
        source: {
          resource_id: resourceId,
          name: resource.name ?? resource.resource?.display_name ?? path.basename(resource.path ?? source?.file_path ?? resourceId),
          path: resource.file_path ?? resource.path ?? source?.file_path ?? null,
          change_state: changeState,
          version_policy: versionPolicy,
        },
        work: {
          session_id: work.session_id,
          revision: work.revision,
          recipe_version: work.recipe?.version ?? 1,
          freshness: work.freshness ?? null,
          href: `/work/${encodeURIComponent(work.session_id)}`,
        },
        results,
        impact,
        actions: {
          open_work: `/work/${encodeURIComponent(work.session_id)}`,
          open_result: results[0]?.href ?? null,
          resource_context: resource.desktop_href ?? null,
          relink_resource: changeState === 'missing' ? resource.desktop_href ?? null : null,
        },
      };
    });
}

export function buildResourceFocusGraph({ projectId, resource, relationshipFocus, workSessions = [], savedWork = [], impactLanes = null, maxNodes = 50, maxEdges = 100 }) {
  const resourceId = resource?.resource_id ?? resource?.resource?.id ?? null;
  if (!projectId || !resourceId || relationshipFocus?.project_id !== projectId || relationshipFocus?.root_resource_id !== resourceId) {
    return { project_id: projectId ?? null, root_resource_id: resourceId, nodes: [], edges: [], truncated: false, file_verification: 'not_checked' };
  }
  const nodes = new Map(); const edges = new Map();
  const relationshipNodes = relationshipFocus.nodes ?? [];
  const relationshipNodeLimit = Math.max(1, maxNodes - 10);
  let truncated = Boolean(relationshipFocus.truncated) || relationshipNodes.length > relationshipNodeLimit;
  const resourceHref = (id) => `/projects/${encodeURIComponent(projectId)}/resources?resource_id=${encodeURIComponent(id)}`;
  for (const item of relationshipNodes.slice(0, relationshipNodeLimit)) {
    if (!item?.resource_id) continue;
    nodes.set(`resource:${item.resource_id}`, { id: `resource:${item.resource_id}`, kind: 'resource', resource_id: item.resource_id,
      label: String(item.name ?? item.resource_id).slice(0, 256), relative_path: item.relative_path ?? null, hop: item.hop ?? 0, href: resourceHref(item.resource_id) });
  }
  for (const item of relationshipFocus.edges ?? []) {
    const sourceId = `resource:${item.source_resource_id}`; const targetId = `resource:${item.target_id}`;
    if (!nodes.has(sourceId) || !nodes.has(targetId)) continue;
    if (edges.size >= maxEdges) { truncated = true; break; }
    edges.set(item.id, { id: item.id, kind: 'linked_to', relationship_id: item.id, source: sourceId, target: targetId,
      direction: item.direction, hop: item.hop, status: item.status, evidence: item.evidence ?? {}, needs_review: item.needs_review === true, file_verification: 'not_checked' });
  }
  const lanes = Array.isArray(impactLanes) ? impactLanes : buildResourceImpactLanes({ resource,
    workSessions: workSessions.filter((work) => work.project_id === projectId),
    savedWork: savedWork.filter((item) => item.project?.id === projectId || item.project_id === projectId),
  });
  const orderedLanes = [...lanes].sort((left, right) => String(left.work?.session_id).localeCompare(String(right.work?.session_id)));
  for (const lane of orderedLanes) {
    const work = lane.work;
    if (!work?.session_id || (nodes.size >= maxNodes && !nodes.has(`work:${work.session_id}`))) { truncated = true; continue; }
    const workNodeId = `work:${work.session_id}`;
    nodes.set(workNodeId, { id: workNodeId, kind: 'work', session_id: work.session_id, label: work.session_id,
      revision: work.revision, freshness: lane.impact ?? work.freshness, href: work.href ?? `/work/${encodeURIComponent(work.session_id)}` });
    const sourceEdgeId = `derived:source:${resourceId}:${work.session_id}`;
    if (edges.size < maxEdges) edges.set(sourceEdgeId, { id: sourceEdgeId, kind: 'derived', derived_kind: 'source_to_work',
      source: `resource:${resourceId}`, target: workNodeId, resource_id: resourceId, work_session_id: work.session_id, impact: lane.impact });
    else truncated = true;
    for (const result of [...(lane.results ?? [])].sort((left, right) => String(left.save_id).localeCompare(String(right.save_id)))) {
      if (result?.output_state !== 'verified' || !result.save_id) continue;
      const resultNodeId = `result:${result.save_id}`;
      if (!nodes.has(resultNodeId) && nodes.size >= maxNodes) { truncated = true; break; }
      nodes.set(resultNodeId, { id: resultNodeId, kind: 'result', save_id: result.save_id, resource_id: result.resource_id ?? null,
        label: String(result.name ?? result.save_id).slice(0, 256), output_state: result.output_state, freshness: result.freshness,
        href: result.href ?? `/work/${encodeURIComponent(work.session_id)}/saved?work_id=${encodeURIComponent(result.save_id)}` });
      const resultEdgeId = `derived:result:${work.session_id}:${result.save_id}`;
      if (edges.size < maxEdges) edges.set(resultEdgeId, { id: resultEdgeId, kind: 'derived', derived_kind: 'work_to_result',
        source: workNodeId, target: resultNodeId, work_session_id: work.session_id, save_id: result.save_id, verified: true });
      else truncated = true;
    }
  }
  return { project_id: projectId, root_resource_id: resourceId, depth: relationshipFocus.depth, status: relationshipFocus.status,
    nodes: [...nodes.values()].slice(0, maxNodes), edges: [...edges.values()].slice(0, maxEdges), truncated, file_verification: 'not_checked' };
}
