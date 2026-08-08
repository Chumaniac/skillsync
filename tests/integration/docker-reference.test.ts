import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseBehaviorManifest } from "../../src/domain/behavior-fixture";
import { runBehaviorV2Test } from "../../src/cli/commands/test-v2";

const enabled = process.env.SKILLSYNC_DOCKER_INTEGRATION === "1";
const image = process.env.SKILLSYNC_REFERENCE_IMAGE;

describe.skipIf(!enabled || !image)("reference Runner Docker integration", () => {
  it("executes the local immutable image-ID reference without writes", async () => {
    const fixtureRoot = resolve("fixtures/behavior/docker-reference");
    const manifest = parseBehaviorManifest(
      await readFile(resolve(fixtureRoot, "behavior.yaml"), "utf8"),
      resolve(fixtureRoot, "behavior.yaml"),
    );
    if (manifest.schema_version !== 2 || manifest.execution.backend !== "docker") {
      throw new Error("reference fixture must be a Docker v2 fixture");
    }

    const report = await runBehaviorV2Test({
      fixtureRoot,
      manifest: {
        ...manifest,
        execution: { ...manifest.execution, image },
      },
      execute: true,
      backend: "docker",
    });

    expect(report.execution.status).toBe("passed");
    expect(report.execution.evidence.writes).toEqual([]);
    expect(report.execution.evidence.tools).toEqual(["fs.read"]);
  });
});
