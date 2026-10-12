import assert from 'node:assert/strict';
import test from 'node:test';
import {renderBoardView} from '../src/ui/views/board-view.js';
import {renderProjectRulesView} from '../src/ui/views/project-rules-view.js';
import {renderRoundTimelineView} from '../src/ui/views/round-timeline-view.js';
const options={locale:'zh-CN',csrfToken:'token'},project={id:'P',name:'示例项目'},base='/projects/P';
const main=html=>html.slice(html.indexOf('<main'));
test('Board index states delivery purpose and counts actual block types',()=>{
 const html=main(renderBoardView({project,base,mode:'list',boards:[{title:'周报',revision:3,desktop_href:base+'/boards/B',blocks:[{type:'text'},{type:'material_reference'},{type:'result_preview'}]}]},options));
 assert.match(html,/独立 HTML/u);assert.match(html,/不会自动重新分析/u);
 assert.match(html,/材料 1 · 说明 1 · 成果 1/u);assert.match(html,/boards\/create/u);
});
test('Rule reads as conditions and instructions without hiding approval reasons',()=>{
 const html=main(renderProjectRulesView({project,base,directories:['资料'],preview:{rule_change_id:'C',status:'prepared',candidate:{summary:'摘录入库',kind:'placement',basis:'observed',condition:{origin:'chat_export'},value:{target_subdirectory:'资料'}}}},options));
 assert.match(html,/适用条件/u);assert.match(html,/材料来源：聊天导出/u);
 assert.match(html,/将匹配的材料放入「资料」。/u);assert.match(html,/待你确认/u);
 assert.doesNotMatch(html,/<dd>prepared<\/dd>|<dd>placement<\/dd>|<dd>observed<\/dd>/u);
 for(const action of ['approve','reject','correct'])assert.ok(html.includes(`name="action" value="${action}"`));
 assert.equal((html.match(/name="reason" maxlength="500" required/gu)||[]).length,3);
 const active=main(renderProjectRulesView({project,base,active:[{summary:'命名',kind:'naming',basis:'user_instruction',condition:{extension:['md','txt']},value:{language:'zh-CN',date_policy:'event_date',date_format:'YYYY-MM-DD'},rule_id:'R',rule_version_id:'RV'}]},options));
 assert.match(active,/使用中文名称/u);assert.match(active,/事件日期/u);assert.doesNotMatch(active,/&quot;condition|<code>\{/u);assert.match(active,/RV/u);
});
test('archive index shows real dates, recorded revision and bounded scope counts',()=>{
 const html=main(renderRoundTimelineView({project,base,rounds:[{round_id:'R',label:'初稿',revision:4,node_count:3,file_count:2,updated_at:'2026-10-10T11:00:00Z'}]},options));
 assert.match(html,/版本 4 · 3 个存档点 · 2 个受保护文件/u);assert.match(html,/datetime="2026-10-10T11:00:00Z"/u);
 assert.match(html,/查看内容与回档预览/u);assert.doesNotMatch(html,/name="action" value="restore"/u);
});
test('archive node display numbers preserve exact parent, node and preview identity',()=>{
 const html=main(renderRoundTimelineView({project,base,round:{round_id:'R',label:'初稿',revision:4,paths:['note.md'],head_node_id:'N2',nodes:[{node_id:'N1',kind:'before',label:'开始前',files:[]},{node_id:'N2',parent_node_id:'N1',kind:'checkpoint',label:'完成初稿',files:[{path:'note.md'}]}]}},options));
 assert.match(html,/存档点 01 · 开始前/u);assert.match(html,/存档点 02 · 完成初稿/u);assert.match(html,/1 个文件/u);
 assert.match(html,/name="node_id" value="N2"/u);assert.match(html,/<code>N1<\/code>/u);assert.match(html,/name="action" value="preview_restore"/u);
 assert.doesNotMatch(html,/name="action" value="restore"/u);
});
