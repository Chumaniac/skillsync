import { z } from "zod";

export const SupportStatusSchema = z.enum([
  "supported",
  "unsupported",
  "ignored",
  "runtime-dependent",
  "unknown",
]);

export const SemanticStatusSchema = z.enum(["pass", "warn", "fail", "unknown"]);

export const CapabilityProfileSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    version: z.number().int().positive(),
    docsUrl: z.string().url().startsWith("https://"),
    projectPath: z.string().min(1),
    userPath: z.string().min(1),
    features: z.record(z.string(), SupportStatusSchema),
    semantics: z.record(z.string(), SemanticStatusSchema),
  })
  .strict();

export const CapabilityProfileDocumentSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    version: z.number().int().positive(),
    docsUrl: z.string().url().startsWith("https://"),
    skill_path: z
      .object({
        project: z.string().min(1),
        user: z.string().min(1),
      })
      .strict(),
    features: z.record(z.string(), SupportStatusSchema),
    semantics: z.record(z.string(), SemanticStatusSchema),
  })
  .strict();

export type SupportStatus = z.infer<typeof SupportStatusSchema>;
export type SemanticStatus = z.infer<typeof SemanticStatusSchema>;
export type CapabilityProfile = z.infer<typeof CapabilityProfileSchema>;

export function parseCapabilityProfile(value: unknown): CapabilityProfile {
  const document = CapabilityProfileDocumentSchema.parse(value);
  return CapabilityProfileSchema.parse({
    id: document.id,
    version: document.version,
    docsUrl: document.docsUrl,
    projectPath: document.skill_path.project,
    userPath: document.skill_path.user,
    features: document.features,
    semantics: document.semantics,
  });
}
