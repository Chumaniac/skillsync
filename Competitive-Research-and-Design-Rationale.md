# SkillSync Competitive Research and Design Rationale

> **Summary:** Competitive research supports positioning SkillSync as a compatibility and quality verification layer rather than another installer or synchronization manager.
> **Status:** Product direction decided; assumptions in Section 7 remain open for continued validation.
> Research date: 2026-08-04
> Purpose: Record the factual basis, alternatives, and key decisions behind the product-positioning change.
> Note: GitHub Stars, issue counts, and feature status change over time; this record reflects the public-page snapshot reviewed for this research.

---

## 1. Which assumptions from the original design must be overturned

The original document treated the following capabilities as major gaps:

```text
diff / doctor / rollback / lockfile
```

That assessment is no longer accurate.

### 1.1 `runkids/skillshare`

The project README already positions it as a source-of-truth synchronization tool for multiple Agents, covering Claude, Cursor, Codex, OpenClaw, OpenCode, and more targets. It also provides security audits, project mode, GitHub Actions, a UI, filtering, and local checkpoints.

The official documentation also lists:

- `skillshare diff`: target-level, file-level, and unified patch differences;
- `skillshare doctor`: target status, broken symlinks, Skill integrity, SHA-256 file hashes, duplicate paths, and CI JSON;
- `skillshare backup/restore`: automatic backups, point-in-time restoration, and pre-restore comparison;
- `skillshare audit`: scanning for prompt injection and data exfiltration.

Sources:

- [GitHub README](https://github.com/runkids/skillshare)
- [Commands](https://skillshare.runkids.cc/docs/reference/commands/)
- [doctor](https://skillshare.runkids.cc/docs/reference/commands/doctor/)
- [diff](https://skillshare.runkids.cc/docs/reference/commands/diff/)
- [backup](https://skillshare.runkids.cc/docs/reference/commands/backup/)
- [restore](https://skillshare.runkids.cc/docs/reference/commands/restore/)

Conclusion: We can no longer claim that "no one provides diff/doctor/rollback."

### 1.2 `xingkongliang/skills-manager`

It is no longer a lightweight, "GUI-only" manager. Its current README explicitly includes:

- a central Skill library;
- installation from Git, local folders, zip archives, `.skill` files, and skills.sh;
- presets, global/project workspaces, and linked workspaces;
- upstream update checks and local/upstream content comparison;
- agent-friendly CLI;
- private GitHub repository backups;
- snapshot restore;
- skill-aware merging and conflict resolution;
- an activity log and log export.

Source: [skills-manager README](https://github.com/xingkongliang/skills-manager)

Conclusion: A GUI, backups, snapshots, a CLI, and cross-device synchronization are not unique selling points.

### 1.3 `vercel-labs/skills`

`npx skills` already provides:

- `add`, `use`, `list`, `find`, `remove`, `update`, and `init`;
- project/global scope;
- multi-Agent installation;
- symlink and copy modes;
- GitHub, GitLab, local-path, and archive sources;
- more than 70 Agent targets.

Source: [vercel-labs/skills README](https://github.com/vercel-labs/skills)

Its Issue #283 instead reveals a more precise gap: the existing `~/.agents/.skill-lock.json` contains source, path, hash, and timestamp data, but it still resembles an update-tracking database rather than a declarative installation manifest capable of fully restoring every Skill on a new machine.

Source: [Issue #283](https://github.com/vercel-labs/skills/issues/283)

Conclusion: There is still an opportunity for a lockfile, but it cannot merely "put the fields into another JSON shape." The real goal is "reproducible distribution + target compatibility + verification evidence."

### 1.4 GitHub's official `gh skill`

The current official GitHub CLI manual already lists `gh skill install/list/preview/publish/search/update`. `publish --dry-run` checks the Skill name, directory name, frontmatter, `allowed-tools` type, and publication metadata.

Sources:

- [`gh skill` manual](https://cli.github.com/manual/gh_skill)
- [`gh skill publish` manual](https://cli.github.com/manual/gh_skill_publish)
- [GitHub CLI repository](https://github.com/cli/cli)

Conclusion: Skill installation and basic publication validation are entering GitHub's official toolchain, so SkillSync should not compete to be that entry point.

### 1.5 `rulesync` and the Agent Skills standard

`rulesync` already covers importing, generating, and converting configuration for rules, ignore files, MCP, commands, subagents, skills, hooks, permissions, and more.

Source: [rulesync](https://github.com/dyoshikawa/rulesync)

As the standards repository, `agentskills/agentskills` defines a Skill as a directory containing `SKILL.md`, scripts, references, and assets, and emphasizes progressive disclosure and cross-product reuse.

Source: [Agent Skills standards repository](https://github.com/agentskills/agentskills)

Community Discussion #210 further proposes distribution-layer `skills.json` and `skills.lock` files that separate source, dependencies, versions, and integrity from the `SKILL.md` read by the Agent runtime.

Source: [Skill Package Manifest RFC](https://github.com/agentskills/agentskills/discussions/210)

Conclusion: SkillSync should serve as a proving ground for the distribution and verification layers while following the standard, rather than independently inventing a closed-loop format.

### 1.6 Security scanning is already a distinct category

Security is no longer a simple "frontmatter doctor."

- [Cisco Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner) covers prompt injection, data exfiltration, malicious code patterns, YAML/YARA, LLM analysis, behavioral data flow, SARIF, and pre-commit.
- [SkillFortify](https://github.com/qualixar/skillfortify) focuses on formal analysis, capability validation, dependency graphs, SBOMs, and deterministic lockfiles.

Conclusion: SkillSync can treat security as an L3 evidence layer and policy entry point, but it should not make "writing our own scanner" the entire product.

---

## 2. Three product directions

### Option A: Compatibility and quality gate (recommended)

**Core:** `scan → verify → compat → diff → CI`

Advantages:

- Complements every existing installer and synchronizer;
- runs directly against existing directories without requiring migration;
- gives Skill authors and teams an ongoing PR/CI use case;
- provides highly deterministic core checks without depending on an AI API;
- can start with three Agent profiles instead of chasing "support for 60+ Agents."

Disadvantages:

- The first-run experience is less intuitive than a desktop manager;
- "semantic compatibility" must be explained clearly enough;
- behavioral contract testing requires fixtures and a sandbox to be built later.

### Option B: Reproducible Skill Package Manager

**Core:** manifest, lockfile, install, reconcile, and restore.

Advantages:

- The technical boundary is easy to understand;
- the value for team users is clear;
- it can align with the community RFC for `skills.json` / `skills.lock`.

Disadvantages:

- It overlaps heavily with `npx skills`, skillshare, and Skills Manager;
- GitHub's official tools and competitors could close the gap quickly;
- copying and rollback alone provide too little motivation to star the project.

Decision: Make this a P1 distribution-layer capability, not the product's primary entry point.

### Option C: Skill Supply Chain Security

**Core:** static analysis, capability declarations, isolated execution, SBOM, signing, and trust policy.

Advantages:

- Skills affect an Agent's file, terminal, and network behavior, so the security need is real;
- enterprises and security teams have defined budgets;
- evidence and reports integrate easily with CI.

Disadvantages:

- Cisco, SkillFortify, and other specialized competitors already exist;
- false positives and false negatives directly damage trust;
- "scan passed" cannot be equated with safety, so a strong threat model is required.

Decision: Make this an L3 adapter and policy layer, not the sole early-stage positioning.

---

## 3. Recommended combination

```text
Primary product: Option A, compatibility and quality verification
Foundation: Option B, provenance and reproducible lock
Security capability: Option C, static evidence and external scanner adapters
```

Final narrative:

> Existing tools help you find, install, and synchronize Skills; SkillSync helps you prove that a change did not silently alter their effective behavior.

---

## 4. What the real differentiation is

### 4.1 From file Diff to semantic Diff

An ordinary file Diff can only say:

```diff
- description: review code
+ description: review code and push changes
```

SkillSync should say:

```text
routing-change
description expands from review-only to review-and-push
risk: activation scope increased

capability-change
new shell script added: scripts/push.sh
risk: write/network capability requires review
```

### 4.2 From path compatibility to capability compatibility

Path synchronization only knows whether `~/.claude/skills` exists.

Capability verification must know:

- whether the target recognizes a given frontmatter field;
- whether `allowed-tools` is actually enforced;
- whether `context: fork` has an equivalent execution model;
- whether hooks will run;
- whether bundled scripts retain their relative paths;
- whether an unknown field is ignored, rejected, or passed through.

### 4.3 From "having a backup" to "a restore point with verification evidence"

An ordinary backup answers, "What did the files look like before?"

SkillSync must answer, "Which version passed which profiles, policies, and behavioral tests?"

Therefore, the rollback target should be:

```text
last verified commit
```

rather than simply:

```text
latest backup directory
```

### 4.4 From "security scan passed" to transparent risk evidence

Report:

- what was found;
- which rule or scanner was used;
- which capabilities were not verified;
- which results require human judgment;
- how to reproduce and remediate the finding.

Do not report:

```text
This skill is safe.
```

---

## 5. Why people will want to star it

### 5.1 Results on the first run

"Scan first, write no files, and make no network requests" is the lowest-friction entry point.

Users do not need to:

- create a central library first;
- migrate directories first;
- sign in to GitHub first;
- choose a synchronizer first;
- configure a model API key first.

### 5.2 Results are suitable for public sharing

SkillSync reports naturally fit:

- PR comments;
- SARIF Code Scanning;
- README badges;
- compatibility matrices;
- minimal reproductions in issues.

### 5.3 The community can contribute evidence

A profile or fixture is an independent contribution that does not require understanding the entire CLI:

```text
Add a profile
Add an official documentation link
Add a supported/unsupported fixture
Add a semantic diff rule
```

This is more reviewable than "support the 47th Agent" and is more likely to become a durable asset.

### 5.4 The more mature the ecosystem becomes, the stronger the need

If every Agent eventually adopts the Agent Skills standard, directory synchronization will become less important, but these questions will remain:

- Is the Skill trustworthy?
- Are its dependencies reproducible?
- Does the target fully support it?
- Does a change alter its behavior?
- Has the team approved it?
- Can it be restored after a failure?

This makes the positioning independent of any current directory convention.

---

## 6. Key design tradeoffs

### 6.1 Why not build a GUI first

skillshare and Skills Manager have already shown that a GUI is a valid direction, but SkillSync's early core value is verification evidence, not card-based management.

CLI/CI enables:

- authors to run checks at commit time;
- teams to block changes in a PR;
- individual users to try it quickly in any directory;
- contributors to test rules with fixtures.

A GUI can consume JSON/SARIF after the verification model stabilizes instead of prematurely dictating the domain model.

### 6.2 Why not support 60+ Agents first

The number of targets is a marketing metric, not a compatibility-quality metric.

Three profiles backed by documentation and fixtures are more credible than 60 profiles that contain only path mappings.

### 6.3 Why AI is not part of core adjudication

AI can be used for:

- risk summaries;
- explanations of semantic changes;
- optional behavioral tests;
- generated remediation suggestions.

AI should not decide:

- whether file hashes match;
- whether a referenced file exists;
- the exit code;
- whether policy blocks a result;
- whether a lockfile is reproducible.

### 6.4 Why not simply copy `skillshare diff`

SkillSync's diff must explain "effective behavior changes" and relate each change to a target profile, policy, and provenance. A file-level diff can serve as evidence, but it is not the final conclusion.

### 6.5 Why use TypeScript first

Go's single binary and Rust's safety boundaries are both attractive, but the current Skill ecosystem relies heavily on npm, `npx`, and TypeScript. Using TypeScript for the MVP can:

- interoperate with `npx skills` lock data more quickly;
- lower the contribution barrier for Skill authors;
- validate the domain model first;
- allow prebuilt binaries later without changing the CLI contract.

---

## 7. Assumptions requiring continued validation

### H1: Users will run a read-only scan

Validation method:

- Put only one command in the README's opening screen;
- require no initialization;
- test against real `.claude/skills`, `.agents/skills`, and `.cursor/skills` directories;
- record the time from installation to report.

### H2: Skill authors will integrate verify into PRs

Validation method:

- Provide a GitHub Action;
- produce SARIF and a short PR summary;
- provide copyable remediation commands for common errors;
- dogfood it in a real Skill repository.

### H3: Semantic compatibility is more valuable than directory synchronization

Validation method:

- Collect 10 real cross-Agent compatibility cases;
- make every case reproducible with a profile/fixture;
- if real cases cannot be found, reduce the semantic layer's scope instead of substituting conceptual framing for evidence.

### H4: Behavioral contracts justify further investment

Validation method:

- First validate fixture and file/tool invariants without a real model;
- then integrate an explicitly isolated Agent sandbox;
- retain only behavioral assertions that can be reproduced reliably.

---

## 8. Final decision

```text
Name: Keep SkillSync for now, but the tagline must say "verify" to avoid being mistaken for an ordinary synchronizer.
Primary entry point: npx skillsync scan
Primary value: compatibility, provenance, semantic Diff, and CI evidence
Primary users: Skill authors + maintainers of multi-Agent teams
MVP: read-only scan, verify, compat, semantic diff, policy, and SARIF
P1: lock, adopt, reconcile, and reproducible restoration
P2: behavioral contracts and sandbox
Not included: marketplace, desktop management, AI generation, or unverified multi-Agent conversion
```

Final pitch:

> AI can write Skills; SkillSync makes changes to Skills visible, verifiable, and reproducible.
