import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSearchView } from '../src/ui/views/search-view.js';
const item = {kind:'file',name:'报告.md',relative_path:'资料/报告.md',project_id:'P',project_name:'示例',href:'/projects/P/resources/read?resource_id=RES-one&return_to=%2Fprojects%2FP%2Fsearch',catalog_index:{snippet:'本期金额合计210，北区130，南区80。'}};
const model = {query:'北区 南区',scope:'body',items:[item],project:{id:'P',name:'示例'},index:{status:'available'}};
const main = html => html.slice(html.indexOf('<main'));
test('body hits show escaped indexed context with literal highlights and unchanged Resource URL',()=>{
  const html=main(renderSearchView(model,{locale:'zh-CN'}));
  assert.match(html,/本期金额合计210，<mark>北区<\/mark>130，<mark>南区<\/mark>80。/u);
  assert.match(html,/resource_id=RES-one&amp;return_to=%2Fprojects%2FP%2Fsearch/u);
  const malicious=main(renderSearchView({...model,query:'[x] 北区',items:[{...item,catalog_index:{snippet:'<img src=x onerror="alert(1)"> 北区 [x]'}}]},{locale:'en'}));
  assert.match(malicious,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; <mark>北区<\/mark> <mark>\[x\]<\/mark>/u);
  assert.doesNotMatch(malicious,/<img src=x|<script>/u);
});
test('snippets are bounded by codepoints and absent when filename-only or no indexed snippet',()=>{
  const html=main(renderSearchView({...model,items:[{...item,catalog_index:{snippet:'😀'.repeat(410)}}]},{locale:'zh-CN'}));
  const snippet=html.match(/class="search-result-snippet">([^<]*)<\/span>/u)[1];
  assert.equal([...snippet].length,401);
  assert.equal(snippet.endsWith('…'),true);
  assert.doesNotMatch(main(renderSearchView({...model,scope:'filename'},{locale:'zh-CN'})),/class="search-result-snippet"/u);
  assert.doesNotMatch(main(renderSearchView({...model,items:[{...item,catalog_index:{}}]},{locale:'zh-CN'})),/class="search-result-snippet"/u);
});
