import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {Ledger, LATEST_SCHEMA_VERSION} from '../src/ledger.js';
import {doctorDesktopUiComponent} from '../src/desktop-ui-component.js';
import {startAtlasUiServer} from '../src/ui-server.js';

function diagnosticDb(throwOnCheck = false) {
  const calls = [];
  let mapped = 65536;
  const ledger = Object.create(Ledger.prototype);
  ledger.stateDir = path.resolve('test/.tmp/nonexistent-diagnostics');
  ledger.dbPath = path.join(ledger.stateDir, 'ledger.sqlite');
  ledger.db = {
    exec(sql) {calls.push(sql); const match = sql.match(/mmap_size\s*=\s*(\d+)/u); if (match) mapped = Number(match[1]);},
    prepare(sql) {
      calls.push(sql);
      if (sql === 'PRAGMA mmap_size') return {get: () => ({mmap_size: mapped})};
      if (sql === 'PRAGMA user_version') return {get: () => ({user_version: LATEST_SCHEMA_VERSION})};
      if (sql === 'PRAGMA journal_mode') return {get: () => ({journal_mode:'wal'})};
      return {all() {if (throwOnCheck) throw Error('corrupt page'); return [{quick_check:'ok'}];}};
    },
  };
  return {ledger, calls, mapped: () => mapped};
}
test('Startup scans the whole database with temporary mapped reads and restores the connection setting', () => {
  const {ledger,calls,mapped} = diagnosticDb();
  assert.equal(ledger.diagnostics({integrityCheck:'quick'}).integrity,'ok');
  assert.ok(calls.some(sql => /mmap_size\s*=\s*1073741824/u.test(sql)));
  assert.ok(calls.includes('PRAGMA quick_check'), 'Do not replace a full database check with a sample');
  assert.equal(mapped(),65536);
});
test('Failed integrity scanning releases the temporary mapping and preserves the error', () => {
  const {ledger,calls,mapped} = diagnosticDb(true);
  assert.throws(() => ledger.diagnostics({integrityCheck:'quick'}),/corrupt page/u);
  assert.ok(calls.some(sql => /mmap_size\s*=\s*1073741824/u.test(sql)));
  assert.equal(mapped(),65536);
});
test('Startup dependency discovery avoids importing analysis libraries; doctor still imports them', () => {
  fs.mkdirSync('test/.tmp',{recursive:true});
  const root = fs.mkdtempSync(path.resolve('test/.tmp/startup-probe-'));
  const python = path.join(root,'python.exe'); fs.writeFileSync(python,'fixture');
  const sources = [];
  const runProcess = (executable,args) => {
    if (args[0] === '--version') return {status:0,stdout:'Python 3.14.4',stderr:''};
    sources.push(args[1]);
    return {status:0,stdout:JSON.stringify({pywebview:'6.2.1',pandas:'3.0.1',pypdf:'6.14.2',pdfplumber:'0.11.10'}),stderr:''};
  };
  try {
    assert.equal(doctorDesktopUiComponent({installationRoot:root,runtimeRoot:process.cwd(),configuredPath:python,runProcess,probeMode:'startup'}).status,'ready');
    assert.match(sources[0],/find_spec/u);
    assert.doesNotMatch(sources[0],/import pandas|import webview/u);
    assert.equal(doctorDesktopUiComponent({installationRoot:root,runtimeRoot:process.cwd(),configuredPath:python,runProcess}).status,'ready');
    assert.match(sources[1],/import pandas/u);
    assert.equal(doctorDesktopUiComponent({installationRoot:root,runtimeRoot:process.cwd(),configuredPath:python,probeMode:'startup',
      runProcess(executable,args) {return args[0] === '--version' ? {status:0,stdout:'Python 3.14.4'} : {status:1,stdout:'',stderr:'pandas is missing'};}
    }).status,'unavailable');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('Page navigation reuses versioned CSS and validated script caches, while private HTML is never cached', async t => {
  fs.mkdirSync('test/.tmp',{recursive:true});
  const stateDir = fs.mkdtempSync(path.resolve('test/.tmp/ui-static-navigation-'));
  const server = await startAtlasUiServer({stateDir,rules:{}});
  t.after(async () => {await server.close(); fs.rmSync(stateDir,{recursive:true,force:true});});
  const page = await fetch(new URL('/toolbox',server.workspace_url));
  const html = await page.text();
  const stylesheet = html.match(/<link rel="stylesheet" href="(\/ui\/styles\/[a-f0-9]{64}\.css)">/u)?.[1];
  assert.ok(stylesheet,'Public styles must be outside the private page payload');
  assert.equal(page.headers.get('cache-control'),'no-store');
  assert.match(page.headers.get('content-security-policy'),/style-src 'self' 'unsafe-inline'/u);
  const css = await fetch(new URL(stylesheet,server.workspace_url));
  assert.equal(css.status,200); assert.match(css.headers.get('cache-control'),/immutable/u);
  const cssText = await css.text(); assert.match(cssText,/toolbox-tool-card/u); assert.match(cssText,/prefers-reduced-motion/u);
  assert.ok(html.length < cssText.length / 2,'Every page must avoid retransmitting the large public stylesheet');
  const again = await fetch(new URL(stylesheet,server.workspace_url),{headers:{'if-none-match':css.headers.get('etag')}});
  assert.equal(again.status,304);
  const script = await fetch(new URL('/ui.js',server.workspace_url));
  assert.match(script.headers.get('cache-control'),/no-cache/u);
  assert.ok(script.headers.get('etag')); await script.arrayBuffer();
  assert.equal((await fetch(new URL('/ui.js',server.workspace_url),{headers:{'if-none-match':script.headers.get('etag')}})).status,304);
  assert.equal((await fetch(new URL(stylesheet+'?path=../../state/ledger.sqlite',server.workspace_url))).status,404);
  assert.equal((await fetch(new URL('/ui/styles/'+ '0'.repeat(64)+'.css',server.workspace_url))).status,404);
});
