import assert from 'node:assert/strict';
import test from 'node:test';
import { renderProductDemoView } from '../src/ui/views/product-demo-view.js';
import fs from 'node:fs';
import path from 'node:path';
import { Registry } from '../src/registry.js';
import { startAtlasUiServer } from '../src/ui-server.js';

test('A3 opens registered body search rather than filename search',()=>{
 const html=renderProductDemoView({showcase:[{capability:'A3',title:'搜索',status:'ready',href:'/projects/P/search?q=北区',expected:'正文'}]});
 assert.match(html,/href="\/projects\/P\/search\?q=北区&amp;scope=body"/u);
});

test('demo guide offers actual local UI links, labels pending gates, and never executes a tool', () => {
  const html = renderProductDemoView({ showcase: [
    { capability: 'D1', title: '关系图', status: 'ready', href: '/projects/PRJ-demo/resources?resource_id=RES-source&relation_depth=2', expected: '资料 → Work → 成果' },
    { capability: 'E2', title: '表格分析', status: 'ready', href: '/work/DWT-group', expected: '汇总', links:[{title:'透视表',href:'/work/DWT-pivot'},{title:'月度趋势',href:'/work/DWT-trend'},{title:'外部运行',href:'https://external.test/run'}] },
    { capability: 'F2', title: '不同Host', status: 'real_host_pending', href: '/projects/PRJ-demo/handoffs/HOF-demo', expected: '接续包可读，第二款AI待验' },
    { capability: 'F5', title: '事件', status: 'default_off', href: null, expected: '默认关闭' },
    { capability: 'F1', title: '<script>bad()</script>', status: 'installed_disabled', href: '//external.test/run', expected: '不能运行' },
  ] }, { project: { id: 'PRJ-demo', name: '虚构演示' }, locale: 'zh-CN' });
  assert.match(html, /data-product-demo/u);
  assert.match(html, /href="\/projects\/PRJ-demo\/resources\?resource_id=RES-source&amp;relation_depth=2&amp;graph=1"/u);
  assert.match(html, /第二款AI待验/u); assert.match(html, /试验默认关闭/u);
  assert.match(html, /href="\/work\/DWT-pivot">透视表<\/a>/u);
  assert.match(html, /href="\/work\/DWT-trend">月度趋势<\/a>/u);
  assert.doesNotMatch(html, /href="https:\/\/external/u);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /href="\/\/external|<script>bad/u);
  const guide = html.match(/<main[^>]*data-product-demo[^>]*>([\s\S]*?)<\/main>/u)?.[1];
  assert.ok(guide); assert.doesNotMatch(guide, /<form|action="\/modules\/local-/u);
  assert.match(html, /不代表全部20项能力/u);
});

test('Settings returns to the explicit demo only when enabled and refuses external or nested return paths', async () => {
  for (const enabled of [true, false]) {
    const stateDir=fs.mkdtempSync(path.resolve('test/.tmp/demo-settings-'));
    const registry=new Registry({stateDir});
    let server;
    try {
      server=await startAtlasUiServer({stateDir,registry,rules:{},runtime:{},...(enabled?{demoShowcase:{showcase:[]}}:{})});
      for(const [returnTo,expected] of [['/demo',enabled?'/demo':'/projects'],['//external.test/demo','/projects'],['/demo/outside','/projects']]) {
        const html=await (await fetch(`${server.workspace_url}settings?return_to=${encodeURIComponent(returnTo)}`)).text();
        const csrf=html.match(/name="csrf" value="([^"]+)"/u)[1];
        const response=await fetch(`${server.workspace_url}settings`,{method:'POST',body:new URLSearchParams({csrf,return_to:returnTo,action:'save',locale:'zh-CN'}),redirect:'manual'});
        assert.equal(response.status,303);
        assert.equal(response.headers.get('location'),expected);
      }
    } finally {if(server)await server.close();registry.dispose();fs.rmSync(stateDir,{recursive:true,force:true});}
  }
});
