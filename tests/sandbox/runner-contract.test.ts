import { describe, expect, it } from "vitest";

import {
  parseRunnerImageConfig,
  RUNNER_ENTRYPOINT,
  RunnerImageContractError,
} from "../../src/sandbox/runner-contract";

const validConfig = {
  Labels: {
    "org.skillsync.runner.protocol": "skillsync.runner.v1",
    "org.skillsync.runner.contract": "1",
    "org.skillsync.runner.entrypoint": RUNNER_ENTRYPOINT,
  },
  Entrypoint: [RUNNER_ENTRYPOINT],
  Env: ["PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8"],
};

describe("Runner image contract", () => {
  it("accepts the exact Runner image contract", () => {
    expect(parseRunnerImageConfig(JSON.stringify(validConfig))).toMatchObject({
      entrypoint: [RUNNER_ENTRYPOINT],
      env: validConfig.Env,
    });
  });

  it.each([
    ["missing protocol label", { ...validConfig, Labels: {} }],
    [
      "wrong contract version",
      { ...validConfig, Labels: { ...validConfig.Labels, "org.skillsync.runner.contract": "2" } },
    ],
    ["shell entrypoint", { ...validConfig, Entrypoint: ["/bin/sh", "-c"] }],
    ["secret-like static env", { ...validConfig, Env: [...validConfig.Env, "OPENAI_API_KEY=embedded"] }],
    ["proxy static env", { ...validConfig, Env: [...validConfig.Env, "HTTPS_PROXY=http://proxy"] }],
    ["missing fixed PATH", { ...validConfig, Env: ["LANG=C.UTF-8"] }],
  ])("rejects %s", (_label, config) => {
    expect(() => parseRunnerImageConfig(JSON.stringify(config))).toThrow(/image-contract-invalid/);
  });

  it("uses a stable contract error without leaking malformed Config content", () => {
    let caught: unknown;
    try {
      parseRunnerImageConfig("not-json with secret=do-not-print");
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RunnerImageContractError);
    expect(caught).toMatchObject({ code: "image-contract-invalid" });
    expect(caught instanceof Error ? caught.message : String(caught)).not.toContain("do-not-print");
  });
});
