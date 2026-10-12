import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { renderSaveResultView } from '../src/ui/views/save-result-view.js';

const record = { save_id:'SAV-demo', status:'prepared', project:{id:'P',name:'示例'}, target:{path:'Result.html'}, source:{kind:'board_delivery'}, verification:{} };
test('Board HTML preview renders in a network-blocked sandbox and retains Save confirmation identity',()=>{
 const document='<html><head></head><body><h1>说明</h1><script>bad()</script><img src="https://example.invalid/pixel"></body></html>';
 const page=renderSaveResultView({save:record,csrf:'csrf-preview',preview_revision:'revision-preview',portable_preview:{html:document,bytes:document.length}}, {locale:'zh-CN'});
 assert.match(page,/<iframe[^>]+sandbox=""/u);
 assert.doesNotMatch(page, /sandbox="[^"]*allow-/u);
 assert.match(page,/Content-Security-Policy/u);
 assert.match(page,/default-src &#39;none&#39;/u);
 assert.match(page,/referrerpolicy="no-referrer"/u);
 assert.match(page,/srcdoc="[^"]*&lt;script&gt;bad\(\)&lt;\/script&gt;/u);
 assert.match(page,/action="\/saves\/SAV-demo\/execute"/u);
 assert.match(page,/name="csrf" value="csrf-preview"/u);
 assert.match(page,/name="preview_revision" value="revision-preview"/u);
});

test('Board preview loader accepts only recorded Board HTML and verifies the bytes it actually reads',async t=>{
 const { boardDeliveryPreview }=await import('../src/ui/services/board-delivery-preview.js');
 fs.mkdirSync('test/.tmp',{recursive:true});const root=fs.mkdtempSync(path.resolve('test/.tmp/board-preview-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'candidate.blob');const html='<h1>原始候选</h1>';fs.writeFileSync(file,html);
 const sha256=crypto.createHash('sha256').update(html).digest('hex');let calls=0;
 const service={candidateSnapshot(id){calls++;assert.equal(id,record.save_id);return {path:file,sha256,bytes:fs.statSync(file).size};}};
 assert.equal(boardDeliveryPreview(service,{...record,source:{kind:'other'}}),null);
 assert.equal(boardDeliveryPreview(service,{...record,target:{path:'file.md'}}),null);
 assert.equal(calls,0);
 assert.equal(boardDeliveryPreview(service,record).html,html);
 fs.writeFileSync(file,'被后改的内容');
 assert.throws(()=>boardDeliveryPreview(service,record),/changed/u);
});

test('Board HTML preview is bounded and leaves large candidates unchanged',async t=>{
 const { boardDeliveryPreview }=await import('../src/ui/services/board-delivery-preview.js');
 fs.mkdirSync('test/.tmp',{recursive:true});const root=fs.mkdtempSync(path.resolve('test/.tmp/board-preview-cap-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'large.blob');const bytes=Buffer.alloc(1024*1024+1,65);fs.writeFileSync(file,bytes);
 const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
 const service={candidateSnapshot(){return{path:file,sha256,bytes:bytes.length};}};
 const preview=boardDeliveryPreview(service,record);assert.equal(preview.html,undefined);assert.equal(preview.bounded,true);
 const page=renderSaveResultView({save:record,portable_preview:preview},{locale:'zh-CN'});
 assert.match(page,/体积较大/u);assert.doesNotMatch(page,/<iframe/u);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),sha256);
});
