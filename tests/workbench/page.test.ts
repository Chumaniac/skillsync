import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { workbenchScript } from "../../src/workbench/page.js";

class Element {
  value = ""; textContent = ""; content = "fixture"; disabled = false;
  hidden = false; checked = false; srcdoc = ""; type = ""; className = "";
  children: Element[] = [];
  onclick?: () => Promise<void> | void;
  onchange?: () => void;
  addEventListener() {}
  replaceChildren() { this.children = []; }
  append(...elements: Element[]) { this.children.push(...elements); }
}

async function page(failure?: "network" | "invalid-json" | "expired-session", delayInitialHistory = false) {
  const elements = new Map<string, Element>();
  const get = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  get("kind").value = "skill"; get("root").value = "/synthetic/review";
  const offsets: number[] = [];
  let releaseHistory!: () => void, historyCalls = 0;
  const initialHistory = new Promise<void>(resolve => { releaseHistory = resolve; });
  const entries = Array.from({length: 14}, (_, i) => ({id: String(i), kind: "verify", label: `record ${i}`, createdAt: "2026-01-01T00:00:00Z"}));
  const fetch = async (url: string, options: {body: string}) => {
    const action = url.slice("/api/".length), input = JSON.parse(options.body);
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
        return {historyId: "new", baselineId: "new", html: '<a href="#scope">Scope</a><p id="scope">Report</p>', status: "检查完成"};
      }
      return {};
    }};
  };
  runInNewContext(workbenchScript, {document: {getElementById: get, querySelector: () => get("meta"), querySelectorAll: () => [], createElement: () => new Element()}, fetch, URL, Blob, setTimeout});
  await new Promise(resolve => setImmediate(resolve));
  return {get, offsets, async finishInitialHistory() { releaseHistory(); await new Promise(resolve => setImmediate(resolve)); }, async click(id: string) { await get(id).onclick?.(); await new Promise(resolve => setImmediate(resolve)); }};
}

describe("workbench interactions", () => {
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
