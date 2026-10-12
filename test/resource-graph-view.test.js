import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { graphLayout, zoomAt, safeGraphHref, mountResourceGraph } from '../src/ui/resource-graph.js';
import { renderResourceGraphView } from '../src/ui/views/resource-graph-view.js';
import { renderResourceReaderView } from '../src/ui/views/resource-reader-view.js';

const base='/projects/P';
const nodes=[{id:'resource:R',kind:'resource',resource_id:'R',label:'<script>bad</script>',href:base+'/resources?resource_id=R'},
  {id:'work:W',kind:'work',session_id:'W',label:'W',href:'/work/W',freshness:{label:'Needs review'}},
  {id:'result:S',kind:'result',save_id:'S',label:'output.csv',href:'/work/W/saved?work_id=S',freshness:{label:'Sources need review'}}];
const graph={project_id:'P',root_resource_id:'R',nodes,edges:[{id:'E',kind:'derived',derived_kind:'source_to_work',source:'resource:R',target:'work:W',impact:{label:'Needs review',reason:'Source changed'}}],file_verification:'not_checked',truncated:true};
test('canvas keeps real identities, direction and freshness with escaped bounded data',()=>{
  const html=renderResourceGraphView(graph,{locale:'zh-CN',workSessions:[{session_id:'W',intent:'汇总本期'}]});
  assert.match(html,/data-resource-focus-graph/u);assert.match(html,/data-focus-graph-node="resource:R"/u);
  assert.match(html,/data-focus-graph-edge="E"/u);assert.match(html,/汇总本期/u);
  assert.match(html,/Sources need review/u);assert.match(html,/Needs review/u);assert.match(html,/文件未核验/u);assert.match(html,/图已截断/u);
  assert.doesNotMatch(html,/<script>bad|>Fresh</u);assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/u);
  for(const attribute of ['data-graph-fit','data-graph-focus','data-graph-filter','data-graph-open','data-graph-stage']) assert.ok(html.includes(attribute));
  const data=JSON.parse(html.match(/data-graph-data="([^"]+)"/u)[1].replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&#39;',"'"));
  assert.deepEqual(data.edges,graph.edges); assert.equal(data.nodes[0].label,nodes[0].label);
});
test('canvas links only permit exact Resource and Work identities on closed local routes',()=>{
  const origin=base+'/resources?resource_id=R&graph=1';
  const href=safeGraphHref(nodes[0],'P',origin),url=new URL(href,'http://atlas.local');
  assert.equal(url.pathname,base+'/resources/read'); assert.equal(url.searchParams.get('resource_id'),'R');assert.equal(url.searchParams.get('return_to'),origin);
  assert.equal(safeGraphHref(nodes[1],'P',origin),'/work/W');assert.equal(safeGraphHref(nodes[2],'P',origin),'/work/W/saved?work_id=S');
  for(const href of ['javascript:alert(1)','data:text/html,x','https://evil.test/a','//evil.test/a','/projects/OTHER/resources?resource_id=R',base+'/resources?resource_id=wrong','/work/OTHER',base+'/resources?resource_id=R#x']) assert.equal(safeGraphHref({...nodes[0],href},'P',origin),null);
  assert.equal(safeGraphHref({...nodes[1],href:'/work/OTHER'},'P',origin),null);
  assert.equal(safeGraphHref({...nodes[2],href:'/work/W/saved?work_id=OTHER'},'P',origin),null);
});
test('deterministic columns and cursor anchored zoom preserve location and enforce bounds',()=>{
  assert.deepEqual(graphLayout(nodes),graphLayout(nodes));const layout=graphLayout(nodes);
  assert.ok(layout['resource:R'].x<layout['work:W'].x && layout['work:W'].x<layout['result:S'].x);
  const view={scale:1,x:17,y:30},point={x:350,y:230};const zoom=zoomAt(view,2,point);
  assert.equal((point.x-zoom.x)/zoom.scale,(point.x-view.x)/view.scale);
  assert.equal((point.y-zoom.y)/zoom.scale,(point.y-view.y)/view.scale);
  assert.equal(zoomAt(view,100,point).scale,2.5);assert.equal(zoomAt(view,.001,point).scale,.4);
});
test('Reader graph is a separate same-page panel, while manual draft never starts hidden',()=>{
  const model={project:{id:'P',name:'Project'},reader:{resource_id:'R',kind:'text',text:'draft body',name:'material.txt',relative_path:'material.txt'},resources:[],resourceFocusGraph:graph,graphMode:true};
  const html=renderResourceReaderView(model,{locale:'en'});assert.match(html,/id="reader-content" hidden/u);assert.match(html,/id="reader-graph">/u);assert.match(html,/data-reader-graph-toggle/u);
  const manual=renderResourceReaderView({...model,manual:{text:'unsaved draft',readHref:base+'/resources/read?resource_id=R',requestKey:'one'}},{locale:'en'});
  assert.match(manual,/unsaved draft/u);assert.match(manual,/id="reader-graph" hidden/u);assert.doesNotMatch(manual,/data-reader-graph-toggle|id="reader-content" hidden/u);
  const client=fs.readFileSync(new URL('../src/ui/client.js',import.meta.url),'utf8');assert.match(client,/visible && \(busy \|\| content.querySelector\('\.reader-edit'\)/u);
});

// Execute the actual interaction controller against small DOM-shaped event targets.
test('node drag and pan do not open nodes; cancellation releases capture and filtering keeps root',()=>{
  class Element {
    constructor(dataset={}){this.dataset=dataset;this.attrs={};this.style={};this.events={};this.hidden=false;this.clientWidth=900;this.clientHeight=500;this.classList={toggle(){}};}
    setAttribute(k,v){this.attrs[k]=v;} removeAttribute(k){delete this.attrs[k];} addEventListener(k,fn){this.events[k]=fn;}
    getBoundingClientRect(){return {left:0,top:0};} setPointerCapture(id){this.capture=id;} hasPointerCapture(id){return this.capture===id;}releasePointerCapture(){this.capture=null;}focus(){}
    closest(selector){return selector==='[data-focus-graph-node]' && this.dataset.focusGraphNode ? this : null;}
  }
  const stage=new Element(),world=new Element(),nodeElements=nodes.map(node=>new Element({focusGraphNode:node.id})),edgeElements=[new Element({focusGraphEdge:'E'})];
  const selectors=Object.fromEntries(['stage','world','zoom','name','identity','evidence','open','filter','fit','focus'].map(key=>['[data-graph-'+key+']',key==='stage'?stage:key==='world'?world:new Element()]));
  const host=new Element({graphData:JSON.stringify({...graph,return_href:base+'/resources?resource_id=R&graph=1'})});
  host.querySelector=selector=>selectors[selector];host.querySelectorAll=selector=>selector==='[data-focus-graph-node]'?nodeElements:selector==='[data-focus-graph-edge]'?edgeElements:[];
  const storage=new Map();globalThis.sessionStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
  globalThis.ResizeObserver=class{observe(){}};
  try {
    mountResourceGraph(host);const initial=selectors['[data-graph-open]'].attrs.href;
    stage.events.wheel({deltaY:-250,clientX:200,clientY:120,preventDefault(){}});
    const chosenView=JSON.parse(storage.get('atlas-graph:P:R')).view;
    host.events['graph-visible']();
    assert.deepEqual(JSON.parse(storage.get('atlas-graph:P:R')).view,chosenView,'Showing the same canvas must preserve the chosen viewport');
    const ev=(id,x,y,target=nodeElements[1])=>({pointerId:id,clientX:x,clientY:y,target,button:0,preventDefault(){}});
    stage.events.pointerdown(ev(1,100,100));stage.events.pointermove(ev(1,180,140));stage.events.pointerup(ev(1,180,140));
    assert.equal(selectors['[data-graph-open]'].attrs.href,initial);assert.equal(stage.capture,null);
    const state=JSON.parse(storage.get('atlas-graph:P:R'));assert.notDeepEqual(state.positions['work:W'],graphLayout(nodes)['work:W']);
    stage.events.pointerdown(ev(2,100,100,stage));stage.events.pointermove(ev(2,150,100,stage));stage.events.pointercancel(ev(2,150,100,stage));assert.equal(stage.capture,null);
    selectors['[data-graph-filter]'].events.change({target:{value:'result'}});assert.equal(nodeElements[0].style.display,'');assert.equal(nodeElements[1].style.display,'none');assert.equal(nodeElements[2].style.display,'');
    stage.events.pointerdown(ev(3,100,100,nodeElements[2]));stage.events.pointerup(ev(3,100,100,nodeElements[2]));assert.equal(selectors['[data-graph-open]'].attrs.href,'/work/W/saved?work_id=S');
    assert.deepEqual(graph.nodes,nodes);assert.equal(graph.edges.length,1);
  } finally {delete globalThis.sessionStorage;delete globalThis.ResizeObserver;}
});
