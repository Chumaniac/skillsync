# User-First Onboarding Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give first-time users a truthful, visual, five-minute path from the public README to a useful local Skill verification.

**Architecture:** Keep the CLI and published package unchanged. Replace the architecture-first README introduction with a product-first onboarding sequence, backed by an image generated from a real `npx` verification run and by lightweight documentation assertions.

**Tech Stack:** Markdown, Vitest, npm, macOS `sips` for PNG rendering.

## Global Constraints

- Public user-facing Markdown is English only.
- Show `Alpha · v0.1.0 · Node.js 20+` without implying production runtime availability.
- The first command must remain exactly `npx --yes @chumanic/skillsync@0.1.0 verify --path . --target codex`.
- The demo must be derived from a real published-package command and must not expose local paths, credentials, or fabricated findings.
- The README must not lead with release preparation, file-by-file document descriptions, or internal architecture reading orders.
- Do not add a hosted application, new CLI command, or package version change.

---

## File Structure

- Create: `docs/assets/verify-demo.svg` — readable source for the terminal demonstration.
- Create: `docs/assets/verify-demo.png` — GitHub- and npm-renderable terminal demonstration.
- Modify: `README.md` — user-first public onboarding page.
- Modify: `tests/docs/documentation.test.ts` — documentation contract for the user-facing promises.

### Task 1: Lock the user-facing documentation contract

**Files:**
- Modify: `tests/docs/documentation.test.ts`

**Interfaces:**
- Consumes: `README.md`, `docs/assets/verify-demo.png`, `package.json`.
- Produces: a regression test that rejects removal of the first-run command, maturity label, visual demo, and safety boundary.

- [ ] **Step 1: Replace the README-only assertions with the onboarding contract**

Add `existsSync` and `statSync` from `node:fs`, retain the existing checks for detailed reference documents and published package metadata, and replace the old README prose assertions with:

```ts
expect(readme).toContain("Verify Agent Skills before you trust them.");
expect(readme).toContain("Alpha · v0.1.0 · Node.js 20+");
expect(readme).toContain(
  "npx --yes @chumanic/skillsync@0.1.0 verify --path . --target codex",
);
expect(readme).toContain(
  "https://raw.githubusercontent.com/Chumaniac/skillsync/main/docs/assets/verify-demo.png",
);
expect(readme).toContain("does not execute Skill scripts");
expect(readme).toContain("does not read credentials");
expect(readme).not.toContain("## Documentation index");
expect(readme).not.toContain("## Recommended reading order");
expect(readme).not.toContain("Local release-candidate validation");
expect(existsSync("docs/assets/verify-demo.png")).toBe(true);
expect(statSync("docs/assets/verify-demo.png").size).toBeGreaterThan(1_000);
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `npx vitest run tests/docs/documentation.test.ts`

Expected: FAIL because the current README lacks the value statement, Alpha label, command, and demo image.

### Task 2: Create a truthful terminal demonstration

**Files:**
- Create: `docs/assets/verify-demo.svg`
- Create: `docs/assets/verify-demo.png`

**Interfaces:**
- Consumes: the npm package `@chumanic/skillsync@0.1.0` and `fixtures/product/trust-loop/review`.
- Produces: a public image used by the README's absolute GitHub raw URL.

- [ ] **Step 1: Capture the source output from the published package**

Run:

```bash
npx --yes @chumanic/skillsync@0.1.0 verify \
  --path fixtures/product/trust-loop/review \
  --target codex \
  --format text
```

Confirm that the captured output includes these exact, non-sensitive lines:

```text
SkillSync verification: 4 findings
pass=3 warn=1 fail=0 unknown=0
```

- [ ] **Step 2: Render a terminal screenshot from that output**

Create an SVG with a dark terminal surface, the exact public command, and a clearly labelled `Real output excerpt` containing the two summary lines plus one genuine `provenance.local-only` finding. Do not include any absolute path, account name, credential, or synthetic success claim.

Use this title and summary text in the image:

```text
$ npx --yes @chumanic/skillsync@0.1.0 verify --path . --target codex
SkillSync verification: 4 findings
pass=3 warn=1 fail=0 unknown=0
warning  provenance.local-only  Record a repository URL and resolved commit when publishing the Skill.
```

- [ ] **Step 3: Generate the portable PNG and inspect it visually**

Run:

```bash
sips -s format png docs/assets/verify-demo.svg --out docs/assets/verify-demo.png
```

Open `docs/assets/verify-demo.png` with the image viewer. Confirm that the command, summary, warning, contrast, and terminal title are legible at README width.

- [ ] **Step 4: Verify the asset is non-empty**

Run: `sips -g pixelWidth -g pixelHeight docs/assets/verify-demo.png`

Expected: a non-zero PNG dimension suitable for a README image.

### Task 3: Rewrite the README around first use

**Files:**
- Modify: `README.md`
- Modify: `tests/docs/documentation.test.ts`

**Interfaces:**
- Consumes: `docs/assets/verify-demo.png`, the current public npm package, and the focused documentation contract.
- Produces: the primary user onboarding experience for GitHub and npm.

- [ ] **Step 1: Put the value proposition, status, and visual demo above all reference material**

Replace the current architecture-first opening with this semantic structure:

```markdown
# SkillSync

**Verify Agent Skills before you trust them.** SkillSync checks a local Skill's provenance, compatibility, and changes without executing it.

> **Alpha · v0.1.0 · Node.js 20+**
> SkillSync performs offline checks of local Skill content. It does not execute Skill scripts, does not read credentials, and does not enable live provider, remote-worker, or runtime capabilities.

[![Terminal demo](https://raw.githubusercontent.com/Chumaniac/skillsync/main/docs/assets/verify-demo.png)](https://github.com/Chumaniac/skillsync/blob/main/docs/assets/verify-demo.png)

Run this from a directory containing `SKILL.md`:

```bash
npx --yes @chumanic/skillsync@0.1.0 verify --path . --target codex
```
```

- [ ] **Step 2: Keep the middle of the README product-oriented and concise**

Add a compact `What you get` section covering `verify`, `scan`, `compat`, `diff`, and the explicit `fix --plan` / `fix --apply` / `report` trust loop. Explain results in plain language: `pass`, `warn`, `fail`, and `unknown` are findings to review; `fix --apply` records an explicit change and only a subsequent `verify` establishes the new state.

Do not reintroduce a recommended reading order, a release-readiness narrative, or individual explanatory blurbs for every reference file.

- [ ] **Step 3: Collapse advanced material into a minimal reference group**

End the README with a `Reference` section containing only labelled links such as `Security and privacy`, `Compatibility profiles`, `CI`, `Runner`, and `Full design`. Keep the detailed release and runtime documents in the repository without presenting them as onboarding prerequisites.

- [ ] **Step 4: Run focused documentation checks and verify success**

Run:

```bash
npx vitest run tests/docs/documentation.test.ts tests/docs/english-documentation.test.ts
```

Expected: PASS. The first test confirms the onboarding promise and the second test confirms English-only text and valid Markdown links.

- [ ] **Step 5: Commit the green documentation change**

```bash
git add README.md docs/assets/verify-demo.svg docs/assets/verify-demo.png tests/docs/documentation.test.ts
git commit -m "docs: add user-first onboarding"
```

### Task 4: Run release-quality documentation verification

**Files:**
- Verify only: `README.md`, `docs/assets/verify-demo.svg`, `docs/assets/verify-demo.png`, `tests/docs/documentation.test.ts`

**Interfaces:**
- Consumes: the completed onboarding documentation.
- Produces: fresh evidence that the docs are link-safe, test-safe, build-safe, and package-safe.

- [ ] **Step 1: Check whitespace and tracked changes**

Run:

```bash
git diff origin/main...HEAD --check
git status --short
```

Expected: no whitespace errors and only the approved documentation work on the branch.

- [ ] **Step 2: Run the complete project validation**

Run: `npm run check`

Expected: tests, type-check, lint, and TypeScript build all pass.

- [ ] **Step 3: Validate the publishable package preview**

Run: `npm pack --dry-run`

Expected: succeeds. The README's demo points to the absolute GitHub raw asset URL, so the image remains visible on npm even though the package allowlist does not need to ship `docs/assets/`.

- [ ] **Step 4: Record final evidence before publishing**

Run:

```bash
git log --oneline origin/main..HEAD
git status --short --branch
```

Expected: the branch has the design-spec commit and the green onboarding-documentation commit, with a clean worktree.
