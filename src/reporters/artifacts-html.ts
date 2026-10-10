import type { ArtifactReport } from "../cli/commands/artifacts.js";
import type { ArtifactFinding } from "../domain/artifact-content.js";
import type { ReconciliationSummary } from "../domain/artifact-reconciliation.js";
import { VERSION } from "../version.js";
import { redactLocalPaths } from "./local-paths.js";

const FILE_DETAILS = 100;
const CHECK_DETAILS = 64;
const TEXT_LENGTH = 160;

// Only metadata supplied by the existing inspector reaches this offline view.
function text(value: unknown): string {
  const original = String(value ?? "Not reported");
  const clipped = original.length > TEXT_LENGTH ? original.slice(0, TEXT_LENGTH) + "…" : original;
  return clipped.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function columns(value: string | string[]): string {
  return text(Array.isArray(value) ? value.join(" + ") : value);
}

function action(code: string): string {
  if (code === "artifact.reconciliation-keys" || code === "artifact.reconciliation-sum") return "Compare expected and delivered records using the declared key columns. Preserve the original delivery while reviewing a corrected copy.";
  if (code.startsWith("artifact.reconciliation-")) return "No partial result is accepted. Review the declared types, integer range and selected-cell capacity before checking again.";
  if (code === "artifact.contract-invalid") return "Review the contract declaration and directory selection before inspecting files. No file acceptance is established.";
  if (code.includes("digest") || code.includes("changed") || code.includes("snapshot")) return "Retain this copy for comparison. Recover known successful originals and recheck the same reviewed expectations.";
  if (code.includes("missing")) return "Recover missing files from the saved successful delivery, then recheck the complete required scope.";
  if (code.includes("capacity")) return "Review the documented capacity bounds. A partial check cannot accept the whole delivery.";
  return "Review the declared file, field and requirement below. Keep original evidence and check again after an approved correction.";
}

function findingRow(finding: ArtifactFinding): string {
  return `<tr><td><code>${text(finding.code)}</code></td><td>${text(finding.path ?? "Whole delivery")}
    ${finding.field ? `<small>Field: ${columns(finding.field)}</small>` : ""}
    ${finding.row !== undefined ? `<small>Row: ${text(finding.row)}</small>` : ""}</td>
    <td>${finding.message ? `<p>${text(finding.message)}</p>` : ""}${action(finding.code)}</td></tr>`;
}

function reconciliationCard(check: ReconciliationSummary, rowBudget: { remaining: number }): string {
  const label = check.status === "passed" ? "Passed" : check.status === "unknown" ? "Unknown — check incomplete" : "Failed";
  const tone = check.status === "passed" ? "pass" : check.status === "unknown" ? "unknown" : "fail";
  const positions = check.recordEvidence?.items.slice(0, Math.min(32, rowBudget.remaining)) ?? [];
  rowBudget.remaining -= positions.length;
  return `<article class="check"><div class="check-heading"><h3>Integer allocation by identity</h3><span class="badge ${tone}">${label}</span></div>
    <div class="sides"><p><span>Expected</span><strong>${text(check.source.path)}</strong><code>${columns(check.source.key)}</code><small>Value column: ${text(check.source.value)}</small></p>
    <p><span>Delivered</span><strong>${text(check.target.path)}</strong><code>${columns(check.target.key)}</code><small>Value column: ${text(check.target.value)}</small></p></div>
    ${check.status === "unknown" ? `<p class="notice">No partial result is accepted. Counts are not reported for this incomplete check.</p>` : `<dl class="counts">
      <div><dt>Expected identities</dt><dd>${text(check.sourceKeys)}</dd></div><div><dt>Delivered identities</dt><dd>${text(check.targetKeys)}</dd></div>
      <div><dt>Missing identities</dt><dd>${text(check.missingKeys)}</dd></div><div><dt>Unexpected identities</dt><dd>${text(check.unexpectedKeys)}</dd></div>
      <div><dt>Mismatched values</dt><dd data-value-mismatches="${text(check.valueMismatches)}">${text(check.valueMismatches)}</dd></div></dl>`}
    ${check.recordEvidence && check.recordEvidence.total > 0 ? `<details><summary>Locate affected CSV records (${positions.length} shown)</summary>
      <p>Data-record positions start at 1 and exclude the header. Quoted multiline records still count as one record. No record identities or amounts are included.</p>
      <p>Showing ${positions.length} of ${check.recordEvidence.total} affected identity groups.${check.recordEvidence.truncated || positions.length < check.recordEvidence.total ? " Position details are incomplete or limited; all defect counts remain above." : ""}</p>
      <div class="table-wrap" tabindex="0" aria-label="Affected CSV record positions"><table><thead><tr><th>Defect</th><th>Expected data records</th><th>Delivered data records</th></tr></thead><tbody>
      ${positions.map(item => `<tr><td>${item.kind === "value_mismatch" ? "Value mismatch" : item.kind === "missing" ? "Missing expected identity" : "Unexpected delivered identity"}</td>
        <td data-source-records="${text(item.sourceRows.slice(0, 8).join(","))}">${text(item.sourceRows.slice(0, 8).join(", ") || "No matching record")}${item.sourceRowsTruncated || item.sourceRows.length > 8 ? " (first 8 shown)" : ""}</td>
        <td data-target-records="${text(item.targetRows.slice(0, 8).join(","))}">${text(item.targetRows.slice(0, 8).join(", ") || "No matching record")}${item.targetRowsTruncated || item.targetRows.length > 8 ? " (first 8 shown)" : ""}</td></tr>`).join("") || '<tr><td colspan="3">Record positions are unavailable in this view. No coordinates are fabricated.</td></tr>'}
      </tbody></table></div></details>` : ""}
    </article>`;
}

/** Use the same path policy as text/JSON, including when called directly. */
export function renderArtifactsHtml(rawReport: ArtifactReport): string {
  const report = redactLocalPaths(rawReport);
  const checks = report.reconciliations ?? [];
  const incomplete = checks.filter(check => check.status === "unknown").length;
  const failedChecks = checks.filter(check => check.status === "failed").length;
  const passed = report.status === "passed";
  const title = passed ? "Declared checks passed" : report.exitCode === 2 ? "Check setup required" : "Review required";
  const csp = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  const files = report.files.slice(0, FILE_DETAILS);
  // Failed and incomplete checks stay visible before successful checks.
  const ordered = [...checks.filter(check => check.status !== "passed"), ...checks.filter(check => check.status === "passed")];
  const rowBudget = { remaining: 64 };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${text(csp)}"><title>SkillSync delivery review — ${title}</title>
<style>
:root{color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#182c35;background:#f3f6f8;line-height:1.55}*{box-sizing:border-box}body{margin:0}a{color:#075f70}.skip{position:absolute;top:-60px;left:16px;background:white;padding:12px}.skip:focus{top:12px;z-index:2}:focus-visible{outline:3px solid #207d94;outline-offset:4px}header,main,footer{max-width:1120px;margin:auto;padding:28px 24px}header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;border-bottom:1px solid #d6e0e5}.brand{font-weight:800;letter-spacing:-.04em;font-size:24px}.kicker{font-size:12px;letter-spacing:.14em;color:#526976;text-transform:uppercase}nav{display:flex;gap:18px;align-items:center;flex-wrap:wrap}main{padding-top:36px}h1{font-size:clamp(28px,4vw,46px);line-height:1.15;letter-spacing:-.04em;margin:10px 0 18px}h2{font-size:24px;margin:0 0 16px}h3{font-size:17px;margin:0}p{margin:10px 0;color:#49616e}.hero{padding:30px;border:1px solid #d8e3e8;border-radius:18px;background:white;border-top:5px solid #087566}.hero.fail{border-top-color:#b44838}.badge{display:inline-block;font-weight:700;font-size:12px;padding:5px 10px;border-radius:20px;background:#e9eff3;color:#334f60}.badge.pass{background:#dff3ec;color:#075f48}.badge.fail{background:#fbe8e3;color:#993c2d}.badge.unknown{background:#fff1d4;color:#745600}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:22px 0 0}.metric{background:#f5f8fa;padding:16px;border-radius:10px}.metric strong{display:block;font-size:28px;line-height:1.1;font-variant-numeric:tabular-nums}.metric span{font-size:13px;color:#526976}.binding{margin-top:18px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}section{margin-top:36px}.check{background:white;padding:22px;border:1px solid #d7e2e7;border-radius:14px;margin:12px 0}.check-heading{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap}.sides{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:12px 0}.sides p{border-left:3px solid #c5d9e2;padding-left:14px}.sides span,.sides strong,.sides code,small{display:block}.sides span{font-size:12px;text-transform:uppercase;letter-spacing:.08em}code{font-family:ui-monospace,monospace;font-size:.9em;overflow-wrap:anywhere}.counts{display:flex;gap:20px;flex-wrap:wrap;margin:16px 0 0}.counts dt{color:#526976;font-size:12px}.counts dd{font-size:23px;font-weight:700;margin:3px 0;font-variant-numeric:tabular-nums}.notice{background:#fff7e5;padding:14px;border-radius:8px}.table-wrap{overflow:auto;border:1px solid #d7e2e7;border-radius:12px;background:white}table{border-collapse:collapse;width:100%;text-align:left}th,td{padding:14px 16px;border-bottom:1px solid #e3eaee;vertical-align:top;overflow-wrap:anywhere}th{background:#ecf2f5;font-size:12px;text-transform:uppercase;letter-spacing:.06em}td{max-width:340px}td p{margin:0 0 8px}small{color:#657b87;font-size:12px;margin-top:5px}details{margin-top:16px;border:1px solid #d7e2e7;padding:16px;border-radius:10px;background:white}summary{cursor:pointer;font-weight:600}dl.evidence{display:grid;grid-template-columns:180px 1fr;gap:8px}.evidence dd{margin:0;overflow-wrap:anywhere}footer{font-size:12px;color:#657b87;border-top:1px solid #d7e2e7;margin-top:30px}footer code{display:block}@media(max-width:640px){header,main,footer{padding-left:16px;padding-right:16px}.hero{padding:20px}.metrics{grid-template-columns:1fr 1fr}.sides{grid-template-columns:1fr}.check{padding:16px}dl.evidence{grid-template-columns:1fr;gap:4px}.evidence dd{margin-bottom:8px}th,td{padding:12px;min-width:110px}}@media print{body{background:white}header nav,.skip{display:none}main{padding-top:16px}.hero,.check,details{border-radius:0;break-inside:avoid}.table-wrap{overflow:visible}a{color:inherit}.metrics{grid-template-columns:repeat(4,1fr)}}
</style></head><body><a class="skip" href="#review">Skip to delivery review</a>
<header><div><div class="brand">SkillSync</div><div class="kicker">Offline delivery review</div></div><nav aria-label="Report sections"><a href="#checks">Record checks</a><a href="#issues">Review actions</a><a href="#files">Files</a></nav></header>
<main id="review"><div class="hero${passed ? "" : " fail"}"><span class="badge ${passed ? "pass" : "fail"}">${passed ? "Passed" : "Not accepted"}</span><h1>${title}</h1>
<p>${passed ? "The observed files satisfy the declared local checks. Review the expectations and responsible approval before using this result." : "This delivery has findings or incomplete checks. Use the file and identity metadata below to review the affected requirement."}</p>
<div class="metrics"><div class="metric"><strong>${report.files.length}</strong><span>Observed files</span></div><div class="metric"><strong>${report.findings.length}</strong><span>Review findings</span></div><div class="metric"><strong>${failedChecks}</strong><span>Failed record checks</span></div><div class="metric"><strong>${incomplete}</strong><span>Incomplete record checks</span></div></div>
<div class="binding"><strong>Receipt / file binding</strong><span class="badge">${text(report.receipt_binding)}</span><small>Hash consistency with supplied local evidence; author identity is not authenticated.</small></div></div>
<section id="checks" aria-labelledby="check-title"><h2 id="check-title">Allocation and identity checks</h2><p>Showing ${Math.min(CHECK_DETAILS, checks.length)} of ${checks.length} reconciliation checks. Failed and incomplete checks appear first.</p>
${ordered.slice(0, CHECK_DETAILS).map(check => reconciliationCard(check, rowBudget)).join("") || "<p>No record reconciliation was declared. Other declared file checks are reflected in the result.</p>"}</section>
<section id="issues" aria-labelledby="issue-title"><h2 id="issue-title">Review actions</h2>${report.findings.length ? `<div class="table-wrap" tabindex="0" aria-label="Review findings table"><table><thead><tr><th>Finding</th><th>Affected metadata</th><th>Next review step</th></tr></thead><tbody>${report.findings.slice(0, 256).map(findingRow).join("")}</tbody></table></div>` : "<p>No finding was reported for the declared scope. This does not authenticate source truth or establish business approval.</p>"}</section>
<section id="files" aria-labelledby="file-title"><h2 id="file-title">Observed files</h2><p>Showing ${files.length} of ${report.files.length} files. Metadata values longer than 160 characters are shortened; the original JSON report retains full metadata.</p>
<div class="table-wrap" tabindex="0" aria-label="Observed file metadata table"><table><thead><tr><th>Declared path</th><th>Bytes</th><th>Rows</th><th>SHA-256</th></tr></thead><tbody>${files.map(file => `<tr><td><code>${text(file.path)}</code></td><td>${text(file.bytes)}</td><td>${text(file.rows)}</td><td><code>${text(file.sha256)}</code></td></tr>`).join("") || '<tr><td colspan="4">No accepted file observation is available.</td></tr>'}</tbody></table></div></section>
<details><summary>Evidence boundaries and snapshot identity</summary><p>This is a local inspection snapshot. It does not execute a Skill, authenticate an author, or replace reviewed expectations and business approval.</p>
<dl class="evidence"><dt>Evidence</dt><dd>physical-files</dd><dt>Execution</dt><dd><code>execution: not-run</code></dd><dt>Provenance</dt><dd><code>provenance: not-authenticated</code></dd><dt>Contract SHA-256</dt><dd><code>${text(report.contract_sha256)}</code></dd><dt>Artifact set SHA-256</dt><dd><code>${text(report.artifact_set_sha256)}</code></dd></dl></details></main>
<footer>SkillSync source ${text(VERSION)} · Standalone HTML, no scripts or external requests.<code>${text(report.schema)}</code></footer></body></html>\n`;
}
