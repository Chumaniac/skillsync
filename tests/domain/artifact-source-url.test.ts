import { describe, expect, it } from "vitest";
import { parseArtifactContract } from "../../src/domain/artifact-contract";
import { inspectArtifactContent } from "../../src/domain/artifact-content";

function contract(field: Record<string, unknown> = {}) {
  return { schema: "skillsync.artifacts/v1",
    limits: { max_files: 1, max_file_bytes: 4096, max_total_bytes: 4096 },
    files: [{ path: "source.json", format: "json", fields: [{
      name: "source_url", type: "https_url", allowed_hosts: ["docs.example.test"], ...field,
    }] }] };
}

function inspect(value: string) {
  const rule = parseArtifactContract(contract()).files[0];
  return inspectArtifactContent(rule, Buffer.from(JSON.stringify({ source_url: value })));
}

describe("declared knowledge source URLs", () => {
  it.each([
    "https://docs.example.test/reference",
    "HTTPS://DOCS.EXAMPLE.TEST/reference?language=zh#section",
    "https://docs.example.test:443/reference",
    "https://docs.example.test/a%20reference",
  ])("accepts HTTPS on the exact declared host: %s", value => {
    expect(inspect(value).findings).toEqual([]);
  });

  it.each([
    "http://docs.example.test/reference",
    "javascript:alert(1)",
    "file:///synthetic/reference.md",
    "/reference",
    "https://docs.example.test.attacker.test/reference",
    "https://extra.docs.example.test/reference",
    "https://demo-reader@docs.example.test/reference",
    "https://docs.example.test@attacker.test/reference",
    "https://docs.example.test:8443/reference",
    "https://docs.example.test./reference",
    "https://127.0.0.1/reference",
    "https://localhost/reference",
    " https://docs.example.test/reference",
    "https://docs.example.test/ref erence",
    "https://docs.example.test/ref\nerence",
    "https://docs.example.test/ref\u200Berence",
    "https:\\docs.example.test\\reference",
    "https://docs.example.test/" + "x".repeat(2048),
  ])("rejects unsafe or undeclared addresses without returning their values: %s", value => {
    const report = inspect(value);
    expect(report.findings).toContainEqual({ code: "artifact.json-value", path: "source.json", field: "source_url" });
    expect(JSON.stringify(report.findings)).not.toContain(value);
  });

  it("uses the same URL rule for actual CSV fields", () => {
    const rule = parseArtifactContract({ ...contract(), files: [{ path: "sources.csv", format: "csv",
      columns: [{ name: "source_url", type: "https_url", allowed_hosts: ["docs.example.test"] }], max_rows: 5 }] }).files[0];
    expect(inspectArtifactContent(rule, Buffer.from('source_url\n"https://docs.example.test/reference?a=1,b=2"\n')).findings).toEqual([]);
    expect(inspectArtifactContent(rule, Buffer.from("source_url\nhttps://docs.example.test.attacker.test/reference\n")).findings)
      .toContainEqual({ code: "artifact.csv-value", path: "sources.csv", field: "source_url", row: 1 });
  });

  it.each([
    { allowed_hosts: undefined }, { allowed_hosts: [] },
    { allowed_hosts: ["*.example.test"] }, { allowed_hosts: ["DOCS.EXAMPLE.TEST"] },
    { allowed_hosts: ["127.0.0.1"] }, { allowed_hosts: ["localhost"] },
    { allowed_hosts: ["docs.example.test."] }, { allowed_hosts: ["-docs.example.test"] },
    { allowed_hosts: ["docs.example.test", "docs.example.test"] },
    { allowed_hosts: Array.from({ length: 17 }, (_, index) => `host${index}.example.test`) },
    { type: "string", allowed_hosts: ["docs.example.test"] },
    { type: "https_url", equals: 1 },
  ])("requires a bounded exact host declaration: %j", field => {
    expect(() => parseArtifactContract(contract(field))).toThrow("artifact contract is invalid");
  });

  it("does not retain URL values in facts or findings", () => {
    const value = "https://docs.example.test/private-synthetic-title";
    const report = inspect(value);
    expect(report.findings).toEqual([]);
    expect(report.facts.integers.size).toBe(0);
    expect(JSON.stringify(report)).not.toContain(value);
  });
});
