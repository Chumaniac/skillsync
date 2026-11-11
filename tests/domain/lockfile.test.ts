import { describe, expect, it } from "vitest";

import { validateLock } from "../../src/domain/lockfile";

const digest = `sha256:${"a".repeat(64)}`;

function validLock() {
  return {
    schema_version: 1,
    generated_at: "2026-08-04T10:00:00Z",
    skills: {
      review: {
        source: {
          kind: "git",
          url: "https://github.com/example/skills.git",
          ref: "v1",
          resolvedCommit: "a".repeat(40),
        },
        content_digest: digest,
        targets: {
          codex: {
            profile: "codex@1",
            status: "pass",
          },
        },
      },
    },
  };
}

describe("validateLock", () => {
  it("accepts the normalized lock shape", () => {
    const lock = validateLock(validLock());

    expect(lock.schema_version).toBe(1);
    expect(lock.skills.review.content_digest).toBe(digest);
    expect(lock.skills.review.targets.codex.profile).toBe("codex@1");
  });

  it("rejects unknown schema versions and duplicate skill names", () => {
    expect(() => validateLock({ ...validLock(), schema_version: 2 })).toThrow();
    expect(() =>
      validateLock({
        ...validLock(),
        skills: [
          { name: "review", ...validLock().skills.review },
          { name: "review", ...validLock().skills.review },
        ],
      }),
    ).toThrow(/duplicate/i);
  });

  it("rejects invalid digests and target statuses", () => {
    const invalidDigest = validLock();
    invalidDigest.skills.review.content_digest = "sha256:not-a-digest";
    const invalidStatus = validLock();
    invalidStatus.skills.review.targets.codex.status = "maybe";

    expect(() => validateLock(invalidDigest)).toThrow();
    expect(() => validateLock(invalidStatus)).toThrow();
  });

  it("rejects a target whose profile does not match its target key", () => {
    const mismatch = validLock();
    mismatch.skills.review.targets.codex.profile = "cursor@1";

    expect(() => validateLock(mismatch)).toThrow(/profile/i);
  });

  it("imports the current npx skills v3 lock shape without treating the tree hash as a content digest", () => {
    const updatedAt = "2026-08-06T10:00:00.000Z";
    const lock = validateLock({
      version: 3,
      skills: {
        review: {
          source: "vercel-labs/agent-skills",
          sourceType: "github",
          sourceUrl: "https://github.com/vercel-labs/agent-skills",
          ref: "main",
          skillPath: "skills/review",
          skillFolderHash: "a".repeat(40),
          installedAt: "2026-08-05T10:00:00.000Z",
          updatedAt,
        },
      },
      dismissed: { findSkillsPrompt: true },
    });

    expect(lock.schema_version).toBe(1);
    expect(lock.generated_at).toBe(updatedAt);
    expect(lock.skills.review.source).toEqual({
      kind: "git",
      url: "https://github.com/vercel-labs/agent-skills",
      ref: "main",
    });
    expect(lock.skills.review.content_digest).toBeUndefined();
    expect(lock.skills.review.targets).toEqual({});
    expect(lock.metadata?.external).toMatchObject({
      version: 3,
      dismissed: { findSkillsPrompt: true },
    });
    expect(lock.skills.review.metadata?.external).toMatchObject({
      sourceType: "github",
      skillFolderHash: "a".repeat(40),
      skillPath: "skills/review",
    });
  });
});
