import { cp, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { runArtifacts } from '../../src/cli/commands/artifacts.js';
import * as tree from '../../src/sandbox/workspace-tree.js';

afterEach(()=>vi.restoreAllMocks());
it.each(['replace','same-size','delete','link'] as const)('rejects a %s contract changed after artifact scanning',async mode=>{
 const root=await mkdtemp(join(tmpdir(),'sync-contract-stability-'));
 try{
  await cp(resolve('fixtures/product/order-summary'),root,{recursive:true});const path=join(root,'contract.json'),before=await readFile(path),scan=tree.scanStagedWorkspace;
  vi.spyOn(tree,'scanStagedWorkspace').mockImplementationOnce(async(...args)=>{
   const result=await scan(...args);
   if(mode==='delete')await rm(path);
   else if(mode==='same-size'){const value=Buffer.from(before);const index=value.indexOf(Buffer.from('"equals": 1'));expect(index).toBeGreaterThanOrEqual(0);value[index+10]=50;await writeFile(path,value);}
   else {await rename(path,path+'.retained');if(mode==='link')await symlink(path+'.retained',path);else await writeFile(path,before);}
   return result;
  });
  const report=await runArtifacts({path:join(root,'artifacts'),contract:path});expect(report.status).toBe('failed');expect(report.exitCode).toBe(2);expect(report.findings).toEqual([{code:'artifact.contract-changed-during-check'}]);expect(report.files).toEqual([]);
  expect((await readFile(join(root,'artifacts/summary.json'))).length).toBeGreaterThan(0);
 }finally{await rm(root,{recursive:true,force:true});}
});
