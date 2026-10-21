import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, lstat, mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ActionPlan } from "../domain/action-plan.js";
import type { VerificationReport } from "../cli/commands/verify.js";
import type { ArtifactReport } from "../cli/commands/artifacts.js";
import { renderVerificationHtml } from "../reporters/verification-html.js";
import { renderArtifactsHtml } from "../reporters/artifacts-html.js";
import { scanStagedWorkspace } from "../sandbox/workspace-tree.js";
import { workbenchPage, workbenchScript, workbenchStyle } from "./page.js";

const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_STATE = 64 * 1024 * 1024;
type Selection = { path: string; identity: string; kind: "skill" | "artifacts"; contract?: string; delivery: boolean };
const identity = (s: {dev: number; ino: number}) => `${s.dev}:${s.ino}`;
const inside = (root: string, target: string) => { const r = relative(root, target); return !r || (!r.startsWith("..") && !isAbsolute(r)); };

/** One loopback client, one bounded CLI process. No shell or Skill execution API. */
export async function startWorkbench(options: { port?: number; stateDir: string; cliPath?: string; timeoutMs?: number }) {
  const stateDir = resolve(options.stateDir);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  if ((await lstat(stateDir)).isSymbolicLink() || await realpath(stateDir) !== stateDir) throw new Error("State directory must be a real directory.");
  await chmod(stateDir, 0o700);
  const nonce = randomBytes(32).toString("hex");
  const cliPath = options.cliPath ?? fileURLToPath(new URL("../cli/index.js", import.meta.url));
  let active: ChildProcess | undefined, busy = false, applying = false, cancelled = false;
  let selection: Selection | undefined;
  let actionable: string[] = [];
  let plan: { id: string; path: string; value: ActionPlan; snapshot: string } | undefined;
  let origin = "";

  async function capacity() {
    const entries = await readdir(stateDir);
    if (entries.length >= 120) throw new Error("状态目录已满，请选择新的状态目录；原结果已保留。");
    let bytes = 0;
    for (const name of entries) { const s = await lstat(join(stateDir, name)); if (!s.isFile()) throw new Error("状态目录包含非普通文件。"); bytes += s.size; }
    // Reserve a complete bounded output before a command, including mutating apply.
    if (bytes + MAX_OUTPUT > MAX_STATE) throw new Error("状态目录达到 64 MiB 上限，请选择新的状态目录。");
  }
  async function save(name: string, value: string) {
    if (Buffer.byteLength(value) > MAX_OUTPUT) throw new Error("报告超过大小上限。");
    const path = join(stateDir, `${randomUUID()}-${name}`);
    await writeFile(path, value, { flag: "wx", mode: 0o600 }); return path;
  }
  async function checkSelection() {
    if (!selection) throw new Error("请先选择目录。");
    const s = await lstat(selection.path);
    if (!s.isDirectory() || s.isSymbolicLink() || identity(s) !== selection.identity || await realpath(selection.path) !== selection.path) throw new Error("目录已被替换，请重新选择。");
    return selection;
  }
  async function command(args: string[]): Promise<string> {
    await capacity(); if (cancelled) throw new Error("Cancelled");
    return new Promise((accept, reject) => {
      const child = spawn(process.execPath, [cliPath, ...args], { shell: false, stdio: ["ignore", "pipe", "pipe"], env: { PATH: dirname(process.execPath), LANG: "en_US.UTF-8" } });
      active = child; const chunks: Buffer[] = []; let size = 0, failure = "";
      const stop = (reason: string) => { failure = reason; child.kill("SIGTERM"); };
      const timer = setTimeout(() => stop(applying ? "修复超时，结果未确认，请重新核验。" : "核验超时，已停止。"), options.timeoutMs ?? 120_000);
      // A killed child must be reaped even if it ignores SIGTERM.
      const killer = setTimeout(() => child.kill("SIGKILL"), (options.timeoutMs ?? 120_000) + 2000); killer.unref();
      child.stdout!.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_OUTPUT) stop("报告超过 8 MiB 上限。"); else chunks.push(chunk); });
      child.stderr!.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_OUTPUT) stop("核验器输出超过上限。"); });
      child.on("error", () => { failure = "无法启动本机核验器。"; });
      child.on("close", code => { clearTimeout(timer); clearTimeout(killer); active = undefined;
        if (cancelled || failure) reject(new Error(cancelled ? "核验已取消，未产生完成结果。" : failure));
        else if (!Buffer.concat(chunks).toString("utf8").trim()) reject(new Error(`核验器未返回报告（${code}）。`)); else accept(Buffer.concat(chunks).toString("utf8"));
      });
    });
  }
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    let bytes = 0, text = "";
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) throw new Error("请求过大。"); text += chunk.toString(); }
    const value: unknown = JSON.parse(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请求无效。");
    return value as Record<string, unknown>;
  }
  function send(res: ServerResponse, code: number, value: unknown, type = "application/json") {
    res.writeHead(code, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self' about:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" });
    res.end(type === "application/json" ? JSON.stringify(value) : value);
  }
  const server = createServer(async (req, res) => {
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site") return send(res, 403, {error: "仅允许本机核验台访问。"});
    if (req.method === "GET") {
      if (req.url === "/favicon.ico") { res.writeHead(204); return res.end(); }
      if (req.url === "/health") return send(res, 200, {service: "skillsync-workbench", schema: 1});
      if (req.url === "/") return send(res, 200, workbenchPage(nonce), "text/html");
      if (req.url === "/app.js") return send(res, 200, workbenchScript, "text/javascript");
      if (req.url === "/style.css") return send(res, 200, workbenchStyle, "text/css");
      return send(res, 404, {});
    }
    if (req.method !== "POST" || req.headers["x-skillsync-client"] !== nonce || !req.headers["content-type"]?.startsWith("application/json")) return send(res, 403, {error: "请从核验台发起操作。"});
    try {
      const input = await body(req);
      if (req.url === "/api/cancel") { if (applying) throw new Error("修复写入中，请等待回执后重新核验。"); cancelled = true; active?.kill("SIGTERM"); const child = active; const timer = setTimeout(() => child?.kill("SIGKILL"), 2000); timer.unref(); return send(res, 200, {cancelled: true}); }
      if (busy) return send(res, 409, {error: "已有操作进行中。"});
      busy = true; cancelled = false;
      try {
        if (req.url === "/api/choose") {
          if (process.platform !== "darwin") throw new Error("请在路径框中输入目录或合同的完整路径。");
          const script = input.file === true ? 'POSIX path of (choose file with prompt "选择核验合同")' : 'POSIX path of (choose folder with prompt "选择核验目录")';
          const {stdout} = await promisify(execFile)("/usr/bin/osascript", ["-e", script], {timeout: 60_000, maxBuffer: 8192});
          return send(res, 200, {path: stdout.trim()});
        }
        if (req.url === "/api/select") {
          if (typeof input.path !== "string" || !isAbsolute(input.path) || input.path.length > 4096) throw new Error("请输入完整目录路径。");
          const path = resolve(input.path), s = await lstat(path);
          if (!s.isDirectory() || s.isSymbolicLink() || await realpath(path) !== path || path === "/" || path === homedir() || inside(path, stateDir) || inside(stateDir, path)) throw new Error("请选择独立的真实 Skill 或交付目录。");
          if (input.kind !== "skill" && input.kind !== "artifacts") throw new Error("请选择核验内容。");
          let contract: string | undefined;
          if (input.kind === "artifacts") {
            if (typeof input.contract !== "string" || !isAbsolute(input.contract)) throw new Error("请选择合同文件。");
            contract = resolve(input.contract); const file = await lstat(contract);
            if (!file.isFile() || file.isSymbolicLink() || file.size > 65536 || await realpath(contract) !== contract) throw new Error("合同必须是小于 64 KiB 的普通文件。");
          }
          selection = {path, identity: identity(s), kind: input.kind, contract, delivery: input.delivery === true}; plan = undefined; actionable = [];
          return send(res, 200, {selected: true});
        }
        const selected = await checkSelection();
        if (req.url === "/api/verify") {
          const output = await command(selected.kind === "skill" ? ["verify", "--path", selected.path, "--target", "codex", "--format", "json"] : ["artifacts", "--contract", selected.contract!, selected.delivery ? "--delivery" : "--path", selected.path, "--format", "json"]);
          const report = JSON.parse(output) as VerificationReport & ArtifactReport;
          if (selected.kind === "skill") actionable = report.issues.filter(i => i.finding.status === "fail" || i.finding.status === "warn").map(i => i.id);
          const html = selected.kind === "skill" ? renderVerificationHtml(report) : renderArtifactsHtml(report);
          await save("report.json", output);
          return send(res, 200, {html, status: report.exitCode === 0 ? "已声明检查通过" : "存在待处理项", exitCode: report.exitCode});
        }
        if (selected.kind !== "skill") throw new Error("交付核验不提供自动修复。");
        if (req.url === "/api/plan") {
          plan = undefined;
          if (!actionable.length) throw new Error("No actionable findings");
          const snapshot = (await scanStagedWorkspace(selected.path)).digest;
          if (cancelled) throw new Error("Cancelled");
          const output = await command(["fix", "--plan", "--path", selected.path, "--target", "codex", "--issue", ...actionable, "--format", "json"]);
          const value = JSON.parse(output) as ActionPlan;
          if (value.rootPath !== selected.path || !Array.isArray(value.changes) || !value.planDigest) throw new Error("未能生成有效计划，请先核验单个 Skill 目录。");
          if (snapshot !== (await scanStagedWorkspace(selected.path)).digest) throw new Error("Directory changed");
          plan = {snapshot, id: randomUUID(), path: await save("plan.json", output), value};
          const description = [...value.changes.map(c => `${c.path} · ${c.safety} · ${c.modeBefore?.toString(8) ?? "内容"} → ${c.modeAfter?.toString(8) ?? "内容"}`), ...value.manualSteps.map(s => `人工处理：${s.title}\n${s.steps.join("\n")}`)].join("\n\n");
          return send(res, 200, {id: plan.id, description: description || "没有可自动应用的变更。"});
        }
        if (req.url === "/api/apply") {
          if (!plan || input.id !== plan.id || input.confirm !== true) throw new Error("请审阅当前计划并明确确认。");
          const current = plan; plan = undefined;
          if (!current.value.changes.length || current.value.changes.length > 256 || current.value.changes.some(c => c.safety !== "safe")) throw new Error("此计划包含需人工审阅的变更，请使用 CLI 逐项处理。");
          if (current.snapshot !== (await scanStagedWorkspace(selected.path)).digest) throw new Error("Plan is stale");
          applying = true;
          const output = await command(["fix", "--apply", "--plan", current.path, "--yes", "--backup", "--format", "json"]);
          await save("receipt.json", output);
          const receipt = JSON.parse(output) as {status?: string; backupPath?: string};
          if (receipt.status !== "applied") throw new Error("修复未完成；已保存可用回执，请重新核验。");
          return send(res, 200, {message: `已应用并备份。尚未重新核验。备份：${receipt.backupPath ?? "见私有回执"}`});
        }
        return send(res, 404, {error: "未知操作。"});
      } finally { busy = false; applying = false; }
    } catch { send(res, 400, {error: cancelled ? "核验已取消，未产生完成结果。" : "操作未完成：请检查目录、合同、计划是否失效或状态目录容量，再重新核验。"}); }
  });
  server.requestTimeout = 130_000; server.headersTimeout = 10_000; server.maxConnections = 8;
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(options.port ?? 14986, "127.0.0.1", accept); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No local address");
  origin = `http://127.0.0.1:${address.port}`;
  return {url: origin, async close() { active?.kill("SIGTERM"); server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); }};
}
