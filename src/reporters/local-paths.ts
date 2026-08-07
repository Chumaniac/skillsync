export type ReportRedactionOptions = {
  includeLocalPaths?: boolean;
};

export const REDACTED_LOCAL_PATH = "<local-path>";

const ABSOLUTE_PATH_IN_TEXT = /(^|[\s"'`([{=:])((?:file:\/\/|\/(?!\/)|[A-Za-z]:[\\/]|\\\\)[^\s"'`<>)\]},;]*)/g;

function normalizedKey(key: string | undefined): string | undefined {
  return key?.toLowerCase().replaceAll("_", "");
}

function isPathLikeKey(key: string | undefined): boolean {
  const normalized = normalizedKey(key);
  return normalized === "path" ||
    normalized?.endsWith("path") === true ||
    normalized === "location" ||
    normalized === "file" ||
    normalized === "directory" ||
    normalized === "root";
}

export function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith("file://") ||
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(value);
}

export function isRedactedLocalPath(value: string): boolean {
  return value === REDACTED_LOCAL_PATH;
}

export function redactLocalPathText(value: string): string {
  return value.replace(ABSOLUTE_PATH_IN_TEXT, (_match, boundary: string) => `${boundary}${REDACTED_LOCAL_PATH}`);
}

function redactValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (isPathLikeKey(key) && isAbsoluteLocalPath(value)) {
      return REDACTED_LOCAL_PATH;
    }
    return redactLocalPathText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([objectKey, item]) => [
        objectKey,
        redactValue(item, objectKey),
      ]),
    );
  }

  return value;
}

export function redactLocalPaths<T>(value: T, options: ReportRedactionOptions = {}): T {
  if (options.includeLocalPaths === true) return value;
  return redactValue(value) as T;
}
