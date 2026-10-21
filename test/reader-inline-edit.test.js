import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { renderResourceReaderView } from '../src/ui/views/resource-reader-view.js';

function editorHarness({withGraph=false,defaultEdit=false}={}) {
  const code=fs.readFileSync(new URL('../src/ui/client.js',import.meta.url),'utf8');
  const start=code.indexOf('function bindReaderInlineEditor('),end=code.indexOf('\nconst readerSurface =',start);
  const handlers={},status={hidden:true},requests=[];
  let phase=defaultEdit?'read':'edit',text='A',focuses=0,destroyed=0,pending;
  const buttons=[];
  const editor={dataset:{},readOnly:false,disabled:false,get value(){return text;},set value(value){text=value;},focus(){focuses++;}};
  const requestKey={value:'original-key'};
  const content={
    get innerHTML(){return JSON.stringify({phase,text});},set innerHTML(value){const snapshot=JSON.parse(value);phase=snapshot.phase;text=snapshot.text;},
    querySelector(selector){
      if(selector==='.reader-edit')return phase==='read'?null:{};
      if(selector==='.reader-text-editor')return phase==='edit'?editor:null;
      if(selector==='textarea')return phase==='edit'?editor:null;
      if(selector==='[name="request_key"]')return requestKey;
      return null;
    },querySelectorAll(){return [];},contains(){return true;},setAttribute(){},removeAttribute(){},focus(){},
    replaceChildren(node){phase=node.phase;if(node.text!==undefined)text=node.text;},
    cloneNode(){return {innerHTML:JSON.stringify({phase,text}),querySelectorAll:()=>[]};},
  };
  const toolbar={href:'/projects/P/resources/edit?resource_id=R&expected_sha256=old',
    ...(defaultEdit?{dataset:{readerReadHref:'/projects/P/resources/read?resource_id=R',readerEditLabel:'Edit',readerReadLabel:'Rendered reading'}}:{}),
    matches:selector=>selector==='[data-reader-inline-edit]',setAttribute(name,value){if(name==='href')this.href=value;else this[name]=value;}};
  let graphDestroyed=0,graphMounted=null,graphHost={version:'old',dispatchEvent(event){if(event.type==='graph-destroy')graphDestroyed++;}};
  const graph={hidden:true,querySelector:()=>graphHost,replaceChildren(node){graphHost=node;}};
  const graphToggle={dataset:{readLabel:'Read',graphLabel:'Graph'},addEventListener(){},setAttribute(){}};
  status.append=()=>{};
  const surface={dataset:{readerResourceId:'R',readerEditError:'Draft kept',readerDefaultEdit:String(defaultEdit),readerEditDiscard:'Discard draft?',readerEditKeep:'Keep',readerEditDiscardAction:'Discard'},
    classList:{toggle(){}},
    querySelector:selector=>selector==='#reader-content'?content:selector==='[data-reader-edit-status]'?status:selector==='.reader-toolbar-actions [data-reader-inline-edit]'?toolbar:withGraph&&selector==='#reader-graph'?graph:withGraph&&selector==='[data-reader-graph-toggle]'?graphToggle:null,
    addEventListener:(kind,fn)=>{handlers[kind]=fn;}};
  let responseModel;
  const context={surface,URL,URLSearchParams,AbortSignal,Event,crypto:{randomUUID:()=> 'new-key'},dirtyDraftForms:new Set(),
    FormData:class extends URLSearchParams{constructor(form){super({resource_id:'R',...form.fields});if(phase==='edit')this.set('text',text);}},
    document:{querySelector:()=>null,createElement:()=>{const button={addEventListener:(_,fn)=>{button.click=fn;}};buttons.push(button);return button;}},
    window:{location:{pathname:'/projects/P/resources/read',href:'http://localhost/projects/P/resources/read?resource_id=R',origin:'http://localhost'},history:{state:null,replaceState(){}},AtlasReaderEditor:{destroy(){destroyed++;},mount(){},focus(){focuses++;},text(){return phase==='edit'?text:undefined;}}},
    DOMParser:class{parseFromString(){const node={phase:responseModel.phase,text:responseModel.text};const replacement={childNodes:[node],querySelector:selector=>selector==='.reader-edit'&&node.phase!=='read'?{}:null};
      const incoming={dataset:{readerResourceId:'R'},querySelector:selector=>selector==='#reader-content'?replacement:selector==='.reader-toolbar-actions [data-reader-inline-edit]'?{getAttribute:()=>responseModel.editHref}:withGraph&&selector==='#reader-graph'?{childNodes:[{version:responseModel.graphVersion,dispatchEvent(event){if(event.type==='graph-destroy')graphDestroyed++;}}]}:null};
      return {querySelector:selector=>selector==='[data-resource-reader]'?incoming:null};}},
    fetch:async(url,options)=>{requests.push({url:String(url),body:options.body,method:options.method});return new Promise(resolve=>{pending=resolve;});},
  };
  context.window.AtlasResourceGraph={mount(host){graphMounted=host;}};
  const initial=vm.runInNewContext(code.slice(start,end)+'\nbindReaderInlineEditor(surface);',context);
  return {content,toolbar,requests,status,context,initial,buttons,
    get text(){return text;},get phase(){return phase;},get destroyed(){return destroyed;},get focuses(){return focuses;},
    get graphDestroyed(){return graphDestroyed;},get graphMounted(){return graphMounted;},
    type(value){text=value;handlers.input({target:{matches:()=>true}});},
    click(){return handlers.click({button:0,preventDefault(){},target:{closest:()=>toolbar}});},
    submit(action='preview'){const form={action:'http://localhost/projects/P/resources/edit/'+action,fields:{},matches:()=>true,querySelector:selector=>selector==='.reader-text-editor'||selector==='textarea'?phase==='edit'?editor:null:null};return handlers.submit({target:form,preventDefault(){}});},
    respond(model){responseModel=model;pending({ok:true,status:200,url:'http://localhost/projects/P/resources/'+(model.phase==='read'?'read?resource_id=R&manual_update_id=U':'edit?resource_id=R'),text:async()=>''});},
  };
}

test('normal opening loads the existing editor once without focus, preview, or save; rendered return stays rendered',async()=>{
  const h=editorHarness({defaultEdit:true});
  assert.equal(h.requests.length,1);
  assert.equal(new URL(h.requests[0].url).pathname,'/projects/P/resources/edit');
  assert.equal(new URL(h.requests[0].url).searchParams.get('expected_sha256'),'old');
  assert.equal(h.requests[0].method,undefined);
  h.respond({phase:'edit',text:'# Original'});await h.initial;
  assert.equal(h.phase,'edit');assert.equal(h.text,'# Original');assert.equal(h.focuses,0);
  assert.equal(h.toolbar.textContent,'Rendered reading');assert.equal(h.toolbar['aria-current'],'true');
  const rendered=h.click();h.respond({phase:'read'});await rendered;
  assert.equal(h.phase,'read');assert.equal(h.toolbar.textContent,'Edit');
  assert.equal(h.requests.length,2);assert.equal(h.context.surface.dataset.readerDefaultEdit,'false');
});

test('render toggle preserves a dirty automatic editor until an explicit discard',async()=>{
  const h=editorHarness({defaultEdit:true});h.respond({phase:'edit',text:'A'});await h.initial;
  h.type('B');await h.click();
  assert.equal(h.requests.length,1);assert.equal(h.phase,'edit');assert.equal(h.text,'B');
  assert.equal(h.status.textContent,'Discard draft?');
  h.buttons[1].click();assert.equal(h.requests.length,1);assert.equal(h.text,'B');
  const discard=h.buttons[0].click();h.respond({phase:'read'});await discard;
  assert.equal(h.phase,'read');assert.equal(h.requests.length,2);
});

test('default editing opts in only normal supported text openings and keeps Markdown fallback',()=>{
  const model={project:{id:'P',name:'Project'},reader:{resource_id:'R',name:'note.md',relative_path:'note.md',kind:'markdown',text:'# Rendered',sha256:'hash'}};
  const render=extra=>renderResourceReaderView({...model,...extra},{locale:'en'});
  assert.match(render({}),/data-reader-default-edit="true"/u);
  assert.match(render({reader:{...model.reader,kind:'text',relative_path:'note.txt'}}),/data-reader-default-edit="true"/u);
  assert.match(render({}),/<h1[^>]*>Rendered<\/h1>/u);
  for(const extra of [{notice:'unavailable'},{graphMode:true},{manualUpdate:{update_id:'U',status:'undone'}},{manual:{readHref:'/projects/P/resources/read?resource_id=R'}},{reader:{...model.reader,kind:'image',relative_path:'photo.png'}},{reader:{...model.reader,relative_path:'data.csv'}}]) {
    assert.match(render(extra),/data-reader-default-edit="false"/u);
  }
});

test('saved Reader updates only its version action and opens a second edit with the new Hash',async()=>{
  const h=editorHarness();const preview=h.submit();h.respond({phase:'review'});await preview;
  const save=h.submit('confirm');
  h.respond({phase:'read',editHref:'/projects/P/resources/edit?resource_id=R&expected_sha256=new'});await save;
  assert.equal(h.phase,'read');assert.equal(h.toolbar.href,'/projects/P/resources/edit?resource_id=R&expected_sha256=new');
  const second=h.click();assert.equal(new URL(h.requests[2].url).searchParams.get('expected_sha256'),'new');
  h.respond({phase:'edit',text:'Saved A'});await second;
  assert.equal(h.phase,'edit');assert.equal(h.text,'Saved A');assert.equal(h.status.hidden,true);
});

test('successful readback replaces the graph model and releases the old canvas',async()=>{
  const h=editorHarness({withGraph:true});
  const preview=h.submit();h.respond({phase:'review'});await preview;
  assert.equal(h.graphDestroyed,0);
  const save=h.submit('confirm');h.respond({phase:'read',editHref:'/projects/P/resources/edit?resource_id=R&expected_sha256=new',graphVersion:'saved-source'});await save;
  assert.equal(h.graphDestroyed,1);assert.equal(h.graphMounted.version,'saved-source');
  const undo=h.submit('undo');h.respond({phase:'read',editHref:'/projects/P/resources/edit?resource_id=R&expected_sha256=old',graphVersion:'restored-source'});await undo;
  assert.equal(h.graphMounted.version,'restored-source');
});

test('Reader keeps B after restoring A from review and after a preview response races with B',async()=>{
  const h=editorHarness();let preview=h.submit();
  assert.equal(h.requests[0].body.get('text'),'A');h.respond({phase:'review'});await preview;
  assert.equal(h.phase,'review');await h.click();assert.equal(h.text,'A');assert.equal(h.phase,'edit');
  h.type('B');const before=h.destroyed;await h.click();assert.equal(h.text,'B');assert.equal(h.destroyed,before);
  h.type('A');preview=h.submit();h.type('B');h.respond({phase:'review'});await preview;
  assert.equal(h.phase,'edit');assert.equal(h.text,'B');assert.equal(h.status.textContent,'Draft kept');
  const after=h.destroyed;await h.click();assert.equal(h.text,'B');assert.equal(h.destroyed,after);assert.ok(h.focuses>0);
  assert.equal(h.requests.length,2);
});

test('text Reader exposes in-place editing with its own Resource identity', () => {
  const html = renderResourceReaderView({ project: { id: 'P', name: 'Project' }, reader: { resource_id: 'R', name: 'note.md', relative_path: 'note.md', sha256: 'hash', kind: 'markdown', text: '# Note' }, returnHref: '/projects/P/resources' }, { locale: 'zh-CN', csrfToken: 'token' });
  assert.match(html, /data-reader-resource-id="R"/u);
  assert.match(html, /data-reader-inline-edit/u);
  assert.match(html, /data-reader-edit-error/u);
});

test('a Reader response arriving after new input preserves the newer draft and its editor', async () => {
  const code=fs.readFileSync(new URL('../src/ui/client.js',import.meta.url),'utf8');
  const start=code.indexOf('function bindReaderInlineEditor('),end=code.indexOf('\nconst readerSurface =',start);
  const handlers={},status={hidden:true,textContent:''};
  let resolveResponse,destroyed=0,replaced=0;
  const content={innerHTML:'newer draft',querySelector:()=>null,querySelectorAll:()=>[],setAttribute(){},removeAttribute(){},replaceChildren(){replaced++;}};
  const surface={dataset:{readerResourceId:'R',readerEditError:'Draft kept'},querySelector:selector=>selector==='#reader-content'?content:selector==='[data-reader-edit-status]'?status:null,addEventListener:(kind,fn)=>{handlers[kind]=fn;}};
  const replacement={querySelector:()=>true,childNodes:[]};
  const context={surface,URL,AbortSignal,dirtyDraftForms:new Set(),window:{location:{pathname:'/projects/P/resources/read',href:'http://localhost/projects/P/resources/read?resource_id=R',origin:'http://localhost'},AtlasReaderEditor:{destroy(){destroyed++;}}},
    DOMParser:class{parseFromString(){return {querySelector:selector=>selector==='[data-resource-reader]'?{dataset:{readerResourceId:'R'},querySelector:selector=>selector==='#reader-content'?replacement:null}:null};}},fetch:()=>new Promise(resolve=>{resolveResponse=resolve;})};
  vm.runInNewContext(code.slice(start,end)+'\nbindReaderInlineEditor(surface);',context);
  const pending=handlers.click({button:0,preventDefault(){},target:{closest:()=>({href:'/projects/P/resources/edit?resource_id=R',matches:()=>true})}});
  handlers.input({target:{matches:()=>true}});
  resolveResponse({ok:true,status:200,url:'http://localhost/projects/P/resources/edit?resource_id=R',text:async()=>''});
  await pending;
  assert.equal(content.innerHTML,'newer draft');assert.equal(replaced,0);assert.equal(destroyed,0);
  assert.equal(context.dirtyDraftForms.has(content),true);assert.equal(status.textContent,'Draft kept');
});

test('inline editor retains the current draft when a request fails, without navigating or retrying', async () => {
  const code = fs.readFileSync(new URL('../src/ui/client.js', import.meta.url), 'utf8');
  const start = code.indexOf('function bindReaderInlineEditor(');
  const end = code.indexOf('\nconst readerSurface =', start);
  assert.ok(start >= 0 && end > start);
  const handlers = {}, content = { innerHTML: 'unsaved draft', querySelector: () => null, setAttribute() {}, removeAttribute() {} }, message = { hidden: true, textContent: '' };
  const surface = { dataset: { readerResourceId: 'R', readerEditError: 'Draft kept' }, querySelector: selector => selector === '#reader-content' ? content : selector === '[data-reader-edit-status]' ? message : null, addEventListener: (kind, callback) => { handlers[kind] = callback; } };
  let requests = 0;
  const context = { surface, URL, AbortSignal, dirtyDraftForms: new Set([content]), window: { location: { href: 'http://localhost/projects/P/resources/read?resource_id=R', origin: 'http://localhost' } }, fetch: async () => { requests++; throw Error('offline'); } };
  vm.runInNewContext(code.slice(start, end) + '\nbindReaderInlineEditor(surface);', context);
  const link = { href: '/projects/P/resources/edit?resource_id=R', matches: selector => selector === '[data-reader-inline-edit]' };
  await handlers.click({ button: 0, preventDefault() {}, target: { closest: () => link } });
  assert.equal(requests, 1); assert.equal(content.innerHTML, 'unsaved draft');
  assert.equal(message.textContent, 'Draft kept'); assert.equal(message.hidden, false);
  assert.equal(context.dirtyDraftForms.has(content), true);
});

test('page submission overlay does not disable or duplicate an inline editing request', () => {
  const code = fs.readFileSync(new URL('../src/ui/client.js', import.meta.url), 'utf8');
  const start = code.indexOf("document.addEventListener('submit', (event) => {");
  const end = code.indexOf('\nconst workDraftConflict =', start);
  class Form { constructor() { this.dataset = {}; } closest() { return { dataset: { readerInlineReady: 'true' } }; } matches() { return true; } setAttribute() { throw Error('Inline form was disabled'); } }
  let handler;
  vm.runInNewContext(code.slice(start, end), { HTMLFormElement: Form, document: { addEventListener: (_,callback) => {handler=callback;}, createElement() {throw Error('Unexpected full-page status');} } });
  const form = new Form(); handler({target:form});
  assert.equal(form.dataset.atlasSubmitting, undefined);
});

test('same-resource readback keeps the receipt URL for refresh without navigating', async () => {
  const code = fs.readFileSync(new URL('../src/ui/client.js', import.meta.url), 'utf8');
  const start = code.indexOf('function bindReaderInlineEditor('), end = code.indexOf('\nconst readerSurface =', start);
  const handlers = {}, content = { querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, removeAttribute() {}, replaceChildren() {}, focus() {} }, status = { hidden: true };
  const surface = { dataset: { readerResourceId: 'R' }, querySelector: selector => selector === '#reader-content' ? content : selector === '[data-reader-edit-status]' ? status : null, addEventListener: (kind,callback) => {handlers[kind]=callback;} };
  const incoming = { dataset: { readerResourceId: 'R' }, querySelector: selector => selector === '#reader-content' ? {childNodes:[],querySelector:()=>null} : null };
  let address, settingsHref;
  const context = {surface, URL, AbortSignal, document:{querySelector:()=>({setAttribute:(_,value)=>{settingsHref=value;}})}, dirtyDraftForms: new Set(), DOMParser: class { parseFromString() {return {querySelector:selector=>selector==='[data-resource-reader]'?incoming:{getAttribute:()=>'/settings?project_id=P'}};} }, window: { location: {pathname:'/projects/P/resources/read',href:'http://localhost/projects/P/resources/read?resource_id=R&expected_sha256=old',origin:'http://localhost'}, history: {state:null,replaceState:(_,__,url)=>{address=url;}} }, fetch: async()=>({ok:true,status:200,url:'http://localhost/projects/P/resources/read?resource_id=R&manual_update_id=U',text:async()=>''}) };
  vm.runInNewContext(code.slice(start,end)+'\nbindReaderInlineEditor(surface);', context);
  await handlers.click({button:0,preventDefault(){},target:{closest:()=>({href:'/projects/P/resources/edit?resource_id=R',matches:()=>true})}});
  assert.equal(address,'/projects/P/resources/read?resource_id=R&manual_update_id=U');
  assert.equal(new URL(settingsHref,'http://localhost').searchParams.get('return_to'),address);
  assert.equal(status.hidden,true);
});
