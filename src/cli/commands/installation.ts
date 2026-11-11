import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { CURRENT_CAPABILITIES, DEFAULT_NPM_VERSION, CHANNEL_OBSERVATION } from "../../capabilities.js";
import { VERSION } from "../../version.js";

export type BuildInfo = { schema: "skillsync.build-info/v1"; version: string; artifactKind: "source-build"; sourceRevision: string | null; dirty: boolean; capabilities: readonly string[] };
export async function readBuildInfo(path: URL = new URL("../../build-info.json", import.meta.url)): Promise<BuildInfo | null> {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.size > 16384) return null;
      const buffer = Buffer.alloc(16385);
      const {bytesRead} = await file.read(buffer,0,buffer.length,0);
      if (bytesRead > 16384 || bytesRead !== before.size) return null;
      const value: unknown = JSON.parse(buffer.subarray(0,bytesRead).toString("utf8"));
      const after = await file.stat();
      if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || typeof value !== "object" || value === null) return null;
      const v = value as Record<string, unknown>;
      if (v.schema !== "skillsync.build-info/v1" || v.version !== VERSION || v.artifactKind !== "source-build" || typeof v.dirty !== "boolean" || !(v.sourceRevision === null || typeof v.sourceRevision === "string" && /^[a-f0-9]{40}$/.test(v.sourceRevision)) || JSON.stringify(v.capabilities) !== JSON.stringify(CURRENT_CAPABILITIES)) return null;
      return {schema:"skillsync.build-info/v1",version:VERSION,artifactKind:"source-build",sourceRevision:v.sourceRevision as string | null,dirty:v.dirty,capabilities:[...CURRENT_CAPABILITIES]};
    } finally { await file.close(); }
  } catch { return null; }
}
export async function installationInfo(expectedSource?: string) {
  if (expectedSource !== undefined && !/^[a-f0-9]{40}$/.test(expectedSource)) throw new Error("Expected source must be a full 40-character lowercase Git commit.");
  const build = await readBuildInfo();
  if (expectedSource !== undefined && (!build || build.dirty || build.sourceRevision !== expectedSource)) throw new Error("Installed source is missing, changed or different; rebuild the selected clean commit before continuing.");
  return {schema:"skillsync.installation-info/v1",version:VERSION,build,identity:build ? "identified-build" : "unconfirmed",declaredCapabilities:[...CURRENT_CAPABILITIES],templateDefault:{source:"npm",packageVersion:DEFAULT_NPM_VERSION,capabilityScope:"published verify/SARIF only; current-source extensions not asserted"},channelObservation:CHANNEL_OBSERVATION,executionAuthority:"not-granted",networkAccess:false};
}
