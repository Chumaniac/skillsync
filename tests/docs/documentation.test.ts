import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("release documentation", () => {
  it("documents the read-only boundary, supported commands, and profile evidence", async () => {
    const readme = await readFile("README.md", "utf8");
    const security = await readFile("docs/security-boundary.md", "utf8");
    const authoring = await readFile("docs/authoring-fixtures.md", "utf8");
    const compatibility = await readFile("docs/compatibility.md", "utf8");
    const runner = await readFile("docs/runner-contract.md", "utf8");
    const provenance = await readFile("docs/runner-provenance.md", "utf8");
    const adapter = await readFile("docs/provider-adapter.md", "utf8");
    const egress = await readFile("docs/egress-contract.md", "utf8");
    const remote = await readFile("docs/remote-lifecycle.md", "utf8");
    const dogfood = await readFile("docs/dogfood-2026-08-05.md", "utf8");
    const review = await readFile("docs/security-review-egress-provider-runtime.md", "utf8");
    const rollout = await readFile("docs/rollout-egress-provider-runtime.md", "utf8");
    const runtime = await readFile("docs/superpowers/specs/2026-08-05-egress-provider-runtime-design.md", "utf8");
    const readiness = await readFile("docs/release-readiness-2026-08-05.md", "utf8");
    const activationGate = await readFile("docs/runtime-activation-gate.md", "utf8");
    const credentialContract = await readFile("docs/credential-contract.md", "utf8");
    const ci = await readFile("docs/ci.md", "utf8");
    const runbook = await readFile("docs/runtime-operator-runbook.md", "utf8");
    const releaseWorkflow = await readFile(".github/workflows/release.yml", "utf8");
    const repositoryWorkflow = await readFile(".github/workflows/skillsync.yml", "utf8");
    const githubTemplate = await readFile("templates/github/skillsync.yml", "utf8");
    const preCommitTemplate = await readFile("templates/pre-commit/skillsync.yaml", "utf8");
    const terminalDemo = await readFile("docs/assets/verify-demo.svg", "utf8");
    const changelog = await readFile("CHANGELOG.md", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      bugs?: { url?: string };
      homepage?: string;
      name?: string;
      private?: boolean;
      publishConfig?: { access?: string };
      repository?: { type?: string; url?: string };
    };

    expect(readme).toContain("Verify Agent Skills before you trust them.");
    expect(readme).toContain("Alpha · v0.1.1 · Node.js 20+");
    expect(readme).toContain("## Run it from source");
    expect(readme).toContain("git clone https://github.com/Chumaniac/skillsync.git");
    expect(readme).toContain(
      "node dist/cli/index.js verify --path fixtures/product/trust-loop/review --target codex",
    );
    expect(readme).toContain("The npm package publish for `0.1.1` is currently paused.");
    expect(readme).not.toContain(
      "npx --yes --package=@chumanic/skillsync@0.1.1 --call 'skillsync verify --path . --target codex'",
    );
    expect(readme).toContain(
      "https://raw.githubusercontent.com/Chumaniac/skillsync/main/docs/assets/verify-demo.png",
    );
    expect(terminalDemo).toContain("$ git clone https://github.com/Chumaniac/skillsync.git");
    expect(terminalDemo).toContain(
      "$ node dist/cli/index.js verify --path fixtures/product/trust-loop/review --target codex",
    );
    expect(terminalDemo).not.toContain("@chumanic/skillsync@0.1.1");
    expect(readme).toContain("does not execute Skill scripts");
    expect(readme).toContain("does not read credentials");
    expect(readme).not.toContain("## Documentation index");
    expect(readme).not.toContain("## Recommended reading order");
    expect(readme).not.toContain("Local release-candidate validation");
    expect(existsSync("docs/assets/verify-demo.png")).toBe(true);
    expect(statSync("docs/assets/verify-demo.png").size).toBeGreaterThan(1_000);
    expect(security).toContain("not a security certification");
    expect(security).toContain("reporting.include_local_paths");
    expect(security).toContain("<local-path>");
    expect(security).toContain("Replay");
    expect(authoring).toContain("schema_version: 2");
    expect(authoring).toContain("--backend replay");
    expect(security).toContain("symlink");
    expect(compatibility).toContain("codex@1");
    expect(compatibility).toContain("claude-code@1");
    expect(compatibility).toContain("cursor@1");
    expect(compatibility).toContain("skillFolderHash");
    expect(security).toContain("workspace evidence");
    expect(runner).toContain("runner validate");
    expect(provenance).toContain("runner.signature-verification-unavailable");
    expect(adapter).toContain("explicit-short-lived");
    expect(adapter).toContain("external immutable image reference and an external identity policy");
    expect(runtime).toContain("allowlist");
    expect(runtime).toContain("credentials");
    expect(egress).toContain("allowlist");
    expect(egress).toContain("does not open sockets");
    expect(remote).toContain("cleaned");
    expect(remote).toContain("credentials");
    expect(remote).toContain("cleanup_proof");
    expect(remote).toContain("Ed25519");
    expect(remote).toContain("trusted Worker-key map");
    expect(dogfood).toContain("genkoy-component-splitter");
    expect(dogfood).toContain("rewrite them automatically");
    expect(review).toContain("Offline contract hardening complete");
    expect(review).toContain("retry contract missing");
    expect(rollout).toContain("Immediate rollback triggers");
    expect(rollout).toContain("direct network access");
    expect(readiness).toContain("Local release candidate status");
    expect(readiness).toContain("independent security review");
    expect(readiness).toContain("Docker daemon remains unavailable");
    expect(activationGate).toContain("provider-credentials");
    expect(activationGate).toContain("does not open sockets");
    expect(activationGate).toContain("runtime-activation-boundary");
    expect(activationGate).toContain("authoritative: false");
    expect(activationGate).toContain("runtime-deployment-requirements.schema.json");
    expect(credentialContract).toContain("secret://");
    expect(credentialContract).toContain("does not parse the host environment");
    expect(ci).toContain("skillsync-runtime-canary.yml");
    expect(ci).toContain("does not claim a live Worker");
    expect(ci).toContain("enable_live_capabilities");
    expect(ci).toContain("--pull=false");
    expect(ci).toContain("release.yml");
    expect(ci).toContain("offline-simulated");
    expect(runbook).toContain("Activation");
    expect(runbook).toContain("Revocation");
    expect(runbook).toContain("Rollback");
    expect(runbook).toContain("Evidence review");
    expect(runbook).toContain("RuntimeTrustRoot");
    expect(runbook).toContain("secret reference");
    expect(runbook).toContain("mTLS");
    expect(runbook).toContain("remote Worker");
    expect(releaseWorkflow).toContain('tags: ["v*"]');
    expect(releaseWorkflow).toContain("npm publish --provenance --access public");
    expect(repositoryWorkflow).toContain("git grep -nE");
    expect(repositoryWorkflow).not.toContain("rg -n");
    expect(repositoryWorkflow).toContain("SkillSync-Complete-Design.md");
    expect(repositoryWorkflow).toContain("Competitive-Research-and-Design-Rationale.md");
    expect(repositoryWorkflow).toContain("MVP-Implementation-Plan.md");
    expect(githubTemplate).toContain("@chumanic/skillsync@0.1.1");
    expect(preCommitTemplate).toContain("@chumanic/skillsync@0.1.1");
    expect(ci).toContain("@chumanic/skillsync@0.1.1");
    expect(changelog).toContain("## 0.1.1 - 2026-08-08");
    expect(changelog).toContain("valid Docker workspace bind-mount form");
    expect(changelog).toContain("immutable reference-image inputs and instruction-network isolation");
    expect(changelog).toContain("436 passed tests across 69 files");
    expect(review).toContain("runtime-activation-policy.ts");
    expect(review).toContain("runtime-deployment-requirements.ts");
    expect(packageJson.name).toBe("@chumanic/skillsync");
    expect(packageJson.private).toBe(false);
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/Chumaniac/skillsync.git",
    });
    expect(packageJson.homepage).toBe("https://github.com/Chumaniac/skillsync#readme");
    expect(packageJson.bugs).toEqual({
      url: "https://github.com/Chumaniac/skillsync/issues",
    });
  });
});
