import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateContentPython } from './python-runtime.js';

const LIMIT = 8 * 1024 * 1024;
const pythonRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'python', 'src');
function refused() {
  return Object.assign(new Error('This Gemini share response could not be read. Export its text and retry.'), {
    code: 'ATLAS_CAPTURE_EXPORT_REQUIRED', reason: 'format_unrecognized', details: { reason: 'format_unrecognized' },
  });
}
function validate(result, shareId) {
  if (!result || result.schema !== 'keeproot.gemini-share.v1' || result.completeness !== 'shared_text_only'
    || result.conversation_id !== shareId || !(result.title === null || typeof result.title === 'string')
    || !Array.isArray(result.messages) || !result.messages.length || result.messages.length % 2) throw refused();
  const expected = ['message_id', 'parent_message_id', 'role', 'content'];
  for (const [index, message] of result.messages.entries()) {
    if (!message || Object.keys(message).length !== expected.length || expected.some(key => !Object.hasOwn(message, key))
      || message.message_id !== null || message.parent_message_id !== null
      || message.role !== (index % 2 ? 'assistant' : 'user') || typeof message.content !== 'string'
      || !message.content.trim() || Buffer.byteLength(message.content) > LIMIT) throw refused();
  }
  if (Object.keys(result).length !== 5) throw refused();
  return result;
}

export async function parseGeminiShare(body, shareId, { installationRoot = process.env.ATLAS_HOME ?? null, pythonPath = null, pythonSourceRoot = pythonRoot } = {}) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > LIMIT || typeof shareId !== 'string'
    || !shareId.length || shareId.length > 256 || /[\x00-\x1f]/u.test(shareId)) throw refused();
  const python = pythonPath ?? locateContentPython({ installationRoot });
  if (!python) throw refused();
  const input = JSON.stringify({ body, share_id: shareId });
  if (Buffer.byteLength(input) > 16 * 1024 * 1024) throw refused();
  return new Promise((resolve, reject) => {
    let child; let timer; let done = false; let bytes = 0;
    const output = [];
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (error) { child?.kill(); reject(refused()); } else resolve(value);
    };
    try {
      child = spawn(python, ['-B', '-m', 'atlas_content.gemini_share'], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: pythonSourceRoot, PYTHONUTF8:'1', PYTHONIOENCODING:'utf-8' },
      });
      timer = setTimeout(() => finish(refused()), 20_000);
      child.on('error', () => finish(refused()));
      child.stdin.on('error', () => finish(refused()));
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > LIMIT) finish(refused());
        else if (!done) output.push(chunk);
      });
      child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > LIMIT) finish(refused()); });
      child.on('close', code => {
        if (done) return;
        if (code !== 0) return finish(refused());
        try { finish(null, validate(JSON.parse(Buffer.concat(output).toString('utf8')), shareId)); }
        catch { finish(refused()); }
      });
      child.stdin.end(input);
    } catch { finish(refused()); }
  });
}
