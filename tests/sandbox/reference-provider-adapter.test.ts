import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  computeEventDigest,
  summarizeRunnerEvents,
} from "../../src/domain/runner-events";
import {
  parseProviderRunRequest,
  type ProviderRunRequest,
} from "../../src/sandbox/runtime-ports";
import {
  createReferenceProviderAdapter,
  parseReferenceProviderEvents,
} from "../../src/sandbox/reference-provider-adapter";

const requestFixturePath = "fixtures/runner/reference-provider-request.json";
const eventsFixturePath = "fixtures/runner/reference-provider-events.jsonl";

async function fixtureRequest(): Promise<ProviderRunRequest> {
  const content = await readFile(requestFixturePath, "utf8");
  const parsed = parseProviderRunRequest(JSON.parse(content) as unknown);
  if (parsed === null) {
    throw new Error("reference provider request fixture must satisfy the normalized provider request contract");
  }
  return parsed;
}

async function fixtureEvents(request: ProviderRunRequest): Promise<string> {
  const content = await readFile(eventsFixturePath, "utf8");
  return content
    .replaceAll("__SKILLSYNC_RUN_ID__", request.runId)
    .replaceAll("__SKILLSYNC_INPUT_DIGEST__", request.inputDigest);
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

describe("reference provider adapter", () => {
  it("replays deterministic skillsync.runner.v1 events with offline evidence", async () => {
    const request = await fixtureRequest();
    const adapter = createReferenceProviderAdapter();

    const first = await adapter.run(request, new AbortController().signal);
    const second = await adapter.run(request, new AbortController().signal);
    const parsedFixture = parseReferenceProviderEvents(await fixtureEvents(request), request);

    expect(first).toEqual(second);
    expect(first.events).toEqual(parsedFixture.events);
    expect(first.events[0]).toMatchObject({
      protocol: "skillsync.runner.v1",
      runId: request.runId,
      type: "run.started",
      payload: { inputDigest: request.inputDigest },
    });
    expect(first.eventDigest).toBe(computeEventDigest(first.events));
    expect(first.redactedEvidenceDigest).toBe(digest(JSON.stringify(summarizeRunnerEvents(first.events))));
    expect(first.evidenceMode).toBe("offline-simulated");
    expect(first.teardown).toEqual({ completed: true, resourceId: request.runId });
  });

  it("rejects output that exceeds the normalized request bound", async () => {
    const request = await fixtureRequest();
    const outputBytes = Buffer.byteLength(await fixtureEvents(request), "utf8");
    const adapter = createReferenceProviderAdapter();

    await expect(adapter.run({ ...request, maxOutputBytes: outputBytes - 1 }, new AbortController().signal))
      .rejects.toMatchObject({ code: "provider.output-too-large" });
  });

  it("returns bounded blocked evidence when cancellation is already requested", async () => {
    const request = await fixtureRequest();
    const controller = new AbortController();
    controller.abort();

    const result = await createReferenceProviderAdapter().run(request, controller.signal);

    expect(result).toMatchObject({
      events: [],
      terminalStatus: "blocked",
      evidenceMode: "offline-simulated",
      teardown: { completed: true, resourceId: request.runId },
    });
    expect(result.eventDigest).toBe(computeEventDigest([]));
  });

  it("stops replay when cancellation arrives between emitted events", async () => {
    const request = await fixtureRequest();
    const controller = new AbortController();
    const running = createReferenceProviderAdapter().run(request, controller.signal);
    controller.abort();

    const result = await running;

    expect(result.terminalStatus).toBe("blocked");
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.length).toBeLessThan(8);
    expect(result.teardown).toEqual({ completed: true, resourceId: request.runId });
  });

  it("rejects malformed fixture events through the Runner parser", async () => {
    const request = await fixtureRequest();
    const malformed = (await fixtureEvents(request)).replace('"type":"run.finished"', '"type":"unknown"');

    expect(() => parseReferenceProviderEvents(malformed, request))
      .toThrow(/provider\.event-invalid/);
  });

  it("binds replay identity and digests to the normalized request", async () => {
    const request = await fixtureRequest();
    const adapter = createReferenceProviderAdapter();

    for (const field of ["skillDigest", "policyDigest", "imageDigest"] as const) {
      const changed = {
        ...request,
        [field]: `sha256:${"f".repeat(64)}`,
      };

      await expect(adapter.run(changed, new AbortController().signal))
        .rejects.toMatchObject({ code: "provider.digest-mismatch" });
    }

    const changedInput = { ...request, inputDigest: `sha256:${"f".repeat(64)}` };
    const result = await adapter.run(changedInput, new AbortController().signal);
    expect(result.events[0]).toMatchObject({
      runId: changedInput.runId,
      payload: { inputDigest: changedInput.inputDigest },
    });
  });

  it("rejects a request carrying a credential value", async () => {
    const request = await fixtureRequest();
    const invalid = {
      ...request,
      credentialContract: {
        ...request.credentialContract,
        credentials: [{
          name: "REFERENCE_TOKEN",
          reference: "secret://provider/reference-token",
          scopes: ["inference"],
          maxTtlSeconds: 900,
          revocation: "required" as const,
          value: "not-a-real-secret",
        }],
      },
    };

    await expect(createReferenceProviderAdapter().run(
      invalid as unknown as ProviderRunRequest,
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "provider.request-invalid" });
  });
});
