import { describe, expect, it } from "vitest";

import {
  normalizeRuntimeEvidenceMode,
  parseRuntimeEvidenceMode,
} from "../../src/sandbox/runtime-evidence";

describe("runtime evidence mode", () => {
  it("normalizes each runtime family to a distinct canonical evidence mode", () => {
    expect(normalizeRuntimeEvidenceMode("offline-simulated")).toBe("offline-simulated");
    expect(normalizeRuntimeEvidenceMode("replay")).toBe("offline-simulated");
    expect(normalizeRuntimeEvidenceMode("local-docker")).toBe("local-docker");
    expect(normalizeRuntimeEvidenceMode("docker")).toBe("local-docker");
    expect(normalizeRuntimeEvidenceMode("controlled-microvm")).toBe("controlled-microvm");
    expect(normalizeRuntimeEvidenceMode("microvm")).toBe("controlled-microvm");
    expect(normalizeRuntimeEvidenceMode("remote-worker")).toBe("remote-worker");
    expect(normalizeRuntimeEvidenceMode("worker")).toBe("remote-worker");
  });

  it("rejects unknown evidence modes instead of conflating them", () => {
    expect(parseRuntimeEvidenceMode("unknown-runtime")).toBeNull();
    expect(normalizeRuntimeEvidenceMode("remote docker")).toBeNull();
    expect(normalizeRuntimeEvidenceMode({ mode: "docker" })).toBeNull();
  });
});
