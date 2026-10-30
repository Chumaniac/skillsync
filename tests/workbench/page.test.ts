import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { workbenchScript } from "../../src/workbench/page.js";

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
  addEventListener() {}
  replaceWith(element: Element) { Object.assign(this, element); }
  replaceChildren() { this.children = []; }
  append(...elements: Element[]) { this.children.push(...elements); }
}

async function page(failure?: "network" | "invalid-json" | "expired-session", delayInitialHistory = false) {
  const elements = new Map<string, Element>();
  const get = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  get("kind").value = "skill"; get("root").value = "/synthetic/review";
  const offsets: number[] = [], actions: string[] = [];
  const rejected = new Map<string, string>();
  let releaseHistory!: () => void, historyCalls = 0;
  const initialHistory = new Promise<void>(resolve => { releaseHistory = resolve; });
  const entries = Array.from({length: 14}, (_, i) => ({id: String(i), kind: "verify", label: `record ${i}`, createdAt: "2026-01-01T00:00:00Z"}));
  const fetch = async (url: string, options: {body: string}) => {
    const action = url.slice("/api/".length), input = JSON.parse(options.body); actions.push(action);
    if (rejected.has(action)) return {ok: false, status: 400, json: async () => ({error: rejected.get(action)})};
    const firstHistory = action === "history" && historyCalls++ === 0;
    const savedHistory = {total: entries.length, items: entries.slice(input.offset, input.offset + 12), capacity: {files: entries.length * 2, maxFiles: 120}};
    if (action === "select" && failure === "network") throw new TypeError("Failed to fetch");
    return {ok: failure !== "expired-session" || action !== "select", status: failure === "expired-session" && action === "select" ? 403 : 200, json: async () => {
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
    }};
  };
  runInNewContext(workbenchScript, {document: {getElementById: get, querySelector: () => get("meta"), querySelectorAll: () => [], createElement: () => new Element()}, fetch, URL, Blob, setTimeout});
  await new Promise(resolve => setImmediate(resolve));
  return {get, offsets, actions, fail(action: string, message: string) { rejected.set(action, message); }, async finishInitialHistory() { releaseHistory(); await new Promise(resolve => setImmediate(resolve)); }, async click(id: string) { await get(id).onclick?.(); await new Promise(resolve => setImmediate(resolve)); }};
}

describe("workbench interactions", () => {
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
