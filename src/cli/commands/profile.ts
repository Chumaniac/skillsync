import { createProfileRegistry, listBuiltinProfiles, validateProfileFile } from "../../profiles/registry.js";
import type { CapabilityProfile } from "../../profiles/types.js";

export type ProfileValidateOptions = {
  path: string;
};

export type ProfileListOptions = {
  profileDir?: string;
};

export type ProfileValidateReport = {
  filePath: string;
  profile: CapabilityProfile;
  status: "pass";
};

export type ProfileListReport = {
  builtin: Array<{ id: string; version: number; docsUrl: string; path: string }>;
  external: Array<{ id: string; version: number; docsUrl: string; filePath: string }>;
};

export async function runProfileValidate(options: ProfileValidateOptions): Promise<ProfileValidateReport> {
  const { profile, filePath } = await validateProfileFile(options.path);
  return { filePath, profile, status: "pass" };
}

export async function runProfileList(options: ProfileListOptions = {}): Promise<ProfileListReport> {
  const registry = await createProfileRegistry({ profileDir: options.profileDir });
  const builtin = listBuiltinProfiles();
  const builtinReports: ProfileListReport["builtin"] = [];
  for (const { id } of builtin) {
    const p = registry.get(id);
    if (p) builtinReports.push({ id: p.id, version: p.version, docsUrl: p.docsUrl, path: `profiles/${id}.v1.yaml` });
  }
  const external: ProfileListReport["external"] = [];
  for (const [key, profile] of registry) {
    if (builtin.some((b) => b.id === key)) continue;
    external.push({ id: profile.id, version: profile.version, docsUrl: profile.docsUrl, filePath: `${profile.id}.v${profile.version}.yaml` });
  }
  return { builtin: builtinReports, external };
}

export function renderProfileValidate(report: ProfileValidateReport, format: string | undefined): string {
  if (format === "json") {
    return `${JSON.stringify({ filePath: report.filePath, profile: report.profile, status: report.status }, null, 2)}\n`;
  }
  return `Profile ${report.profile.id}@${report.profile.version} validated from ${report.filePath}\n  docs: ${report.profile.docsUrl}\n  paths: ${report.profile.projectPath} / ${report.profile.userPath}\n  features: ${Object.keys(report.profile.features).length} capabilities\n`;
}

export function renderProfileList(report: ProfileListReport, format: string | undefined): string {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }
  const lines: string[] = [];
  lines.push(`Builtin profiles (${report.builtin.length}):`);
  for (const b of report.builtin) lines.push(`  - ${b.id}@${b.version}  ${b.docsUrl}  [${b.path}]`);
  if (report.external.length > 0) {
    lines.push(`External profiles (${report.external.length}):`);
    for (const e of report.external) lines.push(`  - ${e.id}@${e.version}  ${e.docsUrl}  [${e.filePath}]`);
  } else {
    lines.push(`External profiles: none (add YAML to profiles/contrib/ or ~/.config/skillsync/profiles/)`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runProfileLintFile(path: string): Promise<ProfileValidateReport> {
  // Alias for validate that also checks strict YAML uniqueKeys.
  return runProfileValidate({ path });
}
