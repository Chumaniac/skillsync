import { expect, it } from "vitest";
import { toIssues } from "../../src/domain/issue";
import type { VerificationReport } from "../../src/cli/commands/verify";
import { renderVerificationHtml } from "../../src/reporters/verification-html";

it("escapes metadata, hides raw evidence, and caps details while retaining totals", () => {
  const finding = { level: 1 as const, severity: "error" as const, status: "fail" as const, code: "test", skill: "<script>alert(1)</script>", message: "Read /private/work/file.md", evidence: [{ content: "RAW_SECRET", path: "/private/work/file.md" }], remediation: "Review <img src=x>" };
  const issues = Array.from({ length: 270 }, () => toIssues([finding])[0]!);
  const report: VerificationReport = { schema_version: 1, generated_at: "now", targets: [], findings: [finding], issues, summary: { total: 270, pass: 0, fail: 270, warn: 0, unknown: 0 }, exitCode: 1 };
  const html = renderVerificationHtml(report);
  expect(html).toContain("Showing 256 of 270");
  expect(html.match(/<article /g)).toHaveLength(256);
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("RAW_SECRET");
  expect(html).not.toContain("/private/work");
  expect(html).toContain("&lt;local-path&gt;");
});
