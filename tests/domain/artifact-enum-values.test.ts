import { describe, expect, it } from "vitest";
import { parseArtifactContract } from "../../src/domain/artifact-contract";
import { inspectArtifactContent } from "../../src/domain/artifact-content";

function contract(field: Record<string, unknown> = {}) {
  return { schema: "skillsync.artifacts/v1",
    limits: { max_files: 1, max_file_bytes: 4096, max_total_bytes: 4096 },
    files: [{ path: "review.json", format: "json", fields: [{
      name: "decision", type: "string", one_of: ["ready", "needs-review", "blocked"], ...field,
    }] }] };
}

function inspect(value: unknown, field: Record<string, unknown> = {}) {
  return inspectArtifactContent(parseArtifactContract(contract(field)).files[0],
    Buffer.from(JSON.stringify({ decision: value })));
}

describe("bounded exact scalar options", () => {
  it.each(["ready", "needs-review", "blocked"])("accepts declared value %s", value => {
    expect(inspect(value).findings).toEqual([]);
  });

  it.each(["approved", "Ready", " ready", "ready ", "re\u200Bady", "", 1, true, null, { label: "ready" }])("rejects unlisted or mistyped material without retaining it: %j", value => {
      const report = inspect(value);
      expect(report.findings).toEqual([{ code: "artifact.json-value", path: "review.json", field: "decision" }]);
      expect(report.facts.integers.size).toBe(0);
      expect(Object.keys(report.facts)).toEqual(["integers"]);
    });

  it("shares the same rule with actual CSV cells", () => {
    const rule = parseArtifactContract({ ...contract(), files: [{ path: "review.csv", format: "csv",
      columns: [{ name: "decision", type: "string", one_of: ["ready", "blocked"] }], max_rows: 10 }] }).files[0];
    expect(inspectArtifactContent(rule, Buffer.from("decision\nready\nblocked\n")).findings).toEqual([]);
    expect(inspectArtifactContent(rule, Buffer.from("decision\nReady\n")).findings)
      .toContainEqual({ code: "artifact.csv-value", path: "review.csv", field: "decision", row: 1 });
  });

  it("preserves formula rejection even for an explicitly listed string", () => {
    const rule = parseArtifactContract({ ...contract(), files: [{ path: "review.csv", format: "csv",
      columns: [{ name: "decision", type: "string", one_of: ["+ready"] }], max_rows: 10 }] }).files[0];
    expect(inspectArtifactContent(rule, Buffer.from("decision\n+ready\n")).findings)
      .toContainEqual({ code: "artifact.csv-formula", path: "review.csv", field: "decision", row: 1 });
  });

  it("allows an empty option only when the rule explicitly allows empty material", () => {
    expect(inspect("", { one_of: ["", "ready"], allow_empty: true }).findings).toEqual([]);
    expect(() => parseArtifactContract(contract({ one_of: ["", "ready"] }))).toThrow("artifact contract is invalid");
  });

  it("does not require an optional JSON field to be present", () => {
    const rule = parseArtifactContract(contract({ required: false })).files[0];
    expect(inspectArtifactContent(rule, Buffer.from("{}")).findings).toEqual([]);
  });

  it.each([
    { one_of: [] }, { one_of: ["ready", "ready"] }, { one_of: [1] },
    { one_of: Array.from({ length: 33 }, (_, index) => `state-${index}`) },
    { one_of: ["x".repeat(257)] }, { one_of: [" ready"] },
    { one_of: ["ready\n"] }, { one_of: ["re\u200Bady"] },
    { type: "integer", one_of: ["1"] }, { type: "date", one_of: ["2026-10-08"] },
    { type: "https_url", allowed_hosts: ["docs.example.test"], one_of: ["https://docs.example.test/"] },
    { equals: "approved" },
  ])("rejects inconsistent or unbounded declarations: %j", field => {
    expect(() => parseArtifactContract(contract(field))).toThrow("artifact contract is invalid");
  });

  it("accepts the inclusive 32-option and 256-character boundaries", () => {
    const values = ["x".repeat(256), ...Array.from({ length: 31 }, (_, index) => `state-${index}`)];
    expect(inspect(values[0], { one_of: values, equals: values[0] }).findings).toEqual([]);
  });

  it("keeps original string contracts unchanged when options are absent", () => {
    const rule = parseArtifactContract(contract({ one_of: undefined })).files[0];
    expect(JSON.stringify(rule)).not.toContain("one_of");
    expect(inspectArtifactContent(rule, Buffer.from('{"decision":"any-original-string"}')).findings).toEqual([]);
  });

  it("uses caller-declared currency labels without interpreting monetary values", () => {
    expect(inspect("CNY", { one_of: ["CNY", "USD"] }).findings).toEqual([]);
    expect(inspect("cny", { one_of: ["CNY", "USD"] }).findings)
      .toContainEqual({ code: "artifact.json-value", path: "review.json", field: "decision" });
    expect(inspect("待审", { one_of: ["待审", "已完成"] }).findings).toEqual([]);
  });
});
