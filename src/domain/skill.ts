import { z } from "zod";

export const SkillSourceSchema = z
  .object({
    kind: z.enum(["git", "local", "unknown"]),
    url: z.string().optional(),
    ref: z.string().optional(),
    resolvedCommit: z.string().optional(),
  })
  .strict();

export const SkillFileSchema = z
  .object({
    relativePath: z.string().min(1),
    content: z.instanceof(Buffer),
    mode: z.number().int().nonnegative(),
    isSymlink: z.boolean(),
  })
  .strict();

export const SkillSchema = z
  .object({
    name: z.string().min(1),
    rootPath: z.string().min(1),
    skillMdPath: z.string().min(1),
    frontmatter: z.record(z.string(), z.unknown()),
    files: z.array(SkillFileSchema),
    source: SkillSourceSchema,
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict();

export type SkillSource = z.infer<typeof SkillSourceSchema>;
export type SkillFile = z.infer<typeof SkillFileSchema>;
export type Skill = z.infer<typeof SkillSchema>;
