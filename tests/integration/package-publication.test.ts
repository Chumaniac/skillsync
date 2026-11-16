import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';

test('actual publication validator accepts both READMEs but refuses private or ambiguous files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sync-package-gate-'));
 try{
  const {version}=JSON.parse(await readFile('package.json','utf8')) as {version:string};
  const pack={name:'@chumanic/skillsync',version,filename:`chumanic-skillsync-${version}.tgz`,files:[{path:'README.md',size:100},{path:'README.en.md',size:100},{path:'dist/cli/index.js',size:100}]};
  const path=join(root,'pack.json');await writeFile(path,JSON.stringify([pack]));
  const run=()=>spawnSync(process.execPath,['scripts/check-package.mjs',path],{encoding:'utf8'});
  expect(run().status).toBe(0);
  for(const file of ['.env','dist/.env','README.private.md','dist/../private.txt','dist/secret\\private.txt','/dist/foreign.js']){
   await writeFile(path,JSON.stringify([{...pack,files:[...pack.files,{path:file,size:1}]}]));expect(run().status).not.toBe(0);
  }
  await writeFile(path,JSON.stringify([{...pack,files:[...pack.files,pack.files[0]]}]));expect(run().status).not.toBe(0);
 }finally{await rm(root,{recursive:true,force:true});}
});
