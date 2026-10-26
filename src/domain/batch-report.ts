import {createHash} from "node:crypto";
import {z} from "zod";
import {parseArtifactReport, artifactSetHash, type ArtifactReport, artifactComparisonSchema} from "./artifact-report.js";
import {compareArtifactReports} from "./artifact-report-comparison.js";

export const BATCH_LIMITS={max_batches:16,max_input_files:10000,max_input_entries:20000,max_input_bytes:67108864,max_report_bytes:1048576,max_reports_bytes:8388608,max_package_bytes:16777216} as const;
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,47}$/);
const path=z.string().min(1).max(1024).refine(value=>!value.includes('\\')&&!value.includes(':')&&!/\p{Cc}/u.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'));
const kind=z.enum(['artifacts','delivery']);
export const acceptancePlanSchema=z.object({schema:z.literal('skillsync.acceptance-plan/v1'),contract:path,batches:z.array(z.object({id,path,kind:kind.default('artifacts')}).strict()).min(1).max(16)}).strict().superRefine((plan,context)=>{
 if(new Set(plan.batches.map(item=>item.id.toLowerCase())).size!==plan.batches.length)context.addIssue({code:z.ZodIssueCode.custom,message:'duplicate batch identity'});
});
export type AcceptancePlan=z.infer<typeof acceptancePlanSchema>;
const declarationSchema=z.object({schema:z.literal('skillsync.acceptance-declaration/v1'),plan_sha256:sha,contract_sha256:sha,contract_file_sha256:sha,file_paths:z.array(path).min(1).max(10000),batches:z.array(z.object({id,kind}).strict()).min(1).max(16)}).strict();
export type AcceptanceDeclaration=z.infer<typeof declarationSchema>;
const report=z.unknown().transform((value,context):ArtifactReport=>{
 try{return parseArtifactReport(value);}catch{context.addIssue({code:z.ZodIssueCode.custom,message:'invalid artifact report'});return z.NEVER;}
});
const previousSchema=z.object({report_sha256:sha,report}).strict();
const sourceFile=z.object({path,bytes:z.number().int().min(0).max(16777216),sha256:sha}).strict();
const caseSchema=z.object({id,kind,status:z.enum(['passed','failed','incomplete']),mode:z.enum(['inspected','reused']),source_inventory:z.array(sourceFile).max(10000).optional(),
 source_sha256:sha.optional(),source_files:z.number().int().min(0).max(10000),source_bytes:z.number().int().min(0).max(BATCH_LIMITS.max_input_bytes),
 report_sha256:sha,report,previous:previousSchema.optional(),comparison:artifactComparisonSchema.optional()}).strict();
export type AcceptanceBatch=z.infer<typeof caseSchema>;
const counts=z.object({passed:z.number().int().min(0).max(16),failed:z.number().int().min(0).max(16),incomplete:z.number().int().min(0).max(16),reused:z.number().int().min(0).max(16),inspected:z.number().int().min(0).max(16)}).strict();
const limits=z.object({max_batches:z.literal(16),max_input_files:z.literal(10000),max_input_entries:z.literal(20000),max_input_bytes:z.literal(67108864),max_report_bytes:z.literal(1048576),max_reports_bytes:z.literal(8388608),max_package_bytes:z.literal(16777216)}).strict();
export const batchReportSchema=z.object({schema:z.literal('skillsync.batch-report/v1'),createdAt:z.string().datetime(),tool_version:z.string().min(1).max(64),
 declaration:declarationSchema,declaration_sha256:sha,previous_package_sha256:sha.optional(),
 status:z.enum(['passed','failed','incomplete']),exitCode:z.union([z.literal(0),z.literal(1),z.literal(2)]),counts,limits,
 evidence:z.literal('physical-files'),execution:z.literal('not-run'),provenance:z.literal('not-authenticated'),batches:z.array(caseSchema).min(1).max(16)}).strict();
export type BatchReport=z.infer<typeof batchReportSchema>;
const packageSchema=z.object({schema:z.literal('skillsync.review-package/v1'),payload_sha256:sha,payload:batchReportSchema}).strict();
export type ReviewPackage=z.infer<typeof packageSchema>;

export class BatchAcceptanceError extends Error {
 readonly exitCode=2;
 constructor(readonly code:string,message:string){super(message);this.name='BatchAcceptanceError';}
}
export const sha256=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');

/** Shared canonical form; hashes detect integrity changes, not authorship. */
export function canonicalJson(value:unknown):string {
 let keys=0;
 function encode(item:unknown,depth:number):string {
  if(depth>64)throw new BatchAcceptanceError('batch.metadata-capacity','Batch metadata depth exceeded.');
  if(item===null||typeof item!=='object'){const result=JSON.stringify(item);if(result===undefined)throw new BatchAcceptanceError('batch.metadata-invalid','Invalid batch metadata.');return result;}
  if(Array.isArray(item))return '['+item.map(child=>encode(child,depth+1)).join(',')+']';
  const record=item as Record<string,unknown>,names=Object.keys(record).filter(key=>record[key]!==undefined).sort();
  keys+=names.length;if(keys>100000)throw new BatchAcceptanceError('batch.metadata-capacity','Batch metadata key budget exceeded.');
  return '{'+names.map(key=>JSON.stringify(key)+':'+encode(record[key],depth+1)).join(',')+'}';
 }
 return encode(value,0);
}
export const contentHash=(value:unknown)=>sha256(canonicalJson(value));

export function batchStatus(report:ArtifactReport,source:string|undefined,declaration:AcceptanceDeclaration,batchKind:'artifacts'|'delivery'):AcceptanceBatch['status'] {
 if(!source||report.exitCode===2||!report.artifact_set_sha256||report.findings.length>=256||report.comparison?.status==='unavailable'||report.reconciliations?.some(item=>item.status==='unknown'))return 'incomplete';
 if(report.status==='failed')return 'failed';
 if(!report.declarations||report.contract_sha256!==declaration.contract_sha256||batchKind==='delivery'&&report.receipt_binding!=='verified'||
  report.files.length!==declaration.file_paths.length||report.files.some(file=>!declaration.file_paths.includes(file.path)))return 'incomplete';
 return 'passed';
}
export function batchCounts(batches:AcceptanceBatch[]):BatchReport['counts'] {
 return {passed:batches.filter(item=>item.status==='passed').length,failed:batches.filter(item=>item.status==='failed').length,
  incomplete:batches.filter(item=>item.status==='incomplete').length,reused:batches.filter(item=>item.mode==='reused').length,inspected:batches.filter(item=>item.mode==='inspected').length};
}
export function summarizeBatch(batches:AcceptanceBatch[]):Pick<BatchReport,'status'|'exitCode'|'counts'> {
 const counts=batchCounts(batches);return {counts,status:counts.incomplete?'incomplete':counts.failed?'failed':'passed',exitCode:counts.incomplete?2:counts.failed?1:0};
}

export function validateBatchReport(input:unknown):BatchReport {
 try{
  const payload=batchReportSchema.parse(input),expected=summarizeBatch(payload.batches);
  if(contentHash(payload.declaration)!==payload.declaration_sha256||canonicalJson(expected.counts)!==canonicalJson(payload.counts)||payload.status!==expected.status||payload.exitCode!==expected.exitCode||
   new Set(payload.declaration.file_paths).size!==payload.declaration.file_paths.length||new Set(payload.batches.map(item=>item.id.toLowerCase())).size!==payload.batches.length||payload.batches.length!==payload.declaration.batches.length)throw Error();
  let reportBytes=0,sourceBytes=0,sourceFiles=0;
  for(const[index,item]of payload.batches.entries()){
   const declared=payload.declaration.batches[index];
   if(item.id!==declared.id||item.kind!==declared.kind||contentHash(item.report)!==item.report_sha256||
    item.report.contract_sha256!==payload.declaration.contract_sha256||item.status!==batchStatus(item.report,item.source_sha256,payload.declaration,item.kind)||
    item.source_files<item.report.files.length||item.source_bytes<item.report.files.reduce((sum,file)=>sum+file.bytes,0)||
    item.mode==='reused'&&(item.status!=='passed'||!payload.previous_package_sha256))throw Error();
   const inventory=item.source_inventory;
   if(inventory){
    if(!item.source_sha256||new Set(inventory.map(file=>file.path)).size!==inventory.length||inventory.length!==item.source_files||inventory.reduce((sum,file)=>sum+file.bytes,0)!==item.source_bytes||artifactSetHash(inventory)!==item.source_sha256)throw Error();
    const allowed=new Set(item.kind==='delivery'?['receipt.json','delivery.json',...payload.declaration.file_paths.map(path=>'artifacts/'+path)]:payload.declaration.file_paths);
    if(inventory.some(file=>!allowed.has(file.path)))throw Error();
    const artifacts=inventory.filter(file=>item.kind!=='delivery'||file.path.startsWith('artifacts/')).map(file=>({...file,path:item.kind==='delivery'?file.path.slice(10):file.path}));
    if(item.report.artifact_set_sha256&&artifactSetHash(artifacts)!==item.report.artifact_set_sha256||item.report.files.some(file=>!artifacts.some(input=>input.path===file.path&&input.sha256===file.sha256&&input.bytes===file.bytes)))throw Error();
   }else if(item.source_sha256||item.source_files||item.source_bytes)throw Error();
   const current=Buffer.byteLength(canonicalJson(item.report));if(current>BATCH_LIMITS.max_report_bytes)throw Error();reportBytes+=current;
   sourceBytes+=item.source_bytes;sourceFiles+=item.source_files;
   if(item.previous){
    const prior=Buffer.byteLength(canonicalJson(item.previous.report));if(prior>BATCH_LIMITS.max_report_bytes||contentHash(item.previous.report)!==item.previous.report_sha256||!payload.previous_package_sha256)throw Error();reportBytes+=prior;
    const compared=compareArtifactReports(item.previous.report,item.report,item.previous.report_sha256);
    if(!item.comparison||canonicalJson(compared)!==canonicalJson(item.comparison))throw Error();
   }else if(item.comparison)throw Error();
  }
  if(reportBytes>BATCH_LIMITS.max_reports_bytes||sourceBytes>BATCH_LIMITS.max_input_bytes||sourceFiles>BATCH_LIMITS.max_input_files)throw Error();
  return payload;
 }catch(error){if(error instanceof BatchAcceptanceError)throw error;throw new BatchAcceptanceError('batch.package-invalid','The review package is inconsistent or unsupported.');}
}
export function parseReviewPackage(input:unknown):ReviewPackage {
 try{
  const packet=packageSchema.parse(input),payload=validateBatchReport(packet.payload);
  if(contentHash(payload)!==packet.payload_sha256)throw Error();
  return {...packet,payload};
 }catch(error){if(error instanceof BatchAcceptanceError)throw error;throw new BatchAcceptanceError('batch.package-invalid','The review package integrity could not be verified.');}
}
