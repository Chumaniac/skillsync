import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createRepairBackup } from '../../src/domain/repair-backups.js';
import { RepairRecovery } from '../../src/workbench/repair-recovery.js';
import { WorkbenchHistory, type Selection } from '../../src/workbench/history.js';

const owned:string[]=[];
afterEach(async()=>{for(const root of owned.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
  const base=await realpath(await mkdtemp(join(tmpdir(),'sync-copy-')));owned.push(base);
  const root=join(base,'selected'),state=join(base,'state');await mkdir(root,{mode:0o700});await mkdir(state,{mode:0o700});
  await writeFile(join(root,'one.md'),'current contents\n');const info=await lstat(root);
  const selection:Selection={path:root,identity:`${info.dev}:${info.ino}`,kind:'skill',delivery:false};
  const backupRoot=join(state,'repair-backups');const backup=await createRepairBackup([{normalizedPath:'one.md',content:'retained originals\n',mode:0o600}],'synthetic-plan',backupRoot,{rootPath:root,rootIdentity:selection.identity});
  const stamp=await lstat(state),history=new WorkbenchHistory(state,`${stamp.dev}:${stamp.ino}`);
  return {base,root,state,selection,id:relative(backupRoot,backup.directory).split('\\').join('/'),store:new RepairRecovery(state,`${stamp.dev}:${stamp.ino}`,history)};
}
test('cancelled copies stay incomplete and cannot hide a later completed copy',async()=>{
  const {root,store,selection,id}=await fixture();const checked=await store.check(id,selection),cancelled=randomUUID();
  await expect(store.restore(checked.token,selection,cancelled,()=>true)).rejects.toThrow('停止');
  expect((await store.status(cancelled,selection)).status).toBe('incomplete');await expect(store.copy(cancelled,selection)).rejects.toThrow('完整副本');
  const second=await store.check(id,selection);let finalized=false;const done=await store.restore(second.token,selection,randomUUID(),()=>false,()=>{finalized=true;});
  expect(finalized).toBe(true);expect((await store.status(done.id,selection)).status).toBe('ready');
  expect(await readFile(join(done.path,'one.md'),'utf8')).toBe('retained originals\n');expect(await readFile(join(root,'one.md'),'utf8')).toBe('current contents\n');
});
test('an identical replacement selected directory cannot consume an old restore confirmation',async()=>{
  const {root,base,store,selection,id}=await fixture();const checked=await store.check(id,selection);
  await rename(root,join(base,'retained-directory'));await mkdir(root);await writeFile(join(root,'one.md'),'current contents\n');
  await expect(store.restore(checked.token,selection,randomUUID(),()=>false)).rejects.toThrow('目录已变化');
  expect(await readFile(join(root,'one.md'),'utf8')).toBe('current contents\n');
});
test('corrupt original backup bytes cannot become a checked or published recovery',async()=>{
  const {state,root,store,selection,id}=await fixture();await writeFile(join(state,'repair-backups',id,'files/one.md'),'changed backup\n');
  await expect(store.check(id,selection)).rejects.toThrow('checksum');expect(await readFile(join(root,'one.md'),'utf8')).toBe('current contents\n');
});
test('a modified completed copy is no longer reported as the original recovery result',async()=>{
  const {root,store,selection,id}=await fixture(),checked=await store.check(id,selection);
  const done=await store.restore(checked.token,selection,randomUUID(),()=>false);
  await chmod(join(done.path,'one.md'),0o640);
  expect((await store.status(done.id,selection)).status).toBe('modified');await expect(store.copy(done.id,selection)).rejects.toThrow('完整副本');
  expect(await readFile(join(root,'one.md'),'utf8')).toBe('current contents\n');
});
