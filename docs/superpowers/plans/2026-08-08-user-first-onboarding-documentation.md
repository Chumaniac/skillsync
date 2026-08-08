# User-First Onboarding Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give first-time users a truthful, visual, five-minute path from the public README to a useful local Skill verification.

**Architecture:** Keep the CLI and published package unchanged. Replace the architecture-first README introduction with a product-first onboarding sequence, backed by an image generated from a real `npx` verification run and by lightweight documentation assertions.

**Tech Stack:** Markdown, Vitest, npm, macOS `sips` for PNG rendering.

## Global Constraints

- Public user-facing Markdown is English only.
- Show `Alpha · v0.1.0 · Node.js 20+` without implying production runtime availability.
- The first command must use the verified, npm-11-compatible form: `npx --yes --package=@chumanic/skillsync@0.1.0 --call 'skillsync verify --path . --target codex'`.
- The demo must be derived from a real published-package command and must not expose local paths, credentials, or fabricated findings.
- The README must not lead with release preparation, file-by-file document descriptions, or internal architecture reading orders.
- Do not add a hosted application, new CLI command, or package version change.

---

## File Structure

- Create: `docs/assets/verify-demo.svg` — readable source for the terminal demonstration.
- Create: `docs/assets/verify-demo.png` — GitHub- and npm-renderable terminal demonstration.
- Modify: `README.md` — user-first public onboarding page.
- Modify: `tests/docs/documentation.test.ts` — documentation contract for the user-facing promises.

### Task 1: Deliver the complete user-first onboarding experience

**Files:**
- Create: `docs/assets/verify-demo.svg`
- Create: `docs/assets/verify-demo.png`
- Modify: `README.md`
- Modify: `tests/docs/documentation.test.ts`

**Interfaces:**
- Consumes: the npm package `@chumanic/skillsync@0.1.0`, `fixtures/product/trust-loop/review`, and existing reference documentation.
- Produces: a single green, reviewable documentation commit that makes the public README useful before technical reference material.

- [ ] **Step 1: Write the documentation contract first**

Add `existsSync` and `statSync` from `node:fs`. Retain the existing checks for detailed reference documents and published package metadata, then replace the old README prose assertions with:

```ts
expect(readme).toContain("Verify Agent Skills before you trust them.");
expect(readme).toContain("Alpha · v0.1.0 · Node.js 20+");
expect(readme).toContain(
  "npx --yes --package=@chumanic/skillsync@0.1.0 --call 'skillsync verify --path . --target codex'",
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

- [ ] **Step 2: Prove the contract is initially red**

Run: `npx vitest run tests/docs/documentation.test.ts`

Expected: FAIL because the current README lacks the value statement, Alpha label, first-run command, and demo image.

- [ ] **Step 3: Capture and render real public-package output**

Run:

```bash
npx --yes --package=@chumanic/skillsync@0.1.0 --call \
  'skillsync verify --path fixtures/product/trust-loop/review --target codex --format text'
```

Create `docs/assets/verify-demo.svg` with a dark terminal surface, the public command, and a clearly labelled `Real output excerpt`. It must include these genuine, non-sensitive lines:

```text
$ npx --yes --package=@chumanic/skillsync@0.1.0 --call 'skillsync verify --path . --target codex'
SkillSync verification: 4 findings
pass=3 warn=1 fail=0 unknown=0
warning  provenance.local-only  Record a repository URL and resolved commit when publishing the Skill.
```

Convert it with:

```bash
sips -s format png docs/assets/verify-demo.svg --out docs/assets/verify-demo.png
```

Visually inspect the PNG. The command, summary, warning, contrast, and title must remain legible at README width. Run `sips -g pixelWidth -g pixelHeight docs/assets/verify-demo.png` and confirm non-zero dimensions.

- [ ] **Step 4: Rewrite README.md around immediate use**

Start the README with this semantic structure:

```markdown
# SkillSync

**Verify Agent Skills before you trust them.** SkillSync checks a local Skill's provenance, compatibility, and changes without executing it.

> **Alpha · v0.1.0 · Node.js 20+**
> SkillSync performs offline checks of local Skill content. It does not execute Skill scripts, does not read credentials, and does not enable live provider, remote-worker, or runtime capabilities.

[![Terminal demo](https://raw.githubusercontent.com/Chumaniac/skillsync/main/docs/assets/verify-demo.png)](https://github.com/Chumaniac/skillsync/blob/main/docs/assets/verify-demo.png)

Run this from a directory containing `SKILL.md`:

```bash
npx --yes --package=@chumanic/skillsync@0.1.0 --call 'skillsync verify --path . --target codex'
```
```

Then add a concise `What you get` section covering `verify`, `scan`, `compat`, `diff`, and the explicit `fix --plan` / `fix --apply` / `report` trust loop. Explain that `pass`, `warn`, `fail`, and `unknown` are findings to review; `fix --apply` records an explicit change and only a subsequent `verify` establishes the new state.

End with a minimal `Reference` group containing labelled links such as `Security and privacy`, `Compatibility profiles`, `CI`, `Runner`, and `Full design`. Do not restore a recommended reading order, release-readiness narrative, or per-file reference descriptions.

- [ ] **Step 5: Prove the implementation is green**

Run:

```bash
npx vitest run tests/docs/documentation.test.ts tests/docs/english-documentation.test.ts
npm run check
npm pack --dry-run
git diff --check
```

Expected: all commands succeed. The README image must use the absolute GitHub raw URL so that it remains visible on npm even though `docs/assets/` is not in the package allowlist.

- [ ] **Step 6: Commit the completed task**

```bash
git add README.md docs/assets/verify-demo.svg docs/assets/verify-demo.png tests/docs/documentation.test.ts
git commit -m "docs: add user-first onboarding"
```

## Final Review Gate

After Task 1 is task-reviewed, run the subagent-driven whole-branch review. The controller will verify the final range against `origin/main`, preserve the plan ledger, and use `superpowers:finishing-a-development-branch` only after the review is clean.
