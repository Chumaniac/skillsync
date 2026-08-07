import { describe, expect, it } from "vitest";

import { toIssue } from "../../src/domain/issue";
import { buildResolutions } from "../../src/domain/resolution";
import { renderSarif } from "../../src/reporters/sarif";
import type { VerificationReport } from "../../src/cli/commands/verify";

describe("renderSarif", () => {
  it("maps findings to SARIF rules, levels, locations, and remediation", () => {
    const finding = {
      level: 2 as const,
      severity: "error" as const,
      status: "fail" as const,
      code: "structure.missing-reference",
      skill: "review",
      target: "codex",
      message: "Referenced resource does not exist.",
      evidence: [{ path: "references/missing.md" }],
      remediation: "Add the referenced file.",
    };
    const issue = toIssue(finding, {});
    const report: VerificationReport = {
      schema_version: 1,
      generated_at: "2026-08-04T10:00:00.000Z",
      targets: [{ name: "project", path: "/tmp/skills", scope: "explicit" }],
      findings: [finding],
      issues: [{ ...issue, resolutions: buildResolutions(issue, { rootPath: "/tmp/skills" }) }],
      summary: { total: 1, pass: 0, warn: 0, fail: 1, unknown: 0 },
      exitCode: 1,
    };

    const sarif = JSON.parse(renderSarif(report)) as {
      version: string;
      runs: Array<{
        tool: { driver: { name: string; rules: Array<{ id: string; help?: { text: string } }> } };
        results: Array<{
          ruleId: string;
          level: string;
          locations?: Array<{ physicalLocation?: { artifactLocation?: { uri: string } } }>;
          properties?: { remediation?: string; issueId?: string };
        }>;
      }>;
    };

    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.tool.driver.name).toBe("skillsync");
    expect(sarif.runs[0]?.tool.driver.rules[0]?.id).toBe("structure.missing-reference");
    expect(sarif.runs[0]?.tool.driver.rules[0]?.help?.text).toBe("Add the referenced file.");
    expect(sarif.runs[0]?.results[0]?.ruleId).toBe("structure.missing-reference");
    expect(sarif.runs[0]?.results[0]?.level).toBe("error");
    expect(sarif.runs[0]?.results[0]?.locations?.[0]?.physicalLocation?.artifactLocation?.uri).toBe(
      "references/missing.md",
    );
    expect(sarif.runs[0]?.results[0]?.properties?.remediation).toBe("Add the referenced file.");
    expect(sarif.runs[0]?.results[0]?.properties?.issueId).toBe(issue.id);
  });

  it("omits local absolute paths by default while retaining relative evidence", () => {
    const root = "/workspace/private-project";
    const finding = {
      level: 2 as const,
      severity: "error" as const,
      status: "fail" as const,
      code: "structure.missing-reference",
      skill: "review",
      target: "codex",
      message: `Referenced resource at ${root}/references/missing.md does not exist.`,
      evidence: [{ path: `${root}/references/missing.md` }],
      remediation: `Add the referenced file under ${root}.`,
    };
    const issue = toIssue(finding, {});
    const report: VerificationReport = {
      schema_version: 1,
      generated_at: "2026-08-04T10:00:00.000Z",
      targets: [{ name: "project", path: root, scope: "explicit" }],
      findings: [finding],
      issues: [{ ...issue, resolutions: buildResolutions(issue, { rootPath: root }) }],
      summary: { total: 1, pass: 0, warn: 0, fail: 1, unknown: 0 },
      exitCode: 1,
      reporting: { sarif: true, include_local_paths: false },
    };

    const sarifText = renderSarif(report);
    const sarif = JSON.parse(sarifText) as {
      runs: Array<{
        tool: { driver: { rules: Array<{ shortDescription: { text: string }; help?: { text: string } }> } };
        results: Array<{
          message: { text: string };
          locations: unknown[];
          properties?: { remediation?: string };
        }>;
      }>;
    };

    expect(sarifText).not.toContain(root);
    expect(sarif.runs[0]?.tool.driver.rules[0]?.shortDescription.text).toContain("<local-path>");
    expect(sarif.runs[0]?.tool.driver.rules[0]?.help?.text).toContain("<local-path>");
    expect(sarif.runs[0]?.results[0]?.message.text).toContain("<local-path>");
    expect(sarif.runs[0]?.results[0]?.locations).toEqual([]);
    expect(sarif.runs[0]?.results[0]?.properties?.remediation).toContain("<local-path>");

    const optedIn = JSON.parse(renderSarif({
      ...report,
      reporting: { sarif: true, include_local_paths: true },
    })) as typeof sarif;
    expect(optedIn.runs[0]?.results[0]?.locations[0]).toEqual({
      physicalLocation: {
        artifactLocation: { uri: `${root}/references/missing.md` },
      },
    });
  });
});
