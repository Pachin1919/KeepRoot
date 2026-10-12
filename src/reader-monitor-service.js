import fs from 'node:fs';
import path from 'node:path';
import { projectDirectory, projectPath } from './ui/project-files.js';
import { readCurrentActivityState } from './ui/current-activity.js';
import { readRecentWorkState } from './ui/recent-work.js';

const LIMIT = 4;
function samePath(left, right) {
  const a = path.resolve(left); const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function notice() {
  const error = new Error('Resource is unavailable in this Project.');
  error.code = 'ATLAS_STATE_CONFLICT';
  return error;
}
function text(value, limit) {
  if (typeof value !== 'string') return null;
  // State errors and labels may contain local paths. Monitors expose metadata only.
  return value.replace(/(?:[a-z]:[\\/]|\\\\)[^\s<>"']+|\/(?:[^\s/<>"']+\/)+[^\s<>"']*/giu, '[local path]')
    .slice(0, limit);
}
function date(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}
function recentDate(item) {
  return [date(item.inspected_at), date(item.last_continued_at)].filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}
function section(state, selectedPath, projectId, resourceId, map) {
  if (state.error) return { items: [], truncated: false, error: state.error.message };
  const matching = state.items.filter(item => item.project?.id === projectId
    && samePath(item.file_path, selectedPath)
    && (!item.resource_id || item.resource_id === resourceId))
    .map(map).sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0));
  return { items: matching.slice(0, LIMIT), truncated: matching.length > LIMIT, error: null };
}

export function createReaderMonitorService({ registry, resourceControl, stateDir }) {
  return {
    read({ projectId, resourceId }) {
      let selectedPath;
      try {
        const detail = registry.show(projectId);
        if (!detail.project || detail.project.id !== projectId) throw notice();
        const root = projectDirectory(detail.location);
        const fact = resourceControl.projectResource(projectId, resourceId, { refresh: false });
        const location = fact.locations.find(item => item.project_id === projectId && item.status === 'active');
        if (!location || fact.resource_id !== resourceId || !fact.path || !samePath(fact.path, location.path)) throw notice();
        selectedPath = projectPath(root, path.relative(root, path.resolve(location.path)));
        const stat = fs.lstatSync(selectedPath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw notice();
      } catch {
        throw notice();
      }
      return {
        project_id: projectId, resource_id: resourceId, observed_at: new Date().toISOString(),
        current: section(readCurrentActivityState(stateDir), selectedPath, projectId, resourceId, item => ({
          id: item.activity_id, kind: 'activity', label: text(item.purpose, 160), status: item.status,
          actor: text(item.initiated_by?.agent ?? item.initiated_by?.actor, 80),
          updated_at: date(item.updated_at), summary: text(item.error_message, 240),
        })),
        recent: section(readRecentWorkState(stateDir), selectedPath, projectId, resourceId, item => ({
          id: item.work_id, kind: 'inspection', label: text(item.inspect.purpose, 160), status: item.last_action,
          actor: text(item.initiated_by?.agent ?? item.initiated_by?.actor, 80),
          updated_at: recentDate(item), summary: text(item.result_summary?.label, 240),
        })),
      };
    },
  };
}
