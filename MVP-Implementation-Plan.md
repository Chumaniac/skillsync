# SkillSync MVP Implementation Plan

> **Summary:** Task-by-task implementation plan for SkillSync's local-first verification CLI, from deterministic domain models through release readiness.
> **Status:** Implemented; Tasks 1-11 and the final review checklist are complete.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Each task ends with an independently testable deliverable.

**Goal:** Build a local-first CLI that scans existing Agent Skill directories and verifies structure, provenance, target compatibility, semantic changes, policy and CI output without executing Skill code by default.

**Architecture:** Keep the domain core pure and deterministic. Filesystem discovery, Git metadata, CLI orchestration, external scanners and reporters are adapters around the core. The MVP will not own Skill installation or synchronization; it will consume existing layouts and emit evidence that other tools and CI can use.

**Tech Stack:** TypeScript 5.x, Node.js 20+, npm, Commander, `yaml`, Zod, Node `crypto`, Vitest, JSON and SARIF.

## Global Constraints

- Default commands are read-only, offline, and do not execute Skill scripts.
- Core domain modules must not read environment variables, call the network, or mutate real user directories.
- Every verification finding has a stable code, severity, message, evidence and remediation.
- Unknown Agent capability must produce `unknown` or `warn`, never an invented `pass`.
- Hashes ignore mtime and inode metadata and use normalized relative paths plus file content.
- `--format json` must be stable enough for CI fixtures; text output can evolve separately.
- The MVP supports Codex, Claude Code and Cursor profiles only after each has a profile version, source link and fixture.
- Security output reports evidence and limitations; it never certifies a Skill as absolutely safe.
- Write commands are outside the MVP except for `ci init`, which writes only the explicitly requested CI file.

---

## File Map

The implementation starts as a single npm package. Do not create a monorepo until the public domain interfaces are stable.

```text
skill-sync/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── cli/
│   │   ├── index.ts
│   │   ├── output.ts
│   │   └── commands/
│   │       ├── scan.ts
│   │       ├── verify.ts
│   │       ├── compat.ts
│   │       ├── diff.ts
│   │       └── ci.ts
│   ├── domain/
│   │   ├── skill.ts
│   │   ├── result.ts
│   │   ├── digest.ts
│   │   ├── frontmatter.ts
│   │   ├── inventory.ts
│   │   ├── compatibility.ts
│   │   ├── semantic-diff.ts
│   │   └── policy.ts
│   ├── profiles/
│   │   ├── types.ts
│   │   ├── codex.ts
│   │   ├── claude-code.ts
│   │   └── cursor.ts
│   ├── scanners/
│   │   ├── structure.ts
│   │   ├── capabilities.ts
│   │   └── provenance.ts
│   └── reporters/
│       ├── text.ts
│       ├── json.ts
│       └── sarif.ts
├── profiles/
│   ├── codex.v1.yaml
│   ├── claude-code.v1.yaml
│   └── cursor.v1.yaml
├── fixtures/
│   ├── invalid/
│   ├── compatibility/
│   ├── provenance/
│   └── semantic-diff/
└── tests/
    ├── domain/
    ├── cli/
    └── reporters/
```

---

## Task 1: Create the package shell and CLI contract

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/cli/index.ts`
- Create: `src/cli/output.ts`
- Create: `tests/cli/help.test.ts`

**Interfaces:**

- `src/cli/index.ts` exposes the executable entry point and registers `scan`, `verify`, `compat`, `diff`, and `ci`.
- `src/cli/output.ts` exposes `writeResult(result, format, stream)` and supports `text`, `json`, and the later `sarif` reporter interface.
- Each command returns an integer exit code instead of calling `process.exit` inside domain code.

- [x] **Step 1: Write the failing CLI help test**

```ts
it("lists the verification commands", async () => {
  const result = await runCli(["--help"]);
  expect(result.stdout).toContain("scan");
  expect(result.stdout).toContain("verify");
  expect(result.stdout).toContain("compat");
  expect(result.stdout).toContain("diff");
  expect(result.stdout).toContain("ci");
  expect(result.exitCode).toBe(0);
});
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run: `npm test -- tests/cli/help.test.ts`

Expected: FAIL because the CLI entry point and command registry do not exist.

- [x] **Step 3: Implement the minimum package and command registry**

Use Commander, register the five command names, add `--format` with `text` as the default, and return exit code `0` for help.

- [x] **Step 4: Run the focused test and confirm it passes**

Run: `npm test -- tests/cli/help.test.ts`

Expected: PASS.

- [x] **Step 5: Run the type check**

Run: `npx tsc --noEmit`

Expected: no TypeScript errors.

---

## Task 2: Implement normalized Skill models and deterministic digests

**Files:**

- Create: `src/domain/skill.ts`
- Create: `src/domain/result.ts`
- Create: `src/domain/digest.ts`
- Create: `tests/domain/digest.test.ts`
- Create: `tests/domain/skill.test.ts`

**Interfaces:**

```ts
export type SkillSource = {
  kind: "git" | "local" | "unknown";
  url?: string;
  ref?: string;
  resolvedCommit?: string;
};

export type SkillFile = {
  relativePath: string;
  content: Buffer;
  mode: number;
  isSymlink: boolean;
};

export type Skill = {
  name: string;
  rootPath: string;
  skillMdPath: string;
  frontmatter: Record<string, unknown>;
  files: SkillFile[];
  source: SkillSource;
  digest: string;
};

export type Finding = {
  level: 0 | 1 | 2 | 3 | 4;
  severity: "info" | "warn" | "error" | "critical";
  status: "pass" | "warn" | "fail" | "unknown";
  code: string;
  skill: string;
  target?: string;
  message: string;
  evidence: Array<Record<string, string>>;
  remediation?: string;
};
```

- [x] **Step 1: Write digest tests for ordering and metadata stability**

Cover these cases:

1. The same files in different input order produce the same digest.
2. mtime changes do not change the digest.
3. Content changes do change the digest.
4. A path traversal entry is rejected before hashing.
5. Symlink metadata is represented explicitly and is not silently followed outside the root.

- [x] **Step 2: Run the digest tests and confirm they fail**

Run: `npm test -- tests/domain/digest.test.ts`

Expected: FAIL because `computeSkillDigest` and path normalization are not implemented.

- [x] **Step 3: Implement normalized digesting**

Normalize slash direction, sort relative paths lexicographically, include file mode and content, reject absolute paths and `..` segments, and prefix the final SHA-256 with `sha256:`.

- [x] **Step 4: Run digest tests and confirm they pass**

Run: `npm test -- tests/domain/digest.test.ts`

Expected: PASS.

- [x] **Step 5: Add Zod schemas for Skill, Source and Finding**

Run: `npm test -- tests/domain/skill.test.ts`

Expected: PASS with valid objects accepted and invalid status/severity values rejected.

---

## Task 3: Implement filesystem inventory and `scan`

**Files:**

- Create: `src/domain/inventory.ts`
- Create: `src/cli/commands/scan.ts`
- Create: `tests/domain/inventory.test.ts`
- Create: `tests/cli/scan.test.ts`
- Create: `fixtures/provenance/duplicate-a/skills/review/SKILL.md`
- Create: `fixtures/provenance/duplicate-b/skills/review/SKILL.md`

**Interfaces:**

```ts
export type ScanTarget = {
  name: string;
  path: string;
  scope: "project" | "user" | "explicit";
  profileId?: string;
};

export type Inventory = {
  targets: ScanTarget[];
  skills: Skill[];
  findings: Finding[];
};

export async function scanInventory(
  targets: ScanTarget[],
  options?: { followSymlinks?: boolean }
): Promise<Inventory>;
```

- [x] **Step 1: Write inventory tests**

Cover missing directories, valid Skill folders, duplicate names with identical digest, duplicate names with different digest, local-only target entries and broken symlinks.

- [x] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/domain/inventory.test.ts tests/cli/scan.test.ts`

Expected: FAIL because inventory discovery is absent.

- [x] **Step 3: Implement explicit and conventional target discovery**

Support explicit `--path` first. Add project/user defaults for `.claude/skills`, `.agents/skills`, `.cursor/skills`, `~/.claude/skills`, `~/.agents/skills`, and `~/.cursor/skills` without reading secrets or configuration files unrelated to Skill paths.

- [x] **Step 4: Emit duplicate and drift findings**

Group by logical Skill name, compare digests, and produce stable codes `inventory.missing-target`, `inventory.duplicate-identical`, `inventory.duplicate-drift`, `inventory.broken-symlink`, and `inventory.unknown-source`.

- [x] **Step 5: Run focused tests and type check**

Run: `npm test -- tests/domain/inventory.test.ts tests/cli/scan.test.ts && npx tsc --noEmit`

Expected: all focused tests pass and type check is clean.

---

## Task 4: Implement frontmatter and L0 structure verification

**Files:**

- Create: `src/domain/frontmatter.ts`
- Create: `src/scanners/structure.ts`
- Create: `tests/domain/frontmatter.test.ts`
- Create: `tests/domain/structure.test.ts`
- Create: `fixtures/invalid/missing-frontmatter/SKILL.md`
- Create: `fixtures/invalid/invalid-yaml/SKILL.md`
- Create: `fixtures/invalid/missing-reference/SKILL.md`
- Create: `fixtures/invalid/path-traversal/SKILL.md`

**Interfaces:**

```ts
export type ParsedSkillDocument = {
  frontmatter: Record<string, unknown>;
  body: string;
  sourceRange: { start: number; end: number };
};

export function parseSkillDocument(content: string):
  | { ok: true; value: ParsedSkillDocument }
  | { ok: false; error: string };

export function inspectStructure(skill: Skill): Finding[];
```

- [x] **Step 1: Write parser and structure tests**

Cover valid YAML, missing delimiters, invalid YAML, non-string `name`, missing `description`, directory/name mismatch, missing relative resources, unsafe paths and scripts outside the root.

- [x] **Step 2: Run focused tests and confirm they fail**

Run: `npm test -- tests/domain/frontmatter.test.ts tests/domain/structure.test.ts`

Expected: FAIL because parsing and structure scanning are not implemented.

- [x] **Step 3: Implement parser without executing any content**

Use `yaml` only for parsing. Preserve body text, reject duplicate keys according to the selected parser policy, and return structured errors without printing full file contents.

- [x] **Step 4: Implement L0 findings**

Use stable codes `structure.missing-skill-md`, `structure.invalid-frontmatter`, `structure.missing-name`, `structure.missing-description`, `structure.name-mismatch`, `structure.missing-reference`, `structure.unsafe-path`, and `structure.invalid-script-mode`.

- [x] **Step 5: Run fixture tests and type check**

Run: `npm test -- tests/domain/frontmatter.test.ts tests/domain/structure.test.ts && npx tsc --noEmit`

Expected: PASS and no TypeScript errors.

---

## Task 5: Add versioned Agent capability profiles and `compat`

**Files:**

- Create: `src/profiles/types.ts`
- Create: `src/profiles/codex.ts`
- Create: `src/profiles/claude-code.ts`
- Create: `src/profiles/cursor.ts`
- Create: `src/domain/compatibility.ts`
- Create: `src/cli/commands/compat.ts`
- Create: `profiles/codex.v1.yaml`
- Create: `profiles/claude-code.v1.yaml`
- Create: `profiles/cursor.v1.yaml`
- Create: `tests/domain/compatibility.test.ts`
- Create: `tests/cli/compat.test.ts`
- Create: `fixtures/compatibility/allowed-tools-loss/SKILL.md`
- Create: `fixtures/compatibility/context-fork-loss/SKILL.md`

**Interfaces:**

```ts
export type SupportStatus = "supported" | "unsupported" | "ignored" | "runtime-dependent" | "unknown";

export type CapabilityProfile = {
  id: string;
  version: number;
  docsUrl: string;
  projectPath: string;
  userPath: string;
  features: Record<string, SupportStatus>;
  semantics: Record<string, "pass" | "warn" | "fail" | "unknown">;
};

export function evaluateCompatibility(
  skill: Skill,
  profile: CapabilityProfile
): Finding[];
```

- [x] **Step 1: Write profile validation tests**

Require profile ID, positive version, official docs URL, project/user paths, feature map and semantics map. Reject unsupported status strings.

- [x] **Step 2: Write compatibility fixture tests**

Assert that a Skill using a supported feature passes, a known ignored feature warns, an explicitly unsupported feature fails for a required target, and an unknown feature returns `unknown`.

- [x] **Step 3: Run tests and confirm they fail**

Run: `npm test -- tests/domain/compatibility.test.ts tests/cli/compat.test.ts`

Expected: FAIL because profiles and compatibility evaluation are absent.

- [x] **Step 4: Implement data-driven profile loading**

Load profile YAML from packaged data, validate with Zod, and keep profile-specific logic out of the core evaluator.

- [x] **Step 5: Implement `compat` output and target selection**

Support `--target` as a comma-separated list, emit one finding per target/feature, and return exit code `1` only when policy marks the compatibility loss as blocking.

- [x] **Step 6: Run focused tests, type check and lint**

Run: `npm test -- tests/domain/compatibility.test.ts tests/cli/compat.test.ts && npx tsc --noEmit && npm run lint`

Expected: all pass with no new lint errors.

---

## Task 6: Implement provenance, Git resolution and lock validation

**Files:**

- Create: `src/scanners/provenance.ts`
- Create: `src/domain/lockfile.ts`
- Create: `tests/domain/provenance.test.ts`
- Create: `tests/domain/lockfile.test.ts`
- Create: `fixtures/provenance/locked.json`
- Create: `fixtures/provenance/unknown-source.json`

**Interfaces:**

```ts
export type ProvenanceEvidence = {
  source: SkillSource;
  contentDigest: string;
  resolvedCommit?: string;
  evidenceStatus: "verified" | "local-only" | "unknown";
};

export function inspectProvenance(skill: Skill): Promise<Finding[]>;

export type SkillLock = {
  schema_version: 1;
  generated_at: string;
  skills: Record<string, {
    source: SkillSource;
    content_digest: string;
    targets: Record<string, { profile: string; status: string; report_digest?: string }>;
  }>;
};

export function validateLock(lock: unknown): SkillLock;
```

- [x] **Step 1: Write provenance tests**

Cover local-only source, Git source with resolved commit, missing commit, digest mismatch and a path that is not allowed by policy.

- [x] **Step 2: Write lock schema tests**

Cover valid schema, unknown schema version, duplicate skill names, invalid digest, invalid status and target profile mismatch.

- [x] **Step 3: Run focused tests and confirm they fail**

Run: `npm test -- tests/domain/provenance.test.ts tests/domain/lockfile.test.ts`

Expected: FAIL because provenance inspection and lock validation are absent.

- [x] **Step 4: Implement local provenance first**

Read only Git metadata that is available in the Skill source tree. When remote resolution is unavailable, return `local-only` or `unknown` rather than attempting a network request.

- [x] **Step 5: Implement lock validation and import shape**

Accept the relevant fields from `npx skills` lock data without silently claiming it is a complete manifest. Convert it into the internal model and preserve original fields under a namespaced metadata object.

- [x] **Step 6: Run tests and type check**

Run: `npm test -- tests/domain/provenance.test.ts tests/domain/lockfile.test.ts && npx tsc --noEmit`

Expected: PASS and no TypeScript errors.

---

## Task 7: Implement semantic diff and policy evaluation

**Files:**

- Create: `src/domain/semantic-diff.ts`
- Create: `src/domain/policy.ts`
- Create: `tests/domain/semantic-diff.test.ts`
- Create: `tests/domain/policy.test.ts`
- Create: `fixtures/semantic-diff/routing-change-before/SKILL.md`
- Create: `fixtures/semantic-diff/routing-change-after/SKILL.md`
- Create: `fixtures/semantic-diff/capability-change-before/SKILL.md`
- Create: `fixtures/semantic-diff/capability-change-after/SKILL.md`

**Interfaces:**

```ts
export type SemanticChangeKind =
  | "routing-change"
  | "capability-change"
  | "compatibility-loss"
  | "provenance-change"
  | "resource-change"
  | "policy-change";

export type SemanticChange = {
  kind: SemanticChangeKind;
  skill: string;
  summary: string;
  evidence: Array<Record<string, string>>;
};

export function compareSkills(before: Skill, after: Skill): SemanticChange[];

export function evaluatePolicy(
  findings: Finding[],
  policy: Policy
): { findings: Finding[]; exitCode: 0 | 1 | 2 | 3 | 4 };
```

- [x] **Step 1: Write semantic diff tests**

Cover description trigger expansion, `allowed-tools` change, script addition, reference deletion, source commit change and target compatibility loss.

- [x] **Step 2: Write policy tests**

Cover warning-only result, required-target compatibility failure, unknown provenance blocked by policy, and invalid policy configuration returning exit code `2`.

- [x] **Step 3: Run focused tests and confirm they fail**

Run: `npm test -- tests/domain/semantic-diff.test.ts tests/domain/policy.test.ts`

Expected: FAIL because semantic comparison and policy evaluation are absent.

- [x] **Step 4: Implement normalized semantic comparison**

Compare parsed frontmatter fields, resource inventory, script capabilities and provenance metadata. Do not compare raw YAML ordering as a semantic change.

- [x] **Step 5: Implement policy evaluation**

Load policy from an explicit path, apply defaults from the design document, and produce deterministic blocking behavior.

- [x] **Step 6: Run tests, type check and lint**

Run: `npm test -- tests/domain/semantic-diff.test.ts tests/domain/policy.test.ts && npx tsc --noEmit && npm run lint`

Expected: PASS with no new lint errors.

---

## Task 8: Implement `verify` orchestration and reporters

**Files:**

- Create: `src/cli/commands/verify.ts`
- Create: `src/reporters/text.ts`
- Create: `src/reporters/json.ts`
- Create: `src/reporters/sarif.ts`
- Create: `tests/cli/verify.test.ts`
- Create: `tests/reporters/sarif.test.ts`

**Interfaces:**

```ts
export type VerificationReport = {
  schema_version: 1;
  generated_at: string;
  targets: ScanTarget[];
  findings: Finding[];
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
    unknown: number;
  };
};

export function runVerification(options: VerifyOptions): Promise<VerificationReport>;
export function renderText(report: VerificationReport): string;
export function renderJson(report: VerificationReport): string;
export function renderSarif(report: VerificationReport): string;
```

- [x] **Step 1: Write orchestration tests**

Use fixtures and an in-memory filesystem adapter. Assert that `verify` runs L0-L3, aggregates all findings, does not execute scripts, and produces stable summary counts.

- [x] **Step 2: Write SARIF tests**

Assert SARIF version, tool name, rule IDs, result levels, file locations and remediation messages.

- [x] **Step 3: Run focused tests and confirm they fail**

Run: `npm test -- tests/cli/verify.test.ts tests/reporters/sarif.test.ts`

Expected: FAIL because orchestration and reporters are absent.

- [x] **Step 4: Implement the verification pipeline**

Pipeline order: inventory → structure → provenance → compatibility → capability scanner → policy. Keep findings from each stage even if a prior stage fails.

- [x] **Step 5: Implement text, JSON and SARIF output**

Text output groups by Skill and target; JSON follows the report schema; SARIF maps `warn` to `warning` and `fail/critical` to `error`.

- [x] **Step 6: Run focused tests and full unit suite**

Run: `npm test -- tests/cli/verify.test.ts tests/reporters/sarif.test.ts && npm test`

Expected: all tests pass.

---

## Task 9: Implement GitHub Action and pre-commit templates

**Files:**

- Create: `src/cli/commands/ci.ts`
- Create: `templates/github/skillsync.yml`
- Create: `templates/pre-commit/skillsync.yaml`
- Create: `tests/cli/ci.test.ts`
- Create: `docs/ci.md`

**Interfaces:**

```ts
export function renderGitHubAction(options: {
  nodeVersion: string;
  paths: string[];
}): string;

export function renderPreCommit(options: {
  paths: string[];
}): string;
```

- [x] **Step 1: Write template tests**

Assert that generated GitHub Action installs the package, runs `skillsync verify --format sarif`, uploads SARIF, and uses read-only contents permission. Assert pre-commit maps staged Skill paths to verification.

- [x] **Step 2: Run tests and confirm they fail**

Run: `npm test -- tests/cli/ci.test.ts`

Expected: FAIL because templates and command are absent.

- [x] **Step 3: Implement template rendering**

Use static templates with only validated path and Node version interpolation. Reject absolute paths and unescaped newlines in user-provided options.

- [x] **Step 4: Implement `skillsync ci init`**

Default to plan output. Require `--apply` for writing. Refuse to overwrite an existing file unless `--force` is explicitly provided.

- [x] **Step 5: Run tests and type check**

Run: `npm test -- tests/cli/ci.test.ts && npx tsc --noEmit`

Expected: PASS and no TypeScript errors.

---

## Task 10: Add safety regression fixtures and dogfood verification

**Files:**

- Create: `fixtures/invalid/secret-looking-content/SKILL.md`
- Create: `fixtures/invalid/unsafe-symlink/`
- Create: `fixtures/invalid/archive-traversal/`
- Create: `tests/security/no-execution.test.ts`
- Create: `tests/security/path-boundary.test.ts`
- Create: `tests/integration/dogfood-report.test.ts`
- Create: `.github/workflows/skillsync.yml`
- Create: `README.md`

- [x] **Step 1: Write no-execution regression tests**

Create a fixture script that would write a marker file if executed. Run scan/verify and assert the marker is absent.

- [x] **Step 2: Write path boundary tests**

Assert that `../outside`, absolute references, and symlinks escaping the Skill root are rejected or warned according to policy without reading outside the test sandbox.

- [x] **Step 3: Run focused security tests and confirm they fail**

Run: `npm test -- tests/security/no-execution.test.ts tests/security/path-boundary.test.ts`

Expected: FAIL until the explicit boundaries are enforced.

- [x] **Step 4: Implement the safety guards and fixture corpus**

Do not add an execution path to make a test pass. Use filesystem mocks or temporary test directories with explicit roots.

- [x] **Step 5: Run full verification**

Run: `npm test && npx tsc --noEmit && npm run lint`

Expected: all tests pass, type check is clean, and lint reports no new errors.

- [x] **Step 6: Dogfood against real local Skill directories**

Run from a temporary copy or read-only mode:

```bash
npx skillsync scan --path ~/.agents/skills --path ~/.claude/skills
npx skillsync verify --format json
```

Expected: the report identifies any existing drift or unknown provenance without changing either directory.

Recorded result: `docs/dogfood-2026-08-05.md`.

---

## Task 11: Documentation and release readiness

**Files:**

- Modify: `README.md`
- Create: `docs/compatibility.md`
- Create: `docs/security-boundary.md`
- Create: `docs/authoring-fixtures.md`
- Create: `CHANGELOG.md`
- Create: `LICENSE`

- [x] **Step 1: Write documentation checks**

Manually verify the README contains the one-command scan, read-only guarantee, supported profiles, CI example, non-goals, and links to the Agent Skills standard.

- [x] **Step 2: Document compatibility evidence**

For each profile, include docs URL, profile version, supported feature list, unknown behavior and fixture path.

- [x] **Step 3: Document security limitations**

State that static verification is not a security certification, scripts are not run by default, content is not uploaded, and external scanner results are optional evidence.

- [x] **Step 4: Run the release gate**

Run:

```bash
npm test
npx tsc --noEmit
npm run lint
npm pack --dry-run
```

Expected: all tests pass, no TypeScript errors, no new lint errors, and the package contains CLI entry points, profiles, reporters, templates and documentation.

---

## Final Review Checklist

- [x] Every requirement in `SkillSync-Complete-Design.md` maps to one or more tasks above.
- [x] No task assumes a function or type that has not been defined in an earlier task or its own Interfaces block.
- [x] No task uses a placeholder such as TBD, TODO or “implement later”.
- [x] No default command executes Skill code or performs network access.
- [x] Profile claims are backed by versioned data, docs links and fixtures.
- [x] `skillsync verify` can run locally before GitHub integration is configured.
- [x] The first release communicates verification evidence, not an absolute security promise.
