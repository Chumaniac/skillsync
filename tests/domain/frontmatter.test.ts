import { describe, expect, it } from "vitest";

import { parseSkillDocument } from "../../src/domain/frontmatter";

describe("parseSkillDocument", () => {
  it("parses YAML frontmatter and preserves the body", () => {
    const content = "---\nname: review\ndescription: Review a change\n---\n# Review\n";
    const result = parseSkillDocument(content);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.frontmatter).toEqual({
      name: "review",
      description: "Review a change",
    });
    expect(result.value.body).toBe("# Review\n");
    expect(result.value.sourceRange).toEqual({
      start: 0,
      end: content.indexOf("# Review"),
    });
  });

  it("rejects a document without an opening or closing delimiter", () => {
    const missingOpening = parseSkillDocument("name: review\n---\nbody");
    const missingClosing = parseSkillDocument("---\nname: review\nbody");

    expect(missingOpening.ok).toBe(false);
    expect(missingClosing.ok).toBe(false);
  });

  it("rejects invalid YAML, duplicate keys, and non-mapping frontmatter", () => {
    const invalidYaml = parseSkillDocument("---\nname: [review\n---\nbody");
    const duplicateKeys = parseSkillDocument("---\nname: review\nname: other\n---\nbody");
    const nonMapping = parseSkillDocument("---\n- review\n---\nbody");

    expect(invalidYaml.ok).toBe(false);
    expect(duplicateKeys.ok).toBe(false);
    expect(nonMapping.ok).toBe(false);
  });
});
