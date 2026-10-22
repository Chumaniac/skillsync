import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { parseStrictJson } from "../domain/strict-json.js";
import { readDirectoryEntries, readWorkspaceText } from "../sandbox/workspace-tree.js";

export const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_META = 16 * 1024;
const MAX_STATE = 64 * 1024 * 1024;
const MAX_FILES = 120;
const uuid = z.string().uuid();
const absolutePath = z.string().min(1).max(4096).refine(v => isAbsolute(v) && !/[\p{Cc}]/u.test(v));
const selectionSchema = z.object({ path:absolutePath, identity:z.string().regex(/^\d+:\d+$/),
  kind:z.enum(["skill","artifacts"]), contract:absolutePath.optional(), delivery:z.boolean() }).strict();
export type Selection = z.infer<typeof selectionSchema>;
const comparisonSchema = z.object({ status:z.enum(["compared","unavailable"]),
  added:z.number().int().nonnegative().optional(), ongoing:z.number().int().nonnegative().optional(),
  resolved:z.number().int().nonnegative().optional(), changed:z.number().int().nonnegative().optional(), reason:z.string().max(100).optional() }).strict();
export type HistoryComparison = z.infer<typeof comparisonSchema>;
const recordSchema = z.object({ schema:z.literal("skillsync.workbench-history/v1"), id:uuid,
  createdAt:z.string().datetime(), kind:z.enum(["verify","plan","apply-intent","apply"]),
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
    const entries = await readDirectoryEntries(this.root, MAX_FILES);
    let bytes = 0;
    for (const entry of entries) {
      const info = await lstat(join(this.root,entry.name));
      if (!info.isFile() || info.isSymbolicLink()) throw new WorkbenchStateError("状态目录包含非普通文件，请检查；原结果未删除。");
      bytes += info.size;
    }
    if (bytes>MAX_STATE) throw new WorkbenchStateError("状态目录超过容量上限，请选择新的状态目录；原结果已保留。");
    return {entries,bytes};
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
    if (dataFile) await writeFile(join(this.root,dataFile),output!,{flag:"wx",mode:0o600});
    // Publishing the index last keeps incomplete writes out of completed history.
    await writeFile(join(this.root,`${id}-history.json`),index,{flag:"wx",mode:0o600});
    return record;
  }
  private async metadata(id:unknown) {
    const key=uuid.parse(id);
    const record=recordSchema.parse(parseStrictJson(await readWorkspaceText(join(this.root,`${key}-history.json`),MAX_META)));
    if(record.id!==key || (record.dataFile && record.dataFile!==`${key}-data.json`))throw new Error("历史关联不匹配。");
    return record;
  }
  async list(offset=0) {
    if(!Number.isInteger(offset)||offset<0||offset>=MAX_FILES)throw new Error("历史页码无效。");
    const {entries,bytes}=await this.entries();
    const rows:HistoryRecord[]=[];let unavailable=0;
    for(const entry of entries)if(/^[a-f0-9-]{36}-history\.json$/.test(entry.name)) {
      try { rows.push(await this.metadata(entry.name.slice(0,-13))); } catch { unavailable++; }
    }
    rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
    return {items:rows.slice(offset,offset+12).map(({id,createdAt,kind,selection,exitCode,baselineId,parentId})=>
      ({id,createdAt,kind,label:selection.path.split(/[\\/]/).at(-1),exitCode,baselineId,parentId})),total:rows.length,offset,unavailable,
      capacity:{files:entries.length,bytes,maxFiles:MAX_FILES,maxBytes:MAX_STATE}};
  }
  async read(id:unknown) {
    await this.entries();
    const record=await this.metadata(id);
    const output=record.dataFile?await readWorkspaceText(join(this.root,record.dataFile),MAX_OUTPUT):undefined;
    if(output!==undefined && sha(output)!==record.dataSha256)throw new Error("历史材料摘要不匹配。");
    return {record,output};
  }
}

/** Deliberately only a summary: no bookmarked paths, raw reports or backup paths. */
export function exportHistorySummary(record:HistoryRecord) {
  const c=record.comparison;
  const comparison=c?.status==="compared"?`新增 ${c.added} · 仍然存在 ${c.ongoing} · 同类项证据变化 ${c.changed??0} · 本次不再出现 ${c.resolved}`:"尚无可比较基线";
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'"><title>SkillSync 核验对照摘要</title><h1>核验对照摘要</h1><p>${record.createdAt}</p><p>记录：${record.id}</p><p>基线：${record.baselineId??"未选择"}</p><p>退出码：${record.exitCode??"不适用"}</p><p>${comparison}</p><p>声明范围的本机核验；摘要不含文件内容和本机位置，不代表作者认证或执行许可。</p></html>`;
}
