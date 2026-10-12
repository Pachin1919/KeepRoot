import assert from 'node:assert/strict';
import test from 'node:test';
import { renderProjectRulesView } from '../src/ui/views/project-rules-view.js';

const project = { id: 'P', name: '研究' }, base = '/projects/P';
const options = { locale: 'zh-CN', csrfToken: 'token' };
const render = (model, overrides = {}) => {
  const html = renderProjectRulesView({ project, base, ...model }, { ...options, ...overrides });
  return html.slice(html.indexOf('<main'));
};

test('Rule document preserves all seven kinds, values, unknown fields and evidence', () => {
  const kinds = ['placement', 'naming', 'directory_role', 'storage', 'content_versioning', 'project_type', 'agent_output'];
  const html = render({ active: kinds.map((kind, i) => ({ kind, rule_id: `R${i}`, rule_version_id: `V${i}`, summary: `规则${i}`, basis: 'observed', condition: { extension: ['md', 'txt'] }, value: { custom_field: `完整值${i}`, nested: { extra: '保留' } }, evidence: [{ path: 'source.md', fact: '实际依据' }] })) });
  for (let i = 0; i < kinds.length; i++) {
    assert.match(html, new RegExp(`完整值${i}`, 'u'));
    assert.match(html, new RegExp(`V${i}`, 'u'));
  }
  for (const label of ['目录用途', '存储边界', '内容版本', '项目类型', 'Agent 输出', 'extra: 保留', 'source.md', '实际依据']) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /<code>\{|&quot;custom_field/u);
  const unknown = render({ active: [{ kind: 'future_type', summary: '未知类型', value: { x: '<keep>' } }] });
  assert.match(unknown, /future_type/u); assert.match(unknown, /&lt;keep&gt;/u);
});

test('Rule review retains exact actions and required reasons in the fixed action panel', () => {
  const preview = { rule_change_id: 'C', status: 'prepared', candidate: { kind: 'placement', summary: '摘录入库', basis: 'user_instruction', condition: { origin: 'chat_export' }, value: { role: 'note', target_subdirectory: '资料' }, scope: { type: 'project', key: 'P' } } };
  const html = render({ preview, directories: ['资料'], pendingPage: { items: [{ rule_change_id: 'C', summary: '重复提案' }, { rule_change_id: 'OTHER', summary: '另一条提案' }] } });
  assert.match(html, /class="rule-action-panel"/u);
  assert.match(html, /<details class="rule-correction"><summary>纠正去向/u);
  for (const action of ['approve', 'reject', 'correct']) assert.ok(html.includes(`name="action" value="${action}"`));
  assert.equal((html.match(/name="reason" maxlength="500" required/gu) ?? []).length, 3);
  assert.equal((html.match(/action="\/projects\/P\/rules\/C"/gu) ?? []).length, 3);
  assert.equal((html.match(/name="csrf" value="token"/gu) ?? []).length, 3);
  assert.doesNotMatch(html, /重复提案/u); assert.match(html, /另一条提案/u);
  assert.match(html, /材料来源：聊天导出/u); assert.match(html, /研究 · 待你确认/u);
  const closed = render({ preview: { ...preview, status: 'rejected' } });
  assert.doesNotMatch(closed, /<form/u); assert.match(closed, /此提案已结束/u);
});

test('Rule naming semantic dates and unsupported correction are stated faithfully', () => {
  const html = render({ preview: { rule_change_id: 'N', status: 'prepared', candidate: { kind: 'naming', summary: '命名', value: { language: 'zh-CN', date_policy: 'semantic_only', date_format: 'YYYY-MM', rename_on_content_edit: false } } } });
  assert.match(html, /由 Host 提供，不自动推断/u);
  for (const field of ['language', 'date_policy', 'date_format', 'summary']) assert.ok(html.includes(`name="${field}"`));
  const other = render({ preview: { rule_change_id: 'S', status: 'prepared', candidate: { kind: 'storage', value: { inbox_is_durable: true } } } });
  assert.match(other, /此类型暂不支持在页面纠正/u);
  assert.doesNotMatch(other, /name="action" value="correct"/u);
  assert.match(other, /name="action" value="approve"/u);
});

test('Rule deactivation posts current rule identity without proposal and retains revision and consumers', () => {
  const html = render({ disablePreview: { rule_id: 'R/1', rule_version_id: 'V1', preview_revision: 'revision-1', kind: 'placement', summary: '当前规则', value: { target_subdirectory: '资料' }, scope: { type: 'project', key: 'P' }, impact: { consumers: ['rule.context', 'intake'] } } });
  assert.match(html, /action="\/projects\/P\/rules\/R%2F1"/u);
  assert.match(html, /name="expected_preview_revision" value="revision-1"/u);
  assert.match(html, /name="action" value="disable"/u);
  assert.match(html, /name="csrf" value="token"/u);
  assert.match(html, /name="reason" maxlength="500" required/u);
  assert.match(html, /rule.context · intake/u); assert.match(html, /V1/u);
  assert.doesNotMatch(html, /action=""/u);
});

test('placement document uses readable role and one destination instruction while retaining technical facts', () => {
  const html = render({active:[{rule_id:'R-note',kind:'placement',summary:'摘记入库',value:{role:'note',target_subdirectory:'资料'}}]});
  const article=html.match(/<article class="rule-document">([^]*?)<\/article>/u)[1];
  assert.match(article,/<dt>材料用途<\/dt><dd>摘记<\/dd>/u);
  assert.match(article,/将匹配的材料放入「资料」/u);
  assert.doesNotMatch(article,/<dt>目标目录<\/dt>|<dd>note<\/dd>/u);
  assert.match(html,/target_subdirectory/u);
});
