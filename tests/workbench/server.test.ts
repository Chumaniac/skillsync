import { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startWorkbench } from "../../src/workbench/server.js";
import { WorkbenchHistory } from "../../src/workbench/history.js";

const running: Array<Awaited<ReturnType<typeof startWorkbench>>> = [];
afterEach(async () => { for (const app of running.splice(0)) await app.close(); });
async function setup(cliPath = resolve("dist/cli/index.js")) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "sync-gui-")));
  const root = join(base, "review"); await mkdir(join(root, "scripts"), {recursive: true});
  await writeFile(join(root, "SKILL.md"), "---\nname: review\ndescription: Review a change.\n---\n");
  const script = join(root, "scripts", "check.sh");
  await writeFile(script, "#!/bin/sh\nexit 47\n", {mode: 0o777}); await chmod(script, 0o777);
  const app = await startWorkbench({port: 0, stateDir: join(base, "state"), cliPath}); running.push(app);
  const html = await (await fetch(app.url)).text(); const token = html.match(/name="client" content="([a-f0-9]+)"/)![1];
  const api = async (action: string, body = {}) => {
    const response = await fetch(`${app.url}/api/${action}`, {method: "POST", headers: {"Content-Type": "application/json", "X-SkillSync-Client": token}, body: JSON.stringify(body)});
    return {status: response.status, data: await response.json()};
  };
  return {base, root, script, app, api, token};
}
describe("real CLI graphical workbench", () => {
  it.each(["plan", "apply"])("rejects an identical replacement directory during %s", async phase => {
    const launcher = join(await realpath(await mkdtemp(join(tmpdir(), "sync-root-swap-"))), "swap.cjs");
    const realCli = resolve("dist/cli/index.js");
    await writeFile(launcher, `
      const fs = require('node:fs');
      const {spawnSync} = require('node:child_process');
      const args = process.argv.slice(2);
      const phase = ${JSON.stringify(phase)};
      const apply = args.includes('--apply');
      function replace(root) {
        fs.renameSync(root, root + '-retained');
        fs.cpSync(root + '-retained', root, {recursive:true});
        fs.chmodSync(root + '/scripts/check.sh', 0o777);
      }
      if (phase === 'apply' && apply) {
        const plan = JSON.parse(fs.readFileSync(args[args.indexOf('--plan') + 1], 'utf8'));
        replace(plan.rootPath);
      }
      const result = spawnSync(process.execPath, [${JSON.stringify(realCli)}, ...args], {encoding:'utf8'});
      if (phase === 'plan' && args.includes('--plan') && !apply) {
        replace(JSON.parse(result.stdout).rootPath);
      }
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
      process.exitCode = result.status ?? 1;
    `);
    const {api, root, script} = await setup(launcher);
    const before = await readFile(script);
    await api("select", {path:root,kind:"skill"});
    expect((await api("verify")).status).toBe(200);
    const planned = await api("plan");
    const outcome = phase === "plan" ? planned : await api("apply", {id:planned.data.id, confirm:true});
    expect(outcome.status).toBe(400);
    expect(outcome.data.error).not.toContain(root);
    for (const path of [script, join(root + "-retained", "scripts/check.sh")]) {
      expect(await readFile(path)).toEqual(before);
      expect((await stat(path)).mode & 0o777).toBe(0o777);
    }
    expect((await api("apply", {id:planned.data.id,confirm:true})).status).toBe(400);
  });

  it("locates affected CSV records in an artifact report and its immutable history", async () => {
    const {api, base} = await setup();
    const fixture = join(base, "allocation-review");
    await cp(resolve("fixtures/product/tenant-reconciliation"), fixture, {recursive:true});
    await cp(join(fixture,"faults/shifted-allocations.csv"), join(fixture,"artifacts/allocations.csv"));
    expect((await api("select",{path:join(fixture,"artifacts"),kind:"artifacts",contract:join(fixture,"contract.json")})).status).toBe(200);
    const checked = await api("verify"); expect(checked.status).toBe(200);
    for (const html of [checked.data.html, (await api("history/open",{id:checked.data.historyId})).data.html]) {
      expect(html).toContain('data-source-records="1"');
      expect(html).toContain('data-target-records="1,3"');
      expect(html).toContain("exclude the header");
      for (const privateValue of [base,"ORG_A","ORG_B","ORDER_1"]) expect(html).not.toContain(privateValue);
    }
  });
  it("does not let initial history loading block selecting a directory", async () => {
    const {api, root} = await setup();
    let started!: () => void, release!: () => void;
    const listing = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const list = WorkbenchHistory.prototype.list;
    const spy = vi.spyOn(WorkbenchHistory.prototype, "list").mockImplementation(async function(this: WorkbenchHistory, offset) {
      started(); await pending; return list.call(this, offset);
    });
    const history = api("history");
    try {
      await listing;
      expect((await api("select", {path:root,kind:"skill"})).status).toBe(200);
    } finally {
      release(); await history; spy.mockRestore();
    }
  });
  it("explains invalid selections without exposing local paths", async () => {
    const {api, base} = await setup();
    const missing = join(base, "missing-private-directory");
    const result = await api("select", {path: missing, kind: "skill"});
    expect(result.status).toBe(400);
    expect(result.data.error).toContain("不存在");
    expect(result.data.error).not.toContain(base);
    expect((await api("verify")).data.error).toBe("请先选择目录。");
  });
  it("reopens immutable history after restart, rechecks a baseline and never revives an old plan", async () => {
    const {root, script, api, base, app} = await setup();
    await api("select", {path: root, kind: "skill"});
    const before = await api("verify");
    expect(before.data.historyId).toMatch(/^[a-f0-9-]{36}$/);
    const planned = await api("plan");
    expect((await api("apply", {id:planned.data.id, confirm:true})).status).toBe(200);
    const after = await api("verify");
    expect(after.data.comparison.status).toBe("compared");
    expect(after.data.comparison.resolved).toBe(1);
    expect(after.data.comparison.added).toBe(0);
    const saved = await readdir(join(base, "state"));
    const contents = await Promise.all(saved.map(name => readFile(join(base,"state",name))));
    await app.close(); running.splice(running.indexOf(app), 1);
    const next = await startWorkbench({port:0, stateDir:join(base,"state"),cliPath:resolve("dist/cli/index.js")}); running.push(next);
    const page = await (await fetch(next.url)).text(); const nonce = page.match(/name="client" content="([a-f0-9]+)"/)![1];
    const post = async (action:string, body={}) => {
      const r = await fetch(next.url+"/api/"+action,{method:"POST",headers:{"Content-Type":"application/json","X-SkillSync-Client":nonce},body:JSON.stringify(body)});
      return {status:r.status, data:await r.json()};
    };
    const history = await post("history"); expect(history.status).toBe(200); expect(history.data.total).toBe(5);
    const opened = await post("history/open",{id:before.data.historyId});
    expect(opened.status).toBe(200); expect(opened.data.html).toContain("structure.invalid-script-mode");
    expect(opened.data.readOnly).toBe(true);
    expect((await post("apply",{id:planned.data.id,confirm:true})).status).toBe(400);
    expect((await post("verify")).status).toBe(400);
    expect((await post("select",{...opened.data.selection,baselineId:before.data.historyId})).status).toBe(200);
    const recheck = await post("verify"); expect(recheck.status).toBe(200); expect(recheck.data.comparison.resolved).toBeGreaterThan(0);
    const exported = await post("history/export",{id:recheck.data.historyId});
    expect(exported.status).toBe(200); expect(exported.data.html).not.toContain(root); expect(exported.data.html).not.toContain(script);
    expect(exported.data.html).toContain("本次不再出现");
    for(let i=0;i<saved.length;i++) expect(await readFile(join(base,"state",saved[i]))).toEqual(contents[i]);
  });
  it("keeps history readable when full, rejects replaced/missing evidence and untrusted history IDs", async () => {
    const {api,root,base} = await setup(); await api("select",{path:root,kind:"skill"});
    const report = await api("verify");
    expect((await api("history/open",{id:"../../outside"})).status).toBe(400);
    const files = await readdir(join(base,"state"));
    const dataFile = files.find(name=>name.endsWith("-data.json"))!;
    await rename(join(base,"state",dataFile),join(base,"evidence-original.json"));
    await symlink(join(base,"evidence-original.json"),join(base,"state",dataFile));
    expect((await api("history/open",{id:report.data.historyId})).status).toBe(400);
    const {api:other,root:otherRoot,base:otherBase}=await setup(); await other("select",{path:otherRoot,kind:"skill"});
    const valid=await other("verify"); const count=(await readdir(join(otherBase,"state"))).length;
    for(let i=count;i<120;i++)await writeFile(join(otherBase,"state",`retained-${i}.json`),"{}");
    expect((await other("history")).status).toBe(200);
    expect((await other("history/open",{id:valid.data.historyId})).status).toBe(200);
    expect((await other("verify")).status).toBe(400);
    expect((await readdir(join(otherBase,"state"))).length).toBe(120);
  });
  it("runs read-only verification → plan → explicit apply + backup → separate recheck", async () => {
    const {root, script, api, base} = await setup(); const original = await readFile(script);
    expect((await api("select", {path: root, kind: "skill"})).status).toBe(200);
    const first = await api("verify"); expect(first.status).toBe(200); expect(first.data.html).toContain("structure.invalid-script-mode");
    expect((await stat(script)).mode & 0o777).toBe(0o777); expect(await readFile(script)).toEqual(original);
    const planned = await api("plan"); expect(planned.status).toBe(200); expect(planned.data.description).toContain("777 → 755");
    expect((await api("apply", {id: planned.data.id})).status).toBe(400);
    const applied = await api("apply", {id: planned.data.id, confirm: true}); expect(applied.status).toBe(200);
    expect(applied.data.message).toContain("尚未重新核验"); expect(applied.data.message).toContain("备份");
    expect((await stat(script)).mode & 0o777).toBe(0o755); expect(await readFile(script)).toEqual(original);
    expect((await api("plan")).status).toBe(400);
    const after = await api("verify"); expect(after.status).toBe(200); expect(after.data.html).not.toContain("structure.invalid-script-mode");
    expect((await api("apply", {id: planned.data.id, confirm: true})).status).toBe(400);
    expect((await stat(join(base, "state"))).mode & 0o777).toBe(0o700);
  });
  it("rejects stale plans, replaced roots, cross-origin requests and missing client capability", async () => {
    const {root, script, api, app, token} = await setup();
    await api("select", {path: root, kind: "skill"}); await api("verify"); const plan = await api("plan");
    await writeFile(script, "changed by owner\n");
    expect((await api("apply", {id: plan.data.id, confirm: true})).status).toBe(400);
    expect(await readFile(script, "utf8")).toBe("changed by owner\n");
    await rename(root, root + "-original"); await mkdir(root);
    expect((await api("verify")).status).toBe(400);
    for (const headers of [{"Content-Type":"application/json"}, {"Content-Type":"application/json", "X-SkillSync-Client":token, Origin:"https://example.invalid"}]) {
      expect((await fetch(app.url + "/api/verify", {method:"POST",headers,body:"{}"})).status).toBe(403);
    }
  });
  it("cancels and reaps one active process without reporting completion", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "sync-slow-")));
    const slow = join(base, "slow.cjs"); await writeFile(slow, "setInterval(()=>{},1000)");
    const {api, root} = await setup(slow); await api("select", {path:root,kind:"skill"});
    const verification = api("verify");
    await new Promise(resolve => setTimeout(resolve, 100));
    expect((await api("history")).status).toBe(200);
    expect((await api("plan")).status).toBe(409);
    expect((await api("cancel")).status).toBe(200);
    expect((await verification).data.error).toContain("已取消");
    expect((await api("select", {path:root,kind:"skill"})).status).toBe(200);
  });
});


  it.each(["replace", "same-size", "delete", "link"])("does not save current history when the contract changes after CLI verification: %s", async mutation => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "sync-contract-gui-")));
    const fixture = join(root, "fixture"); await cp(resolve("fixtures/product/order-summary"), fixture, {recursive:true});
    const contract = join(fixture, "contract.json"), marker = join(root, "mutate"), launcher = join(root, "changed.cjs");
    await writeFile(launcher, `
      const fs=require('node:fs'),{spawnSync}=require('node:child_process');
      const args=process.argv.slice(2),path=${JSON.stringify(contract)},marker=${JSON.stringify(marker)},mode=${JSON.stringify(mutation)};
      const result=spawnSync(process.execPath,[${JSON.stringify(resolve("dist/cli/index.js"))},...args],{encoding:'utf8'});
      if(args[0]==='artifacts'&&fs.existsSync(marker)){
        const bytes=fs.readFileSync(path);
        if(mode==='delete')fs.unlinkSync(path);
        else if(mode==='same-size'){const index=bytes.indexOf(Buffer.from('"equals": 1'));if(index<0)throw Error('Synthetic marker missing');bytes[index+10]=50;fs.writeFileSync(path,bytes);}
        else{fs.renameSync(path,path+'.retained');if(mode==='link')fs.symlinkSync(path+'.retained',path);else fs.writeFileSync(path,bytes);}
      }
      process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status??1;
    `);
    const {api} = await setup(launcher);
    expect((await api("select",{path:join(fixture,"artifacts"),kind:"artifacts",contract})).status).toBe(200);
    const first=await api("verify");expect(first.status).toBe(200);
    await writeFile(marker,"1");const changed=await api("verify");expect(changed.status).toBe(400);expect(changed.data.error).toContain("合同");expect(changed.data.error).not.toContain(root);
    expect((await api("history")).data.total).toBe(1);expect((await api("history/open",{id:first.data.historyId})).status).toBe(200);
  });


it("reads the current contract at verification start rather than pinning a prior file-picker choice", async () => {
  const {api, base} = await setup();const fixture=join(base,"contract-before-start");await cp(resolve("fixtures/product/order-summary"),fixture,{recursive:true});const contract=join(fixture,"contract.json");
  expect((await api("select",{path:join(fixture,"artifacts"),kind:"artifacts",contract})).status).toBe(200);
  const contents=await readFile(contract,"utf8");await writeFile(contract,contents+"\n");
  const outcome=await api("verify");expect(outcome.status).toBe(200);expect(outcome.data.html).toContain("Declared checks passed");expect((await api("history")).data.total).toBe(1);
});
