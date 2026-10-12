import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { fetchPublicDocument } from '../src/public-web-capture.js';
import { createCaptureNetworkConfigurator, captureNetworkFailure } from '../src/capture-network.js';
import { toolboxErrorKey } from '../src/ui/toolbox-flow.js';
import { errorEnvelope } from '../src/protocol.js';

test('Public capture uses the configured Node proxy and still rejects a redirect into private scope', async t => {
  let hits = 0;
  const sockets = new Set();
  let redirect = false;
  const body = '<html><title>Proxy fixture</title><p>Captured by Keeproot.</p></html>';
  const server = http.createServer();
  server.on('connect', (request, socket) => {
    hits += 1; sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => socket.end(redirect
      ? 'HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'
      : 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: '+Buffer.byteLength(body)+'\r\nConnection: close\r\n\r\n'+body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let restore;
  t.after(async () => { restore?.(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  let configured = 0;
  const configureNetwork = async () => {
    if (!configured++) restore = http.setGlobalProxyFromEnv({HTTP_PROXY:'http://127.0.0.1:'+server.address().port,NO_PROXY:'localhost,127.0.0.1,::1'});
    return { mode: 'environment_proxy' };
  };
  const lookupHost = async () => [{address:'93.184.216.34',family:4}];
  const result = await fetchPublicDocument('http://capture-proxy.invalid/page', { lookupHost, configureNetwork, timeoutMs: 2000 });
  assert.match(result.capture.text, /Captured by Keeproot/u);
  assert.equal(result.network_mode, 'environment_proxy');
  assert.equal(hits, 1);
  redirect = true;
  await assert.rejects(fetchPublicDocument('http://capture-proxy.invalid/redirect', {lookupHost,configureNetwork,timeoutMs:2000}), /private|local/u);
  assert.equal(hits, 2, 'no third proxy request for the private redirect');
});

test('Capture exposes failed and a bounded connection-timeout reason without leaking the cause', async () => {
  const original = new TypeError('fetch failed', {cause:Object.assign(new Error('secret proxy credentials 1.2.3.4'), {code:'UND_ERR_CONNECT_TIMEOUT'})});
  await assert.rejects(fetchPublicDocument('https://public.example/page', {
    lookupHost:async () => [{address:'93.184.216.34',family:4}],
    fetchImpl:async () => { throw original; },
  }), error => {
    assert.equal(error.code, 'ATLAS_CAPTURE_NETWORK');
    assert.deepEqual(error.details, {status:'failed',reason:'connection_timeout'});
    assert.equal(error.message, 'failed: connection_timeout');
    assert.doesNotMatch(JSON.stringify(error), /secret|1\.2\.3\.4/u);
    return true;
  });
});

test('Windows manual proxy initializes once, preserves bypass and never returns proxy credentials', async () => {
  let reads=0, applies=0, configured;
  const configure=createCaptureNetworkConfigurator({platform:'win32',env:{},readSystemProxy:async()=>{
    reads++;return {enabled:true,server:'http=127.0.0.1:7800;https=http://user:secret@127.0.0.1:7801',bypass:'<local>;*.example.test'};
  },applyProxy:value=>{applies++;configured=value;}});
  const [a,b]=await Promise.all([configure(),configure()]);
  assert.deepEqual(a,{mode:'windows_proxy'});assert.equal(a,b);assert.equal(reads,1);assert.equal(applies,1);
  assert.equal(configured.HTTP_PROXY,'http://127.0.0.1:7800/');assert.equal(configured.HTTPS_PROXY,'http://user:secret@127.0.0.1:7801/');
  assert.match(configured.NO_PROXY,/localhost,127\.0\.0\.1,::1,\*\.example\.test/u);
  assert.doesNotMatch(JSON.stringify(a),/secret|7801/u);
});

test('Explicit proxy environment wins and unsupported proxy configurations fail without direct retry', async () => {
  let applied;
  const configure=createCaptureNetworkConfigurator({platform:'win32',env:{https_proxy:'http://proxy.example:8000',HTTPS_PROXY:'http://ignored.example:8001',NO_PROXY:'intranet.example'},readSystemProxy:()=>{throw new Error('must not read Windows settings');},applyProxy:value=>{applied=value;}});
  assert.equal((await configure()).mode,'environment_proxy');assert.equal(applied.HTTPS_PROXY,'http://proxy.example:8000/');assert.match(applied.NO_PROXY,/intranet/u);
  for(const settings of [{enabled:true,server:'socks=127.0.0.1:8000'},{enabled:true,server:'file:///secret'},{enabled:false,pac:'https://proxy.example/config.pac'}]) {
    const bad=createCaptureNetworkConfigurator({platform:'win32',env:{},readSystemProxy:()=>settings,applyProxy:()=>{throw new Error('must not apply');}});
    await assert.rejects(bad(),error=>error.code==='ATLAS_CAPTURE_NETWORK' && error.details.status==='failed');
  }
  await assert.rejects(createCaptureNetworkConfigurator({platform:'linux',env:{HTTPS_PROXY:'http://proxy.example:8000'},applyProxy:null})(),error=>error.details.reason==='proxy_requires_node_24_14');
  assert.equal((await createCaptureNetworkConfigurator({platform:'linux',env:{},applyProxy:null})()).mode,'direct');
});

test('Host and Toolbox get only failed plus a deterministic network reason', () => {
  for(const [code,reason,key] of [['UND_ERR_CONNECT_TIMEOUT','connection_timeout','network_timeout'],['ENOTFOUND','dns_failure','dns_failure'],['CERT_HAS_EXPIRED','tls_failure','tls_failure']]) {
    const error=captureNetworkFailure(new TypeError('fetch failed',{cause:Object.assign(new Error('credential text'),{code})}));
    const envelope=errorEnvelope('capture.fetch',error);assert.equal(envelope.ok,false);assert.deepEqual(envelope.error.details,{status:'failed',reason});
    assert.equal(toolboxErrorKey(error),key);assert.doesNotMatch(JSON.stringify(envelope),/credential/u);
  }
});
