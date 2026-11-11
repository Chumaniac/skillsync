import { parse } from "yaml";

export type ParsedSkillDocument = {
  frontmatter: Record<string, unknown>;
  body: string;
  sourceRange: { start: number; end: number };
};

export type ParseSkillDocumentResult =
  | { ok: true; value: ParsedSkillDocument }
  | { ok: false; error: string };

function parserError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0] ?? "Unknown YAML parse error";
}

export function parseSkillDocument(content: string): ParseSkillDocumentResult {
  const opening = /^---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!opening) {
    return {
      ok: false,
      error: "Skill document must start with a YAML frontmatter delimiter.",
    };
  }

  const openingEnd = opening[0].length;
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(content.slice(openingEnd));
  if (!closing) {
    return {
      ok: false,
      error: "Skill frontmatter closing delimiter is missing.",
    };
  }

  const yamlEnd = openingEnd + closing.index;
  const frontmatterText = content.slice(openingEnd, yamlEnd);
  const sourceEnd = yamlEnd + closing[0].length;

  let parsed: unknown;
  try {
    parsed = parse(frontmatterText, { uniqueKeys: true });
  } catch (error: unknown) {
    return {
      ok: false,
      error: `Invalid YAML frontmatter: ${parserError(error)}`,
    };
  }

  if (parsed === null || parsed === undefined) {
    parsed = {};
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "Skill frontmatter must be a YAML mapping.",
    };
  }

  return {
    ok: true,
    value: {
      frontmatter: parsed as Record<string, unknown>,
      body: content.slice(sourceEnd),
      sourceRange: { start: 0, end: sourceEnd },
    },
  };
}
