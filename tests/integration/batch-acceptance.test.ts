import { cp, mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/index.js";
import {contentHash} from "../../src/domain/batch-report.js";

async function fixture() {
  const root=await realpath(await mkdtemp(join(tmpdir(),"sync-batch-")));
  await cp(resolve('fixtures/product/tenant-reconciliation/contract.json'),join(root,'contract.json'));
  await mkdir(join(root,'batches'));
  for(const id of ['north','south']) await cp(resolve('fixtures/product/tenant-reconciliation/artifacts'),join(root,'batches',id),{recursive:true});
  await cp(resolve('fixtures/product/tenant-reconciliation/faults/shifted-allocations.csv'),join(root,'batches/south/allocations.csv'));
  const plan={schema:'skillsync.acceptance-plan/v1',contract:'contract.json',batches:[{id:'north',path:'batches/north',kind:'artifacts'},{id:'south',path:'batches/south',kind:'artifacts'}]};
  await writeFile(join(root,'plan.json'),JSON.stringify(plan));
  return {root,plan,planPath:join(root,'plan.json'),output:join(root,'acceptance.json')};
}
const execute=(plan:string,output:string,extra:string[]=[])=>runCli(['batch','run','--plan',plan,'--output',output,'--format','json',...extra]);

describe('portable multi-batch acceptance',()=>{
 it('records per-batch failures without copying business rows, and can verify the offline package',async()=>{
  const {root,planPath,output}=await fixture();const run=await execute(planPath,output);
  expect(run.stdout).toContain('skillsync.batch-report/v1');expect(run.exitCode).toBe(1);
  const saved=JSON.parse(await readFile(output,'utf8'));expect(saved.payload.status).toBe('failed');
  expect(saved.payload.batches.map((item:{status:string})=>item.status)).toEqual(['passed','failed']);
  for(const value of [root,'ORG_A','ORG_B','ORDER_1'])expect(JSON.stringify(saved)).not.toContain(value);
  const checked=await runCli(['batch','inspect','--package',output,'--format','json']);expect(checked.exitCode).toBe(0);expect(JSON.parse(checked.stdout).integrity).toBe('verified');
  const html=await runCli(['batch','inspect','--package',output,'--format','html']);expect(html.exitCode).toBe(0);expect(html.stdout).toContain('Batch acceptance');expect(html.stdout).toContain('not authenticated');
  expect((await stat(output)).mode&0o777).toBe(0o600);
 });

 it('rechecks a repaired batch while preserving a passed report and the original package',async()=>{
  const {root,planPath,output}=await fixture();await execute(planPath,output);const original=await readFile(output);const before=JSON.parse(original.toString());
  await cp(join(root,'batches/north/allocations.csv'),join(root,'batches/south/allocations.csv'));
  const next=join(root,'corrected.json');const run=await execute(planPath,next,['--previous',output,'--retry-failed']);expect(run.exitCode).toBe(0);
  const after=JSON.parse(await readFile(next,'utf8'));expect(after.payload.status).toBe('passed');
  expect(after.payload.batches.map((item:{mode:string})=>item.mode)).toEqual(['reused','inspected']);
  expect(after.payload.batches[0].report_sha256).toBe(before.payload.batches[0].report_sha256);
  expect(after.payload.batches[1].comparison.status).toBe('compared');expect(after.payload.batches[1].comparison.findings.resolved).toBeGreaterThan(0);
  expect(await readFile(output)).toEqual(original);
 });

 it('refuses reuse after a passed input or contract changes and does not publish a replacement',async()=>{
  for(const changed of ['input','contract']){
   const {root,planPath,output}=await fixture();await execute(planPath,output);const original=await readFile(output);
   const path=changed==='input'?join(root,'batches/north/summary.json'):join(root,'contract.json');await writeFile(path,(await readFile(path,'utf8'))+'\n');
   const next=join(root,'must-not-publish.json');const run=await execute(planPath,next,['--previous',output,'--retry-failed']);expect(run.exitCode).toBe(2);
   await expect(stat(next)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(output)).toEqual(original);expect(run.stderr).not.toContain(root);
  }
 });

 it('rejects package tampering, output collisions and duplicate plan identities',async()=>{
  const {root,plan,planPath,output}=await fixture();await execute(planPath,output);const original=await readFile(output);
  expect((await execute(planPath,output)).exitCode).toBe(2);expect(await readFile(output)).toEqual(original);
  const damaged=JSON.parse(original.toString());damaged.payload.status='passed';const path=join(root,'damaged.json');await writeFile(path,JSON.stringify(damaged));
  expect((await runCli(['batch','inspect','--package',path,'--format','json'])).exitCode).toBe(2);
  plan.batches[1].id=plan.batches[0].id;await writeFile(planPath,JSON.stringify(plan));expect((await execute(planPath,join(root,'duplicate.json'))).exitCode).toBe(2);
 });

 it('rejects symbolic package files without following them',async()=>{
  if(process.platform==='win32')return;
  const {root,planPath,output}=await fixture();await execute(planPath,output);const link=join(root,'linked.json');await symlink(output,link);
  expect((await runCli(['batch','inspect','--package',link,'--format','json'])).exitCode).toBe(2);
 });

 it('checks source/report bindings even when an edited packet has a new outer hash',async()=>{
  const {root,planPath,output}=await fixture();await execute(planPath,output);
  const packet=JSON.parse(await readFile(output,'utf8'));
  packet.payload.batches[0].source_inventory[0].sha256='0'.repeat(64);
  packet.payload_sha256=contentHash(packet.payload);
  const damaged=join(root,'rebuilt-hash.json');await writeFile(damaged,JSON.stringify(packet));
  expect((await runCli(['batch','inspect','--package',damaged])).exitCode).toBe(2);
 });

 it('binds the optional contract and accepts a BOM without changing the frozen plan hash',async()=>{
  const {root,planPath,output}=await fixture();await writeFile(planPath,'\uFEFF'+await readFile(planPath,'utf8'));
  expect((await execute(planPath,output)).exitCode).toBe(1);
  expect((await runCli(['batch','inspect','--package',output,'--contract',join(root,'contract.json')])).exitCode).toBe(0);
  await writeFile(join(root,'contract.json'),(await readFile(join(root,'contract.json'),'utf8'))+'\n');
  expect((await runCli(['batch','inspect','--package',output,'--contract',join(root,'contract.json')])).exitCode).toBe(2);
 });

 it('retains the exact plan binding without publishing paths and refuses swapped source declarations',async()=>{
  const {root,plan,planPath,output}=await fixture();await execute(planPath,output);
  expect((await runCli(['batch','inspect','--package',output,'--plan',planPath])).exitCode).toBe(0);
  [plan.batches[0].path,plan.batches[1].path]=[plan.batches[1].path,plan.batches[0].path];await writeFile(planPath,JSON.stringify(plan));
  expect((await runCli(['batch','inspect','--package',output,'--plan',planPath])).exitCode).toBe(2);
  const next=join(root,'swapped.json');expect((await execute(planPath,next,['--previous',output,'--retry-failed'])).exitCode).toBe(2);
  await expect(stat(next)).rejects.toMatchObject({code:'ENOENT'});
 });
});
