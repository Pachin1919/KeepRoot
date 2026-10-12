import { UI_DISPLAY_NAME } from '../brand.js';
import { escapeHtml as h, renderNav, renderTopbar, renderUiClientScript } from '../components.js';
import { uiStyles } from '../styles.js';
import { normalizeUiLocale, translateUi } from '../i18n.js';

const TABLE_TOOLS = ['pipeline', 'aggregate', 'pivot', 'trend'];
const ICONS = {
 markdown: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>',
 pipeline: '<rect x="3" y="3" width="7" height="6" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/><path d="M10 6h5v12h-5m5-6h6m-3-3 3 3-3 3"/>',
 aggregate: '<path d="M4 5h8M4 10h8M4 15h4m7-10h6l-5 7 5 7h-6M4 20h8"/>',
 pivot: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18M9 15h12m6-6v12"/>',
 trend: '<path d="M3 3v18h18M6 16l5-6 4 3 6-8"/>',
};
const icon = key => '<span class="toolbox-tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+ICONS[key]+'</svg></span>';

export function renderToolboxView(model, options = {}) {
 const t = key => translateUi(options.locale,'toolbox.'+key,options.languageCatalog);
 const mt = key => translateUi(options.locale,'modules.'+key,options.languageCatalog);
 const base = model.project ? '/projects/'+encodeURIComponent(model.project.id) : null;
 const toolboxHref = '/toolbox'+(model.project ? '?project_id='+encodeURIComponent(model.project.id) : '');
 const modulesHref = '/modules'+(model.project ? '?project_id='+encodeURIComponent(model.project.id) : '');
 const selected = model.selected_ids ?? [], draft = model.markdown ?? {};
 const tool = [...TABLE_TOOLS,'markdown'].includes(model.tool) ? model.tool : Object.hasOwn(draft,'url') ? 'markdown' : null;
 const tableTool = TABLE_TOOLS.includes(tool) ? tool : 'pipeline';
 const moduleLink = '<a href="'+h(modulesHref)+'">'+h(mt('open'))+'</a>';
 const notice = model.notice_key ? t(model.notice_key) : model.notice;
 const card = key => {
  const paused = key === 'markdown' ? model.capture_paused : model.paused;
  const href = toolboxHref+(model.project ? '&' : '?')+'tool='+key+'#toolbox-config';
  return '<a class="toolbox-tool-card'+(tool===key?' is-selected':'')+'" href="'+h(href)+'" data-toolbox-tool="'+key+'"'+(tool===key?' aria-current="true"':'')+'>'+icon(key)+'<span class="toolbox-tool-copy"><strong>'+h(t(key))+'</strong><span>'+h(t(key+'_short'))+'</span><small>'+h(t(key==='markdown'?'web_input':'table_input'))+'</small></span><span class="toolbox-tool-enter">'+h(t(paused?'tool_paused':'tool_open'))+'<span aria-hidden="true">↗</span></span></a>';
 };
 const catalog = '<div class="toolbox-catalog"><section class="toolbox-tool-group" aria-labelledby="toolbox-convert-heading"><div class="toolbox-group-heading"><h2 id="toolbox-convert-heading">'+h(t('convert_group'))+'</h2><p>'+h(t('convert_group_help'))+'</p></div><div class="toolbox-catalog-grid is-conversion">'+['markdown','pipeline'].map(card).join('')+'</div></section><section class="toolbox-tool-group" aria-labelledby="toolbox-analysis-heading"><div class="toolbox-group-heading"><h2 id="toolbox-analysis-heading">'+h(t('analysis_group'))+'</h2><p>'+h(t('analysis_group_help'))+'</p></div><div class="toolbox-catalog-grid is-analysis">'+['aggregate','pivot','trend'].map(card).join('')+'</div></section></div>';
 const projectChoice = !base ? '<section class="surface toolbox-project-choice"><h2>'+h(t('choose'))+'</h2><ul>'+model.projects.map(p=>'<li><a href="/toolbox?project_id='+encodeURIComponent(p.id)+(tool?'&amp;tool='+tool:'')+'">'+h(p.name)+'</a></li>').join('')+'</ul></section>' : '';
 const table = model.paused ? '<p class="callout warn">'+h(t('paused'))+' '+moduleLink+'</p>' : model.resources.length ? '<form method="post" action="'+base+'/toolbox/start"><input type="hidden" name="csrf" value="'+h(options.csrfToken)+'"><fieldset><legend>'+h(t('materials'))+'</legend><div class="toolbox-materials">'+model.resources.map(r=>'<label><input type="checkbox" name="resource_ids" value="'+h(r.resource_id)+'"'+(selected.includes(r.resource_id)?' checked':'')+'> <strong>'+h(r.name)+'</strong><small>'+h(r.relative_path)+'</small></label>').join('')+'</div></fieldset><fieldset hidden>'+TABLE_TOOLS.map(key=>'<input type="radio" name="tool" value="'+key+'"'+(tableTool===key?' checked':'')+'>').join('')+'</fieldset><p class="muted">'+h(t('hint'))+'</p><button class="action-button">'+h(t('start'))+'</button></form>' : '<p>'+h(t('empty'))+'</p>';
 const folders = (model.folders ?? []).map(folder=>typeof folder==='string'?folder:folder.relative_path ?? folder.path ?? '.');
 const retainedFolder = String(draft.folder ?? folders[0] ?? '.');
 const folderOptions = [...new Set([...folders,retainedFolder])].map(folder=>'<option value="'+h(folder)+'"'+(folder===retainedFolder?' selected':'')+'>'+h(folder)+(folders.includes(folder)?'':' — '+h(t('folder_error')))+'</option>').join('');
 const markdown = (model.capture_paused?'<p class="callout warn">'+h(t('capture_paused'))+' '+moduleLink+'</p>':'')+'<form method="post" action="'+base+'/toolbox/markdown" data-draft-protect><input type="hidden" name="csrf" value="'+h(options.csrfToken)+'"><input type="hidden" name="request_key" value="'+h(draft.request_key)+'"><label>'+h(t('url'))+'<input name="url" type="url" required maxlength="2048" value="'+h(draft.url ?? '')+'" placeholder="https://..."></label><label>'+h(t('folder'))+'<select name="folder">'+folderOptions+'</select></label><label>'+h(t('name'))+'<input name="name" required maxlength="120" value="'+h(draft.name ?? 'public-page')+'"></label><button class="action-button"'+(model.capture_paused?' disabled':'')+'>'+h(t('prepare_markdown'))+'</button></form><a class="text-link" href="'+base+'#project-add-material">'+h(t('source_option'))+'</a>';
 const configuration = base ? '<div id="toolbox-config" class="toolbox-config" tabindex="-1"><section class="surface toolbox-setup"'+(!TABLE_TOOLS.includes(tool)?' hidden':'')+'><div class="toolbox-setup-heading">'+icon(tableTool)+'<div><h2>'+h(t(tableTool))+'</h2><p>'+h(t(tableTool+'_help'))+'</p></div></div>'+table+'</section><section class="surface toolbox-setup toolbox-conversion"'+(tool!=='markdown'?' hidden':'')+'><div class="toolbox-setup-heading">'+icon('markdown')+'<div><h2>'+h(t('markdown'))+'</h2><p>'+h(t('markdown_help'))+'</p></div></div>'+markdown+'</section></div>' : '';
 const localTools = '<section class="toolbox-local-tools" data-local-tools><div class="toolbox-group-heading"><div><h2>'+h(t('local_tools'))+'</h2><p>'+h(t('local_tools_intro'))+'</p></div><a class="text-link" href="'+h(modulesHref)+'">'+h(t('local_tools_manage'))+'</a></div>'+((model.local_modules ?? []).length?'<ul class="toolbox-local-list">'+model.local_modules.map(module=>'<li><div><strong>'+h(module.module_id)+'</strong><small>'+h(module.module_version)+' · '+h(mt(module.enabled?'enabled':'disabled'))+'</small></div><a class="text-link" href="'+h(modulesHref)+'#local-tool-'+encodeURIComponent(module.module_id)+'">'+h(t('local_tools_open'))+'</a></li>').join('')+'</ul>':'<p class="toolbox-local-empty">'+h(t('local_tools_empty'))+'</p>')+'<details class="toolbox-permissions"><summary>'+h(t('local_tools_permissions'))+'</summary><p>'+h(t('local_tools_help'))+'</p></details></section>';
 return '<!doctype html><html lang="'+normalizeUiLocale(options.locale)+'" '+(options.htmlAttributes ?? '')+'><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+h(t('title'))+' · '+UI_DISPLAY_NAME+'</title><style>'+uiStyles()+'</style>'+renderUiClientScript(true)+'</head><body><div class="app-shell">'+renderNav('Toolbox',{...options,project:model.project,interactive:true})+'<div class="workspace">'+renderTopbar({section:t('title'),project:model.project,locale:options.locale,languageCatalog:options.languageCatalog})+'<main class="page toolbox-page"><div class="page-intro"><div><h1>'+h(t('title'))+'</h1><p class="lede">'+h(t('catalog_help'))+'</p></div><a class="text-link" href="'+(base ?? '/projects')+'">'+h(t('project_exit'))+'</a></div>'+(notice?'<p class="callout warn" role="alert">'+h(notice)+'</p>':'')+projectChoice+catalog+configuration+localTools+'</main></div></div></body></html>';
}
