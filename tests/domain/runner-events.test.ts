import { describe, expect, it } from "vitest";

import {
  computeEventDigest,
  parseRunnerTrace,
  redactSensitiveValue,
  summarizeRunnerEvents,
} from "../../src/domain/runner-events";

const runId = "run-1";
const inputDigest = "sha256:" + "a".repeat(64);
const outputDigest = "sha256:" + "b".repeat(64);

function validEvents(): Array<Record<string, unknown>> {
  return [
    {
      protocol: "skillsync.runner.v1",
      runId,
      seq: 0,
      atMs: 0,
      type: "run.started",
      payload: { agent: "codex", skillPath: "skill", inputDigest },
    },
    {
      protocol: "skillsync.runner.v1",
      runId,
      seq: 1,
      atMs: 1,
      type: "tool.call",
      payload: { tool: "fs.read", operation: "start", callId: "call-read" },
    },
    {
      protocol: "skillsync.runner.v1",
      runId,
      seq: 2,
      atMs: 2,
      type: "fs.read",
      payload: { path: "workspace/input.md", bytes: 4 },
    },
    {
      protocol: "skillsync.runner.v1",
      runId,
      seq: 3,
      atMs: 3,
      type: "tool.call",
      payload: { tool: "fs.read", operation: "finish", callId: "call-read", result: "ok" },
    },
    {
      protocol: "skillsync.runner.v1",
      runId,
      seq: 4,
      atMs: 4,
      type: "tool.call",
      payload: { tool: "fs.write", operation: "start", callId: "call-write" },
    },
    {
      protocol: "skillsync.runner.v1",
      runId,
      seq: 5,
      atMs: 5,
      type: "fs.write",
      payload: { path: "workspace/review.md", bytes: 12, digest: outputDigest },
    },
    {
      protocol: "skillsync.runner.v1",
      runId,
      seq: 6,
      atMs: 6,
      type: "tool.call",
      payload: { tool: "fs.write", operation: "finish", callId: "call-write", result: "ok" },
    },
    {
      protocol: "skillsync.runner.v1",
      runId,
      seq: 7,
      atMs: 7,
      type: "run.finished",
      payload: { status: "passed", exitCode: 0 },
    },
  ];
}

function trace(events: Array<Record<string, unknown>>): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function parseValid(events = validEvents()) {
  return parseRunnerTrace(trace(events), { runId, inputDigest });
}

describe("Runner JSONL protocol", () => {
  it("accepts a complete trace with contiguous sequence numbers", () => {
    const result = parseValid();

    expect(result.events.at(0)?.type).toBe("run.started");
    expect(result.events.at(-1)?.type).toBe("run.finished");
    expect(result.terminalExitCode).toBe(0);
    expect(result.eventDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it.each([
    ["malformed JSON", "{"],
    ["wrong protocol", trace(validEvents()).replace("skillsync.runner.v1", "other.protocol")],
    ["run id mismatch", trace(validEvents()).replaceAll('"runId":"run-1"', '"runId":"run-2"')],
    ["sequence gap", trace(validEvents()).replace('"seq":2', '"seq":9')],
    ["decreasing atMs", trace(validEvents()).replace('"atMs":6', '"atMs":2')],
    ["event after run.finished", trace([...validEvents(), { ...validEvents()[0], seq: 8, atMs: 8 }])],
    ["missing run.finished", trace(validEvents().slice(0, -1))],
    ["duplicate terminal event", trace([...validEvents(), { ...validEvents().at(-1), seq: 8, atMs: 8 }])],
    [
      "unpaired tool call",
      trace(validEvents().filter((event) => {
        const payload = event.payload as { callId?: string; operation?: string };
        return !(payload.callId === "call-write" && payload.operation === "finish");
      })),
    ],
    [
      "unknown payload key",
      trace(validEvents().map((event, index) =>
        index === 2
          ? { ...event, payload: { ...(event.payload as object), unexpected: true } }
          : event,
      )),
    ],
  ])("rejects %s", (_label, content) => {
    expect(() => parseRunnerTrace(content, { runId, inputDigest })).toThrow();
  });

  it("rejects an oversized event before retaining it", () => {
    const events = validEvents();
    events[2] = {
      ...events[2],
      payload: { path: `workspace/${"x".repeat(4_097)}`, bytes: 1 },
    };

    expect(() => parseValid(events)).toThrow(/event-too-large|protocol-invalid/);
  });

  it("requires exact tool start and finish payloads", () => {
    const startWithResult = validEvents().map((event, index) =>
      index === 1
        ? { ...event, payload: { ...(event.payload as object), result: "ok" } }
        : event,
    );
    const finishWithoutResult = validEvents().map((event, index) =>
      index === 3
        ? { ...event, payload: { tool: "fs.read", operation: "finish", callId: "call-read" } }
        : event,
    );

    expect(() => parseValid(startWithResult)).toThrow();
    expect(() => parseValid(finishWithoutResult)).toThrow();
  });

  it("rejects filesystem traversal and mismatched input digest", () => {
    const traversal = validEvents().map((event, index) =>
      index === 2
        ? { ...event, payload: { path: "../outside.md", bytes: 1 } }
        : event,
    );
    const wrongDigest = trace(validEvents()).replace(inputDigest, "sha256:" + "c".repeat(64));

    expect(() => parseValid(traversal)).toThrow(/protocol-invalid|workspace|traversal/);
    expect(() => parseRunnerTrace(wrongDigest, { runId, inputDigest })).toThrow();
  });
});

describe("Runner evidence", () => {
  it("summarizes bounded facts and produces a stable digest", () => {
    const first = parseValid();
    const second = parseValid();

    expect(summarizeRunnerEvents(first.events)).toEqual(summarizeRunnerEvents(second.events));
    expect(summarizeRunnerEvents(first.events)).toMatchObject({
      eventCount: 8,
      redacted: true,
      tools: ["fs.read", "fs.write"],
      writes: [{ path: "workspace/review.md", bytes: 12, digest: outputDigest }],
    });
    expect(computeEventDigest(first.events)).toBe(first.eventDigest);
  });

  it("redacts credential-like diagnostic strings", () => {
    expect(redactSensitiveValue("Authorization: Bearer top-secret")).toBe("[REDACTED]");
    expect(redactSensitiveValue("cookie=session=abc")).toBe("[REDACTED]");
    expect(redactSensitiveValue("fs.read")).toBe("fs.read");
  });
});
