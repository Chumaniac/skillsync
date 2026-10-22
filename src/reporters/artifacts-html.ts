import type { ArtifactReport } from "../cli/commands/artifacts.js";
import type { ArtifactFinding } from "../domain/artifact-content.js";
import type { ReconciliationSummary } from "../domain/artifact-reconciliation.js";
import { VERSION } from "../version.js";
import { redactLocalPaths } from "./local-paths.js";

const FILE_DETAILS = 100;
const CHECK_DETAILS = 64;
const REFERENCE_DETAILS = 32;
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
  if (code.startsWith("artifact.reference-value-")) return "Review the cited source record and declared metadata columns, such as digest or revision. Keep the original copy; do not accept an existing ID as proof that its metadata matches.";
  if (code === "artifact.reference-missing") return "Review the source ID column and its declared target table. The cited record was not found; no source is fetched or authenticated.";
  if (code === "artifact.reconciliation-keys" || code === "artifact.reconciliation-sum") return "Compare expected and delivered records using the declared key columns. Preserve the original delivery while reviewing a corrected copy.";
  if (code.startsWith("artifact.reconciliation-")) return "No partial result is accepted. Review the declared types, integer range and selected-cell capacity before checking again.";
  if (code === "artifact.contract-invalid") return "Review the contract declaration and directory selection before inspecting files. No file acceptance is established.";
  if (code === "artifact.directory-invalid") return "Select an existing directory, not a file or symbolic link, and check read access before inspecting the delivery.";
  if (code.includes("digest") || code.includes("changed") || code.includes("snapshot")) return "Retain this copy for comparison. Recover known successful originals and recheck the same reviewed expectations.";
  if (code.includes("missing")) return "Recover missing files from the saved successful delivery, then recheck the complete required scope.";
  if (code.includes("capacity")) return "Review the documented capacity bounds. A partial check cannot accept the whole delivery.";
  return "Review the declared file, field and requirement below. Keep original evidence and check again after an approved correction.";
}

function findingRow(finding: ArtifactFinding, budget: { remaining: number }): string {
  const reference = finding.reference;
  const showReference = reference !== undefined && budget.remaining > 0;
  if (showReference) budget.remaining -= 1;
  const location = showReference ? `<div class="reference-location" data-reference-path="${text(reference.path)}" data-reference-row="${text(reference.row)}">
    <strong>Compare with <code>${text(reference.path)}</code></strong>
    <small>Lookup column: ${text(reference.field)} · Data record: ${text(reference.row)}</small>
    <span>Compared columns</span><ul>${reference.matches.slice(0, 8).map(pair => `<li><code data-source-column="${text(pair.source)}">${text(pair.source)}</code> → <code data-target-column="${text(pair.target)}">${text(pair.target)}</code></li>`).join("")}</ul>
    <small>One or more of these columns differ or are unavailable. Record positions exclude the header; IDs and cell values are omitted.</small></div>` : reference ? "<small>Reference-location details are limited in this view. Use the JSON report for the full metadata.</small>" : "";
  return `<tr><td><code>${text(finding.code)}</code></td><td>${text(finding.path ?? "Whole delivery")}
    ${finding.field ? `<small>Field: ${columns(finding.field)}</small>` : ""}
    ${finding.row !== undefined ? `<small>Data record: ${text(finding.row)}</small>` : ""}${location}</td>
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

function comparisonSection(report: ArtifactReport): string {
  const value = report.comparison;
  if (!value) return "";
  const checks = value.checks ?? [];
  return `<section id="comparison" aria-labelledby="comparison-title"><h2 id="comparison-title">Changes since baseline review</h2>
    <p>Caller-supplied history is not authenticated. The current directory was inspected again; previous messages and record positions are not copied into this comparison.</p>
    <p>Previous result: <strong>${text(value.baseline_status)}</strong> · Current inspection: <strong>${text(value.current_status)}</strong></p>
    ${value.status === "unavailable" ? `<p class="notice">Comparison unavailable: ${text(value.reason)}. No improvement or resolution is established.</p>` : `<p>Finding categories: <strong>${text(value.findings?.added)}</strong> new · <strong>${text(value.findings?.ongoing)}</strong> ongoing · <strong>${text(value.findings?.resolved)}</strong> resolved. Categories use code, file and column, not record identities.</p>
    <p>Record checks: ${checks.filter(check => check.change === "improved").length} improved · ${checks.filter(check => check.change === "regressed").length} regressed · ${checks.filter(check => check.change === "changed").length} mixed changes · ${checks.filter(check => check.change === "unchanged").length} unchanged. Reduced defect counts are not business approval.</p>
    <p>Showing ${Math.min(CHECK_DETAILS, checks.length)} of ${checks.length} check transitions, in declaration order.</p>
    <div class="table-wrap" tabindex="0" aria-label="Record check changes"><table><thead><tr><th>Declared check</th><th>Previous</th><th>Current</th><th>Change</th></tr></thead><tbody>
    ${checks.slice(0, CHECK_DETAILS).map(check => `<tr><td>${text(check.index + 1)}</td><td>${text(check.before)}</td><td>${text(check.after)}</td><td>${text(check.change)}</td></tr>`).join("") || '<tr><td colspan="4">No integer reconciliation was declared.</td></tr>'}</tbody></table></div>`}
    <details><summary>Baseline report identity</summary><code>${text(value.baseline_report_sha256)}</code><p>SHA-256 binds the supplied JSON bytes; it does not establish their author or truth.</p></details></section>`;
}

function declarationSection(report: ArtifactReport): string {
  const value = report.declarations;
  if (!value) return '<section id="declarations"><h2>Declared cross-file checks</h2><p>Declaration metadata is unavailable in this snapshot. Consult its original contract; no expectations are inferred.</p></section>';
  return `<section id="declarations" aria-labelledby="declarations-title"><h2 id="declarations-title">Declared cross-file checks</h2>
    <p>These are declarations, not proof of a completed check. Per-file type, digest and scalar-value rules remain in the original contract; expected values and raw cells are omitted here.</p>
    <p>Limits: ${text(value.limits.max_files)} files · ${text(value.limits.max_file_bytes)} bytes per file · ${text(value.limits.max_total_bytes)} total bytes.</p>
    <p>Showing ${Math.min(128, value.checks.length)} of ${value.checks.length} declarations. Up to 8 mappings per declaration are shown; JSON retains the complete declared mappings.</p>
    ${value.checks.slice(0, 128).map(({ ordinal, check }) => {
      let source: string, target: string, fields: string;
      if (check.type === "csv_summary") {
        source = check.csv; target = check.json;
        fields = `Row count → <code>${text(check.row_count_field)}</code><ul>${check.sums.slice(0, 8).map(pair => `<li><code>${text(pair.column)}</code> → <code>${text(pair.field)}</code></li>`).join("")}</ul><small>${Math.min(8, check.sums.length)} of ${check.sums.length} sum mappings shown.</small>`;
      } else if (check.type === "reference_exists") {
        source = check.source.path; target = check.target.path;
        fields = `Lookup: <code>${text(check.source.field)}</code> → <code>${text(check.target.field)}</code><p>Require all targets: ${check.require_all_targets === true ? "yes" : "no"}</p><ul>${(check.matches ?? []).slice(0, 8).map(pair => `<li><code>${text(pair.source)}</code> → <code>${text(pair.target)}</code></li>`).join("")}</ul>`;
      } else {
        source = check.source.path; target = check.target.path;
        fields = `Identity: <code>${columns(check.source.key)}</code> → <code>${columns(check.target.key)}</code><p>Integer value: <code>${text(check.source.value)}</code> → <code>${text(check.target.value)}</code></p>`;
      }
      return `<article class="check" id="declared-check-${text(ordinal)}"><h3>Declaration ${text(ordinal)} · <code>${text(check.type)}</code></h3><p>Source: <code>${text(source)}</code> → Target: <code>${text(target)}</code></p>${fields}</article>`;
    }).join("") || '<p>No cross-file check was declared. Consult the original contract for file-level requirements.</p>'}</section>`;
}

/** Use the same path policy as text/JSON, including when called directly. */
export function renderArtifactsHtml(rawReport: ArtifactReport): string {
  const report = redactLocalPaths(rawReport);
  const checks = report.reconciliations ?? [];
  const incomplete = checks.filter(check => check.status === "unknown").length;
  const failedChecks = checks.filter(check => check.status === "failed").length;
  const passed = report.status === "passed";
  const referenceOnly = report.findings.length > 0 && report.findings.every(finding =>
    finding.code === "artifact.reference-value-mismatch" || finding.code === "artifact.reference-value-unavailable");
  const title = passed ? "Declared checks passed" : report.exitCode === 2 ? "Check setup required"
    : referenceOnly ? "Reference metadata needs review" : "Review required";
  const csp = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  const files = report.files.slice(0, FILE_DETAILS);
  // Failed and incomplete checks stay visible before successful checks.
  const ordered = [...checks.filter(check => check.status !== "passed"), ...checks.filter(check => check.status === "passed")];
  const rowBudget = { remaining: 64 };
  const referenceBudget = { remaining: REFERENCE_DETAILS };
  const referenceCount = report.findings.filter(finding => finding.reference).length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${text(csp)}"><title>SkillSync delivery review — ${title}</title>
<style>
:root{color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#182c35;background:#f3f6f8;line-height:1.55}*{box-sizing:border-box}body{margin:0}a{color:#075f70}.skip{position:absolute;top:-60px;left:16px;background:white;padding:12px}.skip:focus{top:12px;z-index:2}:focus-visible{outline:3px solid #207d94;outline-offset:4px}header,main,footer{max-width:1120px;margin:auto;padding:28px 24px}header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;border-bottom:1px solid #d6e0e5}.brand{font-weight:800;letter-spacing:-.04em;font-size:24px}.kicker{font-size:12px;letter-spacing:.14em;color:#526976;text-transform:uppercase}nav{display:flex;gap:18px;align-items:center;flex-wrap:wrap}main{padding-top:36px}h1{font-size:clamp(28px,4vw,46px);line-height:1.15;letter-spacing:-.04em;margin:10px 0 18px}h2{font-size:24px;margin:0 0 16px}h3{font-size:17px;margin:0}p{margin:10px 0;color:#49616e}.hero{padding:30px;border:1px solid #d8e3e8;border-radius:18px;background:white;border-top:5px solid #087566}.hero.fail{border-top-color:#b44838}.badge{display:inline-block;font-weight:700;font-size:12px;padding:5px 10px;border-radius:20px;background:#e9eff3;color:#334f60}.badge.pass{background:#dff3ec;color:#075f48}.badge.fail{background:#fbe8e3;color:#993c2d}.badge.unknown{background:#fff1d4;color:#745600}.binding{margin-top:18px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}section{margin-top:36px}.check{background:white;padding:22px;border:1px solid #d7e2e7;border-radius:14px;margin:12px 0}.check-heading{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap}.sides{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:12px 0}.sides p{border-left:3px solid #c5d9e2;padding-left:14px}.sides span,.sides strong,.sides code,small{display:block}.sides span{font-size:12px;text-transform:uppercase;letter-spacing:.08em}code{font-family:ui-monospace,monospace;font-size:.9em;overflow-wrap:anywhere}.counts{display:flex;gap:20px;flex-wrap:wrap;margin:16px 0 0}.counts dt{color:#526976;font-size:12px}.counts dd{font-size:23px;font-weight:700;margin:3px 0;font-variant-numeric:tabular-nums}.notice{background:#fff7e5;padding:14px;border-radius:8px}.table-wrap{overflow:auto;border:1px solid #d7e2e7;border-radius:12px;background:white}table{border-collapse:collapse;width:100%;text-align:left}th,td{padding:14px 16px;border-bottom:1px solid #e3eaee;vertical-align:top;overflow-wrap:anywhere}th{background:#ecf2f5;font-size:12px;text-transform:uppercase;letter-spacing:.06em}td{max-width:340px}td p{margin:0 0 8px}small{color:#526976;font-size:12px;margin-top:5px}details{margin-top:16px;border:1px solid #d7e2e7;padding:16px;border-radius:10px;background:white}summary{cursor:pointer;font-weight:600;min-height:44px}dl.evidence{display:grid;grid-template-columns:180px 1fr;gap:8px}.evidence dd{margin:0;overflow-wrap:anywhere}footer{font-size:12px;color:#526976;border-top:1px solid #d7e2e7;margin-top:30px}footer code{display:block}@media(max-width:640px){header,main,footer{padding-left:16px;padding-right:16px}.hero{padding:20px}.sides{grid-template-columns:1fr}.check{padding:16px}dl.evidence{grid-template-columns:1fr;gap:4px}.evidence dd{margin-bottom:8px}th,td{padding:12px;min-width:110px}}@media print{body{background:white}header nav,.skip{display:none}main{padding-top:16px}.hero,.check,details{border-radius:0;break-inside:avoid}.table-wrap{overflow:visible}a{color:inherit}}

.review-summary{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:18px;padding-top:18px;margin-top:18px;border-top:1px solid #d6e0e5}.review-summary p{margin:0;font-variant-numeric:tabular-nums}.review-link{display:inline-flex;align-items:center;min-height:44px;padding:8px 14px;background:#075f70;color:white;border-radius:6px;text-decoration:none;font-weight:650}.review-link:hover{background:#064956}.reference-location{border-top:1px solid #d6e0e5;margin-top:14px;padding-top:12px;font-size:14px}.reference-location strong,.reference-location span,.reference-location small{display:block}.reference-location ul{list-style:none;padding:0;margin:8px 0}.reference-location li{margin:5px 0}.reference-location code{overflow-wrap:anywhere}h2[tabindex="-1"]{scroll-margin-top:24px}h2[tabindex="-1"]:focus{outline:3px solid #207d94;outline-offset:5px}
</style></head><body><a class="skip" href="#review">Skip to delivery review</a>
<header><div><div class="brand">SkillSync</div><div class="kicker">Offline delivery review</div></div><nav aria-label="Report sections"><a href="#declarations">Declared checks</a><a href="#checks">Record checks</a><a href="#issues">Review actions</a><a href="#files">Files</a></nav></header>
<main id="review"><div class="hero${passed ? "" : " fail"}"><span class="badge ${passed ? "pass" : "fail"}">${passed ? "Passed" : "Not accepted"}</span><h1>${title}</h1>
<p>${passed ? "Declared file checks passed. Business approval is separate." : "Review the findings below. Keep the original files."}</p>
<div class="review-summary"><p><strong>${report.files.length}</strong> inspected ${report.files.length === 1 ? "file" : "files"} · <strong>${report.findings.length}</strong> reported ${report.findings.length === 1 ? "finding" : "findings"}${checks.length ? ` · ${failedChecks} failed and ${incomplete} incomplete allocation checks` : ""}</p>
<a class="review-link" href="${report.findings.length ? "#issue-title" : "#file-title"}">${report.findings.length ? `Review ${report.findings.length} reported ${report.findings.length === 1 ? "finding" : "findings"}` : "Review inspected files"}</a></div>
<div class="binding"><strong>Receipt / file binding</strong><span class="badge">${text(report.receipt_binding)}</span><small>Local hashes checked; author identity unverified.</small></div></div>
${comparisonSection(report)}
${declarationSection(report)}
<section id="checks" aria-labelledby="check-title"><h2 id="check-title">Allocation and identity checks</h2><p>Showing ${Math.min(CHECK_DETAILS, checks.length)} of ${checks.length} reconciliation checks. Failed and incomplete checks appear first.</p>
${ordered.slice(0, CHECK_DETAILS).map(check => reconciliationCard(check, rowBudget)).join("") || "<p>No record reconciliation was declared. Other declared file checks are reflected in the result.</p>"}</section>
<section id="issues" aria-labelledby="issue-title"><h2 id="issue-title" tabindex="-1">Review actions</h2>${referenceCount > REFERENCE_DETAILS ? `<p>Reference locations: first ${REFERENCE_DETAILS} of ${referenceCount} reported findings shown. The JSON report retains all location metadata.</p>` : ""}${report.findings.length ? `<div class="table-wrap" tabindex="0" aria-label="Review findings table"><table><thead><tr><th>Finding</th><th>Affected metadata</th><th>Next review step</th></tr></thead><tbody>${report.findings.slice(0, 256).map(finding => findingRow(finding, referenceBudget)).join("")}</tbody></table></div>` : "<p>No findings in the declared scope.</p>"}</section>
<section id="files" aria-labelledby="file-title"><h2 id="file-title" tabindex="-1">Observed files</h2><p>Showing ${files.length} of ${report.files.length} files. </p>
<div class="table-wrap" tabindex="0" aria-label="Observed file metadata table"><table><thead><tr><th>Declared path</th><th>Bytes</th><th>Rows</th><th>SHA-256</th></tr></thead><tbody>${files.map(file => `<tr><td><code>${text(file.path)}</code></td><td>${text(file.bytes)}</td><td>${text(file.rows)}</td><td><code>${text(file.sha256)}</code></td></tr>`).join("") || '<tr><td colspan="4">No accepted file observation is available.</td></tr>'}</tbody></table></div></section>
<details><summary>Evidence boundaries and snapshot identity</summary><p>Local inspection only: no Skill execution, author authentication or business approval. Metadata values longer than 160 characters are shortened; JSON retains full metadata.</p>
<dl class="evidence"><dt>Evidence</dt><dd>physical-files</dd><dt>Execution</dt><dd><code>execution: not-run</code></dd><dt>Provenance</dt><dd><code>provenance: not-authenticated</code></dd><dt>Contract SHA-256</dt><dd><code>${text(report.contract_sha256)}</code></dd><dt>Artifact set SHA-256</dt><dd><code>${text(report.artifact_set_sha256)}</code></dd></dl></details></main>
<footer>SkillSync source ${text(VERSION)} · Standalone HTML, no scripts or external requests.<code>${text(report.schema)}</code></footer></body></html>\n`;
}
