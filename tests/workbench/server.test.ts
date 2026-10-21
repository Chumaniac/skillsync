import { chmod, mkdir, mkdtemp, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { startWorkbench } from "../../src/workbench/server.js";

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
    expect((await api("plan")).status).toBe(409);
    expect((await api("cancel")).status).toBe(200);
    expect((await verification).data.error).toContain("已取消");
    expect((await api("select", {path:root,kind:"skill"})).status).toBe(200);
  });
});
