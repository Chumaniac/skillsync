import { basename } from "node:path";

import { parseSkillDocument } from "../domain/frontmatter.js";
import { normalizeRelativePath } from "../domain/digest.js";
import type { Finding } from "../domain/result.js";
import type { Skill, SkillFile } from "../domain/skill.js";

type FindingStatus = Pick<Finding, "level" | "severity" | "status">;

function finding(
  values: FindingStatus &
    Pick<Finding, "code" | "skill" | "message" | "evidence"> &
    Partial<Pick<Finding, "remediation">>,
): Finding {
  return values;
}

function structureFinding(
  skill: Skill,
  values: FindingStatus &
    Pick<Finding, "code" | "message" | "evidence"> &
    Partial<Pick<Finding, "remediation">>,
): Finding {
  return finding({ ...values, skill: skill.name });
}

function isExternalReference(reference: string): boolean {
  return reference.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference);
}

function referencePath(reference: string): string {
  const firstToken = reference.trim().replace(/^<|>$/g, "").split(/\s+/, 1)[0] ?? "";
  return firstToken.split(/[?#]/, 1)[0] ?? "";
}

function inspectReferences(skill: Skill, body: string, paths: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = markdownLink.exec(body)) !== null) {
    const rawReference = referencePath(match[1] ?? "");
    if (!rawReference || isExternalReference(rawReference)) {
      continue;
    }

    let normalizedReference: string;
    try {
      normalizedReference = normalizeRelativePath(rawReference);
    } catch {
      findings.push(
        structureFinding(skill, {
          level: 3,
          severity: "error",
          status: "fail",
          code: "structure.unsafe-path",
          message: `Relative reference escapes the Skill root: ${rawReference}.`,
          evidence: [{ path: rawReference }],
          remediation: "Use a relative resource path that remains inside the Skill root.",
        }),
      );
      continue;
    }

    if (!paths.has(normalizedReference)) {
      findings.push(
        structureFinding(skill, {
          level: 2,
          severity: "error",
          status: "fail",
          code: "structure.missing-reference",
          message: `Referenced resource does not exist: ${normalizedReference}.`,
          evidence: [{ path: normalizedReference }],
          remediation: "Add the referenced file or remove the broken reference.",
        }),
      );
    }
  }

  return findings;
}

function isScriptPath(path: string): boolean {
  return /^scripts\/.+\.(?:sh|bash|zsh|fish|py|js|mjs|cjs|ts|rb|pl|php)$/i.test(path);
}

function inspectFilePaths(skill: Skill, files: SkillFile[]): { paths: Set<string>; findings: Finding[] } {
  const paths = new Set<string>();
  const findings: Finding[] = [];

  for (const file of files) {
    let normalizedPath: string;
    try {
      normalizedPath = normalizeRelativePath(file.relativePath);
    } catch {
      findings.push(
        structureFinding(skill, {
          level: 3,
          severity: "error",
          status: "fail",
          code: "structure.unsafe-path",
          message: `Skill file path is outside the Skill root: ${file.relativePath}.`,
          evidence: [{ path: file.relativePath }],
          remediation: "Keep all Skill files under the Skill root.",
        }),
      );
      continue;
    }

    paths.add(normalizedPath);
    if (isScriptPath(normalizedPath) && (file.mode & 0o022) !== 0) {
      findings.push(
        structureFinding(skill, {
          level: 2,
          severity: "error",
          status: "fail",
          code: "structure.invalid-script-mode",
          message: `Script has group/world-writable permissions: ${normalizedPath}.`,
          evidence: [{ path: normalizedPath, mode: `0${(file.mode & 0o777).toString(8)}` }],
          remediation: "Remove group/world write permissions from Skill scripts.",
        }),
      );
    }
  }

  return { paths, findings };
}

export function inspectStructure(skill: Skill): Finding[] {
  const fileInspection = inspectFilePaths(skill, skill.files);
  const findings = [...fileInspection.findings];
  const skillMdFile = skill.files.find((file) => {
    try {
      return normalizeRelativePath(file.relativePath) === "SKILL.md";
    } catch {
      return false;
    }
  });

  if (!skillMdFile) {
    findings.push(
      structureFinding(skill, {
        level: 2,
        severity: "error",
        status: "fail",
        code: "structure.missing-skill-md",
        message: "Skill root does not contain SKILL.md.",
        evidence: [{ path: skill.skillMdPath }],
        remediation: "Add a SKILL.md file at the Skill root.",
      }),
    );
    return findings;
  }

  const parsed = parseSkillDocument(skillMdFile.content.toString("utf8"));
  if (!parsed.ok) {
    findings.push(
      structureFinding(skill, {
        level: 2,
        severity: "error",
        status: "fail",
        code: "structure.invalid-frontmatter",
        message: parsed.error,
        evidence: [{ path: "SKILL.md" }],
        remediation: "Add valid YAML frontmatter enclosed by --- delimiters.",
      }),
    );
    return findings;
  }

  const { frontmatter, body } = parsed.value;
  const name = frontmatter.name;
  const description = frontmatter.description;

  if (typeof name !== "string" || name.trim().length === 0) {
    findings.push(
      structureFinding(skill, {
        level: 2,
        severity: "error",
        status: "fail",
        code: "structure.missing-name",
        message: "Frontmatter name must be a non-empty string.",
        evidence: [{ field: "name", value: typeof name }],
        remediation: "Set frontmatter.name to the Skill directory name.",
      }),
    );
  } else if (name !== basename(skill.rootPath)) {
    findings.push(
      structureFinding(skill, {
        level: 2,
        severity: "error",
        status: "fail",
        code: "structure.name-mismatch",
        message: `Frontmatter name ${name} does not match directory ${basename(skill.rootPath)}.`,
        evidence: [{ frontmatter_name: name, directory_name: basename(skill.rootPath) }],
        remediation: "Rename the directory or update frontmatter.name consistently.",
      }),
    );
  }

  if (typeof description !== "string" || description.trim().length === 0) {
    findings.push(
      structureFinding(skill, {
        level: 2,
        severity: "error",
        status: "fail",
        code: "structure.missing-description",
        message: "Frontmatter description must be a non-empty string.",
        evidence: [{ field: "description", value: typeof description }],
        remediation: "Add a concise description that explains when the Skill should be used.",
      }),
    );
  }

  findings.push(...inspectReferences(skill, body, fileInspection.paths));
  return findings;
}
