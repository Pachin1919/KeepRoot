import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function captureNetworkFailure(error, reason = null) {
  if (error?.code === 'ATLAS_CAPTURE_NETWORK') return error;
  const codes = [];
  const visit = (value, depth = 0) => {
    if (!value || depth > 4) return;
    codes.push(String(value.code ?? value.name ?? ''));
    visit(value.cause, depth + 1);
    if (Array.isArray(value.errors)) value.errors.slice(0, 8).forEach(item => visit(item, depth + 1));
  };
  visit(error);
  reason ??= codes.some(code => /TIMEOUT|ETIMEDOUT|AbortError|TimeoutError/u.test(code)) ? 'connection_timeout'
    : codes.some(code => /ENOTFOUND|EAI_AGAIN/u.test(code)) ? 'dns_failure'
      : codes.some(code => /CERT|TLS|SSL/u.test(code)) ? 'tls_failure' : 'network_error';
  return Object.assign(new Error(`failed: ${reason}`), {code:'ATLAS_CAPTURE_NETWORK',details:{status:'failed',reason}});
}

function readWindowsProxy() {
  const executable = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $p=Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -ErrorAction SilentlyContinue; [pscustomobject]@{enabled=[bool]$p.ProxyEnable;server=[string]$p.ProxyServer;bypass=[string]$p.ProxyOverride;pac=[string]$p.AutoConfigURL}|ConvertTo-Json -Compress";
  const result = spawnSync(executable, ['-NoProfile','-NonInteractive','-Command',command], {encoding:'utf8',windowsHide:true,timeout:3000,maxBuffer:32*1024});
  if (result.error || result.status !== 0) throw captureNetworkFailure(null, 'proxy_settings_unavailable');
  try { return JSON.parse(result.stdout.trim()); } catch { throw captureNetworkFailure(null, 'proxy_settings_unavailable'); }
}

function proxyUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    if (!['http:','https:'].includes(url.protocol) || !url.hostname || (url.pathname && url.pathname !== '/') || url.search || url.hash) throw new Error();
    return url.toString();
  } catch { throw captureNetworkFailure(null, 'proxy_configuration'); }
}

// Configure once, before the first real capture request. No system/environment writes.
export function createCaptureNetworkConfigurator({platform=process.platform,env=process.env,readSystemProxy=readWindowsProxy,applyProxy=http.setGlobalProxyFromEnv} = {}) {
  let initialization;
  return () => initialization ??= (async () => {
    let httpProxy = env.http_proxy ?? env.HTTP_PROXY ?? '';
    let httpsProxy = env.https_proxy ?? env.HTTPS_PROXY ?? '';
    let bypass = env.no_proxy ?? env.NO_PROXY ?? '';
    let mode = 'direct';
    if (httpProxy || httpsProxy) mode = 'environment_proxy';
    else if (env.ALL_PROXY || env.all_proxy) throw captureNetworkFailure(null, 'proxy_configuration');
    else if (platform === 'win32') {
      const system = await readSystemProxy();
      if (system.enabled) {
        const server = String(system.server ?? '').trim();
        if (server.includes('=')) {
          const entries = Object.fromEntries(server.split(';').filter(Boolean).map(entry => {
            const split = entry.indexOf('='); return [entry.slice(0, split).trim().toLowerCase(),entry.slice(split + 1).trim()];
          }));
          httpProxy = entries.http ?? ''; httpsProxy = entries.https ?? '';
        } else httpProxy = httpsProxy = server;
        if (!httpProxy && !httpsProxy) throw captureNetworkFailure(null, 'proxy_configuration');
        bypass = String(system.bypass ?? '').split(';').filter(value => value && value !== '<local>').join(',');
        mode = 'windows_proxy';
      } else if (system.pac) throw captureNetworkFailure(null, 'proxy_pac_unsupported');
    }
    if (mode !== 'direct') {
      if (typeof applyProxy !== 'function') throw captureNetworkFailure(null, 'proxy_requires_node_24_14');
      const proxyEnv = {HTTP_PROXY:proxyUrl(httpProxy),HTTPS_PROXY:proxyUrl(httpsProxy),NO_PROXY:['localhost','127.0.0.1','::1',bypass].filter(Boolean).join(',')};
      try { applyProxy(proxyEnv); } catch { throw captureNetworkFailure(null, 'proxy_configuration'); }
    }
    return Object.freeze({mode});
  })();
}

export const configureCaptureNetwork = createCaptureNetworkConfigurator();
