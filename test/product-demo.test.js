import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {prepareProductDemo,serveProductDemo,loadProductDemo} from '../scripts/demo.js';
import {isPathInside} from '../src/paths.js';
import {Registry} from '../src/registry.js';
import {RUNTIME_HANDSHAKE_TIMEOUTS} from '../src/runtime-location.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('demo UI assembles the rule service and shows an empty Project without creating rules',async t=>{
  const temp=fs.mkdtempSync(path.join(repo,'test/.tmp/product-demo-rules-'));
  const root=path.join(temp,'library');fs.mkdirSync(path.join(root,'资料'),{recursive:true});
  const stateDir=path.join(temp,'state');
  const registry=new Registry({stateDir});
  const adopted=registry.adoptRoot({rootPath:root,rootType:'managed_library',contentPolicy:'bounded_content'});
  const projectId=registry.create({name:'资料',currentPath:'资料'}).project_id;
  registry.attachRoot(projectId,{rootId:adopted.root_id,relativePath:'资料',reason:'Isolated empty-rule UI fixture.'});
  registry.dispose();
  let session;
  t.after(async()=>{if(session)await session.close();fs.rmSync(temp,{recursive:true,force:true,maxRetries:5});});
  session=await serveProductDemo({state_dir:stateDir,board_href:`/projects/${projectId}`},{python:process.execPath});
  const response=await fetch(session.url+'/rules');
  const html=await response.text();
  assert.equal(response.status,200,html);
  assert.match(html,/No proposals awaiting confirmation/u);
  assert.match(html,/No confirmed rules yet/u);
  assert.match(html,/No confirmed Library rules/u);
  assert.doesNotMatch(html,/Confirm rule|Confirm deactivation/u);
});
function isolatedScript(t){
  const root=fs.mkdtempSync(path.join(repo,'test/.tmp/product-demo-command-'));
  const fake=path.join(root,'repository');
  for(const dir of ['scripts','src','fixtures'])fs.mkdirSync(path.join(fake,dir),{recursive:true});
  fs.copyFileSync(path.join(repo,'scripts/demo.js'),path.join(fake,'scripts/demo.js'));
  fs.copyFileSync(path.join(repo,'src/paths.js'),path.join(fake,'src/paths.js'));
  fs.writeFileSync(path.join(fake,'src/runtime-location.js'), `export const RUNTIME_HANDSHAKE_TIMEOUTS = ${JSON.stringify(RUNTIME_HANDSHAKE_TIMEOUTS)};`);
  fs.writeFileSync(path.join(fake,'package.json'),'{"type":"module"}');
  fs.writeFileSync(path.join(fake,'src/tracker.js'),'export class Tracker { constructor(){throw new Error("legacy stopped after cleanup");} }');
  fs.cpSync(path.join(repo,'fixtures/demo-vault'),path.join(fake,'fixtures/demo-vault'),{recursive:true});
  t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5}));
  return {root,fake,run:args=>spawnSync(process.execPath,[path.join(fake,'scripts/demo.js'),...args],{encoding:'utf8',timeout:15000,windowsHide:true})};
}

test('demo help preserves the previous demonstration and creates no new workspace',t=>{
  const f=isolatedScript(t),previous=path.join(f.fake,'.atlas/demo');
  fs.mkdirSync(previous,{recursive:true});
  const marker=path.join(previous,'previous-user-result.txt');fs.writeFileSync(marker,'keep previous demonstration');
  const result=f.run(['--help']);
  assert.equal(fs.readFileSync(marker,'utf8'),'keep previous demonstration');
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/--python/);
  assert.equal(fs.existsSync(path.join(f.fake,'test/.tmp')),false);
});

test('demo resume rejects path syntax before reading any manifest',()=>{
  for(const id of ['../outside','C:/Users/example','00000000-0000-0000-0000-000000000000'])assert.throws(()=>loadProductDemo(id),/UUID demo-id/);
});

test('demo refuses a linked state parent before touching its target',t=>{
  const f=isolatedScript(t),outside=path.join(f.root,'outside');
  fs.mkdirSync(path.join(outside,'demo'),{recursive:true});
  const marker=path.join(outside,'demo/retained.txt');fs.writeFileSync(marker,'outside retained');
  fs.symlinkSync(outside,path.join(f.fake,'.atlas'),process.platform==='win32'?'junction':'dir');
  const result=f.run(['--python',process.execPath]);
  assert.equal(fs.readFileSync(marker,'utf8'),'outside retained');
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/symbolic link|junction/);
  assert.equal(fs.existsSync(path.join(f.fake,'test/.tmp')),false);
});

test('current-product demo creates one verified three-row Result and a readable three-kind Board',{timeout:180000},async t=>{
  const python=process.env.ATLAS_TEST_PYTHON;
  if(!python || !fs.existsSync(python)){t.skip('Provide ATLAS_TEST_PYTHON for the actual product demonstration.');return;}
  const demo=prepareProductDemo({python});
  let session,passed=false;
  t.after(async()=>{
    if(session)await session.close();
    if(!passed)return; // Preserve failed examples for diagnosis.
    for(const [target,parent] of [[demo.state_dir,path.join(repo,'.atlas/demo')],[path.dirname(demo.workspace),path.join(repo,'test/.tmp')]]){
      assert.ok(isPathInside(parent,target));assert.notEqual(path.resolve(parent),path.resolve(target));
      assert.ok(isPathInside(parent,fs.realpathSync(target)));
      fs.rmSync(target,{recursive:true,force:true,maxRetries:5});
    }
  });
  assert.equal(demo.phase,'ready');
  assert.equal(isPathInside(demo.project_path,demo.import_source),false);
  assert.ok(fs.readFileSync(demo.import_source).equals(fs.readFileSync(path.join(repo,'fixtures/product-demo/新线索.txt'))));
  const rows=fs.readFileSync(demo.result_path,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(line=>line.split(','));
  assert.deepEqual(rows,[['id','region','amount'],['1','北区','100'],['2','南区','80'],['3','北区','20']]);
  assert.equal(rows.slice(1).reduce((sum,row)=>sum+Number(row[2]),0),200);
  assert.equal(fs.statSync(demo.manifest_path).size<=16384,true);
  assert.deepEqual(demo.showcase.map(item=>item.capability),['A1','A2','A3','B1','B2','B3','C1','C2','D1','D2','E1','E2','E3','E4','F1','F2','F3','F4','F5','F6']);
  assert.equal(demo.showcase.find(item=>item.capability==='F2').status,'real_host_pending');
  for(const id of ['F5','F6'])assert.equal(demo.showcase.find(item=>item.capability===id).status,'default_off');
  const aggregateRows=fs.readFileSync(demo.aggregate_result_path,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(line=>line.split(','));
  assert.deepEqual(aggregateRows[0],['region','amount']);
  assert.equal(aggregateRows.length,3);
  assert.deepEqual(aggregateRows.slice(1).map(row=>[row[0],Number(row[1])]),[['北区',120],['南区',80]]);
  assert.equal(aggregateRows.slice(1).reduce((sum,row)=>sum+Number(row[1]),0),200);
  assert.equal(demo.analysis_demo,'pivot_trend_v1');
  assert.notEqual(demo.pivot_work_id,demo.trend_work_id);
  assert.notEqual(demo.pivot_save_id,demo.trend_save_id);
  assert.ok(fs.readFileSync(demo.analysis_source_path).equals(fs.readFileSync(path.join(repo,'fixtures/product-demo/地区类别月度.csv'))));
  const pivotRows=fs.readFileSync(demo.pivot_result_path,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(line=>line.split(','));
  assert.deepEqual(pivotRows[0],['row:地区','column:1:活动','column:2:线上','total:金额','share_percent','dense_rank']);
  assert.deepEqual(pivotRows.slice(1).map(row=>[row[0],...row.slice(1,5).map(Number),row[5]===''?null:Number(row[5])]),[['北区',100,50,150,60,1],['南区',70,30,100,40,2],['__TOTAL__',170,80,250,100,null]]);
  const trendRows=fs.readFileSync(demo.trend_result_path,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(line=>line.split(','));
  assert.deepEqual(trendRows[0],['month','sum:金额']);
  assert.deepEqual(trendRows.slice(1).map(row=>[row[0],Number(row[1])]),[['2026-01',100],['2026-02',150]]);
  assert.match(fs.readFileSync(demo.index_path,'utf8'),/真实 Host 接续待验收/u);
  assert.equal(demo.capture_demo,'structured_export_v1_v2');
  assert.equal(demo.capture_added_count,1);
  assert.equal(demo.capture_repeat_status,'unchanged');
  assert.equal(demo.local_module_enabled,false);
  assert.equal(demo.coverage_demo,'remaining_subsets_v1');
  assert.equal(demo.row_candidate_status,'pending');
  assert.equal(demo.showcase.filter(item=>item.capability!=='F5' && item.capability!=='F6' && item.href!==null).length,18);
  assert.notEqual(demo.migration_project_id,demo.project_id);
  assert.match(demo.migration_readme_resource_id,/^RES-[a-f0-9-]{36}$/iu);
  assert.equal(demo.migration_project_path,path.join(demo.workspace,'迁移练习'));
  assert.ok(fs.existsSync(path.join(demo.migration_project_path,'资料/迁移说明.txt')));
  assert.match(fs.readFileSync(path.join(demo.migration_project_path,'README.md'),'utf8'),/资料\/迁移说明\.txt/u);
  assert.equal(fs.existsSync(path.join(demo.workspace,'迁移练习_新位置')),false);
  assert.ok(fs.readFileSync(path.join(demo.project_path,'01_资料','下一期.csv')).equals(fs.readFileSync(path.join(repo,'fixtures/product-demo/下一期.csv'))));
  for(const [version,count] of [[1,2],[2,3]]){
    const input=JSON.parse(fs.readFileSync(path.join(demo.project_path,'01_资料',`聊天导出_v${version}.json`),'utf8'))[0];
    assert.equal(input.conversation_id,'fictional-region-demo');
    assert.equal(Object.values(input.mapping).filter(node=>node.message).length,count);
    assert.ok(isPathInside(path.join(demo.project_path,'02_成果'),demo.capture_result_paths[version-1]));
    const stored=JSON.parse(fs.readFileSync(demo.capture_result_paths[version-1],'utf8'));
    assert.equal(stored.version_id,demo.capture_version_ids[version-1]);
    assert.equal(stored.capture_mode,'chatgpt_export');
    assert.match(stored.readable,/北区120，南区80，合计200/u);
    if(version===1)assert.doesNotMatch(stored.readable,/新增下一期/u);
    else assert.match(stored.readable,/新增下一期/u);
  }
  const shown=spawnSync(process.execPath,[path.join(repo,'bin/atlas.js'),'board','show',demo.board_id,'--project',demo.project_id,'--json'],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,ATLAS_STATE_DIR:demo.state_dir,ATLAS_CONTENT_PYTHON:python}});
  assert.equal(shown.status,0,shown.stderr+shown.stdout);
  const receipt=JSON.parse(shown.stdout);assert.equal(receipt.ok,true);
  assert.deepEqual(receipt.data.blocks.map(block=>block.type),['material_reference','text','result_preview']);
  assert.equal(receipt.data.blocks[2].save_id,demo.save_id);
  session=await serveProductDemo(demo,{python});
  const showcaseResponse=await fetch(session.showcase_url);
  assert.equal(showcaseResponse.status,200);
  const showcaseHtml=await showcaseResponse.text();
  assert.match(showcaseHtml,/data-product-demo/u);
  for(const href of [demo.graph_href,demo.aggregate_href,demo.pivot_href,demo.trend_href])assert.ok(showcaseHtml.includes(`href="${href.replaceAll('&','&amp;')}"`),'showcase contains actual visible product anchors');
  const response=await fetch(session.url);assert.equal(response.status,200);
  const html=await response.text();assert.match(html,/金额合计200/);assert.match(html,/北区/);assert.match(html,/南区/);
  for(const href of new Set([demo.index_href,demo.rules_href,demo.membership_href,demo.pivot_href,demo.trend_href,...demo.showcase.map(item=>item.href).filter(Boolean)])){
    const page=await fetch(new URL(href,session.url));
    assert.equal(page.status,200,`Actual demo entry must resolve: ${href}`);
    if(href===demo.graph_href)assert.match(await page.text(),/data-resource-focus-graph/u);
    if(href===demo.round_href){
      const html=await page.text();
      const text=html.slice(html.indexOf('<main'),html.indexOf('</main>'));
      assert.doesNotMatch(text,/role="alert"/u,'round detail must remain readable after all demo Resources are registered');
      assert.match(text,/报告原稿\.md/u);
      assert.match(text,/报告修订稿\.md/u);
      assert.match(text,/name="action" value="preview_restore"/u);
    }
    if(href===demo.capture_changes_href)assert.match(await page.text(),/新增下一期/u);
    if(href===demo.row_candidates_href){const text=await page.text();assert.ok(text.includes(demo.row_candidate_id));assert.match(text,/区域归属/u);}
    if(href===demo.rule_preview_href)assert.match(await page.text(),/01_资料/u);
    if(href===demo.location_href)assert.match(await page.text(),/地区活动简报/u);
    if(href===demo.pivot_href){const html=await page.text();assert.match(html,/data-work-pivot/u);assert.match(html,/<tr><td>北区<\/td><td>100<\/td><td>50<\/td><td>150<\/td><td>60%<\/td><td>1<\/td><\/tr>/u);assert.match(html,/<tr><td>南区<\/td><td>70<\/td><td>30<\/td><td>100<\/td><td>40%<\/td><td>2<\/td><\/tr>/u);}
    if(href===demo.trend_href){const html=await page.text();assert.match(html,/data-work-trend-chart/u);assert.match(html,/2026-01/u);assert.match(html,/2026-02/u);assert.match(html,/50%/u);}
  }
  await session.close();session=null;
  assert.ok(fs.existsSync(demo.result_path),'closing the UI retains results');
  const reopened=loadProductDemo(demo.demo_id);
  assert.equal(reopened.work_id,demo.work_id);assert.equal(reopened.save_id,demo.save_id);
  assert.equal(reopened.board_id,demo.board_id);assert.equal(reopened.result_path,demo.result_path);
  const manifest=JSON.parse(fs.readFileSync(demo.manifest_path,'utf8'));
  fs.writeFileSync(demo.manifest_path,JSON.stringify({...manifest,workspace:repo}));
  assert.throws(()=>loadProductDemo(demo.demo_id),/does not match/);
  fs.writeFileSync(demo.manifest_path,JSON.stringify(manifest));
  fs.writeFileSync(demo.manifest_path,JSON.stringify({...manifest,pivot_result_path:path.join(repo,'outside.csv')}));
  assert.throws(()=>loadProductDemo(demo.demo_id),/analysis paths or identities/);
  fs.writeFileSync(demo.manifest_path,JSON.stringify({...manifest,showcase:manifest.showcase.map(item=>item.capability==='E2'?{...item,links:[{title:'地区×类别透视、占比和排名',href:'https://example.test/forged'}]}:item)}));
  assert.throws(()=>loadProductDemo(demo.demo_id),/analysis links/);
  fs.writeFileSync(demo.manifest_path,JSON.stringify(manifest));
  fs.writeFileSync(demo.manifest_path,JSON.stringify({...manifest,migration_project_path:repo}));
  assert.throws(()=>loadProductDemo(demo.demo_id),/supplemental materials/);
  fs.writeFileSync(demo.manifest_path,JSON.stringify(manifest));
  fs.writeFileSync(demo.manifest_path,JSON.stringify({...manifest,showcase:manifest.showcase.map(item=>item.capability==='D1'?{...item,href:'https://example.test/forged'}:item)}));
  assert.throws(()=>loadProductDemo(demo.demo_id),/showcase paths or links/);
  fs.writeFileSync(demo.manifest_path,JSON.stringify(manifest));
  for(const file of ['本期.csv','补充.csv','演示说明.md'])assert.ok(fs.readFileSync(path.join(demo.project_path,'01_资料',file)).equals(fs.readFileSync(path.join(repo,'fixtures/product-demo',file))));
  assert.equal(JSON.parse(fs.readFileSync(demo.manifest_path,'utf8')).save_id,demo.save_id);
  passed=true;
});
