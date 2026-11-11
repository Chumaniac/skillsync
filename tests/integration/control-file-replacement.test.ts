import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it.skipIf(process.platform==='win32')('rejects a regular control file replaced by a FIFO without waiting for a writer',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'sync-control-fifo-'))),path=join(root,'control.json');
 try{
  const script=`import {writeFile,lstat,unlink} from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {readWorkspaceFile} from ${JSON.stringify(pathToFileURL(resolve('dist/sandbox/workspace-tree.js')).href)};const path=${JSON.stringify(path)};await writeFile(path,'{}');const stamp=await lstat(path);await unlink(path);if(spawnSync('mkfifo',[path]).status!==0)throw Error('Synthetic FIFO unavailable');try{await readWorkspaceFile(path,65536,stamp);process.exitCode=9;}catch{process.stdout.write('REJECTED');}`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:3000});
  expect(result.error).toBeUndefined();expect(result.status).toBe(0);expect(result.stdout).toBe('REJECTED');
 }finally{await rm(root,{recursive:true,force:true});}
});
