import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";

import { parseCapabilityProfile, type CapabilityProfile } from "./types.js";

export const PROFILE_IDS = ["codex", "claude-code", "cursor"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

const PROFILE_URLS: Record<ProfileId, URL> = {
  codex: new URL("../../profiles/codex.v1.yaml", import.meta.url),
  "claude-code": new URL("../../profiles/claude-code.v1.yaml", import.meta.url),
  cursor: new URL("../../profiles/cursor.v1.yaml", import.meta.url),
};

export function normalizeProfileId(value: string): ProfileId {
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude") {
    return "claude-code";
  }
  if ((PROFILE_IDS as readonly string[]).includes(normalized)) {
    return normalized as ProfileId;
  }
  throw new Error(`Unknown capability profile: ${value}`);
}

export async function loadCapabilityProfile(value: string): Promise<CapabilityProfile> {
  const id = normalizeProfileId(value);
  const document = await readFile(PROFILE_URLS[id], "utf8");
  return parseCapabilityProfile(parseYaml(document, { uniqueKeys: true }));
}

export async function loadCapabilityProfiles(values: string[] = [...PROFILE_IDS]): Promise<CapabilityProfile[]> {
  const ids = values.flatMap((value) => value.split(",")).map(normalizeProfileId);
  return Promise.all(ids.map((id) => loadCapabilityProfile(id)));
}
