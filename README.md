# SkillSync

**Verify Agent Skills before you trust them.** SkillSync checks a local Skill's provenance, compatibility, and changes without executing it.

> **Alpha · v0.1.1 · Node.js 20+**
> SkillSync performs offline checks of local Skill content. It does not execute Skill scripts, does not read credentials, and does not enable live provider, remote-worker, or runtime capabilities.

[![Terminal demo](https://raw.githubusercontent.com/Chumaniac/skillsync/main/docs/assets/verify-demo.svg)](https://github.com/Chumaniac/skillsync/blob/main/docs/assets/verify-demo.svg)

## Run it from source

The npm package publish for `0.1.1` is currently paused. Clone this repository to run the current Alpha build:

```bash
git clone https://github.com/Chumaniac/skillsync.git
cd skillsync
npm ci
npm run build
node dist/cli/index.js verify --path fixtures/product/trust-loop/review --target codex
```

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
