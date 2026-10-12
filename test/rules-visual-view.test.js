import assert from 'node:assert/strict';
import test from 'node:test';
import { renderProjectRulesView } from '../src/ui/views/project-rules-view.js';

const render = (model, locale = 'zh-CN') => {
  const html = renderProjectRulesView({ project: { id: 'P', name: '项目甲' }, base: '/projects/P', ...model }, { locale, csrfToken: 'fixture-token' });
  return html.slice(html.indexOf('<main'));
};
const rule = { kind: 'placement', rule_id: 'R', scope: { type: 'project', key: 'P' }, summary: 'Host 的长说明，不承担条件或目标展示', condition: { artifact_role: 'note', extension: ['md', 'txt'] }, value: { role: 'note', target_subdirectory: '会议/记录' }, basis: 'observed', evidence: [{ path: 'meeting.md', fact: '已声明依据' }] };

test('pending metadata never fabricates conditions or an absent destination', () => {
  // pendingPage returns metadata; the complete candidate is read on its review page.
  const html = render({pendingPage:{items:[{rule_change_id:'META',kind:'placement',summary:'仅有提案说明',basis:'observed',status:'prepared'}]}});
  assert.match(html,/href="\/projects\/P\/rules\/META"/u);
  assert.match(html,/仅有提案说明/u);
  assert.doesNotMatch(html,/所属范围内所有材料|未声明目标目录|rule-flow/u);
  const full=render({preview:{rule_change_id:'META',status:'prepared',candidate:rule}});
  assert.match(full,/class="rule-flow"/u);
  assert.match(full,/会议\/记录/u);
});

test('graph shows actual conditions and destination independently of the Host summary', () => {
  const html = render({ active: [rule] });
  const flow = html.match(/<div class="rule-flow"[^>]*>([^]*?)<details class="rule-explanation">/u)[1];
  assert.match(flow, /class="rule-condition-node"/u);
  assert.match(flow, /材料用途<\/span><strong>摘记/u);
  assert.match(flow, /文件格式<\/span><strong>md \/ txt/u);
  assert.match(flow, /class="rule-target-title">[^]*?<strong>会议\/记录<\/strong>/u);
  assert.match(flow, /class="rule-connector" aria-hidden="true">→/u);
  assert.doesNotMatch(flow, /Host 的长说明/u);
  assert.match(html, /<details class="rule-explanation"><summary>完整说明与依据/u);
  assert.match(html, /Host 的长说明/u);
  assert.match(html, /meeting.md/u);
  assert.match(html, /已声明依据/u);
});

test('every supported context kind shows its supplied values and unknown kind never promises an operation', () => {
  for (const kind of ['naming', 'directory_role', 'storage', 'content_versioning', 'project_type', 'agent_output', 'future_kind']) {
    const html = render({ active: [{ ...rule, kind, condition: { custom_condition: '<source>' }, value: { custom_value: '<target>', nested: { retained: true } } }] });
    const flow = html.match(/<div class="rule-flow"[^>]*>([^]*?)<details class="rule-explanation">/u)[1];
    assert.match(flow, /custom_condition<\/span><strong>&lt;source&gt;/u);
    assert.match(flow, /custom_value<\/span><strong>&lt;target&gt;/u);
    assert.match(flow, /retained: 是/u);
    assert.doesNotMatch(html, /<source>|<target>/u);
    if (kind !== 'naming') {
      assert.match(flow, /规则上下文/u);
      assert.match(flow, /由使用方支持的操作决定实际处理/u);
      assert.doesNotMatch(flow, /存放到|将匹配的材料/u);
    }
  }
});

test('pending count names only returned page and empty library stays a collapsed short section', () => {
  const html = render({ pendingPage: { items: [{ ...rule, rule_change_id: 'C' }], has_more: true, next_cursor: 'cursor/2' }, active: [rule] });
  assert.match(html, /本页 1/u);
  assert.doesNotMatch(html, /总计|全部待确认/u);
  assert.match(html, /cursor=cursor%2F2/u);
  assert.match(html, /href="\/projects\/P\/rules\/C">审核提案/u);
  assert.match(html, /<details class="surface rule-library"><summary>库级规则/u);
  assert.match(html, /class="rule-scope">项目甲/u);
  const library = render({ libraryActive: [{ ...rule, scope: { type: 'library' } }] });
  assert.match(library, /<details class="surface rule-library" open>/u);
  assert.match(library, /class="rule-scope">整个库/u);
  assert.doesNotMatch(library, /href="\/projects\/P\/rules\/R"/u);
});

test('proposal controls preserve reasons and CSRF while closed proposals have no forms', () => {
  const preview = { rule_change_id: 'C/1', status: 'prepared', candidate: rule };
  const html = render({ preview, directories: ['会议/记录'] });
  for (const action of ['approve', 'reject', 'correct']) assert.ok(html.includes(`name="action" value="${action}"`));
  assert.equal((html.match(/name="csrf" value="fixture-token"/gu) ?? []).length, 3);
  assert.equal((html.match(/name="reason" maxlength="500" required/gu) ?? []).length, 3);
  assert.equal((html.match(/action="\/projects\/P\/rules\/C%2F1"/gu) ?? []).length, 3);
  assert.match(html, /已有文件不会在此移动或重命名/u);
  assert.match(html, /<details class="rule-operation-help">/u);
  const closed = render({ preview: { ...preview, status: 'approved' } });
  assert.doesNotMatch(closed, /<form/u);
  assert.match(closed, /已确认/u);
  assert.match(closed, /此提案已结束/u);
  const english = render({ active: [rule] }, 'en');
  assert.match(english, /Matching conditions/u);
  assert.match(english, /Place in/u);
  assert.match(english, /Active/u);
});
