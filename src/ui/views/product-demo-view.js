import { escapeHtml as h, renderNav, renderTopbar, renderUiClientScript } from '../components.js';
import { uiStyles } from '../styles.js';
import { UI_DISPLAY_NAME } from '../brand.js';

// This page is offered only by the explicit fictional-demo launcher.
// Product actions stay in their existing UI; the guide never performs them.
export function renderProductDemoView(demo, options = {}) {
  const href = value => {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\s\\]/u.test(value)) return null;
    const parsed = new URL(value, 'http://atlas.local');
    return parsed.origin === 'http://atlas.local' ? value : null;
  };
  const labels = { ready: '有演示素材', subset_ready: '有代表场景', installed_disabled: '已安装，未运行', candidate_pending: '有待确认候选', material_pending: '有材料，操作待演示', real_host_pending: '接续包可查看，第二款AI待验', not_demonstrated: '本次素材待补', default_off: '试验默认关闭' };
  const featured = ['D1','E2','E4','B1','B2','C2','F3','F1','F2'];
  const rank = item => featured.includes(item.capability) ? featured.indexOf(item.capability) : featured.length;
  const available = (demo.showcase ?? []).filter(item => href(item.href)).sort((left,right) => rank(left)-rank(right));
  const cards = available.map(source => {
    const item = source.capability === 'A3' ? {...source,href:source.href + (source.href.includes('?') ? '&' : '?') + 'scope=body'} : {...source};
    if(item.capability==='D1') { item.href += (item.href.includes('?')?'&':'?')+'graph=1'; item.title='材料关系画布'; item.expected='选择材料，拖动、缩放和聚焦关系；打开真实材料、处理与已保存成果后返回画布。'; }
    const links=(item.links ?? []).filter(link=>href(link.href)).slice(0,2);
    return `<article class="surface demo-showcase-card" data-demo-capability="${h(item.capability)}"><a class="demo-showcase-main" href="${h(href(item.href))}"><small>${h(item.capability)} · ${h(labels[item.status] ?? item.status)}</small><h2>${h(item.title)}</h2><p>${h(item.expected)}</p><span class="text-link">打开查看 →</span></a>${links.length?`<nav class="demo-showcase-links" aria-label="${h(item.title)}其他示例">${links.map(link=>`<a class="text-link" href="${h(href(link.href))}">${h(link.title)}</a>`).join('')}</nav>`:''}</article>`;
  }).join('');
  const rows = (demo.showcase ?? []).map(item => `<tr><th scope="row">${h(item.capability)} ${h(item.title)}</th><td>${h(labels[item.status] ?? item.status)}</td><td>${h(item.expected)}</td></tr>`).join('');
  return `<!doctype html><html lang="zh-CN" ${options.htmlAttributes ?? ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>V20演示台 · ${UI_DISPLAY_NAME}</title><style>${uiStyles()}</style>${renderUiClientScript(true)}</head><body class="product-workspace-body"><div class="app-shell" style="${h(options.railStyle ?? '')}">${renderNav('Projects', { ...options, project: options.project, interactive: true, workspaceHref: '/projects' })}<div class="workspace">${renderTopbar({ section: 'V20演示台', locale: options.locale, languageCatalog: options.languageCatalog })}<main class="page" data-product-demo><div class="page-intro"><div><span class="eyebrow">Keeproot · 虚构示例</span><h1>点开就能看的演示</h1><p class="lede">先看关系图，再看汇总和看板。文字材料可以直接在阅读页修改。</p></div></div><p class="callout">这是预置的虚构资料。每张卡片写明已准备的效果；不代表全部20项能力或真实项目已验收。本页来自源码隔离演示，正式安装尚未同步。</p><div class="demo-showcase-grid">${cards}</div><details class="surface demo-coverage"><summary>完整20项：演示范围与待补材料</summary><div class="table-scroll"><table><thead><tr><th>功能</th><th>本次演示</th><th>可以看什么 / 还缺什么</th></tr></thead><tbody>${rows}</tbody></table></div></details></main></div></div></body></html>`;
}
