import { installDesktopUiComponent } from '../src/desktop-ui-component.js';
import { locateInstalledRuntime } from '../src/runtime-install.js';

try {
 const args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--install-root')options.installationRoot=args[++i];
  else if(args[i]==='--python')options.sourcePython=args[++i];
  else throw Error('Use --install-root <existing installation> --python <Python 3.11+>.');
 }
 const current=locateInstalledRuntime(options.installationRoot);
 if(current.status!=='ready')throw Error('Desktop setup requires a verified existing Runtime.');
 const result=installDesktopUiComponent({...options,runtimeRoot:current.manifest.runtime_path});
 console.log(JSON.stringify(result));
 if(!['ready','already_installed'].includes(result.status))process.exitCode=1;
}catch(error){console.error(JSON.stringify({status:'failed',message:error.message}));process.exitCode=1;}
