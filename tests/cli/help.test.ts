import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { isCliEntryPoint, runCli } from "../../src/cli/index";

describe("skillsync CLI", () => {
  it("lists the verification commands", async () => {
    const result = await runCli(["--help"]);

    expect(result.stdout).toContain("scan");
    expect(result.stdout).toContain("verify");
    expect(result.stdout).toContain("explain");
    expect(result.stdout).toContain("fix");
    expect(result.stdout).toContain("compat");
    expect(result.stdout).toContain("diff");
    expect(result.stdout).toContain("lock");
    expect(result.stdout).toContain("adopt");
    expect(result.stdout).toContain("test");
    expect(result.stdout).toContain("Run fixture preflight or explicit sandbox");
    expect(result.stdout).toContain("ci");
    expect(result.stdout).toContain("runner");
    expect(result.stdout).toContain("report");
    expect(result.stdout).toContain("baseline");
    expect(result.exitCode).toBe(0);
  });

  it("documents explicit v2 execution flags", async () => {
    const result = await runCli(["test", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--execute");
    expect(result.stdout).toContain("--backend <backend>");
    expect(result.stdout).toMatch(/replay|docker/);
  });

  it("documents Runner contract validation inputs", async () => {
    const result = await runCli(["runner", "validate", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--config <path>");
    expect(result.stdout).toContain("--image <image>");
    expect(result.stdout).toContain("--provenance <path>");
  });

  it("documents provider adapter validation", async () => {
    const result = await runCli(["runner", "adapter", "validate", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--config <path>");
    expect(result.stdout).toContain("--image <image>");
    expect(result.stdout).toContain("--policy <path>");
    expect(result.stdout).toContain("--policy-digest <digest>");
  });

  it("recognizes a CLI path reached through a filesystem symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "skillsync-cli-entry-"));
    const actual = join(root, "dist-cli.js");
    const linked = join(root, "bin", "skillsync");
    await writeFile(actual, "");
    await mkdir(join(root, "bin"));
    await symlink(actual, linked, "file");

    expect(isCliEntryPoint(pathToFileURL(await realpath(actual)).href, linked)).toBe(true);
  });
});
