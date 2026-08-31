# SkillSync

**Verify Agent Skills before you trust them.** SkillSync checks a local Skill's provenance, compatibility, and changes without executing it.

> **Alpha · v0.1.1 · Node.js 20+**
> SkillSync performs offline checks of local Skill content. It does not execute Skill scripts, does not read credentials, and does not enable live provider, remote-worker, or runtime capabilities.

[![Terminal demo](https://raw.githubusercontent.com/Chumaniac/skillsync/main/docs/assets/verify-demo.svg)](https://github.com/Chumaniac/skillsync/blob/main/docs/assets/verify-demo.svg)

## Install

**From npm (stable 0.1.0):**

```bash
npx --yes @chumanic/skillsync@0.1.0 verify --path . --target codex
# or install globally
npm install -g @chumanic/skillsync@0.1.0
skillsync verify --path . --target codex
```

**From source (latest 0.1.1):**

```bash
git clone https://github.com/Chumaniac/skillsync.git
cd skillsync
npm ci
npm run build
node dist/cli/index.js verify --path fixtures/product/trust-loop/review --target codex
```

> `0.1.1` is tagged as `v0.1.1` and will be published via the OIDC provenance workflow (`npm publish --provenance --access public` with `id-token: write`, no long-lived token). Until the Trusted Publisher is verified on npm, use `0.1.0` via `npx` or run `0.1.1` from source. The `skillsync ci init` template pins `0.1.1` by default; override with `--package-version 0.1.0` on npm today.

The command above verifies the included sample Skill. Replace the fixture path with a directory containing your own `SKILL.md` when you are ready.

## What you get

- `verify` reviews one local Skill for provenance, target compatibility, and changes without running its scripts.
- `scan` inventories local Skills, while `compat` checks their declared features against agent profiles.
- `diff` shows the meaningful changes between two Skill versions before you accept them.
- The trust loop is explicit: `verify`, review the findings, use `fix --plan`, confirm with `fix --apply`, run `verify` again, then use `report` to compare the before and after evidence.

`pass`, `warn`, `fail`, and `unknown` are findings to review, not an automatic approval. `fix --apply` records an explicit change; only a subsequent `verify` establishes the new state.

## Reference

- [Security and privacy](./docs/security-boundary.md)
- [Compatibility profiles](./docs/compatibility.md)
- [CI](./docs/ci.md)
- [Runner](./docs/runner-contract.md)
- [Full design](./SkillSync-Complete-Design.md)
