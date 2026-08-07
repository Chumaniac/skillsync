import { z } from "zod";

import { SkillSourceSchema, type SkillSource } from "./skill.js";

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const LockStatusSchema = z.enum(["pass", "warn", "fail", "unknown"]);
const ProfileRefSchema = z.string().regex(/^[a-z0-9-]+@\d+$/);

const LockTargetSchema = z
  .object({
    profile: ProfileRefSchema,
    status: LockStatusSchema,
    report_digest: DigestSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const LockSkillSchema = z
  .object({
    source: SkillSourceSchema,
    content_digest: DigestSchema.optional(),
    targets: z.record(z.string(), LockTargetSchema),
    metadata: z
      .object({
        external: z.record(z.string(), z.unknown()),
      })
      .optional(),
  })
  .strict();

type NormalizedLockSkill = z.infer<typeof LockSkillSchema>;

export const SkillLockSchema = z
  .object({
    schema_version: z.literal(1),
    generated_at: z.string().datetime({ offset: true }),
    skills: z.record(z.string().min(1), LockSkillSchema),
    metadata: z
      .object({
        external: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SkillLock = z.infer<typeof SkillLockSchema>;

type RawRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): RawRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as RawRecord;
}

function sourceKind(value: string, entry: RawRecord): SkillSource["kind"] {
  const sourceType = typeof entry.sourceType === "string" ? entry.sourceType.toLowerCase() : undefined;
  if (sourceType === "local") return "local";
  if (sourceType === "git" || sourceType === "github" || sourceType === "gitlab" || sourceType === "bitbucket") {
    return "git";
  }
  if (/^(?:https?:\/\/|git@|ssh:\/\/)/i.test(value) || /^[^/\\]+\/[^/\\]+(?:\/[^/\\]+)*$/.test(value)) {
    return "git";
  }
  return "unknown";
}

function normalizeSource(value: unknown, entry: RawRecord): SkillSource {
  if (typeof value === "string") {
    return {
      kind: sourceKind(value, entry),
      url: value,
      ref: typeof entry.ref === "string" ? entry.ref : undefined,
      resolvedCommit:
        typeof entry.resolved_commit === "string" ? entry.resolved_commit : undefined,
    };
  }

  const source = asRecord(value, "lock source");
  return SkillSourceSchema.parse({
    kind: source.kind,
    url: source.url,
    ref: source.ref,
    resolvedCommit: source.resolvedCommit ?? source.resolved_commit ?? entry.resolved_commit,
  });
}

type LockInputFormat = "skillsync" | "skills-v3";

function normalizeEntry(name: string, value: unknown, format: LockInputFormat): [string, NormalizedLockSkill] {
  const raw = asRecord(value, `lock Skill ${name}`);
  const contentDigest = raw.content_digest ?? raw.contentDigest;
  if (format === "skillsync" && contentDigest === undefined) {
    throw new Error(`lock Skill ${name} requires content_digest`);
  }
  if (format === "skillsync" && raw.targets === undefined) {
    throw new Error(`lock Skill ${name} requires targets`);
  }
  const known = new Set([
    "name",
    "source",
    "path",
    "resolved_commit",
    "content_digest",
    "contentDigest",
    "targets",
    "sourceType",
    "sourceUrl",
    "ref",
    "skillPath",
    "skillFolderHash",
    "installedAt",
    "updatedAt",
    "pluginName",
    "sourceBaseUrl",
    "wellKnownDigest",
  ]);
  const external = format === "skills-v3"
    ? { ...raw }
    : Object.fromEntries(Object.entries(raw).filter(([key]) => !known.has(key)));
  const sourceValue = format === "skills-v3" ? raw.sourceUrl ?? raw.source : raw.source;
  const entry = LockSkillSchema.parse({
    source: normalizeSource(sourceValue, raw),
    ...(contentDigest === undefined ? {} : { content_digest: contentDigest }),
    targets: raw.targets ?? {},
    ...(Object.keys(external).length > 0 ? { metadata: { external } } : {}),
  });
  return [name, entry];
}

function normalizeSkills(value: unknown, format: LockInputFormat): Record<string, NormalizedLockSkill> {
  if (Array.isArray(value)) {
    const entries: Record<string, NormalizedLockSkill> = {};
    for (const item of value) {
      const raw = asRecord(item, "lock Skill entry");
      if (typeof raw.name !== "string" || raw.name.length === 0) {
        throw new Error("lock Skill entry requires a name");
      }
      if (raw.name in entries) {
        throw new Error(`Duplicate Skill name in lock: ${raw.name}`);
      }
      const [name, entry] = normalizeEntry(raw.name, raw, format);
      entries[name] = entry;
    }
    return entries;
  }

  const record = asRecord(value, "lock skills");
  const entries: Record<string, NormalizedLockSkill> = {};
  for (const [name, entry] of Object.entries(record)) {
    const [normalizedName, normalizedEntry] = normalizeEntry(name, entry, format);
    entries[normalizedName] = normalizedEntry;
  }
  return entries;
}

function inputFormat(raw: RawRecord): LockInputFormat {
  if (raw.schema_version === 1) return "skillsync";
  if (raw.version === 3) return "skills-v3";
  throw new Error("Unsupported lock schema version");
}

function importedGeneratedAt(raw: RawRecord, format: LockInputFormat): string {
  if (typeof raw.generated_at === "string") return raw.generated_at;
  if (format !== "skills-v3") {
    throw new Error("Lock requires generated_at");
  }

  const skills = asRecord(raw.skills, "lock skills");
  const timestamps = Object.values(skills).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const entry = value as RawRecord;
    return [entry.updatedAt, entry.installedAt].filter((item): item is string => typeof item === "string");
  });
  const validTimestamps = timestamps.filter((timestamp) => Number.isFinite(Date.parse(timestamp)));
  const latest = validTimestamps.sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1);
  if (!latest) {
    throw new Error("npx skills v3 lock requires an installedAt or updatedAt timestamp");
  }
  return latest;
}

function externalMetadata(raw: RawRecord, format: LockInputFormat): SkillLock["metadata"] {
  const known = new Set(["schema_version", "generated_at", "skills"]);
  const external = Object.fromEntries(Object.entries(raw).filter(([key]) => !known.has(key)));
  if (format === "skills-v3" || Object.keys(external).length > 0) {
    return { external };
  }
  return undefined;
}

function canonicalTarget(value: string): string {
  return value === "claude" ? "claude-code" : value;
}

function validateTargetProfiles(lock: SkillLock): void {
  for (const [skillName, skill] of Object.entries(lock.skills)) {
    for (const [targetName, target] of Object.entries(skill.targets)) {
      const profileId = target.profile.split("@", 1)[0] ?? "";
      if (canonicalTarget(targetName) !== canonicalTarget(profileId)) {
        throw new Error(
          `Lock profile mismatch for ${skillName}/${targetName}: ${target.profile}`,
        );
      }
    }
  }
}

export function validateLock(lock: unknown): SkillLock {
  const raw = asRecord(lock, "lock");
  const format = inputFormat(raw);
  const metadata = externalMetadata(raw, format);
  const normalized = {
    schema_version: 1 as const,
    generated_at: importedGeneratedAt(raw, format),
    skills: normalizeSkills(raw.skills, format),
    ...(metadata === undefined ? {} : { metadata }),
  };
  const parsed = SkillLockSchema.parse(normalized);
  if (format === "skillsync" && Object.values(parsed.skills).some((skill) => skill.content_digest === undefined)) {
    throw new Error("SkillSync lock entries require content_digest");
  }
  validateTargetProfiles(parsed);
  return parsed;
}
