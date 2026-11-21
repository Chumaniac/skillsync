import { describe, expect, it } from "vitest";

import { BYTE_LIMIT, inspectDocument, normalizeReference, summarize } from "../../browser/inspect";
import { normalizeRelativePath } from "../../src/domain/digest";

const document = (frontmatter: string, body = "先读取清单，再逐项核对。") => `---\n${frontmatter}\n---\n\n${body}`;
const codes = (text: string) => inspectDocument(text).diagnostics.map(item => item.code);

describe("browser document inspection", () => {
  it("accepts a complete document and reports its fields and body size", () => {
    const result = inspectDocument(document("name: inventory-check\ndescription: 对照清单核对库存。\nallowed-tools: [Read]"));
    expect(result.state).toBe("valid");
    expect(result.diagnostics).toEqual([]);
    expect(result.fields).toEqual([
      { key: "name", value: "inventory-check", structured: false },
      { key: "description", value: "对照清单核对库存。", structured: false },
      { key: "allowed-tools", value: "（列表，1 项）", structured: true },
    ]);
    expect(result.body).toEqual({ characters: 12, lines: 1 });
  });

  it("locates a YAML error and translates the parser's fixed messages", () => {
    const duplicate = inspectDocument(document("name: a\nname: b\ndescription: d"));
    expect(duplicate.state).toBe("error");
    expect(duplicate.diagnostics[0]).toMatchObject({ code: "structure.invalid-frontmatter", location: { line: 3 } });
    expect(duplicate.diagnostics[0]?.message).toMatch(/^YAML 文档头无效：/);
    expect(inspectDocument("no frontmatter").diagnostics[0]?.message).toBe("文档必须以单独一行的 --- 开头。");
    expect(inspectDocument("---\nname: a\n").diagnostics[0]?.message).toBe("缺少结束文档头的 --- 行。");
  });

  it("reports the CLI's required fields as errors at the offending key", () => {
    const result = inspectDocument(document("name: 7\ndescription: ''"));
    expect(result.state).toBe("error");
    expect(result.diagnostics.map(item => [item.code, item.location?.line])).toEqual([
      ["structure.missing-name", 2],
      ["structure.missing-description", 3],
    ]);
    // An absent key points at the opening delimiter instead of a wrong line.
    expect(inspectDocument(document("description: d")).diagnostics[0]).toMatchObject({ code: "structure.missing-name", location: { line: 1 } });
  });

  it("warns about naming and length conventions without failing the document", () => {
    const result = inspectDocument(document(`name: Inventory Check\ndescription: ${"长".repeat(1025)}`));
    expect(result.state).toBe("warning");
    expect(result.diagnostics.map(item => item.code)).toEqual(["convention.name-format", "convention.description-length"]);
    expect(codes(document("name: a\ndescription: d", "  \n"))).toEqual(["document.empty-body"]);
  });

  it("rejects references that leave the Skill root and lists the ones only the CLI can confirm", () => {
    const body = "见 [说明](references/guide.md#usage)、[脚本](./scripts/run.sh) 和 [官网](https://example.com)。\n不要用 [上级](../secret.txt) 或 [绝对](/etc/passwd)。";
    const result = inspectDocument(document("name: a\ndescription: d", body));
    expect(result.state).toBe("error");
    expect(result.diagnostics.filter(item => item.code === "structure.unsafe-path").map(item => item.location?.line)).toEqual([7, 7]);
    expect(result.references).toEqual(["references/guide.md", "scripts/run.sh"]);
    expect(result.diagnostics.at(-1)).toMatchObject({ severity: "info", code: "structure.reference" });
  });

  it("refuses oversized input before parsing", () => {
    const result = inspectDocument("---\nname: a\ndescription: d\n---\n" + "文".repeat(BYTE_LIMIT));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "document.too-large", severity: "error" })]);
  });

  it("keeps reference normalization identical to the CLI's path boundary", () => {
    for (const input of ["a/b.md", "./a//b.md", "a\\b.md", "../a", "a/../b", "/abs", "C:\\x", "C:x", ".", "", "a\0b", "scripts/run.sh"]) {
      let expected: string | undefined;
      try { expected = normalizeRelativePath(input); } catch { expected = undefined; }
      expect(normalizeReference(input), JSON.stringify(input)).toBe(expected);
    }
  });

  it("summarizes findings without copying field values or body text", () => {
    const summary = summarize(inspectDocument(document("name: 机密名称\ndescription: 机密描述", "[x](../leak)")));
    expect(summary).toContain("**SKILL.md 文档检查：未通过**");
    expect(summary).toContain("`structure.unsafe-path`（第 6 行，第 1 列）");
    expect(summary).not.toContain("机密描述");
    expect(summarize(inspectDocument(document("name: a\ndescription: d")))).toContain("通过");
  });
});
