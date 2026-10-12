import { escapeHtml } from '../components.js';
import { graphLayout, safeGraphHref } from '../resource-graph.js';

export function renderResourceGraphView(graph, { locale = 'en', returnHref, workSessions = [] } = {}) {
  if (!graph?.nodes?.length) return `<p role="status">${locale.startsWith('zh') ? '当前材料没有可用的已存关系图。' : 'No stored graph is available for this material.'}</p>`;
  const h = escapeHtml, zh = locale.startsWith('zh'), text = (cn,en) => zh ? cn : en;
  const base = `/projects/${encodeURIComponent(graph.project_id)}`;
  const origin = returnHref ?? base + '/resources?' + new URLSearchParams({resource_id:graph.root_resource_id,graph:'1'});
  const nodes = graph.nodes.map(node => ({...node, label: node.kind === 'work' ? workSessions.find(work=>work.session_id===node.session_id)?.intent || node.label : node.label}));
  const data = { ...graph, nodes, return_href: origin };
  const positions = graphLayout(nodes), ids = new Set(nodes.map(node=>node.id));
  const arrow = `graph-arrow-${h(graph.root_resource_id)}`;
  const kinds = {resource:text('材料','Material'),work:text('处理','Work'),result:text('成果','Result')};
  const states = zh ? {Fresh:'当前',fresh:'当前','Needs review':'需复核',needs_review:'需复核','Sources need review':'来源需复核','Not checked':'未核验',not_checked:'未核验',contained:'影响受控'} : {};
  data.kind_labels=kinds; data.state_labels=states;
  const status = node => typeof node.freshness === 'string' ? node.freshness : node.freshness?.label ?? node.freshness?.status ?? '';
  const visibleStatus = node => states[status(node)] ?? status(node);
  const svgNodes = nodes.map(node => {
    const p=positions[node.id], current=node.id===`resource:${graph.root_resource_id}`;
    return `<g data-focus-graph-node="${h(node.id)}" data-node-kind="${h(node.kind)}" transform="translate(${p.x} ${p.y})" role="button" tabindex="0" aria-label="${h(kinds[node.kind]+': '+node.label)}" aria-pressed="${current}" class="graph-node${current?' is-current':''}"><title>${h(node.label)}${status(node)?' · '+h(status(node)):''}</title><rect width="240" height="72" rx="9"/><text x="14" y="20" class="graph-kind">${h(kinds[node.kind])}${current?' · '+h(text('当前','Current')):''}</text><text x="14" y="41" class="graph-label">${h([...String(node.label)].slice(0,18).join(''))}${[...String(node.label)].length>18?'…':''}</text><text x="14" y="59" class="graph-state">${h(visibleStatus(node))}</text></g>`;
  }).join('');
  const edges = graph.edges.filter(edge=>ids.has(edge.source)&&ids.has(edge.target));
  data.edges=edges;
  const svgEdges=edges.map(edge=>{
    const a=positions[edge.source],b=positions[edge.target];
    return `<path data-focus-graph-edge="${h(edge.id)}" data-edge-kind="${h(edge.kind)}" class="graph-edge${edge.kind==='linked_to'?' is-linked':''}${edge.needs_review||edge.impact?.status==='needs_review'?' needs-review':''}" d="M${a.x+240},${a.y+36} L${b.x},${b.y+36}" marker-end="url(#${arrow})"><title>${h(edge.kind==='linked_to'?'linked_to · '+edge.status+' · '+JSON.stringify(edge.evidence??{}):edge.derived_kind+' · '+(edge.impact?.label??''))}</title></path>`;
  }).join('');
  const fallback=nodes.map(node=>{const href=safeGraphHref(node,graph.project_id,origin);return `<li>${href?`<a href="${h(href)}">${h(node.label)}</a>`:h(node.label)} ${h(status(node))}</li>`;}).join('');
  return `<section class="resource-graph" data-resource-focus-graph data-graph-data="${h(JSON.stringify(data))}" aria-label="${h(text('材料关系画布','Material relationship canvas'))}"><script type="module" src="/ui/resource-graph.js"></script><div class="graph-toolbar"><strong>${h(text('关系画布','Relationship canvas'))}</strong><label>${h(text('节点','Nodes'))} <select data-graph-filter><option value="all">${h(text('全部','All'))}</option>${Object.entries(kinds).map(([kind,label])=>`<option value="${kind}">${h(label)}</option>`).join('')}</select></label><button type="button" class="reader-button" data-graph-scale="0.8" aria-label="${h(text('缩小','Zoom out'))}">−</button><output data-graph-zoom>100%</output><button type="button" class="reader-button" data-graph-scale="1.25" aria-label="${h(text('放大','Zoom in'))}">+</button><button type="button" class="reader-button" data-graph-fit>${h(text('适配屏幕','Fit'))}</button><button type="button" class="reader-button" data-graph-focus>${h(text('聚焦当前','Focus current'))}</button></div><p class="graph-help">${h(text('拖动节点或空白 · 滚轮缩放 · 材料 → 处理 → 成果；绿线为已存材料关系，灰线为处理方向。距离无语义，文件未核验。','Drag nodes or background · Wheel to zoom · Material → Work → Result; green edges are stored material links, gray edges are processing direction. Distance has no meaning; files are not verified.'))}${graph.truncated?' '+h(text('图已截断。','Graph truncated.')):''}</p><svg class="graph-stage" data-graph-stage tabindex="0" aria-label="${h(text('选择节点后打开；加减缩放，Escape返回当前','Select a node then Open; plus/minus zoom, Escape selects current'))}"><defs><marker id="${arrow}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z"/></marker></defs><g data-graph-world>${svgEdges}${svgNodes}</g></svg><div class="graph-selection" aria-live="polite"><div><strong data-graph-name>${h(nodes[0].label)}</strong><details><summary>${h(text('身份与关系证据','Identity and relationship evidence'))}</summary><small data-graph-identity>${h(nodes[0].id)}</small><pre data-graph-evidence></pre></details></div><a class="reader-button" data-graph-open hidden>${h(text('打开','Open'))}</a></div><noscript><p>${h(text('启用JavaScript使用画布；材料仍可打开。','Enable JavaScript for the canvas; materials can still be opened.'))}</p><ul>${fallback}</ul></noscript></section>`;
}
