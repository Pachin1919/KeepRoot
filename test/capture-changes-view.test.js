import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCaptureSourceView } from '../src/ui/views/capture-source-view.js';

const model = () => ({ project: { id: 'PRJ-demo', name: 'Demo' }, detail: { save_id: 'SAV-demo', capture_mode: 'chatgpt_export', title: '讨论', scope: 'selected_conversation', completeness: 'complete' }, read: {
  current_output: 'verified', previous_output: 'verified',
  mode: 'changes', start_character: 0, truncated: false, comparison: { status: 'available', added_count: 1, edited_count: 0, branch_changed_count: 1 },
  excerpt: [
    { kind: 'added', id: 'm3', role: 'user', before_text: null, after_text: '<script>新增</script>' },
    { kind: 'branch_changed', id: 'm2', role: 'assistant', before_text: '合计200', after_text: '合计200', branch_state: { before: [], after: ['m3'] } },
  ].map(JSON.stringify).join('\n'),
} });

test('capture changes show readable messages and counts while retaining the complete technical records', () => {
  const html = renderCaptureSourceView(model(), { locale: 'zh-CN' });
  assert.match(html, /data-capture-change="added"/u);
  assert.match(html, /新增消息<\/dt><dd>1/u);
  assert.match(html, /&lt;script&gt;新增&lt;\/script&gt;/u); assert.doesNotMatch(html, /<script>新增/u);
  assert.match(html, /<details[^>]*data-capture-change="branch_changed"><summary>分支结构变化/u);
  assert.match(html, /技术记录/u); assert.match(html, /来源与版本详情/u);
  assert.match(html, /&quot;m3&quot;/u);
  assert.match(html, /所选对话 · 本次文字记录完整/u);
  assert.match(html, /当前版本：与保存内容一致 · 上一版本：与保存内容一致/u);
  assert.match(html, /<h2>变化正文<\/h2>/u);
});

test('partial, cursor and future change excerpts remain visible rather than being parsed away', () => {
  for (const update of [{ truncated: true }, { start_character: 7 }, { excerpt: '{"kind":"future_type","body":"保留我"}' }]) {
    const sample = model(); Object.assign(sample.read, update);
    const html = renderCaptureSourceView(sample, { locale: 'zh-CN' });
    assert.match(html, /class="save-result-preview"/u);
    assert.doesNotMatch(html, /data-capture-change=/u);
    assert.ok(html.includes((sample.read.excerpt.includes('保留我') ? '保留我' : '&lt;script&gt;新增&lt;\/script&gt;')));
  }
});

test('changed, missing and unknown output states are never presented as verified', () => {
  const sample = model();
  sample.detail.completeness = 'partial';
  sample.read.current_output = 'changed'; sample.read.previous_output = 'missing';
  const html = renderCaptureSourceView(sample, { locale: 'zh-CN' });
  assert.match(html, /文字记录不完整/u);
  assert.match(html, /当前版本：保存后已变化 · 上一版本：文件缺失/u);
  assert.doesNotMatch(html, /与保存内容一致/u);
  sample.read.current_output = '<future_state>';
  const unknown = renderCaptureSourceView(sample, { locale: 'en' });
  assert.match(unknown, /Current version：&lt;future_state&gt;/u);
  assert.doesNotMatch(unknown, /Matches the saved content/u);
});
