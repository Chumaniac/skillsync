import {cp,mkdir,mkdtemp,readFile,realpath,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,expect,it} from 'vitest';
import {startWorkbench} from '../../src/workbench/server.js';
const apps:Array<Awaited<ReturnType<typeof startWorkbench>>>=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();});

it('previews then creates and reopens a batch package without enabling Skill repair',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'sync-batch-gui-'))),data=join(base,'inputs');await mkdir(data);
 await cp(resolve('fixtures/product/tenant-reconciliation'),join(data,'north'),{recursive:true});
 await cp(join(data,'north/artifacts'),join(data,'south'),{recursive:true});
 await cp(join(data,'north/faults/shifted-allocations.csv'),join(data,'south/allocations.csv'));
 const path=join(data,'plan.json');await writeFile(path,JSON.stringify({schema:'skillsync.acceptance-plan/v1',contract:'north/contract.json',batches:[{id:'north',kind:'artifacts',path:'north/artifacts'},{id:'south',kind:'artifacts',path:'south'}]}));
 const app=await startWorkbench({port:0,stateDir:join(base,'state'),cliPath:resolve('dist/cli/index.js')});apps.push(app);
 const page=await(await fetch(app.url)).text(),nonce=page.match(/name="client" content="([a-f0-9]+)"/)![1];
 const post=async(action:string,body={})=>{const response=await fetch(app.url+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-SkillSync-Client':nonce},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 const preview=await post('batch/preview',{path});expect(preview.status).toBe(200);expect(preview.data.batches).toHaveLength(2);
 const output=join(base,'first.json');const result=await post('batch/run',{path,output});expect(result.status).toBe(200);expect(result.data.summary.status).toBe('failed');expect(result.data.html).toContain('Batch acceptance');
 const saved=await readFile(output);
 expect((await post('apply',{id:'old',confirm:true})).status).toBe(400);
 const reopened=await post('batch/open',{path:output,expectSha256:result.data.package_sha256});expect(reopened.status).toBe(200);expect(reopened.data.integrity).toBe('verified');
 expect(await readFile(output)).toEqual(saved);
 for(const secret of [base,'ORG_A','ORDER_1'])expect(result.data.html).not.toContain(secret);
});

it('a plan changed after preview cannot create a package',async()=>{
 const base=await realpath(await mkdtemp(join(tmpdir(),'sync-batch-stale-'))),data=join(base,'data');await mkdir(data);
 await cp(resolve('fixtures/product/tenant-reconciliation'),data,{recursive:true});
 const path=join(data,'plan.json'),plan={schema:'skillsync.acceptance-plan/v1',contract:'contract.json',batches:[{id:'one',kind:'artifacts',path:'artifacts'}]};await writeFile(path,JSON.stringify(plan));
 const app=await startWorkbench({port:0,stateDir:join(base,'state'),cliPath:resolve('dist/cli/index.js')});apps.push(app);
 const nonce=(await(await fetch(app.url)).text()).match(/name="client" content="([a-f0-9]+)"/)![1];
 const post=async(action:string,body={})=>{const response=await fetch(app.url+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-SkillSync-Client':nonce},body:JSON.stringify(body)});return response;};
 expect((await post('batch/preview',{path})).status).toBe(200);await writeFile(path,JSON.stringify(plan)+'\n');
 expect((await post('batch/run',{path,output:join(base,'blocked.json')})).status).toBe(400);
 await expect(readFile(join(base,'blocked.json'))).rejects.toMatchObject({code:'ENOENT'});
});
