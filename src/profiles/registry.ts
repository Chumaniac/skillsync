import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

import { parse as parseYaml } from "yaml";

import { readDirectoryEntries, readWorkspaceText } from "../sandbox/workspace-tree.js";

import { parseCapabilityProfile, type CapabilityProfile } from "./types.js";
import { PROFILE_IDS, type ProfileId, loadCapabilityProfile, normalizeProfileId } from "./loader.js";

class ProfileInputError extends Error {
  readonly exitCode = 2;
}

export const BUILTIN_PROFILE_IDS = [...PROFILE_IDS] as const;

export type RegistryLoadOptions = {
  targets?: string[];
  profileDir?: string;
  contribDir?: string;
};

export type ProfileRegistry = Map<string, CapabilityProfile>;

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const st = await stat(path);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function loadExternalProfileFile(filePath: string): Promise<CapabilityProfile> {
  const content = await readWorkspaceText(filePath, 1024 * 1024);
  const doc = parseYaml(content, { uniqueKeys: true, maxAliasCount: 100, prettyErrors: false, logLevel: "silent" });
  const profile = parseCapabilityProfile(doc);
  return profile;
}

async function discoverInDir(dir: string, registry: ProfileRegistry, explicit = false): Promise<void> {
  if (!(await isDirectory(dir))) {
    if (explicit) throw new ProfileInputError("profile.invalid-input: explicit profile directory is unavailable");
    return;
  }
  let entries;
  try { entries = await readDirectoryEntries(dir, 1000); }
  catch { throw new ProfileInputError("profile.invalid-input: profile directory is unreadable or exceeds 1000 entries"); }
  let count = 0;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;
    if (++count > 64) throw new ProfileInputError("profile.invalid-input: profile directory exceeds 64 profiles");
    try {
      if (!entry.isFile()) throw new Error("profile must be a regular file");
      const profile = await loadExternalProfileFile(join(dir, entry.name));
      registry.set(normalizeId(profile.id), profile);
    } catch {
      if (explicit) throw new ProfileInputError("profile.invalid-input: explicit profile must be valid YAML within 1 MiB");
      // Optional ambient profiles stay best-effort; explicit inputs fail closed.
    }
  }
}

async function defaultContribDir(): Promise<string | undefined> {
  try {
    const url = new URL("../../profiles/contrib", import.meta.url);
    // import.meta.url is file://.../dist/profiles/registry.js -> ../../profiles/contrib
    // Resolve to filesystem path.
    const path = resolve(decodeURIComponent(url.pathname));
    if (await isDirectory(path)) return path;
  } catch {
    // defaultContribDir resolution may fail on non-file URLs; ignore
  }
  return undefined;
}

function userProfileDir(): string | undefined {
  try {
    const home = homedir();
    if (!home) return undefined;
    return join(home, ".config", "skillsync", "profiles");
  } catch {
    // homedir may throw on unusual platforms; no user dir then
    return undefined;
  }
}

export async function createProfileRegistry(options: RegistryLoadOptions = {}): Promise<ProfileRegistry> {
  const registry: ProfileRegistry = new Map();

  // Load builtins first.
  for (const id of BUILTIN_PROFILE_IDS) {
    try {
      const profile = await loadCapabilityProfile(id);
      registry.set(normalizeId(profile.id), profile);
    } catch {
      // builtin load should not fail; if it does, skip gracefully
    }
  }

  const dirs: string[] = [];
  if (options.contribDir) dirs.push(resolve(options.contribDir));
  else {
    const contrib = await defaultContribDir();
    if (contrib) dirs.push(contrib);
  }

  const userDir = userProfileDir();
  if (userDir) dirs.push(userDir);

  if (options.profileDir) dirs.push(resolve(options.profileDir));

  for (const dir of dirs) {
    await discoverInDir(dir, registry, dir === (options.profileDir ? resolve(options.profileDir) : undefined));
  }

  if (options.targets && options.targets.length > 0) {
    // Ensure explicitly requested targets are loaded if they are builtin but were shadowed.
    for (const raw of options.targets.flatMap((v) => v.split(","))) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const normalized = normalizeId(trimmed);
      if (registry.has(normalized)) continue;
      // Try builtin fallback for known aliases (e.g., claude -> claude-code)
      try {
        const builtinId = normalizeProfileId(trimmed);
        const profile = await loadCapabilityProfile(builtinId);
        registry.set(normalizeId(profile.id), profile);
      } catch {
        // Unknown target remains unknown; caller will handle via `unknown` status.
      }
    }
  }

  return registry;
}

export async function loadProfilesForTargets(
  targetIds: string[],
  options: Omit<RegistryLoadOptions, "targets"> = {},
): Promise<CapabilityProfile[]> {
  const registry = await createProfileRegistry({ ...options, targets: targetIds });
  const requested = targetIds.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  const ids = requested.length > 0 ? requested : [...BUILTIN_PROFILE_IDS];
  if (ids.length > 64) throw new ProfileInputError("profile.invalid-input: at most 64 targets are supported");
  const profiles: CapabilityProfile[] = [];
  for (const raw of ids) {
    const key = normalizeId(raw);
    // Support alias normalization for builtin check.
    let profile = registry.get(key);
    if (!profile) {
      try {
        const normalized = normalizeProfileId(raw);
        profile = registry.get(normalizeId(normalized));
      } catch {
        // alias normalization failed; remains unknown
      }
    }
    if (profile) profiles.push(profile);
    else {
      throw new ProfileInputError("profile.unknown-target: requested target has no valid capability profile");
    }
  }
  return profiles;
}

export async function validateProfileFile(filePath: string): Promise<{ profile: CapabilityProfile; filePath: string }> {
  const resolved = resolve(filePath);
  const profile = await loadExternalProfileFile(resolved);
  return { profile, filePath: resolved };
}

export function listBuiltinProfiles(): Array<{ id: ProfileId; path: string }> {
  return [...BUILTIN_PROFILE_IDS].map((id) => ({ id: id as ProfileId, path: `profiles/${id}.v1.yaml` }));
}
