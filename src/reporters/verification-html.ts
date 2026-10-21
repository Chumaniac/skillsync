import type { VerificationReport } from "../cli/commands/verify.js";
import { toIssues } from "../domain/issue.js";
import { redactLocalPaths } from "./local-paths.js";

const DETAIL_LIMIT = 256;
function text(value: unknown): string {
  const valueText = String(value ?? "Not reported");
  return (valueText.length > 600 ? valueText.slice(0, 600) + "…" : valueText)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** A bounded, offline review of existing evidence; no scripts or automatic fixes. */
export function renderVerificationHtml(input: VerificationReport): string {
  const report = redactLocalPaths(input);
  const issues = report.issues?.length ? report.issues : toIssues(report.findings);
  const counts = report.summary;
  const priorities = [
    { severity: "critical", label: "Critical issues", help: "Resolve these issues before reusing this Skill." },
    { severity: "error", label: "Errors", help: "Fix the failed checks, then verify again." },
    { severity: "warn", label: "Warnings", help: "Review these warnings against your intended use." },
    { severity: "info", label: "Information", help: "Review the recorded checks and notes." },
  ].map(priority => ({ ...priority, issues: issues.filter(issue => issue.finding.severity === priority.severity) }))
    .filter(priority => priority.issues.length > 0);
  const links = priorities.length ? `<nav class="priorities" aria-label="Issue priorities">${priorities.map(priority => `<a href="#issues-${priority.severity}-start">${priority.label} <strong>${priority.issues.length}</strong></a>`).join("")}</nav>` : "";
  let remaining = DETAIL_LIMIT;
  const groups = priorities.map(({ severity, label, help, issues: all }, groupIndex) => {
    const shown = all.slice(0, remaining);
    remaining -= shown.length;
    return `<details class="issue-group" id="issues-${severity}"${groupIndex === 0 ? " open" : ""}><summary>${label} · ${all.length} ${all.length === 1 ? "issue" : "issues"}</summary><p id="issues-${severity}-start" tabindex="-1">${help}</p>${shown.map((issue, index) => {
      const f = issue.finding;
      const resolution = issue.resolutions[0];
      const steps = resolution?.kind === "manual" ? resolution.steps.slice(0, 8) : [];
      return `<article id="${severity}-${index}"><h3>${text(f.code)} <small>${text(f.status)}</small></h3>
      <p><strong>Skill:</strong> ${text(f.skill)} · <strong>Target:</strong> ${text(f.target ?? "All")}</p>
      <p>${text(issue.explanation.cause)}</p><p><strong>Next step:</strong> ${text(resolution?.title ?? f.remediation ?? issue.explanation.impact)}</p>
      ${steps.length ? `<ol>${steps.map(step => `<li>${text(step)}</li>`).join("")}</ol>` : ""}
      <details><summary>Issue reference</summary><code>${text(issue.id)}</code><p>${text(issue.location?.path ?? "Location not included")}</p></details></article>`;
    }).join("")}${all.length > shown.length ? `<p>Showing ${shown.length} of ${all.length} issues in this group. Use JSON for complete evidence.</p>` : ""}</details>`;
  }).join("");
  const title = report.exitCode === 2 ? "Verification setup required" : counts.fail ? "Changes require attention" : counts.unknown || counts.warn ? "Review incomplete evidence" : "Declared checks passed";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>SkillSync · ${title}</title>
<style>:root{font-family:system-ui,sans-serif;color:#19343c;background:#f1f5f6;line-height:1.6}*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:960px;margin:auto;padding:24px}a{color:#066d78}:focus-visible{outline:3px solid #18849b;outline-offset:4px}nav{display:flex;flex-wrap:wrap;gap:18px}h1{font-size:clamp(28px,4vw,42px);line-height:1.2}.hero,.issue-group{background:white;border:1px solid #cddce0;border-radius:8px;padding:20px;margin:16px 0}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;border-block:1px solid #cddce0;padding:16px 0;font-variant-numeric:tabular-nums}.metrics strong{display:block;font-size:28px}.priorities{gap:8px;margin-top:20px}.priorities a{display:flex;align-items:center;gap:12px;min-height:44px;padding:8px 12px;border:1px solid #9db7bd;border-radius:4px;text-decoration:none}.priorities a:hover{background:#e8f3f4}summary{cursor:pointer;font-weight:700;min-height:44px;padding-block:8px}article{padding:16px 0;border-top:1px solid #cddce0}article h3{margin:0}article details{margin-top:12px}code,p{overflow-wrap:anywhere}[id]{scroll-margin-top:16px}small{font-size:13px}footer{color:#4e6871;font-size:13px}@media(max-width:600px){.metrics{grid-template-columns:1fr 1fr}header,main,footer{padding:16px}}@media print{body{background:white}nav{display:none}article{break-inside:avoid}details{border-radius:0}}</style></head>
<body><header><strong>SkillSync · Offline verification review</strong><nav aria-label="Report sections"><a href="#overview">Overview</a><a href="#issues">Issues and next steps</a><a href="#scope">Scope</a></nav></header><main>
<section class="hero" id="overview"><h1>${title}</h1><div class="metrics">${([{ key: "pass", label: "Passed" }, { key: "fail", label: "Failed" }, { key: "warn", label: "Warnings" }, { key: "unknown", label: "Unverified" }] as const).map(({ key, label }) => `<div><strong>${text(counts[key])}</strong>${label}</div>`).join("")}</div><p>${text(counts.total)} findings · ${text(issues.length)} deduplicated issues · exit code ${report.exitCode}</p>${links}</section>
<section id="issues"><h2>Issues and next steps</h2>${priorities.length ? `<p>Up to ${DETAIL_LIMIT} issue details. Use JSON for the complete report.</p>${groups}` : "<p>No issues were reported.</p>"}</section>
<section id="scope"><h2>Scope and evidence</h2><p>${report.targets.length} selected ${report.targets.length === 1 ? "target" : "targets"}. ${text(report.generated_at)}</p><p>Metadata checks only; no Skill execution or fixes. Runtime safety, authenticated provenance and approval remain unverified. Local paths and raw contents are omitted.</p></section></main><footer>Offline report. No scripts or external requests.</footer></body></html>\n`;
}
