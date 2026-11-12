import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath, rename } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { parseStrictJson } from "../domain/strict-json.js";
import { readDirectoryEntries, readWorkspaceText } from "../sandbox/workspace-tree.js";
import {parseComparisonReport,compareVerificationReports} from "./verification-comparison.js";
import {compareArtifactReports,parseArtifactReport} from "../domain/artifact-report-comparison.js";

import { REPAIR_BACKUP_FOLDER, syncDirectory, validateRepairBackupRoot, writeSyncedFile } from "../domain/repair-backups.js";

export const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_META = 16 * 1024;
const MAX_STATE = 64 * 1024 * 1024;
const MAX_FILES = 120;
const uuid = z.string().uuid();
const taskKind = z.enum(["verify","plan","apply-intent","apply"]);
const filtersSchema = z.object({
  query: z.string().max(128).refine(value => !/[\\/\p{Cc}]/u.test(value)).default("").transform(value => value.trim().toLowerCase()),
  kind: taskKind.optional(),
  exitCode: z.number().int().min(0).max(4).optional(),
}).strict();
const absolutePath = z.string().min(1).max(4096).refine(v => isAbsolute(v) && !/[\p{Cc}]/u.test(v));
const selectionSchema = z.object({ path:absolutePath, identity:z.string().regex(/^\d+:\d+$/),
  kind:z.enum(["skill","artifacts"]), contract:absolutePath.optional(), delivery:z.boolean() }).strict();
export type Selection = z.infer<typeof selectionSchema>;
const comparisonSchema = z.object({ status:z.enum(["compared","unavailable"]),
  added:z.number().int().nonnegative().optional(), ongoing:z.number().int().nonnegative().optional(),
  resolved:z.number().int().nonnegative().optional(), changed:z.number().int().nonnegative().optional(), reason:z.string().max(100).optional() }).strict();
export type HistoryComparison = z.infer<typeof comparisonSchema>;
const recordSchema = z.object({ schema:z.literal("skillsync.workbench-history/v1"), id:uuid,
  createdAt:z.string().datetime(), kind:taskKind,
  selection:selectionSchema, snapshot:z.string().max(128).optional(), baselineId:uuid.optional(), parentId:uuid.optional(),
  dataFile:z.string().regex(/^[a-f0-9-]{36}-data\.json$/).optional(), dataSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  exitCode:z.number().int().min(0).max(4).optional(), comparison:comparisonSchema.optional(),
}).strict().refine(r => r.kind === "apply-intent" ? !r.dataFile && !r.dataSha256 : Boolean(r.dataFile && r.dataSha256));
export type HistoryRecord = z.infer<typeof recordSchema>;
const sha = (value:string) => createHash("sha256").update(value).digest("hex");
const identity = (s:{dev:number;ino:number}) => `${s.dev}:${s.ino}`;
export class WorkbenchStateError extends Error {}

/** Immutable, small index records. Listing never loads report bodies or prunes data. */
export class WorkbenchHistory {
  constructor(private readonly root:string, private readonly rootIdentity:string) {}
  private async entries() {
    const root = await lstat(this.root);
    if (!root.isDirectory() || root.isSymbolicLink() || identity(root)!==this.rootIdentity || await realpath(this.root)!==this.root) throw new WorkbenchStateError("状态目录已变化，请停止操作并检查原目录。");
    const entries = await readDirectoryEntries(this.root, MAX_FILES + 1);
    let bytes = 0; const reports = [];
    for (const entry of entries) {
      if (entry.name === REPAIR_BACKUP_FOLDER) { await validateRepairBackupRoot(join(this.root, entry.name)); continue; }
      reports.push(entry);
      const info = await lstat(join(this.root,entry.name));
      if (!info.isFile() || info.isSymbolicLink()) throw new WorkbenchStateError("状态目录包含非普通文件，请检查；原结果未删除。");
      bytes += info.size;
    }
    if (bytes>MAX_STATE) throw new WorkbenchStateError("状态目录超过容量上限，请选择新的状态目录；原结果已保留。");
    if (reports.length > MAX_FILES) throw new WorkbenchStateError("历史文件超过上限，原材料已保留。");
    return {entries:reports,bytes};
  }
  async capacity(files=2, bytes=MAX_OUTPUT+MAX_META) {
    const current=await this.entries();
    if (current.entries.length+files>MAX_FILES || current.bytes+bytes>MAX_STATE) throw new WorkbenchStateError("状态目录已满；原结果已保留，请选择新的状态目录。");
  }
  async append(input:Omit<HistoryRecord,"schema"|"id"|"createdAt"|"dataFile"|"dataSha256">, output?:string) {
    const id=randomUUID(), dataFile=output===undefined?undefined:`${id}-data.json`;
    const record=recordSchema.parse({...input,schema:"skillsync.workbench-history/v1",id,createdAt:new Date().toISOString(),
      ...(dataFile?{dataFile,dataSha256:sha(output!)}:{})});
    const index=JSON.stringify(record);
    if (Buffer.byteLength(index)>MAX_META || (output!==undefined && Buffer.byteLength(output)>MAX_OUTPUT)) throw new Error("历史记录超过上限。");
    await this.capacity(output===undefined?1:2,Buffer.byteLength(index)+Buffer.byteLength(output??""));
    const publish = async (name: string, text: string) => {
      const pending = join(this.root, `.${name}.tmp`);
      await writeSyncedFile(pending, text);
      await rename(pending, join(this.root, name));
      await syncDirectory(this.root);
    };
    if (dataFile) await publish(dataFile, output!);
    // Failed staging/output remains discoverable and is never counted as completed.
    await publish(`${id}-history.json`, index);
    return record;
  }
  private async metadata(id:unknown) {
    const key=uuid.parse(id);
    const record=recordSchema.parse(parseStrictJson(await readWorkspaceText(join(this.root,`${key}-history.json`),MAX_META)));
    if(record.id!==key || (record.dataFile && record.dataFile!==`${key}-data.json`))throw new Error("历史关联不匹配。");
    return record;
  }
  async list(offset=0, filters:unknown={}) {
    if(!Number.isInteger(offset)||offset<0||offset>=MAX_FILES)throw new Error("历史页码无效。");
    const parsed=filtersSchema.safeParse(filters);
    if(!parsed.success)throw new WorkbenchStateError("历史筛选条件无效，请使用目录名、任务类型和退出码 0–4。");
    const {query,kind,exitCode}=parsed.data;
    const {entries,bytes}=await this.entries();
    const rows:HistoryRecord[]=[]; const incomplete = new Set<string>();
    const names = new Set(entries.map(entry => entry.name));
    for(const entry of entries)if(/^[a-f0-9-]{36}-history\.json$/.test(entry.name)) {
      const id = entry.name.slice(0, -13);
      try {
        const record = await this.metadata(id);
        if (record.dataFile && !names.has(record.dataFile)) throw new Error('History output is missing.');
        rows.push(record);
      } catch { incomplete.add(id); }
    }
    const completed = new Set(rows.map(row => row.id));
    for (const entry of entries) {
      const match = /^\.?([a-f0-9-]{36})-(?:data|history)\.json(?:\.tmp)?$/.exec(entry.name);
      if (match && !completed.has(match[1])) incomplete.add(match[1]);
    }
    const unavailable = incomplete.size;
    const recovery = [...incomplete].sort().map(id => ({ id, status: 'incomplete-material' as const, readOnly: true }));
    rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
    const summaries=rows.map(({id,createdAt,kind,selection,exitCode,baselineId,parentId})=>
      ({id,createdAt,kind,label:selection.path.split(/[\\/]/).filter(Boolean).at(-1)??"",exitCode,baselineId,parentId}));
    const matches=summaries.filter(row=>(!query||row.label.toLowerCase().includes(query))
      &&(!kind||row.kind===kind)&&(exitCode===undefined||row.exitCode===exitCode));
    return {items:matches.slice(offset,offset+12),total:matches.length,offset,unavailable,recovery,
      capacity:{files:entries.length,bytes,maxFiles:MAX_FILES,maxBytes:MAX_STATE}};
  }
  async read(id:unknown) {
    await this.entries();
    const record=await this.metadata(id);
    return {record,output:await this.output(record)};
  }
  private async output(record:HistoryRecord) {
    const output=record.dataFile?await readWorkspaceText(join(this.root,record.dataFile),MAX_OUTPUT):undefined;
    if(output!==undefined && sha(output)!==record.dataSha256)throw new Error("历史材料摘要不匹配。");
    return output;
  }
  async compare(beforeId:unknown,afterId:unknown) {
    const first=uuid.parse(beforeId),second=uuid.parse(afterId);
    if(first===second)throw new WorkbenchStateError("请选择两份不同的历史记录。");
    await this.entries();
    const before=await this.metadata(first),after=await this.metadata(second);
    const identity=(record:HistoryRecord)=>({id:record.id,createdAt:record.createdAt,reportSha256:record.dataSha256,exitCode:record.exitCode});
    const base={schema:"skillsync.history-comparison/v1",before:identity(before),after:identity(after),kind:before.selection.kind,
      readOnly:true,execution:"not-run",provenance:"not-authenticated"};
    const unavailable=(reason:string)=>({...base,status:"unavailable" as const,reason});
    if(before.kind!=="verify"||after.kind!=="verify")return unavailable("not-verification");
    if(JSON.stringify(before.selection)!==JSON.stringify(after.selection))return unavailable("selection-changed");
    // Scope predicates precede any body read. Do not reopen current source directories.
    const left=await this.output(before),right=await this.output(after);
    try {
      if(before.selection.kind==="skill"){
        const a=parseComparisonReport(parseStrictJson(left!)),b=parseComparisonReport(parseStrictJson(right!));
        if(a.exitCode!==before.exitCode||b.exitCode!==after.exitCode)return unavailable("incomplete-evidence");
        if(JSON.stringify(a.targets.map(row=>[row.name,row.scope,row.profileId]))!==JSON.stringify(b.targets.map(row=>[row.name,row.scope,row.profileId])))return unavailable("declared-targets-changed");
        return {...base,...compareVerificationReports(a,b)};
      }
      const a=parseArtifactReport(parseStrictJson(left!)),b=parseArtifactReport(parseStrictJson(right!));
      if(a.exitCode!==before.exitCode||b.exitCode!==after.exitCode)return unavailable("incomplete-evidence");
      const compared=compareArtifactReports(a,b,before.dataSha256!);
      if(compared.status!=="compared")return unavailable(compared.reason??"incomplete-evidence");
      const details=(compared.checks??[]).filter(row=>row.change!=="unchanged").map(row=>({code:"reconciliation."+row.index,change:row.change,count:1}));
      return {...base,status:"compared" as const,counts:compared.findings!,details:details.slice(0,32),detailsTotal:details.length,detailsTruncated:details.length>32};
    }catch{return unavailable("invalid-evidence");}
  }
}

/** Deliberately only a summary: no bookmarked paths, raw reports or backup paths. */
export function exportHistorySummary(record:HistoryRecord) {
  const c=record.comparison;
  const comparison=c?.status==="compared"?`新增 ${c.added} · 仍然存在 ${c.ongoing} · 同类项证据变化 ${c.changed??0} · 本次不再出现 ${c.resolved}`:"尚无可比较基线";
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'"><title>SkillSync 核验对照摘要</title><h1>核验对照摘要</h1><p>${record.createdAt}</p><p>记录：${record.id}</p><p>基线：${record.baselineId??"未选择"}</p><p>退出码：${record.exitCode??"不适用"}</p><p>${comparison}</p><p>声明范围的本机核验；摘要不含文件内容和本机位置，不代表作者认证或执行许可。</p></html>`;
}
