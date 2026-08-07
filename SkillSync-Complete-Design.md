# SkillSync — Compatibility, Provenance, and Behavior Verification Layer for Agent Skills

> Summary: SkillSync validates installed Agent Skills, their source, compatibility, and behavior.
>
> Version: v2.0 Design Baseline
> Date: 2026-08-04
> Status: Confirmed product and technical design; MVP implemented
> Original reference: External desktop requirements document provided as project input (not published with the public repository)

---

## 0. Design Conclusions

### 0.1 One-Sentence Positioning

> SkillSync is the compatibility, provenance, and behavior verification layer for Agent Skills: it proves whether a Skill is recognized correctly, installed correctly, free from unaudited drift, and still capable of its intended behavior on the target Agent.

### 0.2 Product Relationships

```text
Agent Skills standard: defines what a Skill is
gh skill / npx skills: handle discovery, installation, updates, and publishing
skillshare / Skills Manager: handle centralized management, synchronization, and backup
SkillSync: verifies that the installed, reviewed, and runtime-visible versions are consistent and compatible
```

### 0.3 Core Judgment

A Skill is an executable capability package consisting of “prompts + optional scripts + references + templates,” not an ordinary Markdown document.

AI can generate `SKILL.md` quickly, but AI alone cannot prove:

- which exact commit it came from;
- whether the target Agent supports the fields it declares;
- whether referenced resources and scripts actually exist;
- whether same-name Skills in two directories are still identical;
- whether a change expanded shell, network, or filesystem capabilities;
- whether it can still complete the target task in a reproducible scenario.

These properties require deterministic parsing, hashing, capability matrices, policies, CI, audit logs, and an engineering system with rollback support.

---

## 1. Why the Positioning Was Reworked

The original design treated `diff`, `doctor`, `rollback`, and a lockfile as the primary blue ocean. By 2026, competitors already covered most of those foundational capabilities:

- `runkids/skillshare` already provides `diff`, `doctor`, integrity hashes, auditing, backup and restore, CI JSON output, and a Web UI;
- `xingkongliang/skills-manager` already provides a desktop app, CLI, upstream comparison, Git backup, snapshot restore, and cross-device conflict handling;
- GitHub's official `gh skill` already covers installation, preview, search, updates, and publishing validation;
- `vercel-labs/skills` already maintains installation lock data, while a community Issue still explicitly exposes the gap that “lock data is not a complete reproducible installation manifest”;
- the Agent Skills community is already discussing putting `skills.json` and `skills.lock` into an independent distribution layer.

Therefore, SkillSync should no longer center its narrative on “another synchronizer” or “a synchronizer with a lockfile.”

The direction with real durability is:

> Evolve from file synchronization into a “verifiable contract” for Skills.

---

## 2. User Problems

### 2.1 Individual Multi-Agent Users

Users may work with Claude Code, Codex, Cursor, OpenCode, and other tools at the same time, with Skills scattered across:

```text
~/.claude/skills/
~/.agents/skills/
~/.cursor/skills/
<project>/.claude/skills/
<project>/.agents/skills/
```

What users actually want to know is not “can these files be copied?” but:

1. Which Skills are visible to multiple Agents?
2. Are same-name Skills actually the same content?
3. Which directory is the source, and which directory is a copy?
4. Does an Agent ignore any fields?
5. Has someone manually changed a target directory locally?
6. After an update, can the system restore the last verified version?

### 2.2 Skill Authors

Before publishing, Skill authors need answers to these questions:

- Does the directory structure conform to the standard?
- Can the target Agent recognize the `SKILL.md` frontmatter?
- Do all references, scripts, and templates exist?
- Do the Skill's declared capabilities match the actual behavior of its scripts?
- Which Agents fully support it, and which ones degrade?
- Could a change alter Agent trigger routing or permission scope?

### 2.3 Team Maintainers

Teams need Skills to enter review and release workflows like code:

- PRs must show the effective changes to a Skill;
- Skills that fail verification must not enter shared directories;
- everyone must install the same source revision;
- incidents must be recoverable by returning to the last verified version;
- private Skills, tokens, and machine-local paths must not be uploaded to third-party services.

### 2.4 Real Dogfood Evidence

In the current user-level environment, same-name Genkoy Skills in `.agents/skills` and `.claude/skills` have different content hashes. This proves that drift is a real problem, while also showing that the product cannot serve only as a copier between two directories: it must be able to take control of an already-disordered Skill environment.

---

## 3. Goals and Non-Goals

### 3.1 Product Goals

1. Let users obtain a trustworthy diagnosis of their existing Skill environment with one read-only command.
2. Express cross-Agent differences as an explainable capability compatibility report.
3. Produce deterministic, auditable, CI-compatible verification results for Skill changes.
4. Record provenance, resolved commit, content hash, and verification evidence to support reproducible restoration.
5. Integrate with the existing ecosystem without forcing directory migration, marketplace lock-in, or Skill-content uploads.
6. Let Skill authors contribute “target capability profiles, fixtures, and test scenarios,” rather than only synchronization adapters.

### 3.2 Non-Goals

- Do not build another Skill marketplace or search engine.
- Do not replace the installation and discovery capabilities of `gh skill` or `npx skills`.
- Do not duplicate the complete UI, synchronization, and backup product offered by `skillshare`.
- Do not generate Skill content in the MVP.
- Do not execute untrusted Skill scripts by default.
- Do not claim that “a passing scan means absolute safety.”
- Do not support unverified transformations for dozens of target Agents in the MVP.
- Do not make enterprise RBAC, a cloud console, or telemetry an early success condition.

---

## 4. Product Claims and Brand Language

### 4.1 Recommended Claim

English:

> Agent Skills that are reviewable, reproducible, and compatible.

Equivalent meaning:

> Make every Agent Skill change auditable, reproducible, and verifiable.

### 4.2 README Hero Pitch

```text
gh skill installs skills.
skillshare syncs skills.
SkillSync verifies skills.

Scan any existing skill directories. Find drift, capability loss,
unknown provenance, broken references, and risky behavior before an agent sees it.
```

### 4.3 “Why Someone Would Want to Star It”

The first command a user runs should produce a valuable, shareable result without modifying files:

```text
$ npx skillsync scan

✓ discovered 14 skills across 3 targets
✗ 2 same-name skills have different content
⚠ 3 skills lose supported features on Cursor
⚠ 1 skill references a missing file
⚠ 1 skill adds shell/network capability
✓ no files changed

Run `skillsync verify --format sarif` in CI to block this state.
```

The reasons to star the project are not “a longer feature list,” but:

1. Zero migration: scan directories users already have.
2. Zero accounts: run locally by default, with no cloud registration.
3. Zero writes: make the first run safe and reviewable.
4. Immediate discovery: report problems users did not know existed.
5. Shareability: outputs, GitHub Actions, badges, and fixtures can all spread through the community.

---

## 5. Competitors and Boundaries

### 5.1 Competitor Layers

| Layer | Representative project | Primary responsibility | What SkillSync should not duplicate |
|---|---|---|---|
| Standard | [agentskills/agentskills](https://github.com/agentskills/agentskills) | Defines the Skill directory, `SKILL.md`, and progressive disclosure | Do not fork the standard; follow it and contribute compatibility evidence |
| Official distribution | [GitHub `gh skill`](https://cli.github.com/manual/gh_skill) | Discovery, installation, preview, updates, and publishing validation within GitHub | Do not build a replacement for official distribution |
| Ecosystem installer | [vercel-labs/skills](https://github.com/vercel-labs/skills) | `npx skills` installation, search, updates, and cross-Agent path handling | Read and support its lock data; do not rebuild the installation entry point |
| Synchronization and operations | [runkids/skillshare](https://github.com/runkids/skillshare) | Multi-target synchronization, diff, doctor, backup, restore, auditing, and UI | Do not treat file synchronization and backup as the core moat |
| Desktop management | [xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager) | Skill library, Presets, workspaces, cross-device backup, and CLI | Do not build another desktop Skill manager |
| Configuration transformation | [dyoshikawa/rulesync](https://github.com/dyoshikawa/rulesync) | Unified import and generation for rules, MCP, commands, skills, and more | Read its output only when verification requires it; do not duplicate the entire configuration-transformation scope |
| Security scanning | [Cisco Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner), [SkillFortify](https://github.com/qualixar/skillfortify) | Prompt injection, data exfiltration, static analysis, SBOM, and lockfile | Integrate through adapters; do not package security scanning alone as the entire product |

### 5.2 Competitive Gap

Existing tools mostly answer these questions:

- Where can a Skill be found?
- How is it installed?
- How is it synchronized into multiple directories?
- Are the files different?
- How is a backup restored?

SkillSync should answer:

- What is the “effective semantic change” in this revision?
- Which capabilities are lost or degraded on a target Agent?
- Does the current on-disk content still equal the reviewed source revision?
- Do the Skill's declared capabilities match its scripts, resources, and tool calls?
- Has this Skill passed a reproducible behavior contract?
- Does the team have enough evidence to approve it for a shared environment?

---

## 6. Product Model: Skill Verification Contract

SkillSync divides the trusted state of a Skill into five layers:

```text
L0  Structure       directories, files, frontmatter, and references are complete
L1  Compatibility   target Agent capability support and semantic degradation
L2  Provenance      source, commit, content hash, and installation state
L3  Security        risk evidence for scripts, network, environment variables, and sensitive behavior
L4  Behavior        scenario tests, allowed operations, and result invariants
```

Each layer can run independently. Passing L0 must never be presented as passing L4 or security verification.

### 6.1 Verification Result

```ts
type VerificationResult = {
  level: 0 | 1 | 2 | 3 | 4;
  status: "pass" | "warn" | "fail" | "unknown";
  code: string;
  skill: string;
  target?: string;
  message: string;
  evidence: Array<{
    path?: string;
    expected?: string;
    actual?: string;
    source?: string;
  }>;
  remediation?: string;
};
```

### 6.2 Result Semantics

- `pass`: the verification evidence is sufficient and no issue was found.
- `warn`: the Skill can be used, but capability degradation, incomplete provenance, or human judgment remains.
- `fail`: an explicit structure, compatibility, or team policy was violated.
- `unknown`: the current profile or scanner lacks enough information; the result must not masquerade as a pass.

---

## 7. Core User Flows

### 7.1 Individual Users: Scan First, Then Decide Whether to Adopt

```text
skillsync scan
  ↓
discover directories, same-name conflicts, content drift, and unknown provenance
  ↓
skillsync verify --target codex,claude
  ↓
review semantic differences and risk evidence
  ↓
skillsync adopt --plan
  ↓
after user confirmation, generate manifest/lock or hand off execution to an existing installer
```

By default, SkillSync does not overwrite files, delete directories, or upload content.

### 7.2 Skill Authors: From Local Verification to PR Blocking

```text
write or modify SKILL.md
  ↓
skillsync verify .
  ↓
compatibility, reference, capability, and security report
  ↓
skillsync test --fixture fixtures/review-pr
  ↓
GitHub Action emits SARIF and a PR summary
  ↓
publish a Skill that includes verification evidence
```

### 7.3 Teams: Lock and Return to a Verified Version

```text
manifest declares intent
  ↓
lock records resolved commit + digest + profile + evidence
  ↓
CI verify
  ↓
target machine reconcile
  ↓
if a problem occurs, restore the last verified revision
```

---

## 8. Command Design

The command names deliberately avoid the mental model of “yet another doctor/sync tool.”

### 8.1 `skillsync scan`

Read-only discovery of the current environment.

```bash
skillsync scan
skillsync scan --path ~/.claude/skills --path ~/.agents/skills
skillsync scan --project .
skillsync scan --format json
```

Detection includes:

- common Agent Skill directories;
- whether `SKILL.md` exists;
- same-name directories and content hashes;
- symlink, copy, and local override states;
- whether provenance metadata exists;
- duplicate discovery across the current target Agent and project-level directories;
- counts of resource files and scripts;
- potential shell, network, and environment-variable behavior.

The output must state that “no files were changed.”

### 8.2 `skillsync verify`

Runs deterministic L0-L3 verification and serves as the primary MVP command.

```bash
skillsync verify
skillsync verify ./skills/review
skillsync verify --target codex,claude,cursor
skillsync verify --policy .skillsync/policy.yaml
skillsync verify --format sarif --output skillsync.sarif
```

Default checks:

1. frontmatter YAML is valid;
2. `name` matches the directory name;
3. `description` exists and is a string;
4. relative references point to real files;
5. script paths do not escape the Skill root;
6. symlinks do not point to unacceptable external paths;
7. script executable bits, file encoding, and file size comply with policy;
8. fields supported and degraded by the Agent profile;
9. whether provenance and the resolved commit can be proven;
10. whether the content hash matches the lock or manifest record.

### 8.3 `skillsync compat`

Reports “semantic compatibility,” not merely “whether a directory exists.”

```bash
skillsync compat --target codex,claude,cursor
skillsync compat review --target codex
skillsync compat --format json
```

Example:

```text
review
  codex       ✓ full support
  claude      ⚠ allowed-tools is ignored by this profile
  cursor      ⚠ context: fork is unavailable; execution mode may differ
  universal   ? profile unavailable; no claim made
```

Every target profile must have a version number and fixture; a manually maintained path table alone is insufficient.

### 8.4 `skillsync diff`

This is a “semantic Diff” and does not compete with the ordinary file diff provided by existing synchronization tools.

```bash
skillsync diff --base main --head HEAD
skillsync diff --source ./skills --target ~/.claude/skills
skillsync diff --semantic
```

Categories:

- `routing-change`: `name` or `description` changed, potentially altering trigger scope;
- `capability-change`: tools, hooks, scripts, or external resources changed;
- `compatibility-loss`: a target no longer supports the complete semantics;
- `provenance-change`: source, commit, or digest changed;
- `resource-change`: references were added, removed, or broken;
- `policy-change`: the change touches a team-prohibited directory, domain, or execution capability.

### 8.5 `skillsync adopt`

Brings existing directories under verifiable management, but generates only a plan by default.

```bash
skillsync adopt --plan
skillsync adopt --path ~/.claude/skills --plan
skillsync adopt --apply --backup
```

`--apply` must:

- explicitly display the files that will be modified;
- create a recoverable backup of target directories;
- preserve user-local overrides;
- stop on conflicts rather than overwrite;
- record an operation log.

### 8.6 `skillsync lock`

Generates or updates distribution-layer lock data without changing `SKILL.md`.

```bash
skillsync lock
skillsync lock --check
skillsync lock --from .agents/.skill-lock.json
```

The MVP supports reading existing lock data from `npx skills`; its format should be designed for compatibility with the Agent Skills community's `skills.json` / `skills.lock` proposal. Until a formal standard is established, the SkillSync schema must include `schema_version` and be explicitly marked experimental.

### 8.7 `skillsync test`

Follows the MVP, with L4 behavior contract tests deferred until after the MVP.

```bash
skillsync test --fixture fixtures/review-pr
skillsync test --agent codex --fixture fixtures/review-pr
skillsync test --list
```

Tests do not require byte-for-byte output equality; they verify invariants:

- whether only files inside the allowed scope were modified;
- whether only allowed tools were called;
- whether the required structure was generated;
- whether prohibited network, shell, or sensitive-path behavior occurred;
- whether failures include actionable evidence.

Real Agent execution must be explicitly enabled, run in an isolated environment, and use a model and permissions selected by the user.

### 8.8 `skillsync ci`

Generates GitHub Action, pre-commit, or local CI configuration.

```bash
skillsync ci init --github
skillsync ci init --pre-commit
```

CI output must include at least:

- a human-readable summary;
- JSON machine output;
- SARIF security/quality results;
- a nonzero exit code;
- the base/head difference scope.

---

## 9. Data and Lockfile Design

### 9.1 Separation of Manifest and Lock Responsibilities

```text
manifest: what the team wants
lock: what was actually resolved
SKILL.md: what the Agent reads at runtime
report: why the Skill was considered acceptable
```

### 9.2 Manifest Example

```yaml
schema_version: 1
name: genkoy-agent-skills
targets:
  - codex
  - claude
  - cursor
skills:
  - name: genkoy-component-splitter
    source: github.com/chumanic/genkoy-skills
    path: skills/genkoy-component-splitter
    policy: required
```

### 9.3 Lock Example

```json
{
  "schema_version": 1,
  "generated_at": "2026-08-04T10:00:00Z",
  "tool": {
    "name": "skillsync",
    "version": "0.1.0"
  },
  "skills": {
    "genkoy-component-splitter": {
      "source": "github.com/chumanic/genkoy-skills",
      "path": "skills/genkoy-component-splitter",
      "resolved_commit": "a1b2c3d4e5f6",
      "content_digest": "sha256:...",
      "targets": {
        "codex": {
          "profile": "codex@1",
          "status": "pass",
          "report_digest": "sha256:..."
        },
        "claude": {
          "profile": "claude-code@1",
          "status": "warn",
          "warnings": ["allowed-tools is not enforced by this profile"]
        }
      },
      "security": {
        "scanner": "static-default",
        "status": "review-required"
      },
      "verified_at": "2026-08-04T10:00:00Z"
    }
  }
}
```

### 9.4 Hash Rules

- Calculate a digest over normalized file paths and contents under the Skill root;
- ignore mtime, operating-system inode values, and temporary files by default;
- explicitly record whether symlinks are included;
- record both the source-content digest and target-artifact digest;
- every transformation must produce a transformation-rule version and a post-transformation digest;
- unknown provenance must not masquerade as locked provenance.

### 9.5 Version Rules

- When a release tag exists, record both the tag and resolved commit;
- without a tag, use the commit as the sole reproducible identity;
- SemVer is human-readable metadata supplied by the author, not a replacement for the commit;
- the rollback target must be a “verified resolved commit,” not merely the most recent file backup;
- before restoration, recheck whether the target Agent profile remains compatible.

---

## 10. Agent Capability Profile

### 10.1 Design Goal

Differences among Agents cannot be described only by directory paths. A Profile is versioned data, not conditional branches scattered through transformation code.

### 10.2 Profile Example

```yaml
id: claude-code
version: 1
skill_path:
  project: .claude/skills
  user: ~/.claude/skills
features:
  frontmatter.name: supported
  frontmatter.description: supported
  allowed-tools: supported
  context.fork: supported
  hooks: supported
  bundled_scripts: supported
semantics:
  unknown_frontmatter: warn
  script_execution: runtime-dependent
```

### 10.3 Profile Acceptance

Every profile must include:

- an official documentation link;
- project/global paths;
- supported and unsupported fields;
- unknown field behavior;
- a fixture Skill;
- a version history;
- a maintainer and last verification date.

If evidence is insufficient, emit `unknown` or `warn`, not `full support`.

### 10.4 Transformation Strategy

The default strategy is “do not transform runtime semantics”:

1. Prefer the original Skill and the target Agent's native discovery path;
2. generate a target format only when explicitly requested;
3. preserve the source digest, profile version, and transformation log in transformed output;
4. when a field cannot be transformed without loss, fail or warn by default rather than silently discard it.

This is safer than promising a particular client's Markdown/JSON transformation in advance during the MVP.

---

## 11. Security Design

### 11.1 Threat Model

A Skill may contain:

- prompt injection text;
- instructions that induce an Agent to read sensitive files;
- shell, Python, Node, or other scripts;
- external network requests;
- reads of environment variables and tokens;
- symlinks or resources that point outside the Skill root;
- copies masquerading as legitimate provenance.

### 11.2 Default Security Boundaries

- `scan`, `verify`, and `compat` do not execute Skill scripts by default;
- network access is disabled by default; reading a remote commit requires explicit network enablement;
- Skill content and machine-local paths are not uploaded by default;
- output does not print tokens, cookies, Authorization headers, or complete environment variables;
- archive extraction must prevent path traversal, symlink escape, and resource exhaustion;
- write operations such as `adopt --apply`, `restore`, and `sync` require explicit confirmation or `--yes`;
- security reports describe “risk evidence found” and never claim “absolute safety.”

### 11.3 External Scanner Integration

Security scanning uses adapters:

```text
SkillSync static rules
        ├── local deterministic checks
        ├── Cisco Skill Scanner adapter
        ├── SkillFortify adapter
        └── user-provided scanner adapter
```

When an external scanner is unavailable, report `not-run`; never convert that state automatically to `pass`.

---

## 12. Domain Architecture

### 12.1 Recommended Implementation Strategy

Start with a single CLI package and testable pure domain modules; do not prematurely create a six-adapter monorepo.

Recommended initial technology stack:

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript 5.x | Consistent with `npx skills`, the rules ecosystem, and contributor habits |
| Runtime | Node.js 20+ | Enables rapid publishing and cross-platform operation |
| CLI | `commander` or `cac` | Clear arguments and exit codes |
| YAML | `yaml` | Parses frontmatter, profile, and policy |
| Schema | `zod` | Runtime validation for manifest, profile, and report |
| Hash | Node `crypto` | Reduces extra dependencies |
| Testing | Vitest | Well suited to pure logic and fixture matrices |
| Reporting | JSON + SARIF | Serves both local users and GitHub CI |
| Distribution | npm + prebuilt binaries later | Reduce publishing cost in the MVP, then improve the zero-dependency experience |

### 12.2 Module Boundaries

```text
src/
├── cli/                    # arguments, exit codes, command orchestration
├── domain/
│   ├── skill.ts            # Skill, resource, and provenance domain models
│   ├── digest.ts           # normalized files and hashing
│   ├── frontmatter.ts      # frontmatter parsing and rules
│   ├── inventory.ts        # directory discovery and same-name aggregation
│   ├── semantic-diff.ts    # effective semantic changes
│   ├── compatibility.ts    # profile matching and degradation
│   ├── provenance.ts       # provenance and evidence
│   ├── lockfile.ts         # manifest/lock reading and writing
│   └── policy.ts           # rules and severity levels
├── profiles/               # Agent capability profile data
├── scanners/               # local rules and external scanner adapters
├── reporters/              # text/json/sarif
└── fixtures/               # invalid, compatibility, and behavior examples
```

Core domain modules must not directly read environment variables, access the network, or execute scripts. I/O, CLI, and external scanners are injected through interfaces.

### 12.3 Data Flow

```text
filesystem / git / optional remote
        ↓
inventory
        ↓
normalized Skill model
        ↓
structure + compatibility + provenance + security scanners
        ↓
VerificationResult[]
        ↓
policy evaluation
        ↓
text / JSON / SARIF / exit code
```

---

## 13. Policy Design

### 13.1 Policy Example

```yaml
schema_version: 1
fail_on:
  - structure-error
  - compatibility-loss:required-target
  - unknown-provenance
  - forbidden-capability
targets:
  required:
    - codex
    - claude
capabilities:
  shell:
    default: review
  network:
    default: deny
  read_sensitive_paths:
    default: deny
sources:
  allowed_hosts:
    - github.com
  require_resolved_commit: true
reporting:
  sarif: true
  include_local_paths: false
```

### 13.2 Severity Levels

| Level | Meaning | Default behavior |
|---|---|---|
| `info` | Fact or guidance | Does not block |
| `warn` | Degradation or human judgment exists | Does not block; policy can make it blocking |
| `error` | Violates structure or an explicit policy | Blocks verify |
| `critical` | High-risk capability or provenance issue found | Blocks and requires human handling |

Policy is team configuration; it does not force every user into enterprise-level strictness.

---

## 14. Error Handling and Recovery

### 14.1 Principles

- Report the true state; do not hide partial failure;
- failure in one Skill must not suppress results for other Skills;
- when the network is unavailable, clearly distinguish “local verification passed” from “remote provenance not verified”;
- do not retry script execution indefinitely;
- create a recovery point before every write operation;
- preserve content from both sides on conflicts and prohibit implicit overwrites.

### 14.2 Exit Codes

```text
0  Pass, or warnings only that are not blocked by policy
1  At least one verification failed
2  Invalid arguments, configuration, or manifest
3  Environment, permission, or path unavailable
4  External dependency unavailable when policy requires external evidence
```

### 14.3 Write Transactions

`adopt`, `restore`, and future `reconcile` operations use:

```text
plan → preview → backup → apply → verify → journal
```

If verify fails after any apply, preserve the backup and journal and provide a copyable restoration command.

---

## 15. MVP and Roadmap

### 15.1 MVP: Skill Verification CLI

The goal is not to complete every synchronization feature, but to give users a trustworthy, shareable, CI-compatible verification tool within four weeks.

| Module | Content | Acceptance |
|---|---|---|
| Inventory | Scan common directories, aggregate same-name Skills, and hash content | Does not write files; JSON output is correct |
| Structure | Check frontmatter, directories, resources, and scripts | Every invalid fixture is detected |
| Compatibility | Three versioned profiles: Codex, Claude Code, and Cursor | Support, degradation, and unknown states are distinguishable |
| Provenance | Git URL, commit, digest, and unknown source | Identical content is reproducibly identified |
| Semantic diff | Metadata, reference, capability, and provenance changes | Categories are stable and readable |
| Policy | fail/warn rules, targets, and capability policies | Nonzero exit codes follow policy |
| Reporter | text, JSON, and SARIF | Integrates with GitHub Code Scanning |
| CI | GitHub Action and pre-commit templates | A new project can generate them with one command |
| Docs | README, migration guide, and profile contribution guide | Complete five-minute onboarding path |

### 15.2 P1: Reproducible Distribution

- Read lock data from `npx skills`;
- generate the SkillSync manifest/lock;
- support `lock --check`;
- record the target profile, verification-report digest, and provenance evidence;
- provide `adopt --plan` and backup-protected `adopt --apply`;
- import read-only state from `skillshare` and `skills-manager`.

### 15.3 P2: Behavior Contract Testing

- fixture scenario descriptions;
- file-modification and tool-call invariants;
- an optional Agent sandbox;
- multi-model/multi-Agent result comparison;
- failed-trace summaries instead of uploading complete context.

### 15.4 P3: Ecosystem and Governance

- a community repository for profiles;
- a Skill author verification badge;
- signable verification reports;
- organization-level policy packages;
- consider cloud report aggregation only after real team demand exists.

---

## 16. README, Demo, and Community Design

### 16.1 README Hero Sequence

1. State in one sentence: “not an installer, but a verification layer”;
2. show a 30-second terminal-output GIF;
3. show `npx skillsync scan`;
4. state the security boundaries: local-first, no upload, read-only default;
5. explain the relationship to `gh skill`, `skills`, and `skillshare`;
6. show a GitHub Action example;
7. list supported profiles and verification dates;
8. explain how to add a fixture/profile;
9. state the roadmap and non-goals.

### 16.2 Shareable Assets

- a `Skill Verification Report` PR-comment template;
- an `Agent Compatibility Matrix`;
- a reproducible set of invalid/malicious fixtures;
- an `Agent Skill Verification` badge;
- a case study showing that “same-name Skills visible to three Agents are not necessarily the same thing”;
- a compatibility-change report for every release.

### 16.3 Units of Community Contribution

Let contributors complete one category of contribution within ten minutes:

- add a target Agent profile;
- add an invalid frontmatter fixture;
- add a capability-loss fixture;
- add a security rule;
- add a behavior contract scenario;
- correct an official documentation reference.

Contributing “evidence and fixtures” creates community network effects more readily than contributing large adapters.

---

## 17. Metrics and Success Criteria

### 17.1 North Star Metric

> How many Skill repositories successfully run SkillSync verify in CI each week and produce reusable verification reports?

### 17.2 Early Metrics

- time from first run to completed report is under 30 seconds;
- `scan` produces no file changes by default;
- three core profiles have public fixtures;
- number of real Skill repositories integrated with the GitHub Action;
- rate at which invalid/compat/security fixtures are added;
- the proportion of `unknown` verification results declines over time;
- proportion of Issue feedback driven by real drift or compatibility problems.

### 17.3 Vanity Metrics Not Used

- number of supported Agents;
- number of adapter files;
- number of YAML files generated;
- npm downloads alone;
- stars without actual CI or usage records.

---

## 18. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Agent standards change rapidly | Profiles become stale | Version profiles independently and record verification dates and sources |
| Competitors add verify | Foundational capabilities become commoditized | Deepen semantic diff, behavior contracts, and the public fixture corpus |
| Security scanner false positives | Users lose trust | Produce evidence-based output, separate deterministic and external scanners, and retain human review |
| Target Agent semantics are opaque | Compatibility cannot be proven | Emit `unknown`, require official documentation or fixtures, and do not guess |
| Users only want synchronization | Low initial conversion | Keep read-only inventory/adopt entry points and allow composition with existing synchronizers |
| Node runtime friction | First installation fails | Prioritize the npm entry point and provide prebuilt binaries later |
| Custom lockfile fragments the ecosystem | Poor long-term compatibility | Import existing lock data and track the Agent Skills distribution-layer RFC |
| Write operations overwrite user content | Data loss | Use plan/backup/apply/verify/journal and remain read-only by default |

---

## 19. Definition of Done

### MVP Completion Criteria

- [x] `npx skillsync scan` can scan at least three common target paths.
- [x] It can detect missing, duplicate, content-drifted, and unknown-provenance same-name Skills.
- [x] L0 structure validation covers frontmatter, references, scripts, and symlink boundaries.
- [x] Codex, Claude Code, and Cursor profiles have versions, documentation links, and fixtures.
- [x] `compat` can emit full support, warn, fail, and unknown.
- [x] `diff` can distinguish routing, capability, provenance, resource, and policy changes.
- [x] `verify` supports text, JSON, SARIF, and stable exit codes.
- [x] Scripts are not executed, content is not uploaded, and the disk is not modified by default.
- [x] GitHub Action and pre-commit templates can be generated and run.
- [x] invalid, compatibility-loss, and source-drift fixtures pass their tests.
- [x] The README lets a new user run the first verification command within five minutes.

As of 2026-08-05, all MVP acceptance criteria above are covered by the implementation, fixtures, and regression tests. The Runner,
provider adapter, egress, and remote worker currently implement only an auditable local contract layer; real network access,
credential injection, container execution, and microVM execution remain disabled and must pass an independent security review and controlled-environment acceptance before they can be enabled.

### Explicit Quality Gates

- Core domain logic has no network access, environment-variable access, or real filesystem side effects.
- Every new rule has positive, negative, and boundary fixtures.
- Every failure result has a stable code, message, and remediation.
- Every support claim in the documentation has a link, profile version, and verification date.
- “No findings” is not presented as “safe.”

---

## 20. Final Pitch

> `gh skill` helps you install, `skillshare` helps you synchronize, and SkillSync helps you prove that the version you reviewed, the version installed on the machine, and the version the Agent actually sees are still the same—and that it really works on that Agent.
