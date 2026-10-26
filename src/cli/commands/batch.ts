import {link,lstat,mkdtemp,open,realpath,rm,writeFile} from "node:fs/promises";
import {dirname,isAbsolute,join,relative,resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {parse as parseYaml} from "yaml";
import {parseStrictJson} from "../../domain/strict-json.js";
import {parseArtifactContract} from "../../domain/artifact-contract.js";
import {artifactSetHash,parseArtifactReport,type ArtifactReport} from "../../domain/artifact-report.js";
import {compareArtifactReports} from "../../domain/artifact-report-comparison.js";
import {acceptancePlanSchema,BATCH_LIMITS,BatchAcceptanceError,canonicalJson,contentHash,sha256,parseReviewPackage,validateBatchReport,batchStatus,summarizeBatch,
 type AcceptancePlan,type AcceptanceDeclaration,type AcceptanceBatch,type BatchReport,type ReviewPackage} from "../../domain/batch-report.js";
import {readDirectoryEntries,readWorkspaceFile,scanStagedWorkspace} from "../../sandbox/workspace-tree.js";
import {redactLocalPaths} from "../../reporters/local-paths.js";
import {runArtifacts} from "./artifacts.js";
import {VERSION} from "../../version.js";

export type BatchRunOptions={plan:string;output:string;previous?:string;retryFailed?:boolean;expectPlanSha256?:string};
type Source={path:string;allowed:Set<string>;files:number;bytes:number;stamp:string;available:boolean};
const error=(code:string,message:string)=>new BatchAcceptanceError(code,message);
const inside=(root:string,path:string)=>{const value=relative(root,path);return !value||!value.startsWith('..')&&!isAbsolute(value);};

function alias(path:string):string {
 if(process.platform!=='darwin')return path;
 for(const name of ['tmp','var','etc'])if(path===`/${name}`||path.startsWith(`/${name}/`))return '/private'+path;
 return path;
}
async function directory(path:string):Promise<string> {
 const lexical=alias(resolve(path)),canonical=await realpath(lexical),info=await lstat(lexical);
 if(!info.isDirectory()||info.isSymbolicLink()||canonical!==lexical)throw error('batch.unsafe-source','Choose a real source directory without links.');
 return canonical;
}
async function contract(path:string){
 const bytes=await readWorkspaceFile(path,64*1024);
 const value=parseArtifactContract(parseYaml(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{maxAliasCount:100,prettyErrors:false,logLevel:'silent'}));
 if(!value.files.length)throw error('batch.empty-contract','A batch acceptance contract must declare at least one file.');
 return {bytes,value,semantic:contentHash(value),file:sha256(bytes),engine:sha256(JSON.stringify(value))};
}

async function metadata(path:string,allowed:Set<string>,shared?:{entries:number;files:number;bytes:number}):Promise<Omit<Source,'path'|'allowed'|'available'>> {
 const items:Array<[string,number,number,number,number,number,number]>=[];let files=0,bytes=0,entries=0;
 const parents=new Set<string>();for(const name of allowed){const parts=name.split('/');for(let index=1;index<parts.length;index++)parents.add(parts.slice(0,index).join('/'));}
 async function walk(current:string,key:string,depth:number):Promise<void>{
  if(depth>64||++entries>20000)throw error('batch.capacity','Selected input metadata exceeds the shared capacity.');
  if(shared&&++shared.entries>BATCH_LIMITS.max_input_entries)throw error('batch.capacity','The combined inputs exceed 20000 directory entries.');
  const info=await lstat(current);
  if(info.isSymbolicLink()||!info.isFile()&&!info.isDirectory())throw error('batch.unsafe-source','Selected input contains a link or special file.');
  items.push([key,info.dev,info.ino,info.mode,info.size,info.mtimeMs,info.ctimeMs]);
  if(info.isDirectory()){
   if(key&&!parents.has(key))throw error('batch.input-layout','Selected input has undeclared directories.');
   for(const entry of await readDirectoryEntries(current,20000))await walk(join(current,entry.name),key?key+'/'+entry.name:entry.name,depth+1);
  }else{
   if(!allowed.has(key))throw error('batch.input-layout','Selected input has undeclared files.');
   files++;bytes+=info.size;
   if(shared){shared.files++;shared.bytes+=info.size;if(shared.files>BATCH_LIMITS.max_input_files||shared.bytes>BATCH_LIMITS.max_input_bytes)throw error('batch.capacity','The combined inputs exceed 64 MiB or 10000 files.');}
   if(!Number.isSafeInteger(info.size)||info.size>16*1024*1024||files>BATCH_LIMITS.max_input_files||bytes>BATCH_LIMITS.max_input_bytes)throw error('batch.capacity','Selected input exceeds the shared file or byte capacity.');
  }
 }
 await walk(path,'',0);items.sort((left,right)=>left[0].localeCompare(right[0]));return {files,bytes,stamp:contentHash(items)};
}
async function planContext(path:string){
 const selected=alias(resolve(path)),base=await directory(dirname(selected));
 const raw=await readWorkspaceFile(selected,256*1024),plan:AcceptancePlan=acceptancePlanSchema.parse(parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
 const contractPath=join(base,plan.contract);if(await realpath(contractPath)!==contractPath)throw error('batch.unsafe-contract','Select a contract without symbolic parents.');
 const checked=await contract(contractPath);
 // Use the same normalized digest as the existing artifact engine.
 const declaration:AcceptanceDeclaration={schema:'skillsync.acceptance-declaration/v1',plan_sha256:sha256(raw),contract_sha256:checked.engine,contract_file_sha256:checked.file,
  file_paths:checked.value.files.map(file=>file.path).sort(),batches:plan.batches.map(({id,kind})=>({id,kind}))};
 const sources:Source[]=[];const shared={entries:0,files:0,bytes:0};
 for(const item of plan.batches){
  const target=join(base,item.path),allowed=new Set(item.kind==='delivery'?['receipt.json','delivery.json',...declaration.file_paths.map(file=>'artifacts/'+file)]:declaration.file_paths);
  try{
   const root=await directory(target);if(!inside(base,root))throw error('batch.unsafe-source','A batch input escaped the plan directory.');const stats=await metadata(root,allowed,shared);
   sources.push({path:root,allowed,...stats,available:true});
  }catch(problem){
   if(problem instanceof BatchAcceptanceError&&problem.code==='batch.capacity')throw problem;
   sources.push({path:target,allowed,files:0,bytes:0,stamp:'',available:false});
  }
 }
 return {path:selected,base,raw_sha256:sha256(raw),plan,contractPath,checked,declaration,sources};
}

export async function previewAcceptancePlan(path:string){
 try{const context=await planContext(path);return {schema:'skillsync.batch-preview/v1',plan_sha256:context.raw_sha256,
  batches:context.plan.batches.map((item,index)=>({id:item.id,kind:item.kind,files:context.sources[index].files,bytes:context.sources[index].bytes,available:context.sources[index].available})),
  suggestedOutput:join(context.base,'skillsync-acceptance-'+randomUUID()+'.json'),limits:BATCH_LIMITS};
 }catch(problem){if(problem instanceof BatchAcceptanceError)throw problem;throw error('batch.plan-invalid','The acceptance plan or contract is invalid or unavailable.');}
}

export async function inspectAcceptancePackage(path:string,options:{expectSha256?:string;contract?:string;plan?:string}={}){
 try{
  const selected=alias(resolve(path));await directory(dirname(selected));const raw=await readWorkspaceFile(selected,BATCH_LIMITS.max_package_bytes),digest=sha256(raw);
  if(options.expectSha256&&options.expectSha256!==digest)throw error('batch.package-digest','The review package does not match the expected digest.');
  const packet=parseReviewPackage(parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
  if(options.plan){
   const planRaw=await readWorkspaceFile(alias(resolve(options.plan)),256*1024);
   const plan=acceptancePlanSchema.parse(parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(planRaw)));
   if(sha256(planRaw)!==packet.payload.declaration.plan_sha256||canonicalJson(plan.batches.map(({id,kind})=>({id,kind})))!==canonicalJson(packet.payload.declaration.batches))throw error('batch.plan-changed','The supplied plan does not bind this package.');
  }
  if(options.contract){
   const checked=await contract(alias(resolve(options.contract))),declared={limits:checked.value.limits,checks:checked.value.checks.map((check,index)=>({ordinal:index+1,check}))};
   if(checked.file!==packet.payload.declaration.contract_file_sha256||checked.engine!==packet.payload.declaration.contract_sha256||canonicalJson(checked.value.files.map(file=>file.path).sort())!==canonicalJson(packet.payload.declaration.file_paths)||packet.payload.batches.some(item=>item.report.declarations&&canonicalJson(item.report.declarations)!==canonicalJson(declared)))throw error('batch.contract-changed','The supplied contract does not bind this package.');
  }
  return {packet,package_sha256:digest};
 }catch(problem){if(problem instanceof BatchAcceptanceError)throw problem;throw error('batch.package-invalid','The review package could not be verified.');}
}

function unavailable(contractSha:string,code:string):ArtifactReport {
 return {schema:'skillsync.artifacts-report/v1',status:'failed',exitCode:2,evidence:'physical-files',execution:'not-run',provenance:'not-authenticated',receipt_binding:'not-provided',contract_sha256:contractSha,files:[],findings:[{code}]};
}
async function snapshot(source:Source){
 if(!source.available)throw error('batch.source-unavailable','A batch input is unavailable.');
 if((await metadata(source.path,source.allowed)).stamp!==source.stamp)throw error('batch.source-changed','A batch input changed after preflight.');
 return scanStagedWorkspace(source.path,{allowedFiles:source.allowed});
}
async function publish(path:string,content:string){
 const selected=alias(resolve(path));if(/[\p{Cc}]/u.test(path)||path.split(/[\\/]/).includes('..'))throw error('batch.output-invalid','Select a new output file without traversal.');
 const parent=await directory(dirname(selected)),identity=await lstat(parent);
 try{await lstat(selected);throw error('batch.output-exists','The output already exists; preserve it and choose a new file.');}catch(problem){if(!(problem instanceof Error&&'code'in problem&&problem.code==='ENOENT'))throw problem;}
 const stage=await mkdtemp(join(parent,'.skillsync-package-'));
 try{
  const file=join(stage,'package.json');await writeFile(file,content,{flag:'wx',mode:0o600});const handle=await open(file,'r');try{await handle.sync();}finally{await handle.close();}
  const current=await lstat(parent);if(current.dev!==identity.dev||current.ino!==identity.ino||await realpath(parent)!==parent)throw error('batch.output-changed','The output directory changed during publication.');
  await link(file,selected); // Atomic no-replace publication; no rename over a user's empty directory.
  if(process.platform!=='win32'){const directoryHandle=await open(parent,'r');try{await directoryHandle.sync();}finally{await directoryHandle.close();}}
 }catch(problem){if(problem instanceof BatchAcceptanceError)throw problem;throw error('batch.output-unavailable','Package publication failed. Inspect any retained output before retrying.');}
 finally{await rm(stage,{recursive:true,force:true});}
}

export async function runAcceptanceBatch(options:BatchRunOptions){
 try{
  const context=await planContext(options.plan);
  if(options.expectPlanSha256&&context.raw_sha256!==options.expectPlanSha256)throw error('batch.plan-changed','The plan changed after preview. Review it again.');
  if(options.retryFailed&&!options.previous)throw error('batch.previous-required','Retrying failed batches requires an explicit previous package.');
  const selected=alias(resolve(options.output));
  if(selected===context.path||selected===context.contractPath||context.sources.some(source=>inside(source.path,selected)))throw error('batch.output-overlap','Keep review packages outside source data and contract files.');
  try{await lstat(selected);throw error('batch.output-exists','The output already exists; choose a new file.');}catch(problem){if(!(problem instanceof Error&&'code'in problem&&problem.code==='ENOENT'))throw problem;}
  const previous=options.previous?await inspectAcceptancePackage(options.previous):undefined;
  const declarationSha=contentHash(context.declaration);
  if(previous&&previous.packet.payload.declaration_sha256!==declarationSha)throw error('batch.previous-plan-changed','The prior package belongs to a different plan or contract.');
  const rows:AcceptanceBatch[]=[];let evidenceBytes=0;
  for(const[index,item]of context.plan.batches.entries()){
   const source=context.sources[index],before=previous?.packet.payload.batches.find(row=>row.id===item.id);
   let tree:Awaited<ReturnType<typeof scanStagedWorkspace>>|undefined,report:ArtifactReport,mode:AcceptanceBatch['mode']='inspected';
   try{tree=await snapshot(source);}catch{tree=undefined;}
   const inventory=tree?.files.map(file=>({path:file.path.slice('workspace/'.length),bytes:file.bytes,sha256:file.digest.slice('sha256:'.length)}));
   const sourceSha=inventory?artifactSetHash(inventory):undefined;
   if(options.retryFailed&&before?.status==='passed'){
    if(!sourceSha||sourceSha!==before.source_sha256)throw error('batch.previous-input-changed','A previously passed input changed; run a new full acceptance plan.');
    report=before.report;mode='reused';
   }else if(tree){
    report=await runArtifacts({contract:context.contractPath,...(item.kind==='delivery'?{delivery:source.path}:{path:source.path}),includeRowEvidence:true});
    report=parseArtifactReport(redactLocalPaths(report));
    try{if((await snapshot(source)).digest!==tree.digest)report=unavailable(context.checked.engine,'artifact.batch-input-changed');}catch{report=unavailable(context.checked.engine,'artifact.batch-input-changed');}
   }else report=unavailable(context.checked.engine,'artifact.batch-input-unavailable');
   if(Buffer.byteLength(canonicalJson(report))>BATCH_LIMITS.max_report_bytes)report=unavailable(context.checked.engine,'artifact.batch-report-capacity');
   const row:AcceptanceBatch={id:item.id,kind:item.kind,status:batchStatus(report,sourceSha,context.declaration,item.kind),mode,
    ...(sourceSha?{source_sha256:sourceSha,source_inventory:inventory}:{}),source_files:tree?.files.length??0,source_bytes:tree?.files.reduce((sum,file)=>sum+file.bytes,0)??0,report_sha256:contentHash(report),report};
   if(before&&mode==='inspected'){
    row.previous={report_sha256:before.report_sha256,report:before.report};row.comparison=compareArtifactReports(before.report,report,before.report_sha256);
   }
   evidenceBytes+=Buffer.byteLength(canonicalJson(report))+Buffer.byteLength(canonicalJson(row.previous?.report??null));
   if(evidenceBytes>BATCH_LIMITS.max_reports_bytes)throw error('batch.evidence-capacity','The combined report evidence exceeds 8 MiB; use a smaller plan.');
   rows.push(row);
  }
  if(sha256(await readWorkspaceFile(context.contractPath,64*1024))!==context.checked.file||sha256(await readWorkspaceFile(context.path,256*1024))!==context.raw_sha256)throw error('batch.plan-changed','The plan or contract changed during acceptance.');
  const payload:BatchReport={schema:'skillsync.batch-report/v1',createdAt:new Date().toISOString(),tool_version:VERSION,declaration:context.declaration,declaration_sha256:declarationSha,
   ...(previous?{previous_package_sha256:previous.package_sha256}:{}),...summarizeBatch(rows),limits:BATCH_LIMITS,evidence:'physical-files',execution:'not-run',provenance:'not-authenticated',batches:rows};
  validateBatchReport(payload);const packet:ReviewPackage={schema:'skillsync.review-package/v1',payload_sha256:contentHash(payload),payload};
  const content=JSON.stringify(packet);if(Buffer.byteLength(content)>BATCH_LIMITS.max_package_bytes)throw error('batch.package-capacity','The review package exceeds 16 MiB.');
  parseReviewPackage(parseStrictJson(content));await publish(options.output,content+'\n');
  return {packet,package_sha256:sha256(content+'\n')};
 }catch(problem){if(problem instanceof BatchAcceptanceError)throw problem;throw error('batch.acceptance-failed','Batch acceptance could not complete; preserve existing inputs and packages.');}
}

export function batchSummary(report:BatchReport){return {schema:report.schema,status:report.status,exitCode:report.exitCode,counts:report.counts,declaration_sha256:report.declaration_sha256,
 batches:report.batches.map(({id,kind,status,mode,report_sha256,comparison})=>({id,kind,status,mode,report_sha256,...(comparison?{comparison}:{})})),execution:report.execution,provenance:report.provenance};}
