import { createHash } from "node:crypto";

import { z } from "zod";

import { normalizeSandboxPath } from "./behavior-v2.js";

export const RUNNER_PROTOCOL = "skillsync.runner.v1" as const;

export const RUNNER_EVENT_LIMITS = {
  maxLineBytes: 64 * 1024,
  maxStringBytes: 4_096,
  maxEvents: 10_000,
  maxTotalBytes: 8 * 1024 * 1024,
  maxStderrBytes: 64 * 1024,
} as const;

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const BoundedString = z.string().min(1).max(RUNNER_EVENT_LIMITS.maxStringBytes);
const EnvelopeFields = {
  protocol: z.literal(RUNNER_PROTOCOL),
  runId: BoundedString,
  seq: z.number().int().nonnegative(),
  atMs: z.number().finite().nonnegative(),
};

const RunnerStartedSchema = z
  .object({
    ...EnvelopeFields,
    type: z.literal("run.started"),
    payload: z
      .object({
        agent: BoundedString,
        skillPath: BoundedString,
        inputDigest: DigestSchema,
      })
      .strict(),
  })
  .strict();

const ToolCallPayloadSchema = z.discriminatedUnion("operation", [
  z
    .object({
      tool: BoundedString,
      operation: z.literal("start"),
      callId: BoundedString,
    })
    .strict(),
  z
    .object({
      tool: BoundedString,
      operation: z.literal("finish"),
      callId: BoundedString,
      result: z.enum(["ok", "error", "blocked"]),
    })
    .strict(),
]);

const ToolCallSchema = z
  .object({
    ...EnvelopeFields,
    type: z.literal("tool.call"),
    payload: ToolCallPayloadSchema,
  })
  .strict();

const FsReadSchema = z
  .object({
    ...EnvelopeFields,
    type: z.literal("fs.read"),
    payload: z
      .object({
        path: BoundedString,
        bytes: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

const FsWriteSchema = z
  .object({
    ...EnvelopeFields,
    type: z.literal("fs.write"),
    payload: z
      .object({
        path: BoundedString,
        bytes: z.number().int().nonnegative(),
        digest: DigestSchema,
      })
      .strict(),
  })
  .strict();

const NetworkRequestSchema = z
  .object({
    ...EnvelopeFields,
    type: z.literal("network.request"),
    payload: z
      .object({
        host: z.string().min(1).max(253).regex(/^[A-Za-z0-9._:-]+$/),
        port: z.number().int().min(1).max(65_535),
        protocol: z.enum(["http", "https", "dns"]),
        decision: z.enum(["allowed", "blocked"]),
      })
      .strict(),
  })
  .strict();

const ProcessSpawnSchema = z
  .object({
    ...EnvelopeFields,
    type: z.literal("process.spawn"),
    payload: z
      .object({
        executable: BoundedString,
        argv: z.array(z.string().max(RUNNER_EVENT_LIMITS.maxStringBytes)).max(128),
        decision: z.enum(["allowed", "blocked"]),
      })
      .strict(),
  })
  .strict();

const RunFinishedSchema = z
  .object({
    ...EnvelopeFields,
    type: z.literal("run.finished"),
    payload: z
      .object({
        status: z.enum(["passed", "failed", "blocked"]),
        exitCode: z.number().int(),
      })
      .strict(),
  })
  .strict();

export const RunnerEventSchema = z.discriminatedUnion("type", [
  RunnerStartedSchema,
  ToolCallSchema,
  FsReadSchema,
  FsWriteSchema,
  NetworkRequestSchema,
  ProcessSpawnSchema,
  RunFinishedSchema,
]);

export type RunnerEvent = z.infer<typeof RunnerEventSchema>;
export type RunnerEventType = RunnerEvent["type"];

export type RunnerProtocolCode = "runner.protocol-invalid" | "runner.event-too-large";

export class RunnerProtocolError extends Error {
  readonly code: RunnerProtocolCode;

  constructor(code: RunnerProtocolCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "RunnerProtocolError";
    this.code = code;
  }
}

export type TraceValidationResult = {
  events: RunnerEvent[];
  eventDigest: string;
  protocolComplete: true;
  terminalStatus: "passed" | "failed" | "blocked";
  terminalExitCode: number;
};

export type RunnerEvidence = {
  eventCount: number;
  redacted: boolean;
  writes: Array<{ path: string; bytes: number; digest: string }>;
  tools: string[];
  network: Array<{ host: string; port: number; decision: string }>;
};

function protocolError(message: string): RunnerProtocolError {
  return new RunnerProtocolError("runner.protocol-invalid", message);
}

function eventTooLarge(message: string): RunnerProtocolError {
  return new RunnerProtocolError("runner.event-too-large", message);
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0] ?? "Invalid event";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function computeEventDigest(events: readonly RunnerEvent[]): string {
  const canonical = events.map((event) => stableValue(event));
  const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return `sha256:${digest}`;
}

function normalizeEvent(event: RunnerEvent): RunnerEvent {
  if (event.type === "run.started") {
    return {
      ...event,
      payload: {
        ...event.payload,
        skillPath: normalizeSandboxPath(event.payload.skillPath, "run.started.skillPath", "workspace"),
      },
    };
  }
  if (event.type === "fs.read" || event.type === "fs.write") {
    return {
      ...event,
      payload: {
        ...event.payload,
        path: normalizeSandboxPath(event.payload.path, `${event.type}.path`, "workspace"),
      },
    } as RunnerEvent;
  }
  if (event.type === "network.request") {
    return {
      ...event,
      payload: { ...event.payload, host: event.payload.host.toLowerCase() },
    };
  }
  return event;
}

function parseEvent(line: string, lineNumber: number): RunnerEvent {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch (error: unknown) {
    throw protocolError(`Invalid JSON at line ${lineNumber}: ${firstLine(error)}`);
  }

  const result = RunnerEventSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw protocolError(`Invalid Runner event at line ${lineNumber}: ${issue?.message ?? "schema validation failed"}`);
  }
  try {
    return normalizeEvent(result.data);
  } catch (error: unknown) {
    throw protocolError(`Invalid Runner path at line ${lineNumber}: ${firstLine(error)}`);
  }
}

export function parseRunnerTrace(
  content: string,
  input: { runId: string; inputDigest: string },
): TraceValidationResult {
  const totalBytes = Buffer.byteLength(content, "utf8");
  if (totalBytes > RUNNER_EVENT_LIMITS.maxTotalBytes) {
    throw eventTooLarge(`Runner event stream exceeds ${RUNNER_EVENT_LIMITS.maxTotalBytes} bytes`);
  }

  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  if (lines.length === 0) {
    throw protocolError("Runner event stream is empty");
  }
  if (lines.length > RUNNER_EVENT_LIMITS.maxEvents) {
    throw eventTooLarge(`Runner event stream exceeds ${RUNNER_EVENT_LIMITS.maxEvents} events`);
  }

  const events: RunnerEvent[] = [];
  const openCalls = new Map<string, string>();
  let previousAtMs = -1;
  let finished = false;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (Buffer.byteLength(line, "utf8") > RUNNER_EVENT_LIMITS.maxLineBytes) {
      throw eventTooLarge(`Runner event line ${lineNumber} exceeds ${RUNNER_EVENT_LIMITS.maxLineBytes} bytes`);
    }
    if (line.trim() === "") {
      throw protocolError(`Runner event line ${lineNumber} is empty`);
    }

    const event = parseEvent(line, lineNumber);
    if (event.runId !== input.runId) {
      throw protocolError(`Runner event line ${lineNumber} has an unexpected runId`);
    }
    if (event.seq !== events.length) {
      throw protocolError(`Runner event line ${lineNumber} has a non-contiguous seq`);
    }
    if (event.atMs < previousAtMs) {
      throw protocolError(`Runner event line ${lineNumber} moves atMs backwards`);
    }
    if (finished) {
      throw protocolError(`Runner emitted an event after run.finished at line ${lineNumber}`);
    }
    if (events.length === 0 && event.type !== "run.started") {
      throw protocolError("Runner event stream must begin with run.started");
    }
    if (event.type === "run.started") {
      if (events.length !== 0) {
        throw protocolError("Runner emitted duplicate run.started");
      }
      if (event.payload.inputDigest !== input.inputDigest) {
        throw protocolError("run.started inputDigest does not match the staged input");
      }
    }

    if (event.type === "tool.call") {
      if (event.payload.operation === "start") {
        if (openCalls.has(event.payload.callId)) {
          throw protocolError(`Tool call is started twice: ${event.payload.callId}`);
        }
        openCalls.set(event.payload.callId, event.payload.tool);
      } else {
        const startedTool = openCalls.get(event.payload.callId);
        if (!startedTool || startedTool !== event.payload.tool) {
          throw protocolError(`Tool call finish has no matching start: ${event.payload.callId}`);
        }
        openCalls.delete(event.payload.callId);
      }
    }

    if (event.type === "run.finished") {
      if (openCalls.size > 0) {
        throw protocolError("Runner finished with open tool calls");
      }
      finished = true;
    }

    events.push(event);
    previousAtMs = event.atMs;
  });

  const terminal = events.at(-1);
  if (!terminal || terminal.type !== "run.finished" || !finished) {
    throw protocolError("Runner event stream must end with run.finished");
  }

  return {
    events,
    eventDigest: computeEventDigest(events),
    protocolComplete: true,
    terminalStatus: terminal.payload.status,
    terminalExitCode: terminal.payload.exitCode,
  };
}

export function redactSensitiveValue(value: string): string {
  if (
    /authorization\s*[:=]\s*bearer/i.test(value) ||
    /cookie\s*[:=]/i.test(value) ||
    /(?:password|passwd|secret|token)\s*[:=]/i.test(value)
  ) {
    return "[REDACTED]";
  }
  return value;
}

export function summarizeRunnerEvents(events: readonly RunnerEvent[]): RunnerEvidence {
  const writes = events.flatMap((event) =>
    event.type === "fs.write"
      ? [{ path: event.payload.path, bytes: event.payload.bytes, digest: event.payload.digest }]
      : [],
  );
  const tools = [...new Set(
    events
      .filter((event): event is Extract<RunnerEvent, { type: "tool.call" }> => event.type === "tool.call")
      .map((event) => redactSensitiveValue(event.payload.tool)),
  )].sort();
  const network = events.flatMap((event) =>
    event.type === "network.request"
      ? [{ host: redactSensitiveValue(event.payload.host), port: event.payload.port, decision: event.payload.decision }]
      : [],
  );

  return {
    eventCount: events.length,
    redacted: true,
    writes,
    tools,
    network,
  };
}
