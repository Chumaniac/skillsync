import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { readRepairBackup, readRepairBackupHeader, repairScopeSchema, syncDirectory, validateRepairBackupRoot, writeSyncedFile } from '../domain/repair-backups.js';
import { assertActionPlanIntegrity, type ActionPlan } from '../domain/action-plan.js';
import { parseStrictJson } from '../domain/strict-json.js';
import { readDirectoryEntries, readWorkspaceFile, readWorkspaceText, scanStagedWorkspace, WORKSPACE_TREE_LIMITS } from '../sandbox/workspace-tree.js';
import { WorkbenchHistory, WorkbenchStateError, type Selection } from './history.js';

export const RECOVERY_COPIES_FOLDER='recovery-copies';
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const same=(a:Selection,b:Selection)=>a.path===b.path&&a.identity===b.identity&&a.kind===b.kind&&a.contract===b.contract&&a.delivery===b.delivery;
const selectionSchema=z.object({path:z.string().max(4096),identity:z.string().regex(/^\d+:\d+$/),kind:z.literal('skill'),contract:z.string().optional(),delivery:z.boolean()}).strict();
const copySchema=z.object({schema:z.literal('skillsync.recovery-copy/v1'),id:z.string().uuid(),selection:selectionSchema,backupId:z.string().max(80),planDigest:z.string().max(128),sourceSnapshot:z.string().max(128),createdAt:z.string().datetime(),outputSnapshot:z.string().max(128).optional()}).strict();
type Ready={token:string;selection:Selection;backupId:string;planDigest:string;manifestHash:string;snapshot:string;expiresAt:number;legacyPlan?:string};
const idPattern=/^slot-(?:0\d|1[0-5])\/[a-f0-9-]{36}$/;
async function sourceSnapshot(root:string){
  const stamps:Array<[string,number,number,number,number,number]>=[];
  const tree=await scanStagedWorkspace(root,{inspectFile:async name=>{const info=await lstat(join(root,name));stamps.push([name,info.mode&0o777,info.dev,info.ino,info.mtimeMs,info.ctimeMs]);}});
  return {tree,digest:'sha256:'+sha(JSON.stringify([tree.digest,stamps.sort((a,b)=>a[0].localeCompare(b[0]))]))};
}

/** Metadata stays private. A repair restores originals into a new bounded copy, never the selected directory. */
export class RepairRecovery {
  private ready?:Ready;
  constructor(private stateDir:string,private stateIdentity:string,private history:WorkbenchHistory){}
  private async state(){const info=await lstat(this.stateDir);if(`${info.dev}:${info.ino}`!==this.stateIdentity||await validateRepairBackupRoot(this.stateDir)!==this.stateDir)throw new WorkbenchStateError('私有状态目录已变化，请保留原材料后重新打开。');}
  private async selected(selection:Selection){const value=await lstat(selection.path);if(value.isSymbolicLink()||!value.isDirectory()||await realpath(selection.path)!==selection.path||`${value.dev}:${value.ino}`!==selection.identity)throw new WorkbenchStateError('所选目录已变化，请重新选择。');}
  private async backup(id:unknown){
    await this.state();if(typeof id!=='string'||!idPattern.test(id))throw new WorkbenchStateError('备份编号无效。');
    const root=join(this.stateDir,'repair-backups');await validateRepairBackupRoot(root);
    const [slot,name]=id.split('/');if(!z.string().uuid().safeParse(name).success)throw new WorkbenchStateError('备份编号无效。');await validateRepairBackupRoot(join(root,slot));
    return validateRepairBackupRoot(join(root,slot,name));
  }
  private async scoped(directory:string,selection:Selection,planDigest:string,legacyPlan?:unknown){
    const exists=await lstat(join(directory,'scope.json')).then(()=>true).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;});
    if(exists){const scope=repairScopeSchema.parse(parseStrictJson(await readWorkspaceText(join(directory,'scope.json'),16384)));if(scope.rootPath!==selection.path||scope.rootIdentity!==selection.identity||scope.planDigest!==planDigest)throw new WorkbenchStateError('这份备份不属于当前目录。');return;}
    if(typeof legacyPlan!=='string')throw new WorkbenchStateError('旧版备份需要选择当前目录的原修复计划后再核对。');
    const {record,output}=await this.history.read(legacyPlan);
    if(record.kind!=='plan'||!same(record.selection,selection)||!output)throw new WorkbenchStateError('原计划与当前目录不匹配。');
    const plan=parseStrictJson(output) as ActionPlan;assertActionPlanIntegrity(plan);
    if(plan.planDigest!==planDigest||plan.rootPath!==selection.path||plan.rootIdentity&&plan.rootIdentity!==selection.identity)throw new WorkbenchStateError('备份与原修复计划不匹配。');
  }
  async list(selection:Selection){
    await this.state();const items:Array<{id:string;createdAt?:string;files?:number;bytes?:number;legacy:boolean;state:string}>=[];
    const root=join(this.stateDir,'repair-backups');
    try{await validateRepairBackupRoot(root);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {items,plans:await this.history.repairPlans(selection),copies:await this.references(selection)};throw error;}
    for(const slot of await readDirectoryEntries(root,16)){
      if(!/^slot-(?:0\d|1[0-5])$/.test(slot.name)||!slot.isDirectory()||slot.isSymbolicLink())throw new WorkbenchStateError('备份目录包含未识别材料，原件已保留。');
      const folder=await validateRepairBackupRoot(join(root,slot.name));
      const children=await readDirectoryEntries(folder,1);
      for(const child of children){
        const id=slot.name+'/'+child.name;if(!idPattern.test(id))throw new WorkbenchStateError('备份目录包含未识别材料，原件已保留。');
        const directory=await this.backup(id);let legacy=false;
        try{const scope=repairScopeSchema.parse(parseStrictJson(await readWorkspaceText(join(directory,'scope.json'),16384)));if(scope.rootPath!==selection.path||scope.rootIdentity!==selection.identity)continue;}
        catch(error){const missing=await lstat(join(directory,'scope.json')).then(()=>false).catch(e=>{if((e as NodeJS.ErrnoException).code==='ENOENT')return true;throw e;});if(missing)legacy=true;else throw error;}
        try{const {manifest,bytes}=await readRepairBackupHeader(directory);items.push({id,createdAt:manifest.createdAt,files:manifest.files.length,bytes,legacy,state:'unchecked'});}
        catch{items.push({id,legacy,state:'incomplete'});}
      }
    }
    return {items,plans:await this.history.repairPlans(selection),copies:await this.references(selection)};
  }
  async check(id:unknown,selection:Selection,legacyPlan?:unknown){
    if(selection.kind!=='skill')throw new WorkbenchStateError('恢复副本只用于当前选择的 Skill 目录。');
    await this.selected(selection);
    const directory=await this.backup(id),data=await readRepairBackup(directory);await this.scoped(directory,selection,data.manifest.planDigest,legacyPlan);
    const tree=await sourceSnapshot(selection.path);
    this.ready={token:randomUUID(),selection:{...selection},backupId:id as string,planDigest:data.manifest.planDigest,manifestHash:sha(JSON.stringify(data.manifest)),snapshot:tree.digest,expiresAt:Date.now()+10*60_000,...(typeof legacyPlan==='string'?{legacyPlan}:{})};
    return {token:this.ready.token,files:data.manifest.files.length,bytes:data.bytes,snapshot:tree.digest,expiresAt:this.ready.expiresAt,sourceAuthentication:'not-authenticated',message:'副本中的备份文件恢复为修复前版本，其他文件使用当前目录内容；原目录保持。副本仍需重新核验。'};
  }
  async restore(token:unknown,selection:Selection,operationId:string,cancelled:()=>boolean,finalizing:()=>void=()=>{}){
    const ready=this.ready;this.ready=undefined;
    if(!ready||token!==ready.token||!same(ready.selection,selection)||ready.expiresAt<=Date.now())throw new WorkbenchStateError('恢复确认已过期或目录已切换，请重新检查备份。');
    const directory=await this.backup(ready.backupId),data=await readRepairBackup(directory);
    await this.scoped(directory,selection,data.manifest.planDigest,ready.legacyPlan);
    if(data.manifest.planDigest!==ready.planDigest||sha(JSON.stringify(data.manifest))!==ready.manifestHash)throw new WorkbenchStateError('备份已变化，请重新检查。');
    await this.selected(selection);const initial=await sourceSnapshot(selection.path);
    if(initial.digest!==ready.snapshot)throw new WorkbenchStateError('当前目录已变化，请重新检查备份与范围。');
    const finalFiles=new Map(initial.tree.files.map(file=>[file.path,file.bytes]));for(const file of data.manifest.files)finalFiles.set('workspace/'+file.path,file.bytes);
    if(finalFiles.size>WORKSPACE_TREE_LIMITS.maxFiles||[...finalFiles.values()].reduce((sum,value)=>sum+value,0)>WORKSPACE_TREE_LIMITS.maxTotalBytes)throw new WorkbenchStateError('恢复后的副本超过64MiB或文件数上限，请保留原材料并缩小范围。');
    const copies=join(this.stateDir,RECOVERY_COPIES_FOLDER);await mkdir(copies,{recursive:true,mode:0o700});
    await validateRepairBackupRoot(copies);
    const entries=await readDirectoryEntries(copies,4);if(entries.some(e=>!/^slot-0[0-3]$/.test(e.name)))throw new WorkbenchStateError('恢复目录包含未识别材料，未删除任何文件。');
    let slot:string|undefined;
    for(let i=0;i<4;i++){const value=join(copies,`slot-0${i}`);try{await mkdir(value,{mode:0o700});slot=value;break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}
    if(!slot)throw new WorkbenchStateError('已保留4份恢复材料。请先核对并归档私有 recovery-copies 中的目录，原件不会自动淘汰。');
    const copy=join(slot,'workspace');await mkdir(copy,{mode:0o700});
    const metadata=copySchema.parse({schema:'skillsync.recovery-copy/v1',id:operationId,selection,backupId:ready.backupId,planDigest:ready.planDigest,sourceSnapshot:ready.snapshot,createdAt:new Date().toISOString()});
    await writeSyncedFile(join(slot,'META.json'),JSON.stringify(metadata));await writeSyncedFile(join(slot,'INCOMPLETE'),'retained recovery material');await syncDirectory(slot);
    const stop=()=>{if(cancelled())throw new WorkbenchStateError('恢复已停止，原目录未改动；新目录中的不完整材料保留。');};
    try{await scanStagedWorkspace(selection.path,{inspectFile:async(name,content)=>{stop();const dest=join(copy,name);await mkdir(join(dest,'..'),{recursive:true,mode:0o700});const mode=(await lstat(join(selection.path,name))).mode&0o777;const file=await open(dest,'wx',0o600);try{await file.writeFile(content);await file.sync();}finally{await file.close();}await chmod(dest,mode);}});}catch(error){stop();throw error;}
    for(const file of data.manifest.files){stop();const content=await readWorkspaceFile(join(directory,'files',file.path),WORKSPACE_TREE_LIMITS.maxFileBytes);if(content.length!==file.bytes||sha(content)!==file.sha256)throw new WorkbenchStateError('备份读取期间变化，恢复副本尚未完成。');const dest=join(copy,file.path);await mkdir(join(dest,'..'),{recursive:true,mode:0o700});const handle=await open(dest,constants.O_WRONLY|constants.O_TRUNC|constants.O_CREAT|(constants.O_NOFOLLOW??0),0o600);try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}await chmod(dest,file.mode);}
    stop();if((await sourceSnapshot(selection.path)).digest!==ready.snapshot)throw new WorkbenchStateError('源目录在恢复期间变化，副本材料保留但不能当作完成。');
    await this.selected(selection);const restored=await sourceSnapshot(copy);stop();
    finalizing();await syncDirectory(copy);await writeSyncedFile(join(slot,'RESTORE.json'),JSON.stringify({...metadata,outputSnapshot:restored.digest}));await syncDirectory(slot);await unlink(join(slot,'INCOMPLETE'));await syncDirectory(slot);
    return {id:operationId,path:copy,files:restored.tree.files.length,snapshot:restored.digest,originalUnchanged:true,requiresVerification:true};
  }
  async references(selection:Selection){
    await this.state();const root=join(this.stateDir,RECOVERY_COPIES_FOLDER),items:Array<{id:string;createdAt:string;state:string}>=[];
    try{await validateRepairBackupRoot(root);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return items;throw error;}
    for(const entry of await readDirectoryEntries(root,4)){if(!/^slot-0[0-3]$/.test(entry.name))throw new WorkbenchStateError('恢复材料布局待核对。');const slot=await validateRepairBackupRoot(join(root,entry.name));try{const info=copySchema.parse(parseStrictJson(await readWorkspaceText(join(slot,'META.json'),32768)));if(same(info.selection,selection))items.push({id:info.id,createdAt:info.createdAt,state:await lstat(join(slot,'INCOMPLETE')).then(()=>'incomplete').catch(()=>'recorded')});}catch{/* Unknown partial material stays on disk and consumes its slot. */}}
    return items;
  }
  async status(id:unknown,selection:Selection){
    await this.state();if(typeof id!=='string'||!z.string().uuid().safeParse(id).success)throw new WorkbenchStateError('恢复编号无效。');
    const root=join(this.stateDir,RECOVERY_COPIES_FOLDER);
    try{await validateRepairBackupRoot(root);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {id,status:'not-found' as const};throw error;}
    for(const entry of await readDirectoryEntries(root,4)){
      if(!/^slot-0[0-3]$/.test(entry.name))throw new WorkbenchStateError('恢复材料布局待核对。');
      const slot=await validateRepairBackupRoot(join(root,entry.name));
      const pending=copySchema.parse(parseStrictJson(await readWorkspaceText(join(slot,'META.json'),32768)));if(pending.id!==id)continue;if(!same(pending.selection,selection))throw new WorkbenchStateError('此恢复材料不属于当前选择。');
      const incomplete=await lstat(join(slot,'INCOMPLETE')).then(()=>true).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;});
      if(incomplete)return {id,status:'incomplete' as const,path:slot};
      const info=copySchema.parse(parseStrictJson(await readWorkspaceText(join(slot,'RESTORE.json'),32768)));
      if(info.id!==id)throw new WorkbenchStateError('恢复结果编号不匹配。');if(!same(info.selection,selection))throw new WorkbenchStateError('此副本不属于当前选择。');
      const path=join(slot,'workspace');if(await realpath(path)!==path||(await lstat(path)).isSymbolicLink())throw new WorkbenchStateError('副本目录已变化。');
      const current=await sourceSnapshot(path);if(current.digest!==info.outputSnapshot)return {id,status:'modified' as const,path};
      return {id,status:'ready' as const,path,snapshot:info.outputSnapshot,metadata:info};
    }
    return {id,status:'not-found' as const};
  }
  async copy(id:unknown,selection:Selection){
    const value=await this.status(id,selection);
    if(value.status!=='ready')throw new WorkbenchStateError('尚未找到可核验的完整副本，请保留原材料并先查询恢复状态。');
    return value;
  }
}
