import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { workbenchPage, workbenchScript } from "../../src/workbench/page.js";
import {randomUUID} from 'node:crypto';

class Element {
  value = ""; textContent = ""; content = "fixture"; disabled = false;
  hidden = false; checked = false; srcdoc = ""; type = ""; className = "";
  children: Element[] = [];
  onclick?: () => Promise<void> | void;
  onchange?: () => void;
  attributes = new Map<string,string>();
  focused = false;
  setAttribute(name: string, value: string) { this.attributes.set(name,value); }
  focus() { this.focused = true; }
  events=new Map<string,()=>void>();
  addEventListener(name:string,handler:()=>void) {this.events.set(name,handler);}
  replaceWith(element: Element) { Object.assign(this, element); }
  replaceChildren() { this.children = []; }
  append(...elements: Element[]) { this.children.push(...elements); }
}

async function page(failure?: "network" | "invalid-json" | "expired-session", delayInitialHistory = false, initialOperation?:unknown) {
  const elements = new Map<string, Element>();
  const get = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  get("kind").value = "skill"; get("root").value = "/synthetic/review";
  const offsets: number[] = [], actions: string[] = [];
  const inputs: Array<{action: string; input: Record<string, unknown>}> = [];
  const rejected = new Map<string, string>(),responses=new Map<string,unknown>();
  responses.set('operation',initialOperation??{schema:'skillsync.workbench-operation/v1',active:null,last:null,readOnly:true});
  let releaseHistory!: () => void, historyCalls = 0;
  const initialHistory = new Promise<void>(resolve => { releaseHistory = resolve; });
  const entries = Array.from({length: 14}, (_, i) => ({id: String(i), kind: "verify", label: `record ${i}`, createdAt: "2026-01-01T00:00:00Z"}));
  const fetch = async (url: string, options: {body: string}) => {
    const action = url.slice("/api/".length), input = JSON.parse(options.body); actions.push(action);
    inputs.push({action, input});
    if (rejected.has(action)) return {ok: false, status: 400, json: async () => ({error: rejected.get(action)})};
    const firstHistory = action === "history" && historyCalls++ === 0;
    const savedHistory = {total: entries.length, items: entries.slice(input.offset, input.offset + 12), capacity: {files: entries.length * 2, maxFiles: 120}};
    if (action === "select" && failure === "network") throw new TypeError("Failed to fetch");
    return {ok: failure !== "expired-session" || action !== "select", status: failure === "expired-session" && action === "select" ? 403 : 200, json: async () => {
      const data = await (async()=>{
      if(responses.has(action))return responses.get(action);
      if (action === "select" && failure === "invalid-json") throw new SyntaxError("Unexpected token '<'");
      if (action === "history") {
        offsets.push(input.offset);
        if (firstHistory && delayInitialHistory) await initialHistory;
        return savedHistory;
      }
      if (action === "verify") {
        entries.unshift({id: "new", kind: "verify", label: "new record", createdAt: "2026-01-02T00:00:00Z"});
        return {historyId: "new", baselineId: "new", html: '<a href="#scope">Scope</a><p id="scope">Report</p>', status: "检查完成",summary:{title:"存在待处理项",description:"生成计划前先审阅",counts:[{label:"阻断问题",count:1}],canPlan:true,readOnly:false}};
      }
      if (action === "history/open") return {id: input.id, selection: {path:"/synthetic/review",kind:"skill",delivery:false},summary:{title:"历史证据 · 只读",description:"请重新核验当前目录",counts:[],canPlan:false,readOnly:true},html:"<p>Stored report</p>"};
      if (action === "plan") return {id: "synthetic-plan", description: "Review this synthetic change"};
      return {};
      })();
      return input.operationId?{...(data as Record<string,unknown>),operationId:input.operationId}:data;
    }};
  };
  const timers=new Map<number,()=>void>(),events=new Map<string,()=>void>();let nextTimer=0;
  runInNewContext(workbenchScript, {document: {hidden:false,addEventListener:(name:string,fn:()=>void)=>events.set(name,fn),getElementById: get, querySelector: () => get("meta"), querySelectorAll: () => [], createElement: () => new Element()},window:{addEventListener:(name:string,fn:()=>void)=>events.set(name,fn)},crypto:{randomUUID},fetch, URL, Blob, setTimeout:(fn:()=>void)=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:(id:number)=>timers.delete(id), AbortController});
  await new Promise(resolve => setImmediate(resolve));
  return {get, offsets, actions,inputs,timers,events,respond(action:string,value:unknown){responses.set(action,value);}, fail(action: string, message: string) { rejected.set(action, message); }, async finishInitialHistory() { releaseHistory(); await new Promise(resolve => setImmediate(resolve)); }, async click(id: string) { await get(id).onclick?.(); await new Promise(resolve => setImmediate(resolve)); }};
}

describe("workbench interactions", () => {
  it('a cached return cannot display an old report as the current result',async()=>{
    const ui=await page();await ui.click('verify');expect(ui.get('result').hidden).toBe(false);
    ui.events.get('pagehide')?.();expect(ui.get('result').hidden).toBe(true);expect(ui.get('report').srcdoc).toBe('');expect(ui.get('root').value).toBe('/synthetic/review');
  });
  it('automatic status polling stops at90 reads and leaves an explicit check available',async()=>{
    const id=randomUUID();const ui=await page(undefined,false,{schema:'skillsync.workbench-operation/v1',active:{id,kind:'verify',phase:'running',startedAt:1,cancellable:true,cancelRequested:false},last:null,readOnly:true});
    for(let i=0;i<100&&ui.timers.size;i++){const [key,fn]=[...ui.timers][0];ui.timers.delete(key);fn();await new Promise(r=>setImmediate(r));}
    expect(ui.actions.filter(a=>a==='operation')).toHaveLength(90);expect(ui.timers.size).toBe(0);expect(ui.get('operation-state').textContent).toContain('自动读取已暂停');expect(ui.get('operation-check').disabled).toBe(false);
  });
  it('background polling is bounded, cancelled reads clean up and apply authority remains unavailable',async()=>{
    const id=randomUUID(),active={id,kind:'apply',phase:'applying',startedAt:1,cancellable:false,cancelRequested:false};
    const ui=await page(undefined,false,{schema:'skillsync.workbench-operation/v1',active,last:null,readOnly:true});
    expect(ui.get('verify').disabled).toBe(true);expect(ui.get('cancel').disabled).toBe(true);expect(ui.get('apply').disabled).toBe(true);
    expect(ui.timers.size).toBe(1);await ui.click('operation-check');expect(ui.timers.size).toBe(1);
    ui.events.get('pagehide')?.();expect(ui.timers.size).toBe(0);expect(ui.get('confirm').checked).toBe(false);
  });
  it('unconfirmed completions and malformed status cannot unlock an old plan',async()=>{
    const id=randomUUID();const ui=await page(undefined,false,{schema:'skillsync.workbench-operation/v1',active:null,last:{id,kind:'apply',startedAt:1,finishedAt:2,outcome:'unconfirmed',historyId:randomUUID()},readOnly:true});
    expect(ui.get('operation-state').textContent).toContain('尚未确认');expect(ui.get('apply').disabled).toBe(true);
    ui.respond('operation',{schema:'skillsync.workbench-operation/v1',active:{id:'PRIVATE_INVALID_ID'},last:null,readOnly:true});await ui.click('operation-check');
    expect(ui.get('verify').disabled).toBe(true);expect(ui.get('operation-state').textContent).toContain('无法核对');expect(ui.get('operation-state').textContent).not.toContain('PRIVATE_INVALID_ID');
  });

  it('leaving a page discards a late plan rather than reviving its authority',async()=>{
    const ui=await page();await ui.click('verify');let release!:(value:unknown)=>void;
    ui.respond('plan',new Promise(resolve=>{release=resolve}));const pending=ui.click('plan');await new Promise(resolve=>setImmediate(resolve));
    ui.events.get('pagehide')?.();release({id:'old-plan',description:'SYNTHETIC_OLD_PLAN'});await pending;
    expect(ui.get('fix').hidden).toBe(true);expect(ui.get('changes').textContent).not.toContain('SYNTHETIC_OLD_PLAN');expect(ui.get('confirm').checked).toBe(false);
    expect(ui.timers.size).toBe(0);
  });
  it('refresh shows the existing background operation without restoring apply authority',async()=>{
    const id=randomUUID();const ui=await page(undefined,false,{schema:'skillsync.workbench-operation/v1',active:{id,kind:'verify',phase:'running',startedAt:1,cancellable:true,cancelRequested:false},last:null,readOnly:true});
    expect(ui.get('verify').disabled).toBe(true);expect(ui.get('cancel').disabled).toBe(false);expect(ui.get('apply').disabled).toBe(true);expect(ui.get('confirm').checked).toBe(false);
    expect(ui.get('operation-state').textContent).toContain('核验');
  });
  it("ignores delayed history replies after an input change",async()=>{
    const ui=await page(),before="11111111-1111-4111-8111-111111111111",after="22222222-2222-4222-8222-222222222222";
    ui.get("history-compare-before").value=before;ui.get("history-compare-after").value=after;
    let release!:(value:unknown)=>void;ui.respond("history/compare",new Promise(resolve=>{release=resolve}));
    const pending=ui.click("history-compare");await new Promise(resolve=>setImmediate(resolve));
    ui.get("history-compare-after").value=before;ui.get("history-compare-after").events.get("input")?.();
    release({schema:"skillsync.history-comparison/v1",kind:"skill",status:"compared",before:{id:before},after:{id:after},counts:{added:0,ongoing:0,resolved:0,changed:0},details:[],detailsTotal:0,detailsTruncated:false,readOnly:true,execution:"not-run",provenance:"not-authenticated"});
    await pending;expect(ui.get("history-compare-result").hidden).toBe(true);expect(ui.get("history-compare-info").textContent).toBe("");
  });

  it("compares history independently of entered paths and reviewed apply consent", async () => {
    const ui=await page();await ui.click("verify");await ui.click("plan");
    ui.get("confirm").checked=true;ui.get("confirm").onchange?.();await ui.click("nav-history");
    const before="11111111-1111-4111-8111-111111111111",after="22222222-2222-4222-8222-222222222222";
    ui.get("history-compare-before").value=before;ui.get("history-compare-after").value=after;
    ui.respond("history/compare",{schema:"skillsync.history-comparison/v1",kind:"skill",status:"compared",before:{id:before},after:{id:after},counts:{added:1,ongoing:2,resolved:3,changed:1},details:[{code:"test.code",change:"added",count:1},{code:"test.code",change:"ongoing",count:2},{code:"test.code",change:"resolved",count:3},{code:"test.code",change:"changed",count:1}],detailsTotal:4,detailsTruncated:false,readOnly:true,execution:"not-run",provenance:"not-authenticated"});
    const initial=ui.actions.length;await ui.click("history-compare");
    expect(ui.actions.slice(initial)).toEqual(["history/compare"]);
    expect(ui.inputs.at(-1)?.input).toEqual({beforeId:before,afterId:after});
    expect(ui.get("history-compare-info").textContent).toContain("历史");
    expect(ui.get("root").value).toBe("/synthetic/review");expect(ui.get("confirm").checked).toBe(true);
    await ui.click("nav-single");expect(ui.get("apply").disabled).toBe(false);
  });

  it("keeps unavailable history comparison distinct from zero changes", async () => {
    const ui=await page();const before="11111111-1111-4111-8111-111111111111",after="22222222-2222-4222-8222-222222222222";
    ui.get("history-compare-before").value=before;ui.get("history-compare-after").value=after;
    ui.respond("history/compare",{schema:"skillsync.history-comparison/v1",kind:"skill",status:"unavailable",before:{id:before},after:{id:after},reason:"incomplete-evidence",readOnly:true,execution:"not-run",provenance:"not-authenticated"});
    await ui.click("history-compare");expect(ui.get("history-compare-info").textContent).toContain("不完整");expect(ui.get("history-compare-result").children).toHaveLength(0);
  });
  it("applies history filters explicitly, keeps them for paging and restores successful criteria on failure", async () => {
    const ui=await page();
    ui.get("history-query").value="review";ui.get("history-kind").value="verify";ui.get("history-exit").value="0";
    const initial=ui.actions.length;
    ui.get("history-query").events.get("input")?.();expect(ui.actions).toHaveLength(initial);
    await ui.click("history-filter");
    expect(ui.inputs.at(-1)?.input).toEqual({offset:0,query:"review",kind:"verify",exitCode:0});
    ui.get("history-query").value="unapplied";await ui.click("history-next");
    expect(ui.inputs.at(-1)?.input).toEqual({offset:12,query:"review",kind:"verify",exitCode:0});
    ui.fail("history","Synthetic list failure");ui.get("history-query").value="other";await ui.click("history-filter");
    expect(ui.get("history-query").value).toBe("review");expect(ui.get("history-list").children).toHaveLength(2);
    expect(ui.get("history-info").textContent).toContain("保留");
    expect(ui.actions.every(action=>action==="history"||action==="operation")).toBe(true);
  });
 it('provides and sends an explicit legacy contract without automatic inspection',async()=>{
  expect(workbenchPage('fixture')).toContain('for="batch-contract"');
  const ui=await page();await ui.click('nav-batch');ui.get('batch-package').value='/synthetic/legacy.json';ui.get('batch-contract').value='/synthetic/contract.json';
  const count=ui.actions.length;ui.get('batch-contract').events.get('input')?.();expect(ui.actions).toHaveLength(count);
  ui.respond('batch/open',{summary:{counts:{passed:1,failed:0,incomplete:0}},package_sha256:'a'.repeat(64),html:'<p>Legacy checked</p>'});
  await ui.click('batch-open');expect(ui.inputs.find(item=>item.action==='batch/open')?.input).toMatchObject({contract:'/synthetic/contract.json'});
  ui.get('batch-digest').value='f'.repeat(64);ui.respond('choose',{path:'/synthetic/another-contract.json'});const opens=ui.actions.filter(item=>item==='batch/open').length;
  await ui.click('choose-batch-contract');expect(ui.get('batch-contract').value).toBe('/synthetic/another-contract.json');
  expect(ui.get('batch-digest').value).toBe('f'.repeat(64));expect(ui.get('result').hidden).toBe(true);expect(ui.actions.filter(item=>item==='batch/open')).toHaveLength(opens);
 });
 it('switching packet paths drops only derived old digests and hides stale success',async()=>{
  const ui=await page();await ui.click('nav-batch');ui.get('batch-package').value='/synthetic/a.json';ui.respond('batch/open',{summary:{counts:{passed:1,failed:0,incomplete:0}},package_sha256:'a'.repeat(64),html:'<p>A</p>'});await ui.click('batch-open');expect(ui.get('batch-digest').value).toBe('');expect(ui.get('batch-receipt').textContent).toContain('a'.repeat(64));
  ui.get('batch-package').value='/synthetic/b.json';ui.get('batch-package').events.get('input')?.();expect(ui.get('batch-digest').value).toBe('');expect(ui.get('result').hidden).toBe(true);expect(ui.get('batch-receipt').textContent).toBe('');
  ui.get('batch-digest').value='trusted'.repeat(8);ui.get('batch-digest').events.get('input')?.();ui.get('batch-package').value='/synthetic/c.json';ui.get('batch-package').events.get('input')?.();expect(ui.get('batch-digest').value).toBe('trusted'.repeat(8));
 });

  it("invalidates prior evidence while typing, before blur can move the verification button",async()=>{
   const ui=await page();await ui.click("verify");expect(ui.get("result").hidden).toBe(false);const requests=ui.actions.length;
   ui.get("root").value="/synthetic/another";ui.get("root").events.get("input")?.();expect(ui.get("result").hidden).toBe(true);expect(ui.get("plan").disabled).toBe(true);expect(ui.actions.length).toBe(requests);
  });

  it.each([false,true])("requires fresh verification after an apply attempt, including failure=%s",async failure=>{
   const ui=await page();await ui.click("verify");await ui.click("plan");ui.get("confirm").checked=true;ui.get("confirm").onchange?.();if(failure)ui.fail("apply","Files changed; result unconfirmed");await ui.click("apply");
   expect(ui.get("plan").hidden).toBe(true);expect(ui.get("plan").disabled).toBe(true);expect(ui.get("apply").disabled).toBe(true);const count=ui.actions.length;await ui.click("plan");expect(ui.actions.length).toBe(count);
   await ui.click("result-recheck");expect(ui.get("plan").hidden).toBe(false);expect(ui.get("plan").disabled).toBe(false);
  });
  it("keeps the attempted batch output for explicit read-only recovery without rerunning",async()=>{
   const ui=await page();ui.get("batch-output").value="/synthetic/review-packet.json";ui.fail("batch/run","核验已取消，先检查可能保留的输出");await ui.click("nav-batch");await ui.click("batch-run");
   expect(ui.get("batch-recovery").hidden).toBe(false);expect(ui.get("batch-package").value).toBe("/synthetic/review-packet.json");ui.fail("batch/open","输出尚不存在");await ui.click("batch-recover");expect(ui.get("batch-recovery-state").textContent).toContain("输出尚不存在");expect(ui.actions.filter(v=>v==="batch/run")).toHaveLength(1);
  });

  it("explains missing task inputs before contacting a verifier", async () => {
    const ui=await page();ui.get("root").value="  ";await ui.click("verify");
    expect(ui.get("root-error").textContent).toContain("Skill 目录");expect(ui.get("root").focused).toBe(true);
    expect(ui.actions).not.toContain("select");expect(ui.actions).not.toContain("verify");
    ui.get("root").value="/synthetic/delivery";ui.get("mode-artifacts").checked=true;ui.get("mode-artifacts").onchange?.();
    expect(ui.get("contract-fields").hidden).toBe(false);expect(ui.get("root-label").textContent).toBe("交付目录");
    await ui.click("verify");expect(ui.get("contract-error").textContent).toContain("清单");expect(ui.get("contract").focused).toBe(true);
    expect(ui.actions).not.toContain("select");
  });
  it("keeps a historical summary read-only and explicitly starts a fresh scoped verification", async () => {
    const ui=await page();await ui.click("verify");await ui.click("nav-history");
    await ui.get("history-list").children[0].children[1].onclick?.();
    expect(ui.get("summary-title").textContent).toContain("只读");expect(ui.get("plan").hidden).toBe(true);expect(ui.get("plan").disabled).toBe(true);
    const count=ui.actions.length;await ui.click("plan");expect(ui.actions.length).toBe(count);
    await ui.click("result-recheck");expect(ui.get("task-single").hidden).toBe(false);expect(ui.get("result").hidden).toBe(false);
    expect(ui.actions.slice(count)).toEqual(["select","verify","history"]);expect(ui.get("summary-title").textContent).toBe("存在待处理项");
  });

  it("switches task surfaces without submitting or losing entered paths and approved-plan state", async () => {
    const ui = await page(); await ui.click("verify"); await ui.click("plan");
    ui.get("root").value="/synthetic/kept"; ui.get("batch-plan").value="/synthetic/plan.json";
    ui.get("confirm").checked=true;ui.get("confirm").onchange?.();
    await ui.click("nav-batch");
    expect(ui.get("task-single").hidden).toBe(true);expect(ui.get("task-batch").hidden).toBe(false);
    expect(ui.get("fix").hidden).toBe(true);expect(ui.get("result").hidden).toBe(true);
    await ui.click("nav-single");
    expect(ui.get("root").value).toBe("/synthetic/kept");expect(ui.get("batch-plan").value).toBe("/synthetic/plan.json");
    expect(ui.get("confirm").checked).toBe(true);expect(ui.get("fix").hidden).toBe(false);
    expect(ui.get("selection").focused).toBe(true);expect(ui.get("nav-single").attributes.get("aria-pressed")).toBe("true");
  });
  it.each([["reverify", "verify", "Synthetic verification failed"], ["reverify", "verify", "核验已取消"], ["plan", "plan", "Synthetic plan failed"]])("revokes the old plan when %s does not complete: %s", async (button, action, message) => {
    const ui = await page(); await ui.click("verify"); await ui.click("plan");
    ui.get("confirm").checked = true; ui.get("confirm").onchange?.();
    expect(ui.get("apply").disabled).toBe(false);
    ui.fail(action, message); await ui.click(button);
    expect(ui.get("fix").hidden).toBe(true); expect(ui.get("confirm").checked).toBe(false);
    expect(ui.get("apply").disabled).toBe(true);
  });
  it("hides stale evidence when a later verification fails", async () => {
    const ui=await page();await ui.click("verify");
    expect(ui.get("result").hidden).toBe(false);
    ui.fail("verify","Synthetic verification failed");await ui.click("verify");
    expect(ui.get("result").hidden).toBe(true);expect(ui.get("report").srcdoc).toBe("");
    expect(ui.get("verify").disabled).toBe(false);
  });
  it("refreshes the latest result even when the initial history read arrives later", async () => {
    const ui = await page(undefined, true);
    await ui.click("verify"); await ui.finishInitialHistory();
    expect(ui.get("status").textContent).toContain("核验完成");
    expect(ui.get("history-list").children[0].children[0].textContent).toContain("new record");
    expect(ui.offsets).toEqual([0, 0]);
  });
  it("shows a new verification on the first history page after browsing older records", async () => {
    const ui = await page(); await ui.click("history-next"); expect(ui.offsets.at(-1)).toBe(12);
    await ui.click("verify");
    expect(ui.offsets.at(-1)).toBe(0);
    expect(ui.get("history-list").children[0].children[0].textContent).toContain("new record");
  });
  it("refreshes history from its newest records", async () => {
    const ui = await page(); await ui.click("history-next"); await ui.click("history-refresh");
    expect(ui.offsets.at(-1)).toBe(0);
  });
  it("keeps report section links inside the sandboxed report document", async () => {
    const ui = await page(); await ui.click("verify");
    expect(ui.get("report").srcdoc).toContain('href="about:srcdoc#scope"');
  });
  it.each(["network", "invalid-json", "expired-session"] as const)("explains %s failures and unlocks retry", async failure => {
    const ui = await page(failure); await ui.click("verify");
    expect(ui.get("status").textContent).toMatch(/服务|响应|会话/);
    expect(ui.get("status").textContent).toMatch(/重试|重新/);
    expect(ui.get("verify").disabled).toBe(false);
    expect(ui.get("report").srcdoc).toBe("");
  });
});
