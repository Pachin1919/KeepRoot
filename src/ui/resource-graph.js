// Deterministic, offline Resource canvas. Positions and filters are presentation only.
// Pointer coordinates and cursor-anchored zoom adapted from Rowboat graph-view.tsx,
// commit 2fdae42589992c19958f53ad64d52d1846c4b288 (Apache-2.0).
// Atlas uses fixed positions, local object identities and no continuous simulation.
// See resource-graph.LICENSE for the upstream license.
export const clampZoom = value => Math.max(.4, Math.min(2.5, value));
export function zoomAt(view, factor, point) {
  const scale = clampZoom(view.scale * factor);
  return { scale, x: point.x - (point.x - view.x) * scale / view.scale, y: point.y - (point.y - view.y) * scale / view.scale };
}
export function graphLayout(nodes) {
  const groups = [[], [], []];
  for (const node of nodes) groups[node.kind === 'resource' ? 0 : node.kind === 'work' ? 1 : 2].push(node);
  return Object.fromEntries(groups.flatMap((group, column) => group.map((node, row) => [node.id, { x: 36 + column * 320, y: 58 + row * 100 }])));
}
export function safeGraphHref(node, projectId, returnHref) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  if (typeof node.href !== 'string' || !node.href.startsWith('/') || node.href.startsWith('//') || /[\s\\]/u.test(node.href)) return null;
  try {
    const url = new URL(node.href, 'http://atlas.local');
    if (url.origin !== 'http://atlas.local' || url.hash) return null;
    if (node.kind === 'resource' && node.resource_id && url.pathname === base + '/resources' && url.searchParams.get('resource_id') === node.resource_id) {
      const back = new URL(returnHref, 'http://atlas.local');
      const scopedReturn = back.pathname === base+'/resources' ? back.pathname+back.search : base+'/resources?'+new URLSearchParams({resource_id:back.searchParams.get('resource_id') || node.resource_id,graph:'1'});
      return base + '/resources/read?' + new URLSearchParams({ resource_id: node.resource_id, return_to: scopedReturn });
    }
    if (node.kind === 'work' && node.session_id && url.pathname === `/work/${encodeURIComponent(node.session_id)}` && !url.search) return url.pathname;
    if (node.kind === 'result' && node.save_id && /^\/work\/[^/]+\/saved$/u.test(url.pathname) && url.searchParams.get('work_id') === node.save_id && [...url.searchParams.keys()].every(key => key === 'work_id')) return url.pathname + url.search;
  } catch {}
  return null;
}
export function mountResourceGraph(host) {
  if (host.dataset.graphReady) return;
  host.dataset.graphReady = 'true';
  const data = JSON.parse(host.dataset.graphData);
  const stage = host.querySelector('[data-graph-stage]');
  const world = host.querySelector('[data-graph-world]');
  const nodes = [...host.querySelectorAll('[data-focus-graph-node]')];
  const edges = [...host.querySelectorAll('[data-focus-graph-edge]')];
  const key = 'atlas-graph:' + data.project_id + ':' + data.root_resource_id;
  let positions = graphLayout(data.nodes), view = { x: 0, y: 0, scale: 1 }, selected = `resource:${data.root_resource_id}`, filter = 'all', pointer = null;
  let restored = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved && Number.isFinite(saved.view?.x) && Number.isFinite(saved.view?.y) && Number.isFinite(saved.view?.scale)) {
      view = { ...saved.view, scale: clampZoom(saved.view.scale) }; selected = saved.selected; filter = ['all','resource','work','result'].includes(saved.filter) ? saved.filter : 'all';
      for (const node of data.nodes) if (Number.isFinite(saved.positions?.[node.id]?.x) && Number.isFinite(saved.positions?.[node.id]?.y)) positions[node.id] = saved.positions[node.id];
      restored = true;
    }
  } catch {}
  const persist = () => { try { sessionStorage.setItem(key, JSON.stringify({ view, positions, selected, filter })); } catch {} };
  const visible = id => id === `resource:${data.root_resource_id}` || filter === 'all' || data.nodes.find(node => node.id === id)?.kind === filter;
  const draw = () => {
    world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
    for (const el of nodes) {
      const id = el.dataset.focusGraphNode, p = positions[id];
      el.setAttribute('transform', `translate(${p.x} ${p.y})`); el.style.display = visible(id) ? '' : 'none';
      el.classList.toggle('is-selected', id === selected); el.setAttribute('aria-pressed', String(id === selected));
    }
    for (const el of edges) {
      const edge = data.edges.find(item => item.id === el.dataset.focusGraphEdge), a = positions[edge.source], b = positions[edge.target];
      el.style.display = visible(edge.source) && visible(edge.target) ? '' : 'none';
      const sx = a.x + 240, sy = a.y + 36, tx = b.x, ty = b.y + 36;
      const bend = Math.max(60, Math.abs(tx - sx) / 2);
      el.setAttribute('d', `M${sx},${sy} C${sx+bend},${sy} ${tx-bend},${ty} ${tx},${ty}`);
    }
    host.querySelector('[data-graph-zoom]').textContent = Math.round(view.scale * 100) + '%';
    persist();
  };
  const select = id => {
    const node = data.nodes.find(node => node.id === id);
    if (!node) return;
    selected = id;
    host.querySelector('[data-graph-name]').textContent = node.label;
    const state = typeof node.freshness === 'string' ? node.freshness : node.freshness?.label ?? node.freshness?.status;
    host.querySelector('[data-graph-identity]').textContent = [data.kind_labels?.[node.kind] ?? node.kind, node.id, node.relative_path, data.state_labels?.[state] ?? state].filter(Boolean).join(' · ');
    const records = data.edges.filter(edge => edge.source === id || edge.target === id);
    host.querySelector('[data-graph-evidence]').textContent = records.map(edge => edge.kind === 'linked_to'
      ? `${edge.source} → ${edge.target} · ${edge.status ?? ''} · ${JSON.stringify(edge.evidence ?? {})}${edge.needs_review ? ' · Needs review' : ''}`
      : `${edge.derived_kind} · ${data.state_labels?.[edge.impact?.label ?? edge.impact?.status] ?? edge.impact?.label ?? edge.impact?.status ?? ''}${edge.impact?.reason ? ' · ' + edge.impact.reason : ''}`).join('\n');
    const open = host.querySelector('[data-graph-open]');
    const href = safeGraphHref(node, data.project_id, data.return_href);
    open.hidden = !href;
    if (href) open.setAttribute('href', href); else open.removeAttribute('href');
    draw();
  };
  const bounds = () => {
    const points = data.nodes.filter(node => visible(node.id)).map(node => positions[node.id]);
    return { left: Math.min(...points.map(p => p.x)), top: Math.min(...points.map(p => p.y)), right: Math.max(...points.map(p => p.x+240)), bottom: Math.max(...points.map(p => p.y+72)) };
  };
  const fit = () => {
    if (!stage.clientWidth || !stage.clientHeight || !data.nodes.length) return;
    const box = bounds(), scale = clampZoom(Math.min((stage.clientWidth-48)/(box.right-box.left), (stage.clientHeight-70)/(box.bottom-box.top), 1.25));
    view = { scale, x: (stage.clientWidth-(box.right+box.left)*scale)/2, y: (stage.clientHeight-(box.bottom+box.top)*scale)/2 };
    restored = true;
    draw();
  };
  const focus = () => {
    const p = positions[`resource:${data.root_resource_id}`]; if (!p) return;
    view = { scale: view.scale, x: stage.clientWidth/2-(p.x+120)*view.scale, y: stage.clientHeight/2-(p.y+36)*view.scale }; select(`resource:${data.root_resource_id}`);
  };
  const point = event => { const r = stage.getBoundingClientRect(); return { x: event.clientX-r.left, y: event.clientY-r.top }; };
  host.querySelector('[data-graph-filter]').value = filter;
  host.querySelector('[data-graph-filter]').addEventListener('change', event => { filter = event.target.value; if (!visible(selected)) selected = `resource:${data.root_resource_id}`; select(selected); });
  host.querySelector('[data-graph-fit]').addEventListener('click', fit);
  host.querySelector('[data-graph-focus]').addEventListener('click', focus);
  for (const button of host.querySelectorAll('[data-graph-scale]')) button.addEventListener('click', () => { view = zoomAt(view, Number(button.dataset.graphScale), { x: stage.clientWidth/2, y: stage.clientHeight/2 }); draw(); });
  stage.addEventListener('wheel', event => { event.preventDefault(); view = zoomAt(view, Math.exp(-event.deltaY * .0015), point(event)); draw(); }, { passive: false });
  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer) return;
    const node = event.target.closest('[data-focus-graph-node]'), start = point(event);
    pointer = { id: event.pointerId, node: node?.dataset.focusGraphNode, start, view: { ...view }, position: node ? { ...positions[node.dataset.focusGraphNode] } : null, moved: false };
    stage.setPointerCapture(event.pointerId); event.preventDefault();
  });
  stage.addEventListener('pointermove', event => {
    if (pointer?.id !== event.pointerId) return;
    const p = point(event), dx = p.x-pointer.start.x, dy = p.y-pointer.start.y;
    if (Math.hypot(dx,dy) > 5) pointer.moved = true;
    if (!pointer.moved) return;
    if (pointer.node) positions[pointer.node] = { x: pointer.position.x+dx/view.scale, y: pointer.position.y+dy/view.scale };
    else view = { ...view, x: pointer.view.x+dx, y: pointer.view.y+dy }; draw();
  });
  const release = (event, cancelled = false) => {
    if (pointer?.id !== event.pointerId) return;
    const old = pointer; pointer = null;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (!cancelled && !old.moved && old.node) select(old.node);
  };
  stage.addEventListener('pointerup', event => release(event));
  stage.addEventListener('pointercancel', event => release(event, true));
  stage.addEventListener('lostpointercapture', () => { pointer = null; });
  stage.addEventListener('keydown', event => {
    const node = event.target.closest('[data-focus-graph-node]');
    if (node && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(node.dataset.focusGraphNode); host.querySelector('[data-graph-open]').focus(); }
    else if (event.key === '+' || event.key === '=' || event.key === '-') { event.preventDefault(); view = zoomAt(view, event.key === '-' ? .8 : 1.25, {x:stage.clientWidth/2,y:stage.clientHeight/2}); draw(); }
    else if (event.key === 'Escape') { pointer = null; select(`resource:${data.root_resource_id}`); }
  });
  host.querySelector('[data-graph-open]').addEventListener('click', event => {
    const node = data.nodes.find(node => node.id === selected), href = node && safeGraphHref(node, data.project_id, data.return_href);
    if (!href) { event.preventDefault(); return; }
    persist();
    try { sessionStorage.setItem('atlas-graph-return', JSON.stringify({ origin: data.return_href, target: href, project: data.project_id })); } catch {}
  });
  host.addEventListener('graph-visible', () => { if (!restored) fit(); else draw(); });
  select(data.nodes.some(node => node.id === selected) ? selected : data.nodes[0]?.id);
  if (!restored) fit();
  let lastSize = '';
  const observer = new ResizeObserver(() => { const size = stage.clientWidth+':'+stage.clientHeight; if (size !== lastSize && stage.clientWidth && stage.clientHeight && !host.closest('[hidden]')) { lastSize=size; if (!restored) fit(); } });
  observer.observe(stage);
  host.addEventListener('graph-destroy', () => {
    observer.disconnect?.();
    if (pointer && stage.hasPointerCapture(pointer.id)) stage.releasePointerCapture(pointer.id);
    pointer = null;
  });
}
if (typeof document !== 'undefined') {
  window.AtlasResourceGraph = { mount: mountResourceGraph };
  document.querySelectorAll('[data-resource-focus-graph]').forEach(mountResourceGraph);
}
