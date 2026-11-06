import {mkdir,mkdtemp,readFile,realpath,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it} from 'vitest';
import {startWorkbench} from '../../src/workbench/server.js';

const apps:Array<Awaited<ReturnType<typeof startWorkbench>>>=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();});
async function setup(){
 const base=await realpath(await mkdtemp(join(tmpdir(),'sync-operation-'))),root=join(base,'skill');await mkdir(root);
 await writeFile(join(root,'SKILL.md'),'---\nname: operation\ndescription: Synthetic readonly check.\n---\n');
 const marker=join(base,'started'),wrapper=join(base,'delayed.mjs'),realCli=resolve('dist/cli/index.js');
 await writeFile(wrapper,`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},String(process.pid));let child;const timer=setTimeout(()=>{child=spawn(process.execPath,[${JSON.stringify(realCli)},...process.argv.slice(2)],{stdio:'inherit'});child.on('exit',code=>process.exit(code??1));},500);process.on('SIGTERM',()=>{clearTimeout(timer);if(child){child.kill('SIGTERM');child.once('exit',()=>process.exit(1));}else process.exit(1);});`);
 const app=await startWorkbench({port:0,stateDir:join(base,'state'),cliPath:wrapper,timeoutMs:3000});apps.push(app);
 const html=await(await fetch(app.url)).text(),nonce=html.match(/name="client" content="([a-f0-9]+)"/)![1];
 const api=async(action:string,body={})=>{const r=await fetch(app.url+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-SkillSync-Client':nonce},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 return {base,root,marker,app,api};
}
async function started(path:string){for(let n=0;n<100;n++){try{return await readFile(path,'utf8');}catch{await new Promise(r=>setTimeout(r,10));}}throw Error('Synthetic child did not start');}

describe('workbench operation reattachment',()=>{
 it('operation metadata needs the same origin and nonce capability',async()=>{
  const {app}=await setup();
  expect((await fetch(app.url+'/api/operation',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(403);
  expect((await fetch(app.url+'/api/operation',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.invalid'},body:'{}'})).status).toBe(403);
 });
 it('a cancel from the completed operation cannot stop the next one',async()=>{
  const {api,root,marker}=await setup();await api('select',{path:root,kind:'skill'});const first=randomUUID();
  const earlier=api('verify',{operationId:first});void earlier.catch(()=>{});await started(marker);await api('cancel',{operationId:first});expect((await earlier).status).toBe(400);
  const next=randomUUID(),pending=api('verify',{operationId:next});void pending.catch(()=>{});
  for(let i=0;i<100;i++){const snapshot=await api('operation');if(snapshot.data.active?.id===next)break;await new Promise(r=>setTimeout(r,5));}
  expect((await api('cancel',{operationId:first})).status).toBe(409);expect((await api('operation')).data.active.id).toBe(next);expect((await pending).status).toBe(200);
 });

 it('returns readonly idle metadata without exposing selection or authority',async()=>{
  const {api,base}=await setup();const status=await api('operation');
  expect(status.status).toBe(200);expect(status.data.schema).toBe('skillsync.workbench-operation/v1');
  expect(status.data.active).toBeNull();expect(status.data.last).toBeNull();expect(status.data.readOnly).toBe(true);
  expect(JSON.stringify(status.data)).not.toContain(base);
 });
 it('a stale cancel cannot terminate the current operation',async()=>{
  const {api,root,marker}=await setup();await api('select',{path:root,kind:'skill'});const id=randomUUID();
  const pending=api('verify',{operationId:id});void pending.catch(()=>{});await started(marker);
  const wrong=await api('cancel',{operationId:randomUUID()});expect(wrong.status).toBe(409);
  const observed=await api('operation');expect(observed.data.active.id).toBe(id);expect(observed.data.active.cancellable).toBe(true);
  expect((await api('cancel',{operationId:id})).status).toBe(200);expect((await pending).status).toBe(400);
  const done=await api('operation');expect(done.data.active).toBeNull();expect(done.data.last.id).toBe(id);expect(done.data.last.outcome).toBe('cancelled');
 });
 it('a refreshed client observes the same bounded operation and explicit saved history',async()=>{
  const {api,base,root,marker,app}=await setup();await api('select',{path:root,kind:'skill'});const id=randomUUID();
  const pending=api('verify',{operationId:id});void pending.catch(()=>{});await started(marker);
  const newHtml=await(await fetch(app.url)).text();expect(newHtml).toContain('name="client"');
  const status=await api('operation');expect(status.status).toBe(200);expect(status.data.active.id).toBe(id);expect(status.data.active.kind).toBe('verify');
  expect(JSON.stringify(status.data)).not.toContain(base);expect(JSON.stringify(status.data)).not.toContain('SKILL.md');
  const result=await pending;expect(result.status).toBe(200);
  const ended=await api('operation');expect(ended.data.active).toBeNull();expect(ended.data.last.id).toBe(id);expect(ended.data.last.outcome).toBe('completed');expect(ended.data.last.historyId).toBe(result.data.historyId);
 });
});
