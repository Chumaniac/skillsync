import { isAbsolute, relative, resolve } from "node:path";

import { computeSkillDigest } from "../domain/digest.js";
import type { Finding } from "../domain/result.js";
import type { Skill } from "../domain/skill.js";

export type ProvenanceEvidence = {
  source: Skill["source"];
  contentDigest: string;
  resolvedCommit?: string;
  evidenceStatus: "verified" | "local-only" | "unknown";
};

export type ProvenanceOptions = {
  allowedRootPrefixes?: string[];
};

type FindingStatus = Pick<Finding, "level" | "severity" | "status">;

function finding(
  values: FindingStatus &
    Pick<Finding, "code" | "skill" | "message" | "evidence"> &
    Partial<Pick<Finding, "remediation">>,
): Finding {
  return values;
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith("../") && !isAbsolute(path));
}

function digestFinding(skill: Skill): Finding | undefined {
  try {
    const actualDigest = computeSkillDigest(skill.files);
    if (actualDigest === skill.digest) {
      return undefined;
    }
    return finding({
      level: 2,
      severity: "error",
      status: "fail",
      code: "provenance.digest-mismatch",
      skill: skill.name,
      message: "Skill digest does not match its current file contents.",
      evidence: [{ expected: skill.digest, actual: actualDigest }],
      remediation: "Recompute the digest after review or restore the locked content.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return finding({
      level: 3,
      severity: "error",
      status: "fail",
      code: "provenance.invalid-files",
      skill: skill.name,
      message: "Skill files could not be normalized for provenance.",
      evidence: [{ error: message.split("\n", 1)[0] ?? "unknown" }],
      remediation: "Remove unsafe paths and recompute the Skill digest.",
    });
  }
}

export async function inspectProvenance(
  skill: Skill,
  options: ProvenanceOptions = {},
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const digestMismatch = digestFinding(skill);
  if (digestMismatch) {
    findings.push(digestMismatch);
  }

  if (
    options.allowedRootPrefixes &&
    !options.allowedRootPrefixes.some((prefix) => isInside(prefix, skill.rootPath))
  ) {
    findings.push(
      finding({
        level: 3,
        severity: "error",
        status: "fail",
        code: "provenance.path-not-allowed",
        skill: skill.name,
        message: "Skill root is outside the configured provenance policy.",
        evidence: [{ root_path: skill.rootPath }],
        remediation: "Move the Skill into an allowed root or update the explicit policy.",
      }),
    );
  }

  if (skill.source.kind === "git") {
    const hasCommit = Boolean(skill.source.resolvedCommit && /^[0-9a-f]{7,64}$/i.test(skill.source.resolvedCommit));
    if (skill.source.url && hasCommit) {
      findings.push(
        finding({
          level: 0,
          severity: "info",
          status: "pass",
          code: "provenance.verified",
          skill: skill.name,
          message: "Git source URL and resolved commit are present.",
          evidence: [
            {
              source_url: skill.source.url,
              ref: skill.source.ref ?? "unknown",
              resolved_commit: skill.source.resolvedCommit ?? "unknown",
              content_digest: skill.digest,
            },
          ],
        }),
      );
    } else {
      findings.push(
        finding({
          level: 1,
          severity: "warn",
          status: "unknown",
          code: "provenance.missing-commit",
          skill: skill.name,
          message: "Git source is known but its resolved commit is missing or invalid.",
          evidence: [{ source_url: skill.source.url ?? "unknown", ref: skill.source.ref ?? "unknown" }],
          remediation: "Record a resolved commit instead of relying on a moving ref.",
        }),
      );
    }
  } else if (skill.source.kind === "local") {
    findings.push(
      finding({
        level: 1,
        severity: "warn",
        status: "warn",
        code: "provenance.local-only",
        skill: skill.name,
        message: "Skill source is local-only and has no verifiable remote identity.",
        evidence: [{ root_path: skill.rootPath, content_digest: skill.digest }],
        remediation: "Record a repository URL and resolved commit when publishing the Skill.",
      }),
    );
  } else {
    findings.push(
      finding({
        level: 2,
        severity: "warn",
        status: "unknown",
        code: "provenance.unknown-source",
        skill: skill.name,
        message: "Skill source provenance is unknown.",
        evidence: [{ content_digest: skill.digest }],
        remediation: "Identify the source repository or explicitly accept local-only provenance.",
      }),
    );
  }

  return findings;
}
