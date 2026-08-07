import { z } from "zod";

const RuntimeEvidenceModes = [
  "offline-simulated",
  "local-docker",
  "controlled-microvm",
  "remote-worker",
] as const;

const RuntimeEvidenceModeAliasSchema = z.enum([
  "offline-simulated",
  "replay",
  "simulated",
  "local-docker",
  "docker",
  "controlled-microvm",
  "microvm",
  "remote-worker",
  "worker",
]);

const RuntimeEvidenceModeAliases: Record<z.infer<typeof RuntimeEvidenceModeAliasSchema>, RuntimeEvidenceMode> = {
  "offline-simulated": "offline-simulated",
  replay: "offline-simulated",
  simulated: "offline-simulated",
  "local-docker": "local-docker",
  docker: "local-docker",
  "controlled-microvm": "controlled-microvm",
  microvm: "controlled-microvm",
  "remote-worker": "remote-worker",
  worker: "remote-worker",
};

export const RuntimeEvidenceModeSchema = z.enum(RuntimeEvidenceModes);
export type RuntimeEvidenceMode = z.infer<typeof RuntimeEvidenceModeSchema>;

export function parseRuntimeEvidenceMode(input: unknown): RuntimeEvidenceMode | null {
  const result = RuntimeEvidenceModeSchema.safeParse(input);
  return result.success ? result.data : null;
}

export function normalizeRuntimeEvidenceMode(input: unknown): RuntimeEvidenceMode | null {
  const result = RuntimeEvidenceModeAliasSchema.safeParse(input);
  return result.success ? RuntimeEvidenceModeAliases[result.data] : null;
}
