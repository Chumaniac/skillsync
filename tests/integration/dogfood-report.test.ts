import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runVerification } from "../../src/cli/commands/verify";
import { renderJson } from "../../src/reporters/json";

describe("SkillSync dogfood report", () => {
  it("verifies the invalid fixture corpus without mutating it", async () => {
    const report = await runVerification({
      paths: [resolve("fixtures/invalid")],
      targets: ["codex"],
    });
    const json = JSON.parse(renderJson(report)) as typeof report;

    expect(json.schema_version).toBe(1);
    expect(json.findings.length).toBeGreaterThan(0);
    expect(json.summary.total).toBe(json.findings.length);
    expect(json.findings.some((finding) => finding.code === "structure.invalid-frontmatter")).toBe(true);
  });
});
