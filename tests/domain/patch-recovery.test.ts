import {mkdir,mkdtemp,readFile,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';
import {planDigest,type ActionPlan} from '../../src/domain/action-plan';
import {applyActionPlan,ActionPlanApplyError} from '../../src/domain/patch-application';
import {renderFixApplyError} from '../../src/cli/commands/fix';
const fault=vi.hoisted(()=>({root:'',moved:'',replace:true,armed:false}));
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,rename:async(from:Parameters<typeof actual.rename>[0],to:Parameters<typeof actual.rename>[1])=>{
  if(fault.armed&&to===join(fault.root,fault.replace?'a.txt':'b.txt')){
   fault.armed=false;
   if(!fault.replace)throw new Error('synthetic write failure');
   await actual.rename(from,to);await actual.rename(fault.root,fault.moved);await actual.mkdir(fault.root);
   await actual.writeFile(join(fault.root,'a.txt'),'replacement-a');await actual.writeFile(join(fault.root,'b.txt'),'replacement-b');return;
  }
  return actual.rename(from,to);
 }};
});
const owned:string[]=[];
afterEach(async()=>{fault.armed=false;await Promise.all(owned.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
it.each([true,false])('retains a discoverable recovery record when root replacement blocks rollback (backup=%s)',async backup=>{
 const parent=await mkdtemp(join(tmpdir(),'skillsync-recovery-'));owned.push(parent);const folder=join(parent,'root');await mkdir(folder);const root=await realpath(folder);await writeFile(join(root,'a.txt'),'before-a');await writeFile(join(root,'b.txt'),'before-b');const metadata=await stat(root);
 const input={schema_version:1 as const,rootPath:root,rootIdentity:`${metadata.dev}:${metadata.ino}`,issueIds:[],changes:[{path:'a.txt',before:'before-a',after:'after-a',safety:'safe' as const},{path:'b.txt',before:'before-b',after:'after-b',safety:'safe' as const}],manualSteps:[]};const plan:ActionPlan={...input,generatedAt:new Date().toISOString(),planDigest:planDigest(input)};
 Object.assign(fault,{root,moved:join(parent,'original'),replace:true,armed:true});
 const error=await applyActionPlan(plan,{yes:true,backup}).then(()=>{throw Error('expected failure');},error=>error as ActionPlanApplyError);
 expect(error).toBeInstanceOf(ActionPlanApplyError);expect(error.receipt).toBeUndefined();
 const recovery=JSON.parse(renderFixApplyError(error)).error.recovery;
 expect(recovery).toMatchObject({schema_version:1,status:'rollback-incomplete',planDigest:plan.planDigest,changedPaths:['a.txt'],failedPaths:['a.txt']});
 expect(recovery.backupPath).toEqual(expect.any(String));owned.push(recovery.backupPath);
 expect(renderFixApplyError(error,'text')).toContain(recovery.backupPath);expect(renderFixApplyError(error,'text')).toContain('rollback-incomplete');expect(renderFixApplyError(error,'text')).not.toContain('before-a');
 expect(await readFile(join(recovery.backupPath,'files/a.txt'),'utf8')).toBe('before-a');expect(await readFile(join(recovery.backupPath,'files/b.txt'),'utf8')).toBe('before-b');
 expect(await readFile(join(root,'a.txt'),'utf8')).toBe('replacement-a');expect(await readFile(join(root,'b.txt'),'utf8')).toBe('replacement-b');
 expect(await readFile(join(fault.moved,'a.txt'),'utf8')).toBe('after-a');
});

it.each([true,false])('completed rollback still exposes retained failure materials (backup=%s)',async backup=>{
 const parent=await mkdtemp(join(tmpdir(),'skillsync-restored-'));owned.push(parent);const folder=join(parent,'root');await mkdir(folder);const root=await realpath(folder);await writeFile(join(root,'a.txt'),'before-a');await writeFile(join(root,'b.txt'),'before-b');
 const input={schema_version:1 as const,rootPath:root,issueIds:[],changes:[{path:'a.txt',before:'before-a',after:'after-a',safety:'safe' as const},{path:'b.txt',before:'before-b',after:'after-b',safety:'safe' as const}],manualSteps:[]};const plan:ActionPlan={...input,generatedAt:new Date().toISOString(),planDigest:planDigest(input)};
 Object.assign(fault,{root,moved:join(parent,'unused'),replace:false,armed:true});
 const error=await applyActionPlan(plan,{yes:true,backup}).then(()=>{throw Error('expected failure');},error=>error as ActionPlanApplyError);
 expect(error).toBeInstanceOf(ActionPlanApplyError);expect(error.recovery).toBeUndefined();expect(error.receipt).toMatchObject({status:'restored',changedPaths:['a.txt']});
 expect(error.receipt!.backupPath).toEqual(expect.any(String));owned.push(error.receipt!.backupPath!);
 expect(await readFile(join(root,'a.txt'),'utf8')).toBe('before-a');expect(await readFile(join(root,'b.txt'),'utf8')).toBe('before-b');
 expect(await readFile(join(error.receipt!.backupPath!,'files/a.txt'),'utf8')).toBe('before-a');
});
