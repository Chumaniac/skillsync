import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Stats } from "node:fs";
import { chmod, lstat, mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ActionPlan } from "../domain/action-plan.js";
import type { VerificationReport } from "../cli/commands/verify.js";
import type { ArtifactReport } from "../domain/artifact-report.js";
import { renderVerificationHtml } from "../reporters/verification-html.js";
import { renderArtifactsHtml } from "../reporters/artifacts-html.js";
import { readWorkspaceFile, scanStagedWorkspace } from "../sandbox/workspace-tree.js";
import { journeySummary } from "./journey-summary.js";
import { workbenchPage, workbenchScript, workbenchStyle } from "./page.js";
import { exportHistorySummary, MAX_OUTPUT, WorkbenchHistory, WorkbenchStateError, type HistoryComparison, type Selection } from "./history.js";
import { parseStrictJson } from "../domain/strict-json.js";
import {compareVerificationReports} from "./verification-comparison.js";
import { compareArtifactReports, parseArtifactReport } from "../domain/artifact-report-comparison.js";
import {previewAcceptancePlan,inspectAcceptancePackage,batchSummary} from "../cli/commands/batch.js";
import {renderBatchHtml} from "../reporters/batch-html.js";
import {BatchAcceptanceError} from "../domain/batch-report.js";

const identity = (s: {dev: number; ino: number}) => `${s.dev}:${s.ino}`;
const inside = (root: string, target: string) => { const r = relative(root, target); return !r || (!r.startsWith("..") && !isAbsolute(r)); };
const describePlan = (value:ActionPlan) => [...value.changes.map(c => `${c.path} · ${c.safety} · ${c.modeBefore?.toString(8) ?? "内容"} → ${c.modeAfter?.toString(8) ?? "内容"}`), ...value.manualSteps.map(s => `人工处理：${s.title}\n${s.steps.join("\n")}`)].join("\n\n") || "没有可自动应用的变更。";
const preview = (text:string) => `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><pre>${text.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]!))}</pre>`;

const operationKinds = {"/api/choose":"choose","/api/select":"select","/api/verify":"verify","/api/plan":"plan","/api/apply":"apply","/api/batch/preview":"batch_preview","/api/batch/run":"batch_run","/api/batch/open":"batch_open","/api/history/open":"history_open","/api/history/export":"history_export"} as const;
type OperationKind = typeof operationKinds[keyof typeof operationKinds];
type OperationOutcome = "completed"|"failed"|"cancelled"|"unconfirmed";
type ActiveOperation = {id:string;kind:OperationKind;phase:"preparing"|"running"|"finalizing";startedAt:number;submitted:boolean;historyId?:string;outcome?:OperationOutcome};
type LastOperation = {id:string;kind:OperationKind;startedAt:number;finishedAt:number;outcome:OperationOutcome;historyId?:string};
const operationId = (value:unknown):value is string => typeof value==="string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

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
  let currentOperation:ActiveOperation|undefined, lastOperation:LastOperation|undefined;
  let cancelKiller:ReturnType<typeof setTimeout>|undefined, closing=false;
  const cancellable = () => Boolean(currentOperation && !applying && !cancelled && currentOperation.phase!=="finalizing" && ["verify","plan","batch_run"].includes(currentOperation.kind));
  const operationStatus = () => ({schema:"skillsync.workbench-operation/v1",readOnly:true,
    active:currentOperation?{id:currentOperation.id,kind:currentOperation.kind,phase:applying?"applying":currentOperation.phase,startedAt:currentOperation.startedAt,cancellable:cancellable(),cancelRequested:cancelled}:null,
    last:lastOperation??null});
  let comparingHistory=false;
  let selection: Selection | undefined;
  let actionable: string[] = [];
  let plan: { id: string; path: string; value: ActionPlan; snapshot: string; historyId:string } | undefined;
  let baseline: {id:string; report:VerificationReport|ArtifactReport; digest:string} | undefined;
  let latestId:string|undefined;
  let batchPreview:{path:string;sha:string}|undefined;
  let origin = "";

  async function checkSelection() {
    if (!selection) throw new WorkbenchStateError("请先选择目录。");
    const s = await lstat(selection.path);
    if (!s.isDirectory() || s.isSymbolicLink() || identity(s) !== selection.identity || await realpath(selection.path) !== selection.path) throw new WorkbenchStateError("目录已被替换，请重新选择。");
    return selection;
  }
  async function command(args: string[], commandOptions:{reserveHistory?:boolean}={}): Promise<string> {
    if(currentOperation)currentOperation.phase="preparing";
    if(commandOptions.reserveHistory!==false)await history.capacity(); if (cancelled||closing) throw new Error("Cancelled");
    return new Promise((accept, reject) => {
      const child = spawn(process.execPath, [cliPath, ...args], { shell: false, stdio: ["ignore", "pipe", "pipe"], env: { PATH: dirname(process.execPath), LANG: "en_US.UTF-8" } });
      active = child; if(currentOperation){currentOperation.phase="running";currentOperation.submitted=true;} const chunks: Buffer[] = []; let size = 0, failure = "";
      const stop = (reason: string) => { failure = reason; child.kill("SIGTERM"); };
      const timer = setTimeout(() => stop(applying ? "修复超时，结果未确认，请重新核验。" : "核验超时，已停止。"), options.timeoutMs ?? 120_000);
      // A killed child must be reaped even if it ignores SIGTERM.
      const killer = setTimeout(() => child.kill("SIGKILL"), (options.timeoutMs ?? 120_000) + 2000); killer.unref();
      child.stdout!.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_OUTPUT) stop("报告超过 8 MiB 上限。"); else chunks.push(chunk); });
      child.stderr!.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_OUTPUT) stop("核验器输出超过上限。"); });
      child.on("error", () => { failure = "无法启动本机核验器。"; });
      child.on("close", code => { clearTimeout(timer); clearTimeout(killer); active = undefined; if(currentOperation)currentOperation.phase="finalizing";
        if (cancelled || failure) reject(new WorkbenchStateError(cancelled ? "核验已取消，未产生完成结果。" : failure));
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
  function batchPath(value:unknown):string {
    if(typeof value!=="string"||!isAbsolute(value)||value.length>4096||/[\p{Cc}]/u.test(value))throw new WorkbenchStateError("请输入独立计划或复核包的完整文件路径。");
    const path=resolve(value),parent=dirname(path);
    if(parent==="/"||parent===homedir()||inside(stateDir,path))throw new WorkbenchStateError("请选择独立项目目录中的文件，避免根目录、主目录和私有历史目录。");
    return path;
  }
  function send(res: ServerResponse, code: number, value: unknown, type = "application/json") {
    res.writeHead(code, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self' about:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" });
    res.end(type === "application/json" ? JSON.stringify(value) : value);
  }
  const server = createServer(async (req, res) => {
    // A clicked/typed top-level page may retain cross-site Fetch Metadata on reload.
    // Only the static entry document is admitted; API writes still require same-origin and nonce checks.
    const entryNavigation = req.method === "GET" && req.url === "/" &&
      req.headers["sec-fetch-mode"] === "navigate" && req.headers["sec-fetch-dest"] === "document" &&
      req.headers["sec-fetch-user"] === "?1" && !req.headers.origin;
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) ||
      (req.headers["sec-fetch-site"] === "cross-site" && !entryNavigation)) return send(res, 403, {error: "仅允许本机核验台访问。"});
    if (req.method === "GET") {
      if (req.url === "/favicon.ico") { res.writeHead(204); return res.end(); }
      if (req.url === "/health") return send(res, 200, {service: "skillsync-workbench", schema: 1});
      if (req.url === "/") return send(res, 200, workbenchPage(nonce), "text/html");
      if (req.url === "/app.js") return send(res, 200, workbenchScript, "text/javascript");
      if (req.url === "/style.css") return send(res, 200, workbenchStyle, "text/css");
      return send(res, 404, {});
    }
    if (req.method !== "POST" || req.headers["x-skillsync-client"] !== nonce || !req.headers["content-type"]?.startsWith("application/json")) return send(res, 403, {error: "请从核验台发起操作。"});
    let requestedOperation:ActiveOperation|undefined;
    try {
      const input = await body(req);
      if(req.url==="/api/operation")return send(res,200,operationStatus());
      if (req.url === "/api/cancel") {
        if(!operationId(input.operationId)||!currentOperation||input.operationId!==currentOperation.id)return send(res,409,{error:"操作已切换或结束，本次请求没有取消任何新操作。",code:"operation_changed"});
        if(applying||currentOperation.kind==="apply")throw new WorkbenchStateError("修复写入中，请等待回执后重新核验。");
        if(cancelled)return send(res,200,{cancelled:true,operationId:currentOperation.id});
        if(!cancellable())throw new WorkbenchStateError("当前操作正在收尾或只读准备中，暂不可取消；请等待结果。");
        cancelled=true;const child=active;child?.kill("SIGTERM");
        if(child){cancelKiller=setTimeout(()=>child.kill("SIGKILL"),2000);cancelKiller.unref();}
        return send(res,200,{cancelled:true,operationId:currentOperation.id});
      }
      if(req.url === "/api/example") {
        const path=fileURLToPath(new URL("../../fixtures/product/trust-loop/review",import.meta.url));
        const info=await lstat(path);
        if(!info.isDirectory()||info.isSymbolicLink())throw new WorkbenchStateError("示例目录不可用，请选择自己的 Skill 目录。");
        return send(res,200,{path});
      }
      if(req.url === "/api/history/json") {
        const {record,output}=await history.read(input.id);
        if(record.kind!=="verify"||!output)return send(res,400,{error:"此记录没有结构化核验报告。"});
        return send(res,200,{schema:"skillsync.local-export/v1",recordId:record.id,createdAt:record.createdAt,report:parseStrictJson(output),scope:"本机已存核验，不执行 Skill，不认证作者"});
      }
      // Listing is bounded and read-only; it must not acquire or reset the CLI operation lock.
      if (req.url === "/api/history") return send(res,200,await history.list(input.offset===undefined?0:Number(input.offset),{
        query:input.query??"",kind:input.kind,exitCode:input.exitCode,
      }));
      if(req.url==="/api/history/compare"){
        if(comparingHistory)return send(res,409,{error:"已有历史对照读取中，请稍后重试。"});
        comparingHistory=true;
        try{return send(res,200,await history.compare(input.beforeId,input.afterId));}
        catch(error){return send(res,400,{error:error instanceof WorkbenchStateError?error.message:"历史材料无法稳定读取，请检查两份原记录；没有重新执行核验。"});}
        finally{comparingHistory=false;}
      }
      if (busy) return send(res, 409, {error: "已有操作进行中，请查看后台状态。",code:"operation_busy"});
      const kind=operationKinds[req.url as keyof typeof operationKinds];
      if(!kind)return send(res,404,{error:"未知操作。"});
      const id=input.operationId===undefined?randomUUID():input.operationId;
      if(!operationId(id)||lastOperation?.id===id)return send(res,409,{error:"请使用新的操作编号重新发起。",code:"operation_changed"});
      const owned:ActiveOperation={id,kind,phase:"preparing",startedAt:Date.now(),submitted:false};
      requestedOperation=owned;currentOperation=owned;busy=true;cancelled=false;
      const respond=(code:number,value:unknown)=>{owned.outcome=code<400?"completed":"failed";return send(res,code,{...(value as Record<string,unknown>),operationId:owned.id});};
      try {
        if (req.url === "/api/choose") {
          if (process.platform !== "darwin") throw new Error("请在路径框中输入目录或合同的完整路径。");
          const script = input.file === true ? 'POSIX path of (choose file with prompt "选择核验清单、计划或复核包")' : 'POSIX path of (choose folder with prompt "选择核验目录")';
          try {
            const pending = promisify(execFile)("/usr/bin/osascript", ["-e", script], {timeout: 60_000, maxBuffer: 8192});
            active=pending.child;owned.phase="running";
            try { const {stdout}=await pending;return respond(200,{path:stdout.trim()}); }
            finally {active=undefined;owned.phase="finalizing";}
          } catch (error) {
            const cancelled = error instanceof Error && "stderr" in error && String(error.stderr).includes("(-128)");
            throw new WorkbenchStateError(cancelled ? "已取消选择，原路径保留。" : "系统选择器未完成，请重试或在路径框输入完整路径。");
          }
        }
        if(req.url==="/api/batch/preview"||req.url==="/api/batch/run"||req.url==="/api/batch/open"){
          // Batch inspection never leaves a single-Skill mutation capability alive.
          selection=undefined;plan=undefined;baseline=undefined;latestId=undefined;actionable=[];
          if(req.url.endsWith("preview")){
            batchPreview=undefined;const path=batchPath(input.path),data=await previewAcceptancePlan(path);
            batchPreview={path,sha:data.plan_sha256};return respond(200,data);
          }
          if(req.url.endsWith("open")){
            batchPreview=undefined;const path=batchPath(input.path);
            const contract=input.contract===undefined||input.contract===''?undefined:batchPath(input.contract);
            const checked=await inspectAcceptancePackage(path,{expectSha256:typeof input.expectSha256==="string"&&input.expectSha256?input.expectSha256:undefined,
              contract});
            return respond(200,{integrity:"verified",summary:batchSummary(checked.packet.payload),package_sha256:checked.package_sha256,html:renderBatchHtml(checked.packet.payload,checked.declarations_sha256)});
          }
          const path=batchPath(input.path),chosen=batchPreview;batchPreview=undefined;
          if(!chosen||chosen.path!==path)throw new WorkbenchStateError("请先预检当前验收计划，再执行多批次核验。");
          const output=batchPath(input.output),args=["batch","run","--plan",path,"--output",output,"--expect-plan-sha256",chosen.sha,"--format","json"];
          if(typeof input.previous==="string"&&input.previous){args.push("--previous",batchPath(input.previous));if(input.retryFailed===true)args.push("--retry-failed");}
          const raw=await command(args,{reserveHistory:false}),result=parseStrictJson(raw) as {schema?:string;package_sha256?:string};
          if(result.schema!=="skillsync.batch-report/v1"||typeof result.package_sha256!=="string"||!/^[a-f0-9]{64}$/.test(result.package_sha256))throw new WorkbenchStateError("多批次结果未确认，请先检查输出文件后再重试。");
          const checked=await inspectAcceptancePackage(output,{expectSha256:result.package_sha256});
          return respond(200,{integrity:"verified",summary:batchSummary(checked.packet.payload),package_sha256:checked.package_sha256,packagePath:output,html:renderBatchHtml(checked.packet.payload,checked.declarations_sha256)});
        }
        if (req.url === "/api/history/open" || req.url === "/api/history/export") {
          const {record,output}=await history.read(input.id);
          if(req.url.endsWith("export"))return respond(200,{html:exportHistorySummary(record)});
          // Viewing old evidence grants no selection or mutation capability.
          selection=undefined;plan=undefined;baseline=undefined;latestId=undefined;actionable=[];batchPreview=undefined;
          let html:string;
          if(record.kind==="verify")html=record.selection.kind==="skill"?renderVerificationHtml(parseStrictJson(output!) as VerificationReport):renderArtifactsHtml(parseArtifactReport(parseStrictJson(output!)));
          else if(record.kind==="plan")html=preview("历史计划，仅供查看。重新核验后才能生成新计划。\n\n"+describePlan(parseStrictJson(output!) as ActionPlan));
          else html=preview(record.kind==="apply-intent"?"应用请求已记录。请查看关联回执；若结果未确认，先核验当前目录。":"应用回执已保留；仍需另行核验当前目录。");
          return respond(200,{readOnly:true,id:record.id,kind:record.kind,selection:record.selection,baselineId:record.kind==="verify"?record.id:record.baselineId,comparison:record.comparison,html,summary:record.kind==="verify"?journeySummary(record.selection.kind,record.selection.kind==="skill"?parseStrictJson(output!) as VerificationReport:parseArtifactReport(parseStrictJson(output!)),true):undefined});
        }
        if (req.url === "/api/select") {
          batchPreview=undefined;
          if (typeof input.path !== "string" || !isAbsolute(input.path) || input.path.length > 4096) throw new WorkbenchStateError("请输入完整目录路径。");
          const path = resolve(input.path), s = await lstat(path);
          if (!s.isDirectory() || s.isSymbolicLink() || await realpath(path) !== path || path === "/" || path === homedir() || inside(path, stateDir) || inside(stateDir, path)) throw new WorkbenchStateError("请选择独立的真实 Skill 或交付目录。");
          if (input.kind !== "skill" && input.kind !== "artifacts") throw new WorkbenchStateError("请选择核验内容。");
          let contract: string | undefined;
          if (input.kind === "artifacts") {
            if (typeof input.contract !== "string" || !isAbsolute(input.contract)) throw new WorkbenchStateError("请选择合同文件。");
            contract = resolve(input.contract); const file = await lstat(contract);
            if (!file.isFile() || file.isSymbolicLink() || file.size > 65536 || await realpath(contract) !== contract) throw new WorkbenchStateError("合同必须是小于 64 KiB 的普通文件。");
          }
          const next:Selection={path, identity: identity(s), kind: input.kind, contract, delivery: input.delivery === true};
          let chosen:typeof baseline;
          if(input.baselineId!==undefined) {
            const {record,output}=await history.read(input.baselineId);
            if(record.kind!=="verify"||JSON.stringify(record.selection)!==JSON.stringify(next))throw new WorkbenchStateError("基线不属于当前目录与核验方式。");
            chosen={id:record.id,digest:record.dataSha256!,report:next.kind==="skill"?parseStrictJson(output!) as VerificationReport:parseArtifactReport(parseStrictJson(output!))};
          }
          selection = next; baseline=chosen;latestId=undefined;plan = undefined; actionable = [];
          return respond( 200, {selected: true});
        }
        const selected = await checkSelection();
        if (req.url === "/api/verify") {
          plan=undefined;actionable=[];
          const snapshot=selected.kind==="skill"?(await scanStagedWorkspace(selected.path)).digest:undefined;
          let contractSnapshot: { stamp: Stats; digest: string } | undefined;
          if (selected.kind === "artifacts") {
            try {
              const stamp = await lstat(selected.contract!);
              contractSnapshot = { stamp, digest: createHash("sha256").update(await readWorkspaceFile(selected.contract!, 64 * 1024, stamp)).digest("hex") };
            } catch { throw new WorkbenchStateError("合同无法稳定读取，请检查文件后重新核验。"); }
          }
          const output = await command(selected.kind === "skill" ? ["verify", "--path", selected.path, "--target", "codex", "--format", "json"] : ["artifacts", "--contract", selected.contract!, selected.delivery ? "--delivery" : "--path", selected.path, "--format", "json", "--include-row-evidence"]);
          const report = parseStrictJson(output) as VerificationReport & ArtifactReport;
          await checkSelection();
          if(snapshot && snapshot!==(await scanStagedWorkspace(selected.path)).digest)throw new WorkbenchStateError("核验期间目录已变化，请重新核验。");
          if (contractSnapshot) {
            let unchanged = false;
            try { unchanged = createHash("sha256").update(await readWorkspaceFile(selected.contract!, 64 * 1024, contractSnapshot.stamp)).digest("hex") === contractSnapshot.digest; } catch { /* Changed/unreadable contracts cannot become current history. */ }
            if (!unchanged) throw new WorkbenchStateError("核验期间合同已变化，请重新核验；此次结果未保存到历史。");
          }
          if (selected.kind === "skill") actionable = report.issues.filter(i => i.finding.status === "fail" || i.finding.status === "warn").map(i => i.id);
          const html = selected.kind === "skill" ? renderVerificationHtml(report) : renderArtifactsHtml(report);
          let comparison:HistoryComparison|undefined;
          if(baseline) {
            if(selected.kind==="artifacts") {
              const compared=compareArtifactReports(baseline.report as ArtifactReport,parseArtifactReport(report),baseline.digest);
              comparison=compared.status==="compared"?{status:"compared",added:compared.findings!.added,ongoing:compared.findings!.ongoing,resolved:compared.findings!.resolved}:{status:"unavailable",reason:compared.reason};
            } else {
              const compared=compareVerificationReports(baseline.report as VerificationReport,report);
              comparison=compared.status==='compared'?{status:'compared',...compared.counts}:{status:'unavailable',reason:compared.reason};
            }
          }
          const saved=await history.append({kind:"verify",selection:selected,snapshot,baselineId:baseline?.id,parentId:latestId,exitCode:report.exitCode,comparison},output);
          owned.historyId=saved.id;
          latestId=saved.id;baseline??={id:saved.id,report,digest:saved.dataSha256!};
          const summary = journeySummary(selected.kind, report);
          const warnings = selected.kind === "skill" ? (report as VerificationReport).summary.warn : 0;
          const status = report.exitCode !== 0 ? "存在待处理项"
            : warnings ? `已完成，${warnings} 项警告待复核` : summary.title;
          return respond(200, {html, historyId:saved.id, baselineId:baseline.id, comparison, summary, status, exitCode:report.exitCode});
        }
        if (selected.kind !== "skill") throw new WorkbenchStateError("交付核验不提供自动修复。");
        if (req.url === "/api/plan") {
          plan = undefined;
          if (!actionable.length) throw new WorkbenchStateError("没有可自动处理的问题，请查看报告中的人工建议。");
          const snapshot = (await scanStagedWorkspace(selected.path)).digest;
          if (cancelled) throw new Error("Cancelled");
          const output = await command(["fix", "--plan", "--path", selected.path, "--target", "codex", "--issue", ...actionable, "--format", "json"]);
          const value = JSON.parse(output) as ActionPlan;
          await checkSelection();
          if (value.rootPath !== selected.path || value.rootIdentity !== selected.identity || !Array.isArray(value.changes) || !value.planDigest) throw new Error("未能生成有效计划，请先核验单个 Skill 目录。");
          if (snapshot !== (await scanStagedWorkspace(selected.path)).digest) throw new WorkbenchStateError("核验期间目录已变化，请重新核验。");
          await checkSelection();
          const saved=await history.append({kind:"plan",selection:selected,snapshot,baselineId:baseline?.id,parentId:latestId},output);
          owned.historyId=saved.id;
          plan = {snapshot, id: randomUUID(), path: join(stateDir,saved.dataFile!), value, historyId:saved.id};
          const description = describePlan(value);
          return respond( 200, {id: plan.id, description: description || "没有可自动应用的变更。"});
        }
        if (req.url === "/api/apply") {
          if (!plan || input.id !== plan.id || input.confirm !== true) throw new WorkbenchStateError("请审阅当前计划并明确确认。");
          const current = plan; plan = undefined; actionable = [];
          if (!current.value.changes.length || current.value.changes.length > 256 || current.value.changes.some(c => c.safety !== "safe")) throw new WorkbenchStateError("此计划包含需人工审阅的变更，请使用 CLI 逐项处理。");
          if (current.snapshot !== (await scanStagedWorkspace(selected.path)).digest) throw new WorkbenchStateError("文件已变化，当前计划不能应用。请重新核验。");
          await history.read(current.historyId);
          await history.capacity(3,2*MAX_OUTPUT);
          const intent=await history.append({kind:"apply-intent",selection:selected,snapshot:current.snapshot,baselineId:baseline?.id,parentId:current.historyId});
          owned.historyId=intent.id;
          await checkSelection();
          applying = true;
          const output = await command(["fix", "--apply", "--plan", current.path, "--yes", "--backup", "--format", "json"]);
          const applied=await history.append({kind:"apply",selection:selected,snapshot:current.snapshot,baselineId:baseline?.id,parentId:intent.id},output);
          owned.historyId=applied.id;
          const receipt = JSON.parse(output) as {status?: string; backupPath?: string};
          if (receipt.status !== "applied") throw new Error("修复未完成；已保存可用回执，请重新核验。");
          return respond( 200, {message: `已应用并备份。尚未重新核验。备份：${receipt.backupPath ?? "见私有回执"}`});
        }
        return respond( 404, {error: "未知操作。"});
      } catch(error) {
        owned.outcome=owned.submitted&&["apply","batch_run"].includes(owned.kind)?"unconfirmed":cancelled?"cancelled":"failed";
        throw error;
      } finally {
        if(cancelKiller){clearTimeout(cancelKiller);cancelKiller=undefined;}
        lastOperation={id:owned.id,kind:owned.kind,startedAt:owned.startedAt,finishedAt:Math.max(Date.now(),owned.startedAt),outcome:owned.outcome??"failed",...(owned.historyId?{historyId:owned.historyId}:{})};
        if(currentOperation===owned)currentOperation=undefined;
        busy=false;applying=false;
      }
    } catch (error) { send(res, 400, {...(requestedOperation?{operationId:requestedOperation.id}:{}),error: cancelled ? "核验已取消，先检查可能保留的输出，再决定后续操作。" : error instanceof WorkbenchStateError ? error.message : error instanceof BatchAcceptanceError ? error.message : error instanceof Error && "code" in error && error.code === "ENOENT" ? "目录或文件不存在，请重新选择或检查历史材料。" : "操作失败，请检查所选目录和验收清单后重新核验。"}); }
  });
  server.requestTimeout = 130_000; server.headersTimeout = 10_000; server.maxConnections = 8;
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(options.port ?? 14986, "127.0.0.1", accept); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No local address");
  origin = `http://127.0.0.1:${address.port}`;
  return {url: origin, async close() {
    closing=true;cancelled=true;const child=active;
    if(child&&child.exitCode===null&&child.signalCode===null){const stopped=new Promise<void>(accept=>child.once("close",()=>accept()));child.kill("SIGTERM");const timer=setTimeout(()=>child.kill("SIGKILL"),2000);timer.unref();await stopped;clearTimeout(timer);}
    if(cancelKiller){clearTimeout(cancelKiller);cancelKiller=undefined;}
    server.closeAllConnections();await new Promise<void>(accept=>server.close(()=>accept()));
  }};
}
