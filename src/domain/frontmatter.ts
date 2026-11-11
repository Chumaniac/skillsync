import { parse, YAMLParseError } from "yaml";

export type ParsedSkillDocument = {
  frontmatter: Record<string, unknown>;
  body: string;
  sourceRange: { start: number; end: number };
};

type DocumentLocation = { start: number; end: number; line: number; column: number };
type DocumentFailure = { ok: false; error: string; location?: DocumentLocation };

function documentLocation(text: string, start: number, end = start): DocumentLocation {
  const lines = text.slice(0, start).split("\n");
  return {start, end, line: lines.length, column: Array.from(lines[lines.length - 1] ?? "").length + 1};
}

export function describeDocumentError(failure: DocumentFailure): string {
  const at = failure.location;
  return at ? failure.error + " (line " + at.line + ", column " + at.column + ")" : failure.error;
}

export type ParseSkillDocumentResult =
  | { ok: true; value: ParsedSkillDocument }
  | DocumentFailure;

function parserError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0] ?? "Unknown YAML parse error";
}

export function parseSkillDocument(content: string): ParseSkillDocumentResult {
  const opening = /^---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!opening) {
    return {
      ok: false,
      location: documentLocation(content, 0),
      error: "Skill document must start with a YAML frontmatter delimiter.",
    };
  }

  const openingEnd = opening[0].length;
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(content.slice(openingEnd));
  if (!closing) {
    return {
      ok: false,
      location: documentLocation(content, content.length),
      error: "Skill frontmatter closing delimiter is missing.",
    };
  }

  const yamlEnd = openingEnd + closing.index;
  const frontmatterText = content.slice(openingEnd, yamlEnd);
  const sourceEnd = yamlEnd + closing[0].length;

  let parsed: unknown;
  try {
    parsed = parse(frontmatterText, { uniqueKeys: true, prettyErrors: false });
  } catch (error: unknown) {
    const location = error instanceof YAMLParseError
      ? documentLocation(content, Math.min(yamlEnd, openingEnd + error.pos[0]), Math.min(yamlEnd, openingEnd + error.pos[1]))
      : undefined;
    return {
      ...(location && { location }),
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
      location: documentLocation(content, openingEnd, yamlEnd),
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
