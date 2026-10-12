// Run from an isolated directory inside test/.tmp; never install in the repo root.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const cwd=process.cwd();
if (!cwd.replaceAll('\\','/').includes('/test/.tmp/')) throw Error('Build inside test/.tmp only.');
const require=createRequire(path.join(cwd,'package.json'));
const {build}=require('esbuild');
const directory=path.dirname(fileURLToPath(import.meta.url));
await build({entryPoints:[path.join(directory,'editor-entry.js')],outfile:path.join(directory,'reader-editor.js'),
  nodePaths:[path.join(cwd,'node_modules')],bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',legalComments:'eof'});
const lock=JSON.parse(fs.readFileSync(path.join(cwd,'package-lock.json'),'utf8'));
const notices=[];
for (const [name,metadata] of Object.entries(lock.packages)) {
  if (!name.startsWith('node_modules/') || name.includes('esbuild')) continue;
  const location=path.join(cwd,name);
  const license=['LICENSE','LICENSE.md','LICENSE.txt'].find(file=>fs.existsSync(path.join(location,file)));
  if (!license) throw Error('Missing license for '+name);
  notices.push(`${name.slice(13)} ${metadata.version}\n${fs.readFileSync(path.join(location,license),'utf8')}`);
}
fs.writeFileSync(path.join(directory,'THIRD-PARTY-NOTICES.txt'),notices.join('\n\n---\n\n'));
