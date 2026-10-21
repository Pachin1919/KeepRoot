import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGeminiShare } from '../src/gemini-share-parser.js';
import { fetchPublicDocument } from '../src/public-web-capture.js';
import { createCaptureSourceService } from '../src/capture-source-service.js';
import { Registry } from '../src/registry.js';
import { createSaveService } from '../src/save-service.js';
import fs from 'node:fs';
import path from 'node:path';

const shareId = '012345abcdef';
const refusal = error => error.code === 'ATLAS_CAPTURE_EXPORT_REQUIRED' && error.reason === 'format_unrecognized'
  && !error.message.includes('SECRET');
function turn(prompt = 'Question', answer = 'Answer') {
  return [null, null, [[prompt]], [[[null, [answer], { media: 'SECRET media', citations: ['SECRET citation'] }]]]];
}
function frame(turns = [turn()], options = {}) {
  const root = [null, turns, [null, 'Shared title'], options.shareId ?? shareId];
  const row = ['wrb.fr', options.rpc ?? 'ujx1Bf', options.payload === undefined ? JSON.stringify([root]) : options.payload];
  const body = JSON.stringify([row, ['di', 1]]);
  return ")]}'\n" + (body.length + 2) + '\n' + body + '\n';
}

test('Gemini RPC parser preserves original text and emits only the text-only contract', async () => {
  const prompt = '  Question\n\n中文 🙂  ';
  const answer = '```python\n  print("中文")\n```\n\n| a | b |\n|---|---|\n  ';
  const result = await parseGeminiShare(frame([turn(prompt, answer)]), shareId);
  assert.deepEqual(result, { schema: 'keeproot.gemini-share.v1', title: 'Shared title', conversation_id: shareId,
    messages: [
      { message_id: null, parent_message_id: null, role: 'user', content: prompt },
      { message_id: null, parent_message_id: null, role: 'assistant', content: answer },
    ], completeness: 'shared_text_only' });
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  const doubled = await parseGeminiShare(frame([turn(), turn('second', 'answer 2')]), shareId);
  assert.equal(doubled.messages.length, 4);
  const diagnostics = JSON.stringify([['di', 1], ['af.httprm', 2]]);
  const multiFrame = ")]}'\n" + diagnostics.length + '\n' + diagnostics + '\n' + frame().slice(4);
  assert.equal((await parseGeminiShare(multiFrame, shareId)).messages.length, 2);
});

test('Gemini RPC parser refuses missing, deleted, malformed and partial conversations', async () => {
  for (const body of [ '', 'SECRET malformed', ")]}'\n[]", frame([], {}), frame([turn()], { rpc: 'other' }),
    frame([turn()], { payload: null }), frame([turn()], { payload: 'SECRET invalid' }),
    frame([turn()], { payload: JSON.stringify([null]) }), frame([turn('Question', '')]),
    frame([turn(null, 'Answer')]), frame([turn(), [null]]), frame([turn()], { shareId: 'foreign' }),
    ")]}'\n" + JSON.stringify([['wrb.fr', 'ujx1Bf', 42]]), frame() + 'SECRET broken trailing frame',
  ]) await assert.rejects(parseGeminiShare(body, shareId), refusal);
});

test('Gemini RPC parser bounds input and refuses unavailable Python without exposing diagnostics', async () => {
  await assert.rejects(parseGeminiShare('x'.repeat(8 * 1024 * 1024 + 1), shareId), refusal);
  await assert.rejects(parseGeminiShare('\x00'.repeat(4 * 1024 * 1024), shareId), refusal);
  await assert.rejects(parseGeminiShare(frame(), shareId, { pythonPath: 'SECRET-not-an-interpreter' }), refusal);
  await assert.rejects(parseGeminiShare(frame(), ''), refusal);
});

test('Gemini short URL uses bounded public RPC, preserves wire evidence, and both capture consumers prepare text', async t=>{
  const calls=[];const body=frame([turn('问题','```python\n  print(1)\n```')]);
  const fetchImpl=async(url,options)=>{
    calls.push({url:String(url),options});
    if(new URL(url).hostname==='share.gemini.google')return new Response(null,{status:302,headers:{location:'https://gemini.google.com/share/'+shareId}});
    assert.equal(options.method,'POST');assert.match(String(url),/rpcids=ujx1Bf/u);
    assert.ok(!options.headers.authorization&&!options.headers.cookie);
    return new Response(body,{headers:{'content-type':'application/json'}});
  };
  const lookupHost=async()=>[{address:'93.184.216.34',family:4}];
  const fetched=await fetchPublicDocument('https://share.gemini.google/token',{fetchImpl,lookupHost,includeResponseBytes:true});
  assert.equal(fetched.response_bytes.toString('utf8'),body);assert.equal(fetched.capture.messages.length,2);assert.equal(calls.length,2);
  const root=fs.mkdtempSync(path.resolve('test/.tmp/gemini-consumers-'));
  const stateDir=path.join(root,'state'),workspace=path.join(root,'workspace');fs.mkdirSync(path.join(workspace,'A/Sources'),{recursive:true});
  const registry=new Registry({stateDir}),adopted=registry.adoptRoot({rootPath:workspace,rootType:'project_workspace',contentPolicy:'bounded_content'});
  const project=registry.create({name:'Gemini fixture',currentPath:'A'});registry.attachRoot(project.project_id,{rootId:adopted.root_id,relativePath:'A',reason:'fixture'});
  const save=createSaveService({stateDir}),capture=createCaptureSourceService({stateDir,registry,saveService:save,fetchImpl,lookupHost});
  t.after(()=>{capture.dispose();save.dispose();registry.dispose();});
  const options={url:'https://share.gemini.google/token',projectId:project.project_id,folder:'Sources',caller:{tool:'fixture-host',client_run_id:'gemini-consumers'}};
  const md=await capture.prepareMarkdown({...options,name:'Gemini.md',requestKey:'md'});
  const text=fs.readFileSync(save.candidateSnapshot(md.save_id).path,'utf8');assert.match(text,/## Gemini/u);assert.match(text,/  print\(1\)/u);
  const source=await capture.prepare({...options,name:'Gemini.source.json',requestKey:'source'});
  const doc=JSON.parse(fs.readFileSync(save.candidateSnapshot(source.save_id).path,'utf8'));assert.equal(doc.raw.bytes,Buffer.byteLength(body));assert.equal(doc.capture_mode,'gemini_share');
  assert.equal(doc.normalized.messages.length,2);assert.match(doc.readable,/## Gemini/u);
});
