import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { simulateEgressEvidence } from "../../src/sandbox/egress-simulator";
import { parseProviderRunRequest } from "../../src/sandbox/runtime-ports";
import { runSimulatedRuntime } from "../../src/sandbox/runtime-orchestrator";
import { createReferenceProviderAdapter } from "../../src/sandbox/reference-provider-adapter";

type WorkflowDocument = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function workflowRuns(workflow: WorkflowDocument, jobName: string): string[] {
  const jobs = asRecord(workflow.jobs);
  const job = asRecord(jobs[jobName]);
  const steps = Array.isArray(job.steps) ? job.steps : [];
  return steps.flatMap((step) => {
    const run = asRecord(step).run;
    return typeof run === "string" ? [run] : [];
  });
}

async function readWorkflow(name: string): Promise<{ content: string; document: WorkflowDocument }> {
  const content = await readFile(`.github/workflows/${name}`, "utf8");
  return { content, document: parse<WorkflowDocument>(content) };
}

describe("live runtime preparation", () => {
  it("runs the provider and egress paths as bounded offline simulations", async () => {
    const request = parseProviderRunRequest(JSON.parse(
      await readFile("fixtures/runner/reference-provider-request.json", "utf8"),
    ));
    if (request === null) {
      throw new Error("reference provider request fixture did not validate");
    }

    const result = await runSimulatedRuntime(
      { providerRequest: request, activationInput: {} },
      {
        simulatedProvider: createReferenceProviderAdapter(),
        liveProvider: {
          async run() {
            throw new Error("live provider must not be selected by the preparation test");
          },
        },
      },
    );
    const egressEvidence = simulateEgressEvidence({
      requestId: "preparation",
      host: "reference.example.test",
      port: 443,
      protocol: "https",
    }, "allowed");

    expect(result).toMatchObject({
      terminalStatus: "passed",
      evidenceMode: "offline-simulated",
    });
    expect(egressEvidence.evidenceMode).toBe("offline-simulated");
  });

  it("runs every offline simulator contract in the manual canary", async () => {
    const { content, document } = await readWorkflow("skillsync-runtime-canary.yml");
    const runs = workflowRuns(document, "contract-preflight").join("\n");
    const requiredContracts = [
      "tests/sandbox/runtime-ports.test.ts",
      "tests/sandbox/runtime-evidence.test.ts",
      "tests/sandbox/reference-provider-adapter.test.ts",
      "tests/sandbox/egress-simulator.test.ts",
      "tests/sandbox/microvm-contract.test.ts",
      "tests/sandbox/remote-worker-port.test.ts",
      "tests/sandbox/runtime-orchestrator.test.ts",
      "tests/integration/live-runtime-preparation.test.ts",
    ];

    for (const contract of requiredContracts) {
      expect(runs).toContain(contract);
    }

    const dispatch = asRecord(asRecord(document.on).workflow_dispatch);
    const inputs = asRecord(dispatch.inputs);
    const liveInput = asRecord(inputs.enable_live_capabilities);
    expect(liveInput.default).toBe(false);
    expect(content).toContain('if [ "$ENABLE_LIVE_CAPABILITIES" != "false" ]');
    expect(content).not.toMatch(/docker\.sock|secrets\.|npm publish|NODE_AUTH_TOKEN/i);
  });

  it("keeps the default CI path aware of preparation and package checks", async () => {
    const { content } = await readWorkflow("skillsync.yml");

    expect(content).toContain("tests/integration/live-runtime-preparation.test.ts");
    expect(content).toContain("npm pack --dry-run");
    expect(content).not.toMatch(/npm publish|NODE_AUTH_TOKEN|secrets\.|docker\.sock/i);
  });

  it("keeps release validation tag-based and publication-free", async () => {
    const { content, document } = await readWorkflow("release.yml");
    const trigger = asRecord(document.on);
    const push = asRecord(trigger.push);
    const jobs = asRecord(document.jobs);

    expect(push.tags).toEqual(["v*"]);
    expect(Object.keys(jobs)).toEqual(["validate"]);

    const runs = workflowRuns(document, "validate").join("\n");
    for (const command of [
      "npm test",
      "npm run type-check",
      "npm run lint",
      "npm run build",
      "npm pack --dry-run",
    ]) {
      expect(runs).toContain(command);
    }

    expect(content).not.toMatch(/npm publish|npm dist-tag|NODE_AUTH_TOKEN|registry-url|secrets\./i);
    expect(asRecord(document.permissions)).toEqual({ contents: "read" });
  });

  it("keeps workflow and test sources outside the package artifact allowlist", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      private?: unknown;
      files?: unknown;
    };
    const files = Array.isArray(packageJson.files)
      ? packageJson.files.filter((entry): entry is string => typeof entry === "string")
      : [];

    expect(packageJson.private).toBe(true);
    expect(files).toContain("dist");
    expect(files).not.toContain(".github");
    expect(files).not.toContain(".github/**");
    expect(files).not.toContain("tests");
    expect(files).not.toContain("tests/**");
    expect(files).not.toContain(".superpowers");
    expect(files).not.toContain(".superpowers/**");
  });
});
