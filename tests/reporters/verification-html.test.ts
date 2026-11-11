import { expect, it } from "vitest";
import { toIssues } from "../../src/domain/issue";
import type { VerificationReport } from "../../src/cli/commands/verify";
import { renderVerificationHtml } from "../../src/reporters/verification-html";

it("escapes metadata, hides raw evidence, and caps details while retaining totals", () => {
  const finding = { level: 1 as const, severity: "error" as const, status: "fail" as const, code: "test", skill: "<script>alert(1)</script>", message: "Read /private/work/file.md", evidence: [{ content: "RAW_SECRET", path: "/private/work/file.md" }], remediation: "Review <img src=x>" };
  const issues = Array.from({ length: 270 }, () => toIssues([finding])[0]!);
  const report: VerificationReport = { schema_version: 1, generated_at: "now", targets: [], findings: [finding], issues, summary: { total: 270, pass: 0, fail: 270, warn: 0, unknown: 0 }, exitCode: 1 };
  const html = renderVerificationHtml(report);
  expect(html).toContain('lang="zh-CN"');
  expect(html).toContain("本组展示 256 / 270");
  expect(html.match(/<article /g)).toHaveLength(256);
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("RAW_SECRET");
  expect(html).not.toContain("/private/work");
  expect(html).toContain("&lt;local-path&gt;");
});

it("links directly to severity groups and opens the first group needing review", () => {
  const findings = (["warn", "critical", "error", "info"] as const).map(severity => ({ level: 1 as const, severity, status: "fail" as const, code: `test-${severity}`, skill: "fixture", message: "Review this check", remediation: "Check the saved input", evidence: [] }));
  const report: VerificationReport = { schema_version: 1, generated_at: "now", targets: [], findings, issues: toIssues(findings), summary: { total: 4, pass: 0, fail: 4, warn: 0, unknown: 0 }, exitCode: 1 };
  const html = renderVerificationHtml(report);
  expect(html).toContain('aria-label="问题优先级"');
  expect(html).toContain('href="#issues-critical-start"');
  expect(html).toContain('id="issues-critical" open');
  expect(html).not.toContain('id="issues-error" open');
  for (const severity of ["critical", "error", "warn", "info"]) {
    expect(html).toContain(`id="issues-${severity}-start"`);
  }
  expect(html).toContain("未验证");
  expect(html).not.toContain("CRITICAL ·");
  expect(html).not.toContain("1 issues");
});

it("does not fill an empty report with four empty severity panels", () => {
  const report: VerificationReport = { schema_version: 1, generated_at: "now", targets: [], findings: [], issues: [], summary: { total: 0, pass: 0, fail: 0, warn: 0, unknown: 0 }, exitCode: 0 };
  const html = renderVerificationHtml(report);
  expect(html).toContain("未发现需处理问题。");
  expect(html).not.toContain('class="issue-group"');
  expect(html).not.toContain('aria-label="问题优先级"');
});

it("renders owned review guidance in Chinese without rewriting saved evidence", () => {
  const finding = { level: 1 as const, severity: "warn" as const, status: "warn" as const,
    code: "provenance.local-only", skill: "sample", evidence: [],
    message: "Skill source is local-only and has no verifiable remote identity.",
    remediation: "Record a repository URL and resolved commit when publishing the Skill." };
  const report: VerificationReport = { schema_version: 1, generated_at: "now", targets: [],
    findings: [finding], issues: toIssues([finding]), summary: { total: 1, pass: 0, fail: 0, warn: 1, unknown: 0 }, exitCode: 0 };
  const original = JSON.stringify(report);
  const html = renderVerificationHtml(report);
  expect(html).toContain("尚无可核验的远端来源身份");
  expect(html).toContain("记录仓库地址与确定的提交版本");
  expect(html).not.toContain(finding.message);
  expect(JSON.stringify(report)).toBe(original);
});
