import { normalizeRelativePath } from "./digest.js";
import type { Finding } from "./result.js";
import type { Skill } from "./skill.js";
import type { CapabilityProfile, SupportStatus } from "../profiles/types.js";

export type { CapabilityProfile } from "../profiles/types.js";

type FindingStatus = Pick<Finding, "level" | "severity" | "status">;

function finding(
  values: FindingStatus &
    Pick<Finding, "code" | "skill" | "target" | "message" | "evidence"> &
    Partial<Pick<Finding, "remediation">>,
): Finding {
  return values;
}

function hasFrontmatterField(skill: Skill, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(skill.frontmatter, field);
}

export function detectSkillFeatures(skill: Skill): string[] {
  const features = new Set<string>();
  const frontmatter = skill.frontmatter;

  if (hasFrontmatterField(skill, "name")) {
    features.add("frontmatter.name");
  }
  if (hasFrontmatterField(skill, "description")) {
    features.add("frontmatter.description");
  }
  if (hasFrontmatterField(skill, "allowed-tools")) {
    features.add("allowed-tools");
  }
  if (frontmatter.context === "fork") {
    features.add("context.fork");
  } else if (hasFrontmatterField(skill, "context")) {
    features.add("frontmatter.context");
  }
  if (hasFrontmatterField(skill, "hooks")) {
    features.add("hooks");
  }

  for (const field of Object.keys(frontmatter)) {
    if (!["name", "description", "allowed-tools", "context", "hooks"].includes(field)) {
      features.add(`frontmatter.${field}`);
    }
  }

  if (
    skill.files.some((file) => {
      try {
        return normalizeRelativePath(file.relativePath).startsWith("scripts/");
      } catch {
        return false;
      }
    })
  ) {
    features.add("bundled_scripts");
  }

  return [...features].sort();
}

function findingForSupportStatus(
  skill: Skill,
  profile: CapabilityProfile,
  feature: string,
  supportStatus: SupportStatus,
): Finding {
  switch (supportStatus) {
    case "supported":
      return finding({
        level: 0,
        severity: "info",
        status: "pass",
        code: "compatibility.supported",
        skill: skill.name,
        target: profile.id,
        message: `Feature ${feature} is supported by ${profile.id}.`,
        evidence: [{ feature, support_status: supportStatus, profile: `${profile.id}.v${profile.version}` }],
      });
    case "ignored":
      return finding({
        level: 1,
        severity: "warn",
        status: "warn",
        code: "compatibility.ignored-feature",
        skill: skill.name,
        target: profile.id,
        message: `Feature ${feature} is ignored by ${profile.id}.`,
        evidence: [{ feature, support_status: supportStatus, profile: `${profile.id}.v${profile.version}` }],
        remediation: "Remove the feature or provide a target-specific fallback.",
      });
    case "unsupported":
      return finding({
        level: 2,
        severity: "error",
        status: "fail",
        code: "compatibility.unsupported-feature",
        skill: skill.name,
        target: profile.id,
        message: `Feature ${feature} is unsupported by ${profile.id}.`,
        evidence: [{ feature, support_status: supportStatus, profile: `${profile.id}.v${profile.version}` }],
        remediation: "Remove the feature, choose another target, or provide a loss-aware fallback.",
      });
    case "runtime-dependent":
      return finding({
        level: 1,
        severity: "warn",
        status: "warn",
        code: "compatibility.runtime-dependent",
        skill: skill.name,
        target: profile.id,
        message: `Feature ${feature} depends on ${profile.id}'s runtime behavior.`,
        evidence: [{ feature, support_status: supportStatus, profile: `${profile.id}.v${profile.version}` }],
        remediation: "Verify this behavior with a target-specific fixture or behavior test.",
      });
    case "unknown":
      return finding({
        level: 1,
        severity: "warn",
        status: "unknown",
        code: "compatibility.unknown-feature",
        skill: skill.name,
        target: profile.id,
        message: `Support for feature ${feature} is unknown on ${profile.id}.`,
        evidence: [{ feature, support_status: supportStatus, profile: `${profile.id}.v${profile.version}` }],
        remediation: "Add profile evidence or validate the feature with a target fixture.",
      });
  }
}

export function evaluateCompatibility(skill: Skill, profile: CapabilityProfile): Finding[] {
  return detectSkillFeatures(skill).map((feature) => {
    const supportStatus = profile.features[feature] ?? "unknown";
    return findingForSupportStatus(skill, profile, feature, supportStatus);
  });
}
