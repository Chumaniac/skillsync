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
  let remaining = DETAIL_LIMIT;
  const groups = (["critical", "error", "warn", "info"] as const).map(severity => {
    const all = issues.filter(issue => issue.finding.severity === severity);
    const shown = all.slice(0, remaining);
    remaining -= shown.length;
    return `<details ${severity === "info" ? "" : "open"}><summary>${severity.toUpperCase()} · ${all.length} issues</summary>${shown.map((issue, index) => {
      const f = issue.finding;
      const resolution = issue.resolutions[0];
      const steps = resolution?.kind === "manual" ? resolution.steps.slice(0, 8) : [];
      return `<article id="${severity}-${index}"><h3>${text(f.code)} <small>${text(f.status)}</small></h3>
      <p><strong>Skill:</strong> ${text(f.skill)} · <strong>Target:</strong> ${text(f.target ?? "All")}</p>
      <p>${text(issue.explanation.cause)}</p><p><strong>Next step:</strong> ${text(resolution?.title ?? f.remediation ?? issue.explanation.impact)}</p>
      ${steps.length ? `<ol>${steps.map(step => `<li>${text(step)}</li>`).join("")}</ol>` : ""}
      <details><summary>Issue reference</summary><code>${text(issue.id)}</code><p>${text(issue.location?.path ?? "Location not included")}</p></details></article>`;
    }).join("")}${all.length > shown.length ? `<p>Showing ${shown.length} of ${all.length} issues in this group. Use JSON for complete evidence.</p>` : ""}${all.length ? "" : "<p>No issues in this group.</p>"}</details>`;
  }).join("");
  const title = report.exitCode === 2 ? "Verification setup required" : counts.fail ? "Changes require attention" : counts.unknown || counts.warn ? "Review incomplete evidence" : "Declared checks passed";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>SkillSync · ${title}</title>
<style>:root{font-family:system-ui,sans-serif;color:#19343c;background:#f1f5f6;line-height:1.6}*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:960px;margin:auto;padding:24px}a{color:#066d78}:focus-visible{outline:3px solid #18849b;outline-offset:4px}nav{display:flex;flex-wrap:wrap;gap:18px}h1{font-size:clamp(28px,4vw,42px);line-height:1.2}.hero,article,details{background:white;border:1px solid #cddce0;border-radius:12px;padding:20px;margin:16px 0}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metrics strong{display:block;font-size:28px}summary{cursor:pointer;font-weight:700}code{overflow-wrap:anywhere}small{font-size:13px}footer{color:#4e6871;font-size:13px}@media(max-width:600px){.metrics{grid-template-columns:1fr 1fr}header,main,footer{padding:16px}}@media print{body{background:white}nav{display:none}article{break-inside:avoid}details{border-radius:0}}</style></head>
<body><header><strong>SkillSync · Offline verification review</strong><nav aria-label="Report sections"><a href="#overview">Overview</a><a href="#issues">Issues and next steps</a><a href="#scope">Scope</a></nav></header><main>
<section class="hero" id="overview"><h1>${title}</h1><p>Read the cause and next step for each issue. These deterministic checks do not establish runtime safety, authenticated provenance, or approval.</p><div class="metrics">${(["pass", "fail", "warn", "unknown"] as const).map(key => `<div><strong>${text(counts[key])}</strong>${key}</div>`).join("")}</div><p>${text(counts.total)} findings · ${text(issues.length)} deduplicated issues · exit code ${report.exitCode}</p></section>
<section id="issues"><h2>Issues and next steps</h2><p>Groups are ordered by severity. At most ${DETAIL_LIMIT} issues are shown. Expand information groups to review successful checks.</p>${groups}</section>
<section id="scope"><h2>Scope and evidence</h2><p>${report.targets.length} selected targets. ${text(report.generated_at)}</p><p>Local paths and raw evidence contents are excluded. No Skill was executed and no fix was applied by this report.</p></section></main><footer>Generated from local verification metadata. No scripts, external assets, or network requests. Keep the JSON report for complete machine-readable evidence.</footer></body></html>\n`;
}
