import { reportLabel } from "./report-labels.js";
import type { ArtifactReport } from "../domain/artifact-report.js";
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
  const original = String(value ?? "未报告");
  const clipped = original.length > TEXT_LENGTH ? original.slice(0, TEXT_LENGTH) + "…" : original;
  return clipped.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function columns(value: string | string[]): string {
  return text(Array.isArray(value) ? value.join(" + ") : value);
}

function action(code: string): string {
  if (code.startsWith("artifact.reference-value-")) return "复核引用来源及声明的摘要、版本等元数据列。请保留原件；ID存在不能证明元数据一致。";
  if (code === "artifact.reference-missing") return "复核来源ID列及声明的目标表。未找到引用记录；本检查不会获取来源或认证身份。";
  if (code === "artifact.reconciliation-keys" || code === "artifact.reconciliation-sum") return "按声明的键列比较预期与交付记录，复核修正副本时请保留原交付包。";
  if (code.startsWith("artifact.reconciliation-")) return "不接受部分检查结果。请核对声明类型、整数范围和单元格容量后重试。";
  if (code === "artifact.contract-invalid") return "检查文件前先复核约定声明和所选目录，当前尚未确认文件验收通过。";
  if (code === "artifact.directory-invalid") return "请选择已有目录，不要选择文件或符号链接；检查交付包前请确认可读取。";
  if (code.includes("digest") || code.includes("changed") || code.includes("snapshot")) return "保留此副本用于对比，恢复已知成功原件后，按相同的已复核要求重新检查。";
  if (code.includes("missing")) return "从已保存成功交付包中恢复缺失文件，再检查完整要求范围。";
  if (code.includes("capacity")) return "请检查文档中的容量上限，部分检查不能代表整个交付包通过。";
  return "复核下方声明的文件、字段和要求，保留原始证据，在确认修正后重新检查。";
}

function findingRow(finding: ArtifactFinding, budget: { remaining: number }): string {
  const reference = finding.reference;
  const showReference = reference !== undefined && budget.remaining > 0;
  if (showReference) budget.remaining -= 1;
  const location = showReference ? `<div class="reference-location" data-reference-path="${text(reference.path)}" data-reference-row="${text(reference.row)}">
    <strong>对照来源 <code>${text(reference.path)}</code></strong>
    <small>查找列： ${text(reference.field)} · 数据记录： ${text(reference.row)}</small>
    <span>对比列</span><ul>${reference.matches.slice(0, 8).map(pair => `<li><code data-source-column="${text(pair.source)}">${text(pair.source)}</code> → <code data-target-column="${text(pair.target)}">${text(pair.target)}</code></li>`).join("")}</ul>
    <small>这些列中至少一列不同或不可用。记录位置不含表头，不展示ID与单元格值。</small></div>` : reference ? "<small>本页面限制引用位置明细，完整元数据请查看JSON报告。</small>" : "";
  return `<tr><td><code>${text(finding.code)}</code></td><td>${text(finding.path ?? "整个交付包")}
    ${finding.field ? `<small>字段： ${columns(finding.field)}</small>` : ""}
    ${finding.row !== undefined ? `<small>数据记录： ${text(finding.row)}</small>` : ""}${location}</td>
    <td>${finding.message ? `<p>检查原文：${text(finding.message)}</p>` : ""}${action(finding.code)}</td></tr>`;
}

function reconciliationCard(check: ReconciliationSummary, rowBudget: { remaining: number }): string {
  const label = check.status === "passed" ? "通过" : check.status === "unknown" ? "未知，检查未完成" : "失败";
  const tone = check.status === "passed" ? "pass" : check.status === "unknown" ? "unknown" : "fail";
  const positions = check.recordEvidence?.items.slice(0, Math.min(32, rowBudget.remaining)) ?? [];
  rowBudget.remaining -= positions.length;
  return `<article class="check"><div class="check-heading"><h3>按标识核对整数分配</h3><span class="badge ${tone}">${label}</span></div>
    <div class="sides"><p><span>预期</span><strong>${text(check.source.path)}</strong><code>${columns(check.source.key)}</code><small>数值列： ${text(check.source.value)}</small></p>
    <p><span>已交付</span><strong>${text(check.target.path)}</strong><code>${columns(check.target.key)}</code><small>数值列： ${text(check.target.value)}</small></p></div>
    ${check.status === "unknown" ? `<p class="notice">不接受部分检查结果，此项未完成检查不报告计数。</p>` : `<dl class="counts">
      <div><dt>预期标识数</dt><dd>${text(check.sourceKeys)}</dd></div><div><dt>已交付标识数</dt><dd>${text(check.targetKeys)}</dd></div>
      <div><dt>缺失标识数</dt><dd>${text(check.missingKeys)}</dd></div><div><dt>额外标识数</dt><dd>${text(check.unexpectedKeys)}</dd></div>
      <div><dt>数值不一致</dt><dd data-value-mismatches="${text(check.valueMismatches)}">${text(check.valueMismatches)}</dd></div></dl>`}
    ${check.recordEvidence && check.recordEvidence.total > 0 ? `<details><summary>定位受影响的CSV记录 （展示${positions.length}条）</summary>
      <p>数据记录位置从1开始，不包含表头；引号中的多行仍计为一条记录。不展示记录标识或金额。</p>
      <p>展示 ${positions.length} / ${check.recordEvidence.total} 个受影响标识分组。${check.recordEvidence.truncated || positions.length < check.recordEvidence.total ? " 位置明细不完整或已达上限，全部问题计数仍保留在上方。" : ""}</p>
      <div class="table-wrap" tabindex="0" aria-label="受影响的CSV记录位置"><table><thead><tr><th>问题类型</th><th>预期数据记录</th><th>已交付数据记录</th></tr></thead><tbody>
      ${positions.map(item => `<tr><td>${item.kind === "value_mismatch" ? "数值不一致" : item.kind === "missing" ? "缺失预期标识" : "存在额外交付标识"}</td>
        <td data-source-records="${text(item.sourceRows.slice(0, 8).join(","))}">${text(item.sourceRows.slice(0, 8).join(", ") || "没有匹配记录")}${item.sourceRowsTruncated || item.sourceRows.length > 8 ? " （仅展示前8条）" : ""}</td>
        <td data-target-records="${text(item.targetRows.slice(0, 8).join(","))}">${text(item.targetRows.slice(0, 8).join(", ") || "没有匹配记录")}${item.targetRowsTruncated || item.targetRows.length > 8 ? " （仅展示前8条）" : ""}</td></tr>`).join("") || '<tr><td colspan="3">此页面无法提供记录位置，不补造坐标。</td></tr>'}
      </tbody></table></div></details>` : ""}
    </article>`;
}

function comparisonSection(report: ArtifactReport, scope: (id: string) => string): string {
  const value = report.comparison;
  if (!value) return "";
  const checks = value.checks ?? [];
  return `<section id="${scope("comparison")}" aria-labelledby="${scope("comparison-title")}"><h2 id="${scope("comparison-title")}">相较基准复核的变化</h2>
    <p>调用方提供的历史未认证来源。已重新检查当前目录，不会将旧消息或位置复制为本次证据。</p>
    <p>此前结果： <strong>${text(reportLabel(value.baseline_status))}</strong> · 当前检查： <strong>${text(reportLabel(value.current_status))}</strong></p>
    ${value.status === "unavailable" ? `<p class="notice">暂时无法对比： ${text(value.reason)}. 尚不能确认改善或解决。</p>` : `<p>问题类别： <strong>${text(value.findings?.added)}</strong> 新增 · <strong>${text(value.findings?.ongoing)}</strong> 持续 · <strong>${text(value.findings?.resolved)}</strong> 已解决。 按代码、文件和列分组，不使用记录标识。</p>
    <p>记录核对： ${checks.filter(check => check.change === "improved").length} 改善 · ${checks.filter(check => check.change === "regressed").length} 退化 · ${checks.filter(check => check.change === "changed").length} 混合变化 · ${checks.filter(check => check.change === "unchanged").length} 未变化。 问题计数减少不代表业务批准。</p>
    <p>按声明顺序展示 ${Math.min(CHECK_DETAILS, checks.length)} / ${checks.length} 项检查变化。</p>
    <div class="table-wrap" tabindex="0" aria-label="记录核对变化"><table><thead><tr><th>声明的检查</th><th>此前</th><th>当前</th><th>变化</th></tr></thead><tbody>
    ${checks.slice(0, CHECK_DETAILS).map(check => `<tr><td>${text(check.index + 1)}</td><td>${text(reportLabel(check.before))}</td><td>${text(reportLabel(check.after))}</td><td>${text(reportLabel(check.change))}</td></tr>`).join("") || '<tr><td colspan="4">未声明整数对账检查。</td></tr>'}</tbody></table></div>`}
    <details><summary>基准报告身份</summary><code>${text(value.baseline_report_sha256)}</code><p>SHA-256仅绑定所提供的JSON字节，不证明作者身份或内容真实。</p></details></section>`;
}

function declarationSection(report: ArtifactReport, scope: (id: string) => string): string {
  const value = report.declarations;
  if (!value) return `<section id="${scope('declarations')}"><h2>声明的跨文件检查</h2><p>此快照的声明元数据不可用，请查阅原始约定，不推断预期值。</p></section>`;
  return `<section id="${scope("declarations")}" aria-labelledby="${scope("declarations-title")}"><h2 id="${scope("declarations-title")}">声明的跨文件检查</h2>
    <p>这些内容是声明，不证明检查已完成。各文件类型、摘要和数值规则保留在原始约定中，本页不展示预期值与原始单元格。</p>
    <p>上限： ${text(value.limits.max_files)} 个文件 · 每文件 ${text(value.limits.max_file_bytes)} 字节 · 合计 ${text(value.limits.max_total_bytes)} 字节。</p>
    <p>展示 ${Math.min(128, value.checks.length)} / ${value.checks.length} 条声明，每条最多展示8个映射；JSON保留完整映射。</p>
    ${value.checks.slice(0, 128).map(({ ordinal, check }) => {
      let source: string, target: string, fields: string;
      if (check.type === "csv_summary") {
        source = check.csv; target = check.json;
        fields = `行数 → <code>${text(check.row_count_field)}</code><ul>${check.sums.slice(0, 8).map(pair => `<li><code>${text(pair.column)}</code> → <code>${text(pair.field)}</code></li>`).join("")}</ul><small>展示 ${Math.min(8, check.sums.length)} / ${check.sums.length} 个求和映射。</small>`;
      } else if (check.type === "reference_exists") {
        source = check.source.path; target = check.target.path;
        fields = `查找： <code>${text(check.source.field)}</code> → <code>${text(check.target.field)}</code><p>要求全部目标： ${check.require_all_targets === true ? "是" : "否"}</p><ul>${(check.matches ?? []).slice(0, 8).map(pair => `<li><code>${text(pair.source)}</code> → <code>${text(pair.target)}</code></li>`).join("")}</ul>`;
      } else {
        source = check.source.path; target = check.target.path;
        fields = `标识： <code>${columns(check.source.key)}</code> → <code>${columns(check.target.key)}</code><p>整数值： <code>${text(check.source.value)}</code> → <code>${text(check.target.value)}</code></p>`;
      }
      return `<article class="check" id="${text(scope("declared-check-" + ordinal))}"><h3>声明 ${text(ordinal)} · <code>${text(check.type)}</code></h3><p>来源： <code>${text(source)}</code> → 目标： <code>${text(target)}</code></p>${fields}</article>`;
    }).join("") || '<p>未声明跨文件检查，文件级要求请查阅原始约定。</p>'}</section>`;
}

/** Use the same path policy as text/JSON, including when called directly. */
function renderArtifactsContent(rawReport: ArtifactReport, prefix: string, heading: "h1" | "h2"): string {
  if (prefix && !/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(prefix)) throw new Error("报告分区前缀无效");
  const scope = (id: string) => prefix + id;
  const report = redactLocalPaths(rawReport);
  const checks = report.reconciliations ?? [];
  const incomplete = checks.filter(check => check.status === "unknown").length;
  const failedChecks = checks.filter(check => check.status === "failed").length;
  const passed = report.status === "passed";
  const referenceOnly = report.findings.length > 0 && report.findings.every(finding =>
    finding.code === "artifact.reference-value-mismatch" || finding.code === "artifact.reference-value-unavailable");
  const title = passed ? "声明的检查已通过" : report.exitCode === 2 ? "需要配置检查环境"
    : referenceOnly ? "引用元数据需要复核" : "需要复核";
  const files = report.files.slice(0, FILE_DETAILS);
  // 失败与未完成的检查排在成功检查之前。
  const ordered = [...checks.filter(check => check.status !== "passed"), ...checks.filter(check => check.status === "passed")];
  const rowBudget = { remaining: 64 };
  const referenceBudget = { remaining: REFERENCE_DETAILS };
  const referenceCount = report.findings.filter(finding => finding.reference).length;
  return `<div class="hero${passed ? "" : " fail"}"><span class="badge ${passed ? "pass" : "fail"}">${passed ? "通过" : "尚未通过"}</span><${heading}${heading === "h2" ? ' class="artifact-outcome"' : ""}>${title}</${heading}>
<p>${passed ? "声明的文件检查已通过，业务批准需要单独确认。" : "请复核下方问题并保留原始文件。"}</p>
<div class="review-summary"><p><strong>${report.files.length}</strong> 个已检查文件 · <strong>${report.findings.length}</strong> 项已记录问题${checks.length ? ` · ${failedChecks} 项分配核对失败，${incomplete} 项未完成` : ""}</p>
<a class="review-link" href="${report.findings.length ? "#" + scope("issue-title") : "#" + scope("file-title")}">${report.findings.length ? `复核 ${report.findings.length} 项已记录问题` : "复核已检查文件"}</a></div>
<div class="binding"><strong>回执与文件绑定</strong><span class="badge">${text(reportLabel(report.receipt_binding))}</span><small>已核对本机哈希，作者身份未验证。</small></div></div>
${comparisonSection(report, scope)}
${declarationSection(report, scope)}
<section id="${scope("checks")}" aria-labelledby="${scope("check-title")}"><h2 id="${scope("check-title")}">分配与标识核对</h2><p>展示 ${Math.min(CHECK_DETAILS, checks.length)} / ${checks.length} 项对账检查。 优先展示失败和未完成检查。</p>
${ordered.slice(0, CHECK_DETAILS).map(check => reconciliationCard(check, rowBudget)).join("") || "<p>未声明记录对账，其他文件检查已反映在结果中。</p>"}</section>
<section id="${scope("issues")}" aria-labelledby="${scope("issue-title")}"><h2 id="${scope("issue-title")}" tabindex="-1">复核操作</h2>${referenceCount > REFERENCE_DETAILS ? `<p>引用位置：展示 ${referenceCount} 项问题中的前 ${REFERENCE_DETAILS} 项。 JSON报告保留全部位置元数据。</p>` : ""}${report.findings.length ? `<div class="table-wrap" tabindex="0" aria-label="问题复核表"><table><thead><tr><th>问题</th><th>受影响元数据</th><th>下一步复核</th></tr></thead><tbody>${report.findings.slice(0, 256).map(finding => findingRow(finding, referenceBudget)).join("")}</tbody></table></div>` : "<p>声明范围内未发现问题。</p>"}</section>
<section id="${scope("files")}" aria-labelledby="${scope("file-title")}"><h2 id="${scope("file-title")}" tabindex="-1">已检查文件</h2><p>展示 ${files.length} / ${report.files.length} 个文件。 </p>
<div class="table-wrap" tabindex="0" aria-label="文件元数据表"><table><thead><tr><th>声明路径</th><th>字节数</th><th>行数</th><th>SHA-256</th></tr></thead><tbody>${files.map(file => `<tr><td><code>${text(file.path)}</code></td><td>${text(file.bytes)}</td><td>${text(file.rows)}</td><td><code>${text(file.sha256)}</code></td></tr>`).join("") || '<tr><td colspan="4">没有通过检查的文件观测。</td></tr>'}</tbody></table></div></section>
<details><summary>证据范围与快照身份</summary><p>仅在本机检查，未执行技能包、认证作者或进行业务批准。超过160字符的元数据会缩短展示，JSON中保留完整内容。</p>
<dl class="evidence"><dt>证据</dt><dd>实际文件</dd><dt>执行</dt><dd><code>execution: not-run</code></dd><dt>来源</dt><dd><code>provenance: not-authenticated</code></dd><dt>约定 SHA-256</dt><dd><code>${text(report.contract_sha256)}</code></dd><dt>文件集合 SHA-256</dt><dd><code>${text(report.artifact_set_sha256)}</code></dd></dl></details>`;
}

export function renderArtifactsFragment(rawReport: ArtifactReport, prefix: string): string {
  return renderArtifactsContent(rawReport, prefix, "h2");
}

export const artifactsReviewStyle = `:root{color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#182c35;background:#f3f6f8;line-height:1.55}*{box-sizing:border-box}body{margin:0}a{color:#075f70}.skip{position:absolute;top:-60px;left:16px;background:white;padding:12px}.skip:focus{top:12px;z-index:2}:focus-visible{outline:3px solid #207d94;outline-offset:4px}header,main,footer{max-width:1120px;margin:auto;padding:28px 24px}header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;border-bottom:1px solid #d6e0e5}.brand{font-weight:800;letter-spacing:-.04em;font-size:24px}.kicker{font-size:12px;letter-spacing:.14em;color:#526976;text-transform:uppercase}nav{display:flex;gap:18px;align-items:center;flex-wrap:wrap}main{padding-top:36px}h1{font-size:30px;line-height:1.15;letter-spacing:-.04em;margin:10px 0 18px}h2{font-size:24px;margin:0 0 16px}h3{font-size:17px;margin:0}p{margin:10px 0;color:#49616e}.hero{padding:30px;border:1px solid #d8e3e8;border-radius:8px;background:white;border-top:5px solid #087566}.hero.fail{border-top-color:#b44838}.badge{display:inline-block;font-weight:700;font-size:12px;padding:5px 10px;border-radius:20px;background:#e9eff3;color:#334f60}.badge.pass{background:#dff3ec;color:#075f48}.badge.fail{background:#fbe8e3;color:#993c2d}.badge.unknown{background:#fff1d4;color:#745600}.binding{margin-top:18px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}section{margin-top:36px}.check{background:white;padding:22px;border:1px solid #d7e2e7;border-radius:6px;margin:12px 0}.check-heading{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap}.sides{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:12px 0}.sides p{border-left:3px solid #c5d9e2;padding-left:14px}.sides span,.sides strong,.sides code,small{display:block}.sides span{font-size:12px;text-transform:uppercase;letter-spacing:.08em}code{font-family:ui-monospace,monospace;font-size:.9em;overflow-wrap:anywhere}.counts{display:flex;gap:20px;flex-wrap:wrap;margin:16px 0 0}.counts dt{color:#526976;font-size:12px}.counts dd{font-size:23px;font-weight:700;margin:3px 0;font-variant-numeric:tabular-nums}.notice{background:#fff7e5;padding:14px;border-radius:8px}.table-wrap{overflow:auto;border:1px solid #d7e2e7;border-radius:12px;background:white}table{border-collapse:collapse;width:100%;text-align:left}th,td{padding:14px 16px;border-bottom:1px solid #e3eaee;vertical-align:top;overflow-wrap:anywhere}th{background:#ecf2f5;font-size:12px;text-transform:uppercase;letter-spacing:.06em}td{max-width:340px}td p{margin:0 0 8px}small{color:#526976;font-size:12px;margin-top:5px}details{margin-top:16px;border:1px solid #d7e2e7;padding:16px;border-radius:10px;background:white}summary{cursor:pointer;font-weight:600;min-height:44px}dl.evidence{display:grid;grid-template-columns:180px 1fr;gap:8px}.evidence dd{margin:0;overflow-wrap:anywhere}footer{font-size:12px;color:#526976;border-top:1px solid #d7e2e7;margin-top:30px}footer code{display:block}@media(max-width:640px){header,main,footer{padding-left:16px;padding-right:16px}.hero{padding:20px}.sides{grid-template-columns:1fr}.check{padding:16px}dl.evidence{grid-template-columns:1fr;gap:4px}.evidence dd{margin-bottom:8px}th,td{padding:12px;min-width:110px}}@media print{body{background:white}header nav,.skip{display:none}main{padding-top:16px}.hero,.check,details{border-radius:0;break-inside:avoid}.table-wrap{overflow:visible}a{color:inherit}}

.review-summary{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:18px;padding-top:18px;margin-top:18px;border-top:1px solid #d6e0e5}.review-summary p{margin:0;font-variant-numeric:tabular-nums}.review-link{display:inline-flex;align-items:center;min-height:44px;padding:8px 14px;background:#075f70;color:white;border-radius:6px;text-decoration:none;font-weight:650}.review-link:hover{background:#064956}.reference-location{border-top:1px solid #d6e0e5;margin-top:14px;padding-top:12px;font-size:14px}.reference-location strong,.reference-location span,.reference-location small{display:block}.reference-location ul{list-style:none;padding:0;margin:8px 0}.reference-location li{margin:5px 0}.reference-location code{overflow-wrap:anywhere}h2[tabindex="-1"]{scroll-margin-top:24px}h2[tabindex="-1"]:focus{outline:3px solid #207d94;outline-offset:5px}

.artifact-outcome{font-size:26px;line-height:1.2;letter-spacing:-.02em;margin:10px 0 18px}

:root{background:#eef2f5;color:#263b4b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.brand{font-size:22px;font-weight:650;color:#29445d}.hero{border-radius:17px;border-top-width:2px;padding:26px;box-shadow:0 2px 3px #243d5305}h1{font-weight:550;font-size:30px}.check{border-radius:13px;border-color:#d8e2e9;box-shadow:0 2px 3px #243d5304}.counts{gap:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr))}.counts>div{padding:14px;border:1px solid #dbe4eb;border-radius:11px;background:#f5f8fa}.counts dd{font-size:27px;font-weight:500;letter-spacing:-.03em}.table-wrap,details{border-color:#d8e2e9;border-radius:12px}nav a{font-size:12px;color:#3d5e7b}h2{font-size:21px;font-weight:550}p{line-height:1.8}@media(max-width:640px){.hero{padding:18px}.counts{grid-template-columns:repeat(2,minmax(0,1fr))}}@media print{.hero,.check{box-shadow:none}}
`;

export function renderArtifactsHtml(rawReport: ArtifactReport): string {
  const body = renderArtifactsContent(rawReport, "", "h1");
  const csp = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${text(csp)}"><title>SkillSync 交付复核</title><style>${artifactsReviewStyle}</style></head><body><a class="skip" href="#review">跳转到交付复核</a><header><div><div class="brand">SkillSync</div><div class="kicker">离线交付复核</div></div><nav aria-label="报告导航"><a href="#declarations">声明的检查</a><a href="#checks">记录核对</a><a href="#issues">复核操作</a><a href="#files">文件</a></nav></header><main id="review" tabindex="-1">${body}</main><footer>SkillSync 源码版本 ${text(VERSION)} · 独立HTML，无脚本或外部请求。<code>${text(rawReport.schema)}</code></footer></body></html>\n`;
}
