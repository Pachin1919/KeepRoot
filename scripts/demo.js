import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {normalizeStateDir} from '../src/paths.js';
import {RUNTIME_HANDSHAKE_TIMEOUTS} from '../src/runtime-location.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const usage=`Keeproot fictional demonstration (Atlas Runtime; source or explicit installation)
  npm run demo -- --python <trusted-python-3.11+> [--serve]
  npm run demo -- --python <trusted-python-3.11+> --resume <demo-id> --serve
  node scripts/demo.js --install-root <explicit-installation> [--python <trusted-python>] [--resume <demo-id>] --serve
  npm run demo -- --help
Creates a new sample in test/.tmp and development state in .atlas/demo.
--resume reopens the same saved sample without recreating its Work or Result.
Preserves previous demonstrations. --serve uses an available loopback port;
it does not open a browser. Ctrl+C closes the server and retains results.
This is not real-Vault acceptance or a different-product Host test.`;

function options(args){
  const result={serve:false,python:null,resume:null,installRoot:null};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--help')result.help=true;
    else if(args[i]==='--serve')result.serve=true;
    else if(args[i]==='--python' && args[i+1] && !args[i+1].startsWith('--'))result.python=path.resolve(args[++i]);
    else if(args[i]==='--resume' && args[i+1] && !args[i+1].startsWith('--'))result.resume=args[++i];
    else if(args[i]==='--install-root' && args[i+1] && !args[i+1].startsWith('--'))result.installRoot=path.resolve(args[++i]);
    else throw Error(`Unknown or incomplete demo argument: ${args[i]}`);
  }
  return result;
}

function demoScope(installRoot){
  if(!installRoot)return {boundary:repo,stateParent:path.join(repo,'.atlas/demo'),sampleParent:path.join(repo,'test/.tmp'),runtimeRoot:repo,nodePath:process.execPath,nodeArgs:[],installRoot:null};
  const root=normalizeStateDir(path.resolve(installRoot),path.resolve(installRoot));
  // Allow all three bounded commands plus installation hashing and process startup.
  const locateBudget=Object.values(RUNTIME_HANDSHAKE_TIMEOUTS).reduce((total,budget)=>total+budget,0)+30000;
  const located=spawnSync(process.execPath,[path.join(repo,'scripts/runtime-manager.js'),'locate','--install-root',root],{cwd:repo,encoding:'utf8',windowsHide:true,timeout:locateBudget,maxBuffer:2*1024*1024});
  let receipt;try{receipt=JSON.parse(located.stdout??'');}catch{}
  if(located.error || located.status!==0 || receipt?.status!=='ready' || path.resolve(receipt.install_root??'')!==root)throw Error(`Explicit demo installation is unavailable: ${receipt?.message??receipt?.status??located.error?.message??'invalid receipt'}${receipt?.next_step?` Next: ${receipt.next_step}`:''}`);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'atlas-install.json'),'utf8'));
  if(path.resolve(manifest.runtime_path??'')!==path.join(root,'runtime') || path.resolve(manifest.state_path??'')!==path.join(root,'state'))throw Error('Demo installation paths do not match the selected root.');
  return {boundary:root,stateParent:path.join(root,'state/demos'),sampleParent:path.join(root,'demo-samples'),runtimeRoot:manifest.runtime_path,nodePath:manifest.node_path,nodeArgs:manifest.node_args??[],installRoot:root,runtimeSha256:manifest.runtime_sha256};
}

function demoPython(scope,python){
  return python??(scope.installRoot?path.join(scope.installRoot,'desktop-ui/venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'):null);
}

function demoEnvironment(scope,stateDir,python){
  const env={...process.env,ATLAS_STATE_DIR:stateDir,ATLAS_CONTENT_PYTHON:python,ATLAS_PYTHON:python};
  delete env.ATLAS_HOME;delete env.ATLAS_DESKTOP_PYTHON;delete env.ATLAS_TEST_PYTHON;
  if(scope.installRoot)env.ATLAS_HOME=scope.installRoot;
  return env;
}

export function loadProductDemo(id,{installRoot=null}={}){
  if(typeof id!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))throw Error('Resume requires the UUID demo-id printed by this script.');
  const scope=demoScope(installRoot);
  const state=normalizeStateDir(scope.boundary,path.join(scope.stateParent,id));
  const workspace=normalizeStateDir(scope.boundary,path.join(scope.sampleParent,`product-demo-${id}`,'workspace'));
  const file=path.join(state,'demo.json'),stat=fs.lstatSync(file);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.size>16384)throw Error('Demo manifest must be a bounded regular file.');
  const demo=JSON.parse(fs.readFileSync(file,'utf8'));
  const projectId=/^PRJ-[a-f0-9-]{36}$/i,boardId=/^BRD-[a-f0-9-]{36}$/i;
  if((demo.installation_root??null)!==scope.installRoot)throw Error('Demo manifest does not match the selected installation.');
  if(demo.schema!=='atlas.product-demo.v1' || demo.phase!=='ready' || path.resolve(demo.state_dir??'')!==state || path.resolve(demo.workspace??'')!==workspace || path.resolve(demo.project_path??'')!==path.join(workspace,'示例项目') || !projectId.test(demo.project_id) || !boardId.test(demo.board_id) || demo.board_href!==`/projects/${demo.project_id}/boards/${demo.board_id}`)throw Error('Demo manifest does not match its repository sample and identity. Partial preparation remains available for manual diagnosis.');
  if(demo.showcase!==undefined){
    const ids=['A1','A2','A3','B1','B2','B3','C1','C2','D1','D2','E1','E2','E3','E4','F1','F2','F3','F4','F5','F6'];
    const prefix=`/projects/${demo.project_id}`;
    const links={graph_href:`${prefix}/resources?resource_id=${demo.source_resource_id}&relation_depth=2&relation_status=active`,aggregate_href:`/work/${demo.aggregate_work_id}`,text_href:`${prefix}/resources/read?resource_id=${demo.text_resource_ids?.[0]}`,compare_href:`${prefix}/compare`,handoff_href:`${prefix}/handoffs/${demo.handoff_id}`,round_href:`${prefix}/rounds/${demo.round_id}`,index_href:`${prefix}/resources/read?resource_id=${demo.index_resource_id}`};
    if(demo.capture_demo!==undefined){
      if(demo.capture_demo!=='structured_export_v1_v2' || !Array.isArray(demo.capture_save_ids) || demo.capture_save_ids.length!==2 || demo.capture_save_ids.some(value=>!/^SAV-[a-f0-9-]{36}$/iu.test(value)) || demo.local_module_id!=='local.example-uppercase-prefix' || demo.local_module_enabled!==false)throw Error('Demo capture or Module identity does not match.');
      if(!Array.isArray(demo.capture_version_ids) || demo.capture_version_ids.length!==2 || demo.capture_version_ids.some(value=>!/^VER-[a-f0-9]{64}$/u.test(value)) || !Array.isArray(demo.capture_result_paths) || demo.capture_result_paths.length!==2 || demo.capture_result_paths.some((value,index)=>path.resolve(value)!==path.join(workspace,'示例项目','02_成果',index===0?'虚构聊天_v1.source.json':`虚构聊天_v2.${demo.capture_version_ids[1].slice(4,16)}.source.json`)))throw Error('Demo capture output paths do not match its versions.');
      Object.assign(links,{capture_href:`${prefix}/capture-source/${demo.capture_save_ids[0]}`,capture_changes_href:`${prefix}/capture-source/${demo.capture_save_ids[1]}?mode=changes`,local_module_href:`/modules?project_id=${demo.project_id}#local-tool-local.example-uppercase-prefix`});
    }
    if(demo.coverage_demo!==undefined){
      if(demo.coverage_demo!=='remaining_subsets_v1' || !projectId.test(demo.migration_project_id) || !/^RES-[a-f0-9-]{36}$/iu.test(demo.guidance_resource_id) || !/^[A-Za-z0-9_-]{1,100}$/u.test(demo.rule_change_id) || demo.row_candidate_status!=='pending' || path.resolve(demo.migration_project_path??'')!==path.join(workspace,'迁移练习'))throw Error('Demo supplemental materials do not match their identity.');
      Object.assign(links,{guidance_href:`${prefix}/resources/read?resource_id=${demo.guidance_resource_id}`,rules_href:`${prefix}/rules`,rule_preview_href:`${prefix}/rules/${demo.rule_change_id}`,search_href:`${prefix}/search?q=${encodeURIComponent('北区')}`,impact_href:links.graph_href,location_href:`${prefix}/content-location?resource_id=${demo.text_resource_ids[0]}`,row_candidates_href:`${prefix}/resources?mode=table`,migration_href:`/projects/${demo.migration_project_id}/move/new`,membership_href:`/projects/${demo.migration_project_id}/membership`,settings_href:`/settings?project_id=${demo.project_id}`});
    }
    if(demo.analysis_demo!==undefined){
      if(demo.analysis_demo!=='pivot_trend_v1' || !/^RES-[a-f0-9-]{36}$/iu.test(demo.analysis_resource_id) || path.resolve(demo.analysis_source_path??'')!==path.join(workspace,'示例项目','01_资料','地区类别月度.csv') || ['pivot','trend'].some(kind=>!/^DWT-[a-f0-9]{32}$/u.test(demo[`${kind}_work_id`]) || !/^SAV-[a-f0-9-]{36}$/iu.test(demo[`${kind}_save_id`]) || path.resolve(demo[`${kind}_result_path`]??'')!==path.join(workspace,'示例项目','02_成果',kind==='pivot'?'地区类别_透视.csv':'地区金额_月度趋势.csv')))throw Error('Demo analysis paths or identities do not match.');
      Object.assign(links,{pivot_href:`/work/${demo.pivot_work_id}`,trend_href:`/work/${demo.trend_work_id}`});
    }
    if(!Array.isArray(demo.showcase) || demo.showcase.length!==20 || demo.showcase.some((item,index)=>item.capability!==ids[index] || !['ready','subset_ready','candidate_pending','material_pending','installed_disabled','not_demonstrated','real_host_pending','default_off'].includes(item.status) || typeof item.title!=='string' || typeof item.expected!=='string') || Object.entries(links).some(([field,href])=>demo[field]!==href || /undefined|\.\.|[\\\\]/u.test(href)) || demo.showcase.some(item=>item.href!==null && ![demo.board_href,...Object.values(links)].includes(item.href)) || path.resolve(demo.index_path??'')!==path.join(workspace,'示例项目','演示入口.md') || path.resolve(demo.aggregate_result_path??'')!==path.join(workspace,'示例项目','02_成果','地区金额_汇总.csv'))throw Error('Demo showcase paths or links do not match its identity.');
    const analysisLinks=[{title:'地区×类别透视、占比和排名',href:demo.pivot_href},{title:'月度趋势与期间变化',href:demo.trend_href}];
    if(demo.showcase.some(item=>item.links!==undefined && (demo.analysis_demo!=='pivot_trend_v1' || item.capability!=='E2' || JSON.stringify(item.links)!==JSON.stringify(analysisLinks))) || demo.analysis_demo==='pivot_trend_v1' && JSON.stringify(demo.showcase.find(item=>item.capability==='E2').links)!==JSON.stringify(analysisLinks))throw Error('Demo analysis links do not match its Work identities.');
  }
  return {...demo,demo_id:id};
}

export function prepareProductDemo({python,installRoot=null}){
  // Validate both parents before creating anything, including test/.tmp.
  const id=crypto.randomUUID();
  const scope=demoScope(installRoot);python=demoPython(scope,python);
  const stateDir=normalizeStateDir(scope.boundary,path.join(scope.stateParent,id));
  const sampleDir=normalizeStateDir(scope.boundary,path.join(scope.sampleParent,`product-demo-${id}`));
  if(!python || !fs.lstatSync(python).isFile())throw Error('Provide --python with a trusted Python 3.11+ executable.');
  const probe=spawnSync(python,['--version'],{encoding:'utf8',windowsHide:true,timeout:15000});
  const version=/Python (\d+)\.(\d+)/.exec(`${probe.stdout??''}\n${probe.stderr??''}`);
  if(probe.status!==0 || !version || Number(version[1])<3 || Number(version[1])===3 && Number(version[2])<11)throw Error('Demo requires Python 3.11+; no sample was created.');
  fs.mkdirSync(path.dirname(stateDir),{recursive:true});fs.mkdirSync(stateDir);
  fs.mkdirSync(path.dirname(sampleDir),{recursive:true});fs.mkdirSync(sampleDir);
  const workspace=path.join(sampleDir,'workspace'),projectPath=path.join(workspace,'示例项目');
  const data=path.join(projectPath,'01_资料'),results=path.join(projectPath,'02_成果');
  fs.mkdirSync(data,{recursive:true});fs.mkdirSync(results);
  for(const name of ['本期.csv','补充.csv','演示说明.md','报告原稿.md','报告修订稿.md','聊天导出_v1.json','聊天导出_v2.json','模组输入.txt','下一期.csv','库认识与入库练习.md','地区类别月度.csv'])fs.copyFileSync(path.join(repo,'fixtures/product-demo',name),path.join(data,name),fs.constants.COPYFILE_EXCL);
  const inbox=path.join(sampleDir,'待入材料');fs.mkdirSync(inbox);
  const importSource=path.join(inbox,'新线索.txt');
  fs.copyFileSync(path.join(repo,'fixtures/product-demo/新线索.txt'),importSource,fs.constants.COPYFILE_EXCL);
  const manifest={schema:'atlas.product-demo.v1',demo_id:id,sample_kind:'fictional_preconfigured',state_dir:stateDir,workspace,project_path:projectPath,import_source:importSource,phase:'sample_created'};
  if(scope.installRoot)Object.assign(manifest,{installation_root:scope.installRoot,runtime_sha256:scope.runtimeSha256});
  const manifestFile=path.join(stateDir,'demo.json');
  const record=phase=>{manifest.phase=phase;const json=JSON.stringify(manifest,null,2);if(Buffer.byteLength(json)>16384)throw Error('Demo manifest exceeds 16 KiB.');fs.writeFileSync(manifestFile,json);};
  record('sample_created');
  const env=demoEnvironment(scope,stateDir,python);
  const host=['--actor','agent','--agent','Demo fixture','--model','deterministic-sample','--tool','atlas-product-demo','--client-run-id',id];
  const cli=(args,caller=false)=>{
    const result=spawnSync(scope.nodePath,[...scope.nodeArgs,path.join(scope.runtimeRoot,'bin/atlas.js'),...args,...(caller?host:[]),'--json'],{cwd:scope.runtimeRoot,env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});
    let receipt;try{receipt=JSON.parse(result.stdout??'');}catch{}
    if(result.error || result.status!==0 || !receipt?.ok){manifest.failed_command=args.slice(0,2).join(' ');record('interrupted');throw Error(`${manifest.failed_command}: ${receipt?.error?.message??result.error?.message??result.stderr?.slice(0,1000)??'invalid receipt'}. State retained at ${manifestFile}`);}
    return receipt.data;
  };
  const root=cli(['root','adopt','--path',workspace,'--type','project_workspace','--content-policy','bounded_content']);
  const project=cli(['project','create','--name','示例：合并两份地区数据','--path','示例项目']);
  manifest.project_id=project.project_id;
  cli(['project','attach-root',project.project_id,'--root',root.root_id,'--path','示例项目','--reason','Explicit fictional demonstration workspace.']);record('project_registered');
  const started=cli(['table-work','start','--project',project.project_id,'--source',path.join(data,'本期.csv'),'--source',path.join(data,'补充.csv'),'--intent','虚构示例：按id合并去重，不代表Host推断或真人认可。'],true);
  manifest.work_id=started.session_id;record('work_started');
  const prepared=cli(['table-work','prepare',started.session_id,'--base-revision',String(started.revision)],true);
  const mappingFile=path.join(stateDir,'mapping.json');
  fs.writeFileSync(mappingFile,JSON.stringify({mapping:prepared.sources.flatMap(source=>['id','region','amount'].map(column=>({source_key:source.source_key,column,canonical:column})))}),{flag:'wx'});
  const aligned=cli(['table-work','align',started.session_id,'--request-file',mappingFile,'--base-revision',String(prepared.revision)],true);
  const recipeFile=path.join(stateDir,'recipe.json');
  fs.writeFileSync(recipeFile,JSON.stringify({combine:'concatenate',deduplicate_columns:'id',sort_column:'id',sort_direction:'asc'}),{flag:'wx'});
  const configured=cli(['table-work','recipe',started.session_id,'--request-file',recipeFile,'--base-revision',String(aligned.revision)],true);
  const preview=cli(['table-work','preview',started.session_id,'--base-revision',String(configured.revision)],true);
  if(preview.preview.result_summary.rows!==3)throw Error(`Unexpected demo Preview; state retained at ${manifestFile}`);
  const saved=cli(['table-work','save',started.session_id,'--base-revision',String(preview.revision),'--folder','02_成果','--file-name','地区数据_合并.csv','--format','csv','--request-key',`demo-save-${id}`,'--reason','Run the explicitly preconfigured fictional demo; preserve all source files.'],true);
  if(saved.status!=='executed' || !saved.verification?.sha256)throw Error(`Demo Save was not verified; state retained at ${manifestFile}`);
  manifest.save_id=saved.save_id;manifest.result_resource_id=saved.resource_id;manifest.result_path=path.join(results,'地区数据_合并.csv');record('result_saved');
  const board=cli(['board','create','--project',project.project_id,'--title','示例交付：资料 → 处理 → 成果']);
  manifest.board_id=board.board_id;
  const boardFile=path.join(stateDir,'board.json');
  fs.writeFileSync(boardFile,JSON.stringify({title:board.title,blocks:[
    {type:'material_reference',resource_id:started.sources[0].resource_id,version_policy:'follow_latest'},
    {type:'text',text:'这是虚构演示：两份CSV共4条输入，按id去重后3条记录，金额合计200。方案已预置，不代表真人语义签收。'},
    {type:'result_preview',save_id:saved.save_id,version_policy:'pinned_version'},
  ]}),{flag:'wx'});
  const completed=cli(['board','save',board.board_id,'--project',project.project_id,'--base-revision',String(board.revision),'--request-file',boardFile]);
  manifest.board_revision=completed.revision;
  manifest.board_href=`/projects/${project.project_id}/boards/${board.board_id}`;
  // A separate Work consumes the verified three-row Result. The original
  // merge recipe, Save and Board remain exactly as prepared above.
  const aggregateStart=cli(['table-work','start','--project',project.project_id,'--source',manifest.result_path,'--intent','虚构示例：按地区汇总已核验的三条记录。'],true);
  const aggregatePrepared=cli(['table-work','prepare',aggregateStart.session_id,'--base-revision',String(aggregateStart.revision)],true);
  const aggregateMapping=path.join(stateDir,'aggregate-mapping.json');
  fs.writeFileSync(aggregateMapping,JSON.stringify({mapping:aggregatePrepared.sources.flatMap(source=>['id','region','amount'].map(column=>({source_key:source.source_key,column,canonical:column})))}),{flag:'wx'});
  const aggregateAligned=cli(['table-work','align',aggregateStart.session_id,'--request-file',aggregateMapping,'--base-revision',String(aggregatePrepared.revision)],true);
  const aggregateRecipe=path.join(stateDir,'aggregate-recipe.json');
  fs.writeFileSync(aggregateRecipe,JSON.stringify({combine:'concatenate',aggregate_dimension:'region',aggregate_measure:'amount',aggregate_formula:'sum',aggregate_unit:'金额',aggregate_null_policy:'exclude'}),{flag:'wx'});
  const aggregateConfigured=cli(['table-work','recipe',aggregateStart.session_id,'--request-file',aggregateRecipe,'--base-revision',String(aggregateAligned.revision)],true);
  const aggregatePreview=cli(['table-work','preview',aggregateStart.session_id,'--base-revision',String(aggregateConfigured.revision)],true);
  const aggregation=aggregatePreview.preview.aggregation;
  if(aggregation?.grand_total!==200 || aggregation.groups.find(group=>group.value==='北区')?.sum!==120 || aggregation.groups.find(group=>group.value==='南区')?.sum!==80)throw Error(`Unexpected demo aggregate; state retained at ${manifestFile}`);
  const aggregateSaved=cli(['table-work','save',aggregateStart.session_id,'--base-revision',String(aggregatePreview.revision),'--folder','02_成果','--file-name','地区金额_汇总.csv','--format','csv','--request-key',`demo-aggregate-${id}`,'--reason','Explicit fictional aggregate with an absent output target.'],true);
  if(aggregateSaved.status!=='executed' || !aggregateSaved.verification?.sha256)throw Error(`Demo aggregate Save was not verified; state retained at ${manifestFile}`);
  Object.assign(manifest,{source_resource_id:started.sources[0].resource_id,aggregate_work_id:aggregateStart.session_id,aggregate_save_id:aggregateSaved.save_id,aggregate_result_path:path.join(results,'地区金额_汇总.csv'),aggregate_total:200});
  // Two independent existing Table Work recipes use the same six-row source.
  // Their output slots are separate from the original merge and aggregate.
  const analysisSource=path.join(data,'地区类别月度.csv');
  manifest.analysis_demo='pivot_trend_v1';manifest.analysis_source_path=analysisSource;
  for(const analysis of [
    {kind:'pivot',file:'地区类别_透视.csv',recipe:{combine:'concatenate',pivot_row_dimension:'地区',pivot_column_dimension:'类别',pivot_measure:'金额',pivot_formula:'sum',pivot_unit:'金额',pivot_null_policy:'exclude'}},
    {kind:'trend',file:'地区金额_月度趋势.csv',recipe:{combine:'concatenate',trend_date_field:'日期',trend_measure:'金额',trend_formula:'sum',trend_start_month:'2026-01',trend_current_start_month:'2026-02',trend_end_month:'2026-02',trend_unit:'金额',trend_null_policy:'exclude'}},
  ]){
    const work=cli(['table-work','start','--project',project.project_id,'--source',analysisSource,'--intent',analysis.kind==='pivot'?'虚构示例：地区×类别透视、占比与排名。':'虚构示例：相邻两个月总额与变化。'],true);
    const prepared=cli(['table-work','prepare',work.session_id,'--base-revision',String(work.revision)],true);
    const mapping=path.join(stateDir,`${analysis.kind}-mapping.json`);
    fs.writeFileSync(mapping,JSON.stringify({mapping:prepared.sources.flatMap(source=>['地区','类别','日期','金额'].map(column=>({source_key:source.source_key,column,canonical:column})))}),{flag:'wx'});
    const aligned=cli(['table-work','align',work.session_id,'--request-file',mapping,'--base-revision',String(prepared.revision)],true);
    const recipe=path.join(stateDir,`${analysis.kind}-recipe.json`);fs.writeFileSync(recipe,JSON.stringify(analysis.recipe),{flag:'wx'});
    const configured=cli(['table-work','recipe',work.session_id,'--request-file',recipe,'--base-revision',String(aligned.revision)],true);
    const preview=cli(['table-work','preview',work.session_id,'--base-revision',String(configured.revision)],true);
    if(analysis.kind==='pivot'){
      const pivot=preview.preview.pivot_aggregation;
      const expected=[{row:'北区',values:[100,50],total:150,share_percent:60,rank:1},{row:'南区',values:[70,30],total:100,share_percent:40,rank:2},{row:'__TOTAL__',values:[170,80],total:250,share_percent:100,rank:null}];
      if(pivot?.grand_total!==250 || JSON.stringify(pivot.matrix)!==JSON.stringify(expected))throw Error(`Unexpected demo pivot; state retained at ${manifestFile}`);
    }else{
      const trend=preview.preview.trend_aggregation;
      if(JSON.stringify(trend?.monthly_totals)!==JSON.stringify([{month:'2026-01',sum:100},{month:'2026-02',sum:150}]) || trend.previous_period.total!==100 || trend.current_period.total!==150 || trend.delta!==50 || trend.growth_percent!==50)throw Error(`Unexpected demo trend; state retained at ${manifestFile}`);
    }
    const saved=cli(['table-work','save',work.session_id,'--base-revision',String(preview.revision),'--folder','02_成果','--file-name',analysis.file,'--format','csv','--request-key',`demo-${analysis.kind}-${id}`,'--reason','Explicit fictional analysis with its own absent output slot.'],true);
    if(saved.status!=='executed' || !saved.verification?.sha256)throw Error(`Demo ${analysis.kind} Save was not verified; state retained at ${manifestFile}`);
    manifest.analysis_resource_id=work.sources[0].resource_id;
    Object.assign(manifest,{[`${analysis.kind}_work_id`]:work.session_id,[`${analysis.kind}_save_id`]:saved.save_id,[`${analysis.kind}_result_path`]:path.join(results,analysis.file),[`${analysis.kind}_href`]:`/work/${work.session_id}`});
  }
  const graph=cli(['resource','show',manifest.source_resource_id,'--project',project.project_id,'--relation-depth','2','--relation-status','active']);
  if(!graph.resource_focus_graph?.nodes.some(node=>node.id===`work:${started.session_id}`) || !graph.resource_focus_graph.nodes.some(node=>node.id===`result:${saved.save_id}`))throw Error(`Demo lineage is missing; state retained at ${manifestFile}`);
  manifest.graph_href=`/projects/${project.project_id}/resources?resource_id=${manifest.source_resource_id}&relation_depth=2&relation_status=active`;
  const handoffRequest=path.join(stateDir,'handoff.json');
  fs.writeFileSync(handoffRequest,JSON.stringify({schema:'atlas.handoff.v1',goal:'核对地区汇总后继续下一期分析。',work_id:aggregateStart.session_id,resource_ids:[saved.resource_id],save_ids:[aggregateSaved.save_id],rule_request:{operation:'content_work',project_id:project.project_id,needs:['placement']},corrections:[],unfinished:['真实不同产品 Host 接续尚待验收。'],caller:{actor:'agent',tool:'atlas-product-demo',client_run_id:id},request_key:`demo-handoff-${id}`}),{flag:'wx'});
  const protectionFile=path.join(stateDir,'protection.json');
  // Register file identities before protection so later reading cannot add an
  // undeclared Resource to the protected files.
  const texts=['报告原稿.md','报告修订稿.md'].map(name=>cli(['content','inspect','--file',path.join(data,name),'--project',project.project_id,'--purpose','content'],true).coordination.resource_id);
  fs.writeFileSync(protectionFile,JSON.stringify({projectId:project.project_id,paths:['01_资料/报告原稿.md','01_资料/报告修订稿.md'],resourceIds:texts,boardIds:[],label:'演示起点：两份文本',requestKey:`demo-protect-${id}`,caller:{actor:'agent',tool:'atlas-product-demo',client_run_id:id}}),{flag:'wx'});
  manifest.round_id=cli(['round','protect','--request-file',protectionFile]).round_id;
  manifest.handoff_id=cli(['handoff','create','--project',project.project_id,'--request-file',handoffRequest]).handoff_id;
  manifest.handoff_href=`/projects/${project.project_id}/handoffs/${manifest.handoff_id}`;
  manifest.round_href=`/projects/${project.project_id}/rounds/${manifest.round_id}`;
  manifest.aggregate_href=`/work/${aggregateStart.session_id}`;
  manifest.text_resource_ids=texts;
  manifest.text_href=`/projects/${project.project_id}/resources/read?resource_id=${texts[0]}`;
  manifest.compare_href=`/projects/${project.project_id}/compare`;
  cli(['content','compare','--left',path.join(data,'报告原稿.md'),'--right',path.join(data,'报告修订稿.md'),'--details']);
  const captures=[],capturePaths=[],captureVersions=[];
  for(const version of [1,2]){
    const input=path.join(data,`聊天导出_v${version}.json`);
    const inspected=cli(['capture','source','inspect-export','--input',input]);
    const captured=cli(['capture','source','prepare-export','--input',input,'--expected-input-sha256',inspected.input_revision.sha256,'--selection',inspected.items[0].selection_token,'--project',project.project_id,'--folder','02_成果','--name',`虚构聊天_v${version}`,'--request-key',`demo-capture-${version}-${id}`],true);
    if(captured.status!=='prepared' || version===2 && (captured.diff?.added_count!==1 || captured.diff.edited_count!==0))throw Error(`Unexpected export version diff; state retained at ${manifestFile}`);
    const reviewed=cli(['save','review',captured.save_id]);
    const executed=cli(['save','execute',captured.save_id,'--expected-preview-revision',reviewed.preview_revision,'--reason','Explicit fictional text-only export sample.']);
    if(executed.status!=='executed')throw Error(`Export Save was not executed; state retained at ${manifestFile}`);
    captures.push(captured.save_id);
    capturePaths.push(executed.target.path);captureVersions.push(captured.version_id);
  }
  const changes=cli(['capture','source','read',captures[1],'--project',project.project_id,'--mode','changes']);
  if(changes.comparison?.status!=='available' || changes.comparison.added_count!==1 || !changes.excerpt.includes('新增下一期'))throw Error(`Unexpected incremental export read; state retained at ${manifestFile}`);
  const repeatedInput=path.join(data,'聊天导出_v2.json');
  const repeatedInspection=cli(['capture','source','inspect-export','--input',repeatedInput]);
  const repeated=cli(['capture','source','prepare-export','--input',repeatedInput,'--expected-input-sha256',repeatedInspection.input_revision.sha256,'--selection',repeatedInspection.items[0].selection_token,'--project',project.project_id,'--folder','02_成果','--name','虚构聊天_v2','--request-key',`demo-capture-repeat-${id}`],true);
  if(repeated.status!=='unchanged')throw Error(`Repeated export should be unchanged; state retained at ${manifestFile}`);
  const packageDirectory=path.join(sampleDir,'模组包');fs.mkdirSync(packageDirectory);
  const packagePath=path.join(packageDirectory,'uppercase-prefix.json');
  fs.copyFileSync(path.join(repo,'fixtures/local-module/uppercase-prefix.json'),packagePath,fs.constants.COPYFILE_EXCL);
  const packagePreview=cli(['module','package-preview','--file',packagePath]);
  const installed=cli(['module','install','--file',packagePath,'--expected-sha256',packagePreview.sha256,'--expected-revision',String(packagePreview.revision),'--request-key',`demo-module-${id}`]);
  if(installed.enabled!==false)throw Error(`Demo Module must remain disabled; state retained at ${manifestFile}`);
  Object.assign(manifest,{capture_demo:'structured_export_v1_v2',capture_save_ids:captures,capture_result_paths:capturePaths,capture_version_ids:captureVersions,capture_href:`/projects/${project.project_id}/capture-source/${captures[0]}`,capture_changes_href:`/projects/${project.project_id}/capture-source/${captures[1]}?mode=changes`,capture_added_count:1,capture_repeat_status:repeated.status,local_module_id:installed.module_id,local_module_enabled:false,local_module_input_resource_id:cli(['content','inspect','--file',path.join(data,'模组输入.txt'),'--project',project.project_id,'--purpose','content'],true).coordination.resource_id,local_module_href:`/modules?project_id=${project.project_id}#local-tool-local.example-uppercase-prefix`});
  const migrationPath=path.join(workspace,'迁移练习');fs.mkdirSync(path.join(migrationPath,'资料'),{recursive:true});
  fs.copyFileSync(path.join(repo,'fixtures/product-demo/迁移练习/README.md'),path.join(migrationPath,'README.md'),fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(path.join(repo,'fixtures/product-demo/迁移练习/迁移说明.txt'),path.join(migrationPath,'资料/迁移说明.txt'),fs.constants.COPYFILE_EXCL);
  const migration=cli(['project','create','--name','示例：独立迁移练习','--path','迁移练习']);
  cli(['project','attach-root',migration.project_id,'--root',root.root_id,'--path','迁移练习','--reason','Separate fictional move preview material; not the main demo Project.']);
  cli(['content','inspect','--file',path.join(migrationPath,'资料/迁移说明.txt'),'--project',migration.project_id,'--purpose','content'],true);
  manifest.migration_readme_resource_id=cli(['content','inspect','--file',path.join(migrationPath,'README.md'),'--project',migration.project_id,'--purpose','content'],true).coordination.resource_id;
  const scan=cli(['bootstrap','scan','--root',migrationPath,'--scan-mode','structure'],true);
  const scanContext=cli(['bootstrap','context',scan.scan_id,'--max-samples','2']);
  fs.writeFileSync(path.join(stateDir,'bootstrap-context.json'),JSON.stringify(scanContext,null,2),{flag:'wx'});
  const proposalFile=path.join(stateDir,'placement-proposal.json');
  fs.writeFileSync(proposalFile,JSON.stringify({kind:'placement',scope:{type:'project',project_id:project.project_id},condition:{artifact_role:'note'},value:{role:'note',target_subdirectory:'01_资料'},summary:'虚构语义候选：把新增摘记放入现有资料目录，等使用者检查或纠正。',basis:'observed',confidence:0.8,evidence:[{path:'示例项目/01_资料',fact:'样例中确有此资料目录；去向是预置的虚构语义提议。'}]}),{flag:'wx'});
  const ruleProposal=cli(['rule','propose','--root',workspace,'--proposal-file',proposalFile],true);
  const contextFile=path.join(stateDir,'rule-context-request.json');
  fs.writeFileSync(contextFile,JSON.stringify({operation:'content_work',project_id:project.project_id,artifact_role:'note',needs:['placement']}),{flag:'wx'});
  const ruleContext=cli(['rule','context','--root',workspace,'--request-file',contextFile]);
  if(ruleContext.applied_rules.length!==0)throw Error(`Demo must not activate semantic rules; state retained at ${manifestFile}`);
  cli(['content','locate','--project',project.project_id,'--resource',texts[0]]);
  const rowScript=`
    import {Registry} from ${JSON.stringify(pathToFileURL(path.join(scope.runtimeRoot,'src/registry.js')).href)};
    import {createResourceControl} from ${JSON.stringify(pathToFileURL(path.join(scope.runtimeRoot,'src/resource-control.js')).href)};
    import {createContentLocationService} from ${JSON.stringify(pathToFileURL(path.join(scope.runtimeRoot,'src/content-location-service.js')).href)};
    import {createProjectViewService} from ${JSON.stringify(pathToFileURL(path.join(scope.runtimeRoot,'src/project-view-service.js')).href)};
    const registry=new Registry({stateDir:process.env.ATLAS_STATE_DIR});
    const control=createResourceControl({stateDir:process.env.ATLAS_STATE_DIR,registry});
    const locations=createContentLocationService({registry,resourceControl:control,installationRoot:${JSON.stringify(scope.runtimeRoot)}});
    const views=createProjectViewService({stateDir:process.env.ATLAS_STATE_DIR,registry,pythonPath:process.env.ATLAS_PYTHON});
    try{
      const projectId=${JSON.stringify(project.project_id)},resourceId=${JSON.stringify(manifest.source_resource_id)};
      const property=views.defineProperty({projectId,name:'区域归属',kind:'text'});
      const snapshot=locations.locateCsvRow({projectId,resourceId,key:{column:'id',value:'1'}});
      const batch=views.submitRowPropertyCandidates({projectId,propertyId:property.property_id,promptVersion:'fictional-region-v1',candidates:[{format:'csv',resource_id:resourceId,key:{column:'id',value:'1'},value:'北区',source_version:snapshot.row_sha256,evidence:{summary:'虚构候选，实际 region 单元格为北区；待使用者确认。',cells:['region']}}],caller:{tool:'atlas-product-demo',model:'deterministic-sample',client_run_id:${JSON.stringify(id)}}});
      console.log(JSON.stringify({ok:true,data:{batch_id:batch.batch_id,candidate_id:batch.candidates[0].candidate_id,status:batch.candidates[0].status}}));
    }finally{views.dispose();locations.dispose();control.dispose();registry.dispose();}
  `;
  const rowProcess=spawnSync(scope.nodePath,[...scope.nodeArgs,'--input-type=module','-e',rowScript],{cwd:scope.runtimeRoot,env,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});
  let rowReceipt;try{rowReceipt=JSON.parse(rowProcess.stdout);}catch{}
  if(rowProcess.status!==0 || rowReceipt?.ok!==true || rowReceipt.data.status!=='pending')throw Error(`CSV candidate preparation failed: ${rowProcess.stderr?.slice(0,1000)}. State retained at ${manifestFile}`);
  Object.assign(manifest,{coverage_demo:'remaining_subsets_v1',bootstrap_scan_id:scan.scan_id,rule_change_id:ruleProposal.rule_change_id,row_candidate_id:rowReceipt.data.candidate_id,row_candidate_status:rowReceipt.data.status,row_candidate_batch_id:rowReceipt.data.batch_id,migration_project_id:migration.project_id,migration_project_path:migrationPath,guidance_resource_id:cli(['content','inspect','--file',path.join(data,'库认识与入库练习.md'),'--project',project.project_id,'--purpose','content'],true).coordination.resource_id,next_period_resource_id:cli(['content','inspect','--file',path.join(data,'下一期.csv'),'--project',project.project_id,'--purpose','data'],true).coordination.resource_id});
  Object.assign(manifest,{guidance_href:`/projects/${project.project_id}/resources/read?resource_id=${manifest.guidance_resource_id}`,rules_href:`/projects/${project.project_id}/rules`,rule_preview_href:`/projects/${project.project_id}/rules/${manifest.rule_change_id}`,search_href:`/projects/${project.project_id}/search?q=${encodeURIComponent('北区')}`,impact_href:manifest.graph_href,location_href:`/projects/${project.project_id}/content-location?resource_id=${texts[0]}`,row_candidates_href:`/projects/${project.project_id}/resources?mode=table`,migration_href:`/projects/${migration.project_id}/move/new`,membership_href:`/projects/${migration.project_id}/membership`,settings_href:`/settings?project_id=${project.project_id}`});
  const titles={A1:'认识库',A2:'按习惯入库',A3:'搜索与规则读回',B1:'原位文本修改',B2:'重复/补充/冲突比较',B3:'相关成果影响与更新',C1:'网页/聊天/导出保存',C2:'重复导入/版本差异/增量读取',D1:'关系图/来源与影响',D2:'改名重联移动拆合引用修复',E1:'内容精确定位',E2:'清理汇总透视趋势占比排名',E3:'属性候选纠正',E4:'看板交付',F1:'本地模组',F2:'不同Host接续',F3:'保护与回档',F4:'体验安装',F5:'事件适配X',F6:'界面AI会话X'};
  const preparedShowcases={B1:[manifest.text_href,'打开报告原稿；可在阅读器执行文本修改，生成时未替用户修改。'],B2:[manifest.compare_href,'选择报告原稿与报告修订稿；下一步段落不同，金额相同。'],D1:[manifest.graph_href,'看到资料 → Work → Verified Result；Board 引用由交付看板展示。'],E2:[manifest.aggregate_href,'原合并成果3行、总计200；地区汇总北区120、南区80。'],E4:[manifest.board_href,'资料引用、文字和固定成果预览三个块。'],F3:[manifest.round_href,'已保护两份文本；回档需先预览，再确认。生成时未执行回档。']};
  manifest.showcase=Object.entries(titles).map(([capability,title])=>({capability,title,href:preparedShowcases[capability]?.[0]??(capability==='F2'?manifest.handoff_href:null),status:preparedShowcases[capability]?'ready':capability==='F2'?'real_host_pending':['F5','F6'].includes(capability)?'default_off':'not_demonstrated',expected:preparedShowcases[capability]?.[1]??(capability==='F2'?'Handoff 已创建，可读回；真实不同产品 Host 接续待验收。':['F5','F6'].includes(capability)?'默认关闭，本演示未启用。':'本样例未演示；不表示该能力已验收。')}));
  for(const [capability,href,status,expected] of [
    ['C1',manifest.capture_href,'subset_ready','仅演示虚构 ChatGPT 结构化导出保存：初版两条文字消息；未演示网页、分享页或账户。'],
    ['C2',manifest.capture_changes_href,'subset_ready','同一虚构对话第二版仅新增一条“新增下一期”；增量读回 added_count=1，重复准备 unchanged，初版保留。'],
    ['F1',manifest.local_module_href,'installed_disabled','模组包已安装且关闭；可选 01_资料/模组输入.txt，未启用或执行代码；不是模组执行验收。'],
  ])Object.assign(manifest.showcase.find(item=>item.capability===capability),{href,status,expected});
  for(const [capability,href,status,expected] of [
    ['A1',manifest.guidance_href,'subset_ready','已通过 Bootstrap 结构扫描读取独立迁移样例；认识与入库练习说明可读。未初始化或接受推断。'],
    ['A2',manifest.rule_preview_href,'candidate_pending','资料去向规则候选待检查/纠正；待入 TXT 保留。未确认规则或执行入库。'],
    ['A3',manifest.search_href,'subset_ready','搜索关键词北区；规则页可读回待确认候选，没有已生效的样例规则。'],
    ['B3',manifest.impact_href,'material_pending','下一期.csv 独立准备，合计210；原来源与本期成果仍Fresh、200。检查影响后再决定是否更新，不伪造Changed。'],
    ['D2',manifest.migration_href,'material_pending','独立迁移练习有TXT及README相对引用。打开移动预览表，目标建议迁移练习_新位置；未移动、改名、拆合或修复引用。'],
    ['E1',manifest.location_href,'subset_ready','实际文本定位入口可定位报告段落；只演示Markdown，不代表PDF/OCR或全部格式验收。'],
    ['E3',manifest.row_candidates_href,'candidate_pending','本期.csv 的 id=1 行 region=北区，属性候选区域归属待确认；保留行版本与实际单元格证据，未接受候选。'],
    ['F4',manifest.settings_href,'subset_ready','Settings 可查看当前源码运行状态；安装态、原生Desktop和安装体验验收仍待完成。'],
  ])Object.assign(manifest.showcase.find(item=>item.capability===capability),{href,status,expected});
  Object.assign(manifest.showcase.find(item=>item.capability==='E2'),{links:[{title:'地区×类别透视、占比和排名',href:manifest.pivot_href},{title:'月度趋势与期间变化',href:manifest.trend_href}],expected:'本期三行合并与地区汇总仍为200、北120/南80。独立六行分析：透视北区150占60%排名1，南区100占40%排名2，总250；月度100→150，增加50、增长50%。'});
  const indexPath=path.join(projectPath,'演示入口.md');
  const introduction=['# Keeproot 虚构演示入口','','这是预置的虚构资料，不是全部20项能力验收。先打开下面的实际产品页面。','',`- [关系图：资料 → Work → 成果](${manifest.graph_href})`,`- [地区汇总：北区120 / 南区80 / 合计200](${manifest.aggregate_href})`,`- [交付看板](${manifest.board_href})`,`- [文本阅读与修改](${manifest.text_href})`,`- [比较两份报告](${manifest.compare_href})：选择 01_资料/报告原稿.md 和 01_资料/报告修订稿.md。`,`- [Handoff 读回](${manifest.handoff_href})：真实 Host 接续待验收。`,`- [已保护的文本](${manifest.round_href})：文本修改后可检查时间线，回档先预览再确认。`,'','原始合并成果保持 id 1/2/3，金额100/80/20。汇总成果另存，不覆盖原成果。','文本比较的预期差异是最后一段；生成过程未执行文本修改或回档。','','## 20项能力范围','',...manifest.showcase.map(item=>`- ${item.capability} ${item.title}：${item.status}。${item.expected}`),''];
  introduction.splice(12,0,`- [虚构聊天初版：两条文字消息](${manifest.capture_href})`,`- [虚构聊天第二版增量：仅新增“新增下一期”](${manifest.capture_changes_href})`,`- [本地模组：已安装且关闭](${manifest.local_module_href})：选择 01_资料/模组输入.txt；生成时未启用或执行。`);
  introduction.splice(15,0,`- [认识库与入库练习说明](${manifest.guidance_href})`,`- [待确认的资料去向候选](${manifest.rule_preview_href})`,`- [搜索北区](${manifest.search_href}) / [规则读回](${manifest.rules_href})`,`- [报告段落定位](${manifest.location_href}) / [CSV行属性候选](${manifest.row_candidates_href})`,`- [独立迁移练习](${manifest.migration_href}) / [拆合入口](${manifest.membership_href})：生成时未执行移动。`,`- [Settings：源码状态](${manifest.settings_href})`);
  introduction.splice(6,0,`- [地区×类别透视、占比和排名](${manifest.pivot_href})：北区活动100、线上50、合计150、占60%、排名1；南区70/30、合计100、占40%、排名2；总计250。`,`- [月度趋势](${manifest.trend_href})：2026-01为100，2026-02为150；增加50，增长50%。这是独立的六行资料，不改变本期200成果。`);
  fs.writeFileSync(indexPath,introduction.join('\n'),{flag:'wx'});
  manifest.index_path=indexPath;
  manifest.index_resource_id=cli(['content','inspect','--file',indexPath,'--project',project.project_id,'--purpose','content'],true).coordination.resource_id;
  manifest.index_href=`/projects/${project.project_id}/resources/read?resource_id=${manifest.index_resource_id}`;
  manifest.manifest_path=manifestFile;record('ready');
  return manifest;
}

async function serveInstalledDemo(demo,{python,installRoot}){
  const stored=loadProductDemo(demo.demo_id,{installRoot});
  for(const field of ['installation_root','state_dir','workspace','project_path','project_id','board_id','board_href']){
    if(demo[field]!==stored[field])throw Error(`Demo UI identity does not match its manifest: ${field}`);
  }
  const scope=demoScope(installRoot);python=demoPython(scope,python);
  const expectedState=normalizeStateDir(scope.boundary,path.join(scope.stateParent,demo.demo_id));
  if(path.resolve(demo.state_dir)!==expectedState || demo.installation_root!==scope.installRoot)throw Error('Demo UI state does not match its selected installation.');
  const child=spawn(scope.nodePath,[...scope.nodeArgs,path.join(scope.runtimeRoot,'bin/atlas.js'),'ui','--no-open','--port','0','--json'],{cwd:scope.runtimeRoot,env:demoEnvironment(scope,expectedState,python),stdio:['ignore','pipe','pipe'],windowsHide:true});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  const close=async()=>{
    if(child.exitCode!==null || child.signalCode!==null)return;
    child.kill('SIGINT');
    let timer;
    await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(()=>{child.kill();resolve();},5000);})]);
    clearTimeout(timer);
  };
  let output='',errors='';
  child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-2048);});
  try{
    const receipt=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Installed demo UI did not start within 60 seconds.')),60000);
      const fail=error=>{clearTimeout(timer);reject(error);};
      child.once('error',fail);
      child.once('exit',code=>fail(Error(`Installed demo UI exited before startup (${code}): ${errors}`)));
      child.stdout.on('data',chunk=>{
        output+=chunk;if(output.length>65536){fail(Error('Installed demo UI returned excessive startup output.'));return;}
        let value;try{value=JSON.parse(output);}catch{return;}
        if(value?.ok!==true || value.command!=='ui.start' || value.protocol_version!=='atlas-cli.v1'){fail(Error('Installed demo UI returned an invalid startup receipt.'));return;}
        clearTimeout(timer);resolve(value);
      });
    });
    const origin=new URL(receipt.data.url);
    if(origin.protocol!=='http:' || origin.hostname!=='127.0.0.1')throw Error('Installed demo UI must use loopback HTTP.');
    return {url:new URL(demo.board_href,origin).href,close};
  }catch(error){await close();throw error;}
}

export async function serveProductDemo(demo,{python,installRoot=null}){
  if(installRoot)return serveInstalledDemo(demo,{python,installRoot});
  if(demo.installation_root)throw Error('Provide the explicit install-root to serve this installed sample.');
  // These are current UI assembly dependencies, not a separate execution engine.
  const [{Registry},{createResourceControl},{Intake},{PreferenceRules},{startAtlasUiServer}]=await Promise.all([
    import('../src/registry.js'),import('../src/resource-control.js'),import('../src/intake.js'),import('../src/preference-rules.js'),import('../src/ui-server.js'),
  ]);
  const previous=process.env.ATLAS_CONTENT_PYTHON;process.env.ATLAS_CONTENT_PYTHON=python;
  const registry=new Registry({stateDir:demo.state_dir});
  const resourceControl=createResourceControl({stateDir:demo.state_dir,registry});
  const intake=new Intake({stateDir:demo.state_dir});
  const rules=new PreferenceRules({stateDir:demo.state_dir});
  let server;
  try{server=await startAtlasUiServer({stateDir:demo.state_dir,registry,resourceControl,intake,rules,projectRoot:repo,host:'127.0.0.1',port:0,...(demo.showcase?{demoShowcase:loadProductDemo(demo.demo_id)}:{})});}
  catch(error){rules.dispose();intake.dispose();resourceControl.dispose();registry.dispose();if(previous===undefined)delete process.env.ATLAS_CONTENT_PYTHON;else process.env.ATLAS_CONTENT_PYTHON=previous;throw error;}
  return {url:`${server.workspace_url.replace(/\/$/,'')}${demo.board_href}`,...(demo.showcase?{showcase_url:`${server.workspace_url.replace(/\/$/,'')}/demo`}:{}),close:async()=>{await server.close();rules.dispose();intake.dispose();resourceControl.dispose();registry.dispose();if(previous===undefined)delete process.env.ATLAS_CONTENT_PYTHON;else process.env.ATLAS_CONTENT_PYTHON=previous;}};
}

async function main(){
  const input=options(process.argv.slice(2));
  if(input.help){console.log(usage);return;}
  if(input.resume && !input.installRoot && (!input.python || !fs.lstatSync(input.python).isFile()))throw Error('Provide --python when reopening the HTML demonstration.');
  const demo=input.resume ? loadProductDemo(input.resume,input) : prepareProductDemo(input);
  console.log(JSON.stringify(demo));
  if(!input.serve)return;
  const session=await serveProductDemo(demo,input);console.log(`Keeproot HTML demo: ${session.showcase_url??session.url}\nCtrl+C closes the server; files and state remain.`);
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;await session.close();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
