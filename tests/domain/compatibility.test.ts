import { describe, expect, it } from "vitest";

import { computeSkillDigest } from "../../src/domain/digest";
import {
  evaluateCompatibility,
  type CapabilityProfile,
} from "../../src/domain/compatibility";
import {
  CapabilityProfileSchema,
  parseCapabilityProfile,
} from "../../src/profiles/types";
import type { Skill } from "../../src/domain/skill";

function skillWith(frontmatter: Record<string, unknown>): Skill {
  const files = [
    {
      relativePath: "SKILL.md",
      content: Buffer.from("---\nname: review\ndescription: Review\n---\n"),
      mode: 0o644,
      isSymlink: false,
    },
  ];
  return {
    name: "review",
    rootPath: "/tmp/skills/review",
    skillMdPath: "/tmp/skills/review/SKILL.md",
    frontmatter,
    files,
    source: { kind: "local" },
    digest: computeSkillDigest(files),
  };
}

function profile(features: CapabilityProfile["features"]): CapabilityProfile {
  return {
    id: "test-agent",
    version: 1,
    docsUrl: "https://example.com/agent-skills",
    projectPath: ".test/skills",
    userPath: "~/.test/skills",
    features,
    semantics: {
      unknown_frontmatter: "warn",
      script_execution: "runtime-dependent",
    },
  };
}

describe("CapabilityProfile and compatibility", () => {
  it("validates profile metadata and maps the YAML skill_path shape", () => {
    const parsed = parseCapabilityProfile({
      id: "codex",
      version: 1,
      docsUrl: "https://example.com/codex/skills",
      skill_path: { project: ".agents/skills", user: "~/.agents/skills" },
      features: { "frontmatter.name": "supported" },
      semantics: { unknown_frontmatter: "warn" },
    });

    expect(parsed.projectPath).toBe(".agents/skills");
    expect(parsed.userPath).toBe("~/.agents/skills");
    expect(CapabilityProfileSchema.safeParse(parsed).success).toBe(true);
  });

  it("rejects unsupported profile statuses and non-https documentation URLs", () => {
    expect(() =>
      parseCapabilityProfile({
        id: "broken",
        version: 1,
        docsUrl: "http://example.com/docs",
        skill_path: { project: ".skills", user: "~/.skills" },
        features: { hooks: "maybe" },
        semantics: {},
      }),
    ).toThrow();
  });

  it("passes a feature explicitly supported by the target profile", () => {
    const findings = evaluateCompatibility(
      skillWith({ name: "review", description: "Review", "allowed-tools": ["Read"] }),
      profile({
        "frontmatter.name": "supported",
        "frontmatter.description": "supported",
        "allowed-tools": "supported",
      }),
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "compatibility.supported",
        status: "pass",
        target: "test-agent",
      }),
    );
  });

  it("warns for ignored features and fails for explicitly unsupported features", () => {
    const ignored = evaluateCompatibility(
      skillWith({ name: "review", description: "Review", context: "fork" }),
      profile({ "context.fork": "ignored" }),
    );
    const unsupported = evaluateCompatibility(
      skillWith({ name: "review", description: "Review", "allowed-tools": ["Read"] }),
      profile({ "allowed-tools": "unsupported" }),
    );

    expect(ignored).toContainEqual(
      expect.objectContaining({
        code: "compatibility.ignored-feature",
        status: "warn",
      }),
    );
    expect(unsupported).toContainEqual(
      expect.objectContaining({
        code: "compatibility.unsupported-feature",
        status: "fail",
      }),
    );
  });

  it("reports an unknown frontmatter feature as unknown", () => {
    const findings = evaluateCompatibility(
      skillWith({ name: "review", description: "Review", "future-field": true }),
      profile({}),
    );

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "compatibility.unknown-feature",
        status: "unknown",
      }),
    );
  });
});
