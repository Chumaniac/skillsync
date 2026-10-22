import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
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
import { exportHistorySummary, MAX_OUTPUT, WorkbenchHistory, WorkbenchStateError, type HistoryComparison, type Selection } from "./history.js";
import { parseStrictJson } from "../domain/strict-json.js";
import { compareIssues } from "../domain/baseline.js";
import { compareArtifactReports, parseArtifactReport } from "../domain/artifact-report-comparison.js";

const identity = (s: {dev: number; ino: number}) => `${s.dev}:${s.ino}`;
const inside = (root: string, target: string) => { const r = relative(root, target); return !r || (!r.startsWith("..") && !isAbsolute(r)); };
const describePlan = (value:ActionPlan) => [...value.changes.map(c => `${c.path} · ${c.safety} · ${c.modeBefore?.toString(8) ?? "内容"} → ${c.modeAfter?.toString(8) ?? "内容"}`), ...value.manualSteps.map(s => `人工处理：${s.title}\n${s.steps.join("\n")}`)].join("\n\n") || "没有可自动应用的变更。";
const preview = (text:string) => `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><pre>${text.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]!))}</pre>`;

/** One loopback client, one bounded CLI process. No shell or Skill execution API. */
export async function startWorkbench(options: { port?: number; stateDir: string; cliPath?: string; timeoutMs?: number }) {
  const stateDir = resolve(options.stateDir);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  if ((await lstat(stateDir)).isSymbolicLink() || await realpath(stateDir) !== stateDir) throw new Error("State directory must be a real directory.");
  await chmod(stateDir, 0o700);
  const history = new WorkbenchHistory(stateDir, identity(await lstat(stateDir)));
  const nonce = randomBytes(32).toString("hex");
  const cliPath = options.cliPath ?? fileURLToPath(new URL("../cli/index.js", import.meta.url));
  let active: ChildProcess | undefined, busy = false, applying = false, cancelled = false;
  let selection: Selection | undefined;
  let actionable: string[] = [];
  let plan: { id: string; path: string; value: ActionPlan; snapshot: string; historyId:string } | undefined;
  let baseline: {id:string; report:VerificationReport|ArtifactReport; digest:string} | undefined;
  let latestId:string|undefined;
  let origin = "";

  async function checkSelection() {
    if (!selection) throw new Error("请先选择目录。");
    const s = await lstat(selection.path);
    if (!s.isDirectory() || s.isSymbolicLink() || identity(s) !== selection.identity || await realpath(selection.path) !== selection.path) throw new Error("目录已被替换，请重新选择。");
    return selection;
  }
  async function command(args: string[]): Promise<string> {
    await history.capacity(); if (cancelled) throw new Error("Cancelled");
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
        if (req.url === "/api/history") return send(res,200,await history.list(input.offset===undefined?0:Number(input.offset)));
        if (req.url === "/api/history/open" || req.url === "/api/history/export") {
          const {record,output}=await history.read(input.id);
          if(req.url.endsWith("export"))return send(res,200,{html:exportHistorySummary(record)});
          // Viewing old evidence grants no selection or mutation capability.
          selection=undefined;plan=undefined;baseline=undefined;latestId=undefined;actionable=[];
          let html:string;
          if(record.kind==="verify")html=record.selection.kind==="skill"?renderVerificationHtml(parseStrictJson(output!) as VerificationReport):renderArtifactsHtml(parseArtifactReport(parseStrictJson(output!)));
          else if(record.kind==="plan")html=preview("历史计划，仅供查看。重新核验后才能生成新计划。\n\n"+describePlan(parseStrictJson(output!) as ActionPlan));
          else html=preview(record.kind==="apply-intent"?"应用请求已记录。请查看关联回执；若结果未确认，先核验当前目录。":"应用回执已保留；仍需另行核验当前目录。");
          return send(res,200,{readOnly:true,id:record.id,kind:record.kind,selection:record.selection,baselineId:record.kind==="verify"?record.id:record.baselineId,comparison:record.comparison,html});
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
          const next:Selection={path, identity: identity(s), kind: input.kind, contract, delivery: input.delivery === true};
          let chosen:typeof baseline;
          if(input.baselineId!==undefined) {
            const {record,output}=await history.read(input.baselineId);
            if(record.kind!=="verify"||JSON.stringify(record.selection)!==JSON.stringify(next))throw new Error("基线不属于当前目录与核验方式。");
            chosen={id:record.id,digest:record.dataSha256!,report:next.kind==="skill"?parseStrictJson(output!) as VerificationReport:parseArtifactReport(parseStrictJson(output!))};
          }
          selection = next; baseline=chosen;latestId=undefined;plan = undefined; actionable = [];
          return send(res, 200, {selected: true});
        }
        const selected = await checkSelection();
        if (req.url === "/api/verify") {
          plan=undefined;actionable=[];
          const snapshot=selected.kind==="skill"?(await scanStagedWorkspace(selected.path)).digest:undefined;
          const output = await command(selected.kind === "skill" ? ["verify", "--path", selected.path, "--target", "codex", "--format", "json"] : ["artifacts", "--contract", selected.contract!, selected.delivery ? "--delivery" : "--path", selected.path, "--format", "json"]);
          const report = parseStrictJson(output) as VerificationReport & ArtifactReport;
          await checkSelection();
          if(snapshot && snapshot!==(await scanStagedWorkspace(selected.path)).digest)throw new Error("Directory changed");
          if (selected.kind === "skill") actionable = report.issues.filter(i => i.finding.status === "fail" || i.finding.status === "warn").map(i => i.id);
          const html = selected.kind === "skill" ? renderVerificationHtml(report) : renderArtifactsHtml(report);
          let comparison:HistoryComparison|undefined;
          if(baseline) {
            if(selected.kind==="artifacts") {
              const compared=compareArtifactReports(baseline.report as ArtifactReport,parseArtifactReport(report),baseline.digest);
              comparison=compared.status==="compared"?{status:"compared",added:compared.findings!.added,ongoing:compared.findings!.ongoing,resolved:compared.findings!.resolved}:{status:"unavailable",reason:compared.reason};
            } else if([baseline.report.exitCode,report.exitCode].some(c=>c===2||c===4)||[(baseline.report as VerificationReport).issues,report.issues].some(v=>v.length>=256))comparison={status:"unavailable",reason:"incomplete-evidence"};
            else {
              const pending=(value:VerificationReport)=>value.issues.filter(issue=>issue.finding.status==="fail"||issue.finding.status==="warn");
              const before=pending(baseline.report as VerificationReport),after=pending(report),c=compareIssues(before,after);
              // A warning may bind the entire Skill digest. Pair changed evidence
              // within the same code/location, rather than claiming it was fixed.
              const group=(issue:VerificationReport["issues"][number])=>JSON.stringify([issue.finding.code,issue.finding.skill,issue.finding.target,issue.location]);
              const removed=new Map<string,number>();
              for(const issue of before.filter(i=>c.resolvedIds.includes(i.id)))removed.set(group(issue),(removed.get(group(issue))??0)+1);
              let changed=0;
              for(const issue of after.filter(i=>c.newIds.includes(i.id))) {const key=group(issue),count=removed.get(key)??0;if(count){changed++;removed.set(key,count-1);}}
              comparison={status:"compared",added:c.newIds.length-changed,ongoing:c.ongoingIds.length,resolved:c.resolvedIds.length-changed,changed};
            }
          }
          const saved=await history.append({kind:"verify",selection:selected,snapshot,baselineId:baseline?.id,parentId:latestId,exitCode:report.exitCode,comparison},output);
          latestId=saved.id;baseline??={id:saved.id,report,digest:saved.dataSha256!};
          return send(res, 200, {html, historyId:saved.id, baselineId:baseline.id, comparison, status: report.exitCode === 0 ? "已声明检查通过" : "存在待处理项", exitCode: report.exitCode});
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
          const saved=await history.append({kind:"plan",selection:selected,snapshot,baselineId:baseline?.id,parentId:latestId},output);
          plan = {snapshot, id: randomUUID(), path: join(stateDir,saved.dataFile!), value, historyId:saved.id};
          const description = describePlan(value);
          return send(res, 200, {id: plan.id, description: description || "没有可自动应用的变更。"});
        }
        if (req.url === "/api/apply") {
          if (!plan || input.id !== plan.id || input.confirm !== true) throw new Error("请审阅当前计划并明确确认。");
          const current = plan; plan = undefined;
          if (!current.value.changes.length || current.value.changes.length > 256 || current.value.changes.some(c => c.safety !== "safe")) throw new Error("此计划包含需人工审阅的变更，请使用 CLI 逐项处理。");
          if (current.snapshot !== (await scanStagedWorkspace(selected.path)).digest) throw new Error("Plan is stale");
          await history.read(current.historyId);
          await history.capacity(3,2*MAX_OUTPUT);
          const intent=await history.append({kind:"apply-intent",selection:selected,snapshot:current.snapshot,baselineId:baseline?.id,parentId:current.historyId});
          applying = true;
          const output = await command(["fix", "--apply", "--plan", current.path, "--yes", "--backup", "--format", "json"]);
          await history.append({kind:"apply",selection:selected,snapshot:current.snapshot,baselineId:baseline?.id,parentId:intent.id},output);
          const receipt = JSON.parse(output) as {status?: string; backupPath?: string};
          if (receipt.status !== "applied") throw new Error("修复未完成；已保存可用回执，请重新核验。");
          return send(res, 200, {message: `已应用并备份。尚未重新核验。备份：${receipt.backupPath ?? "见私有回执"}`});
        }
        return send(res, 404, {error: "未知操作。"});
      } finally { busy = false; applying = false; }
    } catch (error) { send(res, 400, {error: cancelled ? "核验已取消，未产生完成结果。" : error instanceof WorkbenchStateError ? error.message : "操作未完成：请检查目录、合同、计划是否失效或状态目录容量，再重新核验。"}); }
  });
  server.requestTimeout = 130_000; server.headersTimeout = 10_000; server.maxConnections = 8;
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(options.port ?? 14986, "127.0.0.1", accept); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No local address");
  origin = `http://127.0.0.1:${address.port}`;
  return {url: origin, async close() { active?.kill("SIGTERM"); server.closeAllConnections(); await new Promise<void>(accept => server.close(() => accept())); }};
}
