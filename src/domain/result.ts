import { z } from "zod";

const FindingLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const FindingSchema = z
  .object({
    level: FindingLevelSchema,
    severity: z.enum(["info", "warn", "error", "critical"]),
    status: z.enum(["pass", "warn", "fail", "unknown"]),
    code: z.string().min(1),
    skill: z.string().min(1),
    target: z.string().min(1).optional(),
    message: z.string().min(1),
    evidence: z.array(z.record(z.string(), z.string())),
    remediation: z.string().min(1).optional(),
  })
  .strict();

export type Finding = z.infer<typeof FindingSchema>;
