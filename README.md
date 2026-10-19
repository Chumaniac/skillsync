# SkillSync

**Verify Agent Skills before you trust them.** SkillSync checks a local Skill's provenance, compatibility, and changes without executing it.

> **Alpha · GitHub release v0.2.1 · Node.js 20+**
> SkillSync performs offline checks of local Skill content. It does not execute Skill scripts, does not read credentials, and does not enable live provider, remote-worker, or runtime capabilities.

GitHub v0.2.1 locates citation metadata failures by file, data record and compared columns. It checks exact digests and revisions without copying record values into reports. The offline review, correction workflow and bounded composite-key reconciliation remain available. The npm registry stays at 0.1.0; use the verified GitHub archive for current features.

[![Terminal demo](https://raw.githubusercontent.com/Chumaniac/skillsync/main/docs/assets/verify-demo.svg)](https://github.com/Chumaniac/skillsync/blob/main/docs/assets/verify-demo.svg)

## Install

**From GitHub releases (no npm account required):**

Tagged builds now publish a CLI tarball, checksums, a validated CycloneDX SBOM
and a source manifest on [GitHub Releases](https://github.com/Chumaniac/skillsync/releases).
[GitHub v0.2.1](https://github.com/Chumaniac/skillsync/releases/tag/v0.2.1)
is distributed as a versioned CLI tarball with checksums, SBOM, source manifest
and GitHub provenance. Its release workflow requires the exact immutable tag
and an already successful main check before packaging. Earlier v0.1.7 assets
and their dated verification evidence remain in the changelog and GitHub Releases.
Installation uses Node.js 20+ and fetches the package's public dependencies;
it needs no npm login.

```bash
release_base="https://github.com/Chumaniac/skillsync/releases/download/v0.2.1"
for asset in chumanic-skillsync-0.2.1.tgz checksums.txt sbom.cyclonedx.json release-manifest.json; do
  curl --fail --location --output "$asset" "$release_base/$asset"
done
shasum -a 256 -c checksums.txt
npm install --prefix ./skillsync-tools ./chumanic-skillsync-0.2.1.tgz
./skillsync-tools/node_modules/.bin/skillsync --version
```

The public npm registry remains at 0.1.0. Generated npm-based CI templates pin
that existing public version; a source/GitHub installation supplies the newer
artifact and target-coverage commands. Older tags and the existing npm package
remain available independently of this distribution.

**Earlier npm package (0.1.0):**

```bash
npx --yes @chumanic/skillsync@0.1.0 verify --path . --target codex
# or install globally
npm install -g @chumanic/skillsync@0.1.0
skillsync verify --path . --target codex
```

**From source (0.2.1):**

```bash
git clone https://github.com/Chumaniac/skillsync.git
cd skillsync
npm ci
npm run build
node dist/cli/index.js verify --path fixtures/product/trust-loop/review --target codex
```

The command above verifies the included sample Skill. Replace the fixture path with a directory containing your own `SKILL.md` when you are ready.

## What you get

- v0.2.0 can bind a citation to its exact declared source metadata with
  `reference_exists.matches`. An existing ID with a different digest or revision
  fails offline inspection without exposing record values. See the
  [synthetic citation example](fixtures/product/citation-metadata/README.md).
  Install GitHub v0.2.0 or build the source; GitHub v0.1.7 and npm 0.1.0 lack this feature.

- v0.1.7 produces an offline acceptance report with `artifacts --format html`.
  Reviewers see file binding, failed or incomplete identity checks, affected
  metadata and concrete review actions in a browser. The report includes no raw
  record values, scripts or network requests; see [the visible review guide](docs/artifact-delivery.md#hand-a-visible-report-to-a-reviewer).
- v0.1.7 supports ordered two-to-four-column identity tuples for integer
  reconciliation. The [multi-organization example](fixtures/product/tenant-reconciliation/README.md)
  separates repeated local IDs, without delimiter collisions or raw ID reporting.
- `keyed_integer_sum_equals` checks compare each record key's integer
  total across CSV files, including split deliveries. They detect balanced but
  wrongly allocated results that global sums cannot identify. The
  [synthetic reconciliation example](fixtures/product/keyed-reconciliation/README.md)
  demonstrates the difference without running Skill code or revealing record IDs.
- The `artifacts` command independently checks actual
  CSV/JSON delivery files, Receipt/file hashes and cross-file count/integer sums.
  See [actual artifact checks](docs/artifact-delivery.md); it runs no Skill code.
  The [knowledge source inventory](fixtures/product/source-index/README.md) adds
  exact declared HTTPS hosts to physical CSV/JSON checks without fetching sources.
  Optional target coverage catches expected records with no delivery/evidence rows;
  see the [delivery coverage example](fixtures/product/delivery-coverage/README.md).
  CSV `reference_exists` checks also bind exact string IDs to a declared unique
  CSV target, with a 100,000-cell reference limit and no raw IDs in findings.
  The [reference-integrity example](fixtures/product/reference-integrity/README.md)
  demonstrates missing citations using synthetic files; it does not fetch or
  authenticate sources.
  The [material intake catalog](fixtures/product/review-intake/README.md) rejects
  unknown classification labels using bounded `one_of` strings; labels do not prove approval.
- `verify` reviews one local Skill for provenance, target compatibility, and changes without running its scripts.
- `scan` inventories local Skills, while `compat` checks their declared features against agent profiles.
- `diff` shows the meaningful changes between two Skill versions before you accept them.
- The trust loop is explicit: `verify`, review the findings, use `fix --plan`, confirm with `fix --apply`, run `verify` again, then use `report` to compare the before and after evidence.
- When `report` includes both `--plan` and `--receipt`, their plan digests must
  match. This consistency check does not authenticate externally supplied
  evidence or replace a fresh verification run.

`pass`, `warn`, `fail`, and `unknown` are findings to review, not an automatic approval. `fix --apply` records an explicit change; only a subsequent `verify` establishes the new state.

## Bounded inputs and CI decisions (current source)

Inventory shares one budget across all requested paths: 10,000 files, 1,000
Skills, 64 targets, 20,000 directory entries, depth 64, 16 MiB per file and
64 MiB total. Oversized, unreadable or changing inputs stop the scan with exit 2;
no partial inventory is presented as complete. Internal symlink targets count
against the same budget when following links is explicitly enabled.

Report, lock, baseline, fix-plan, Runner and fixture control files are limited
to 8 MiB. Policy and external profile files are limited to 1 MiB. Inputs must
be stable regular UTF-8 files; duplicate JSON keys are rejected in reports,
locks, baselines and fix plans. Staging applies the file/tree budgets before
copying and binds its input digest to the staged Skill bytes.

`report` normally renders supplied evidence and exits successfully even if its
conclusion is unverified. For a CI gate, use the source-only option:

```bash
skillsync report --before before.json --after after.json --fail-on-unverified
```

This returns exit 1 for an unverified conclusion, or exit 2 for invalid report
input. It evaluates the supplied after-report; it does not rerun verification
or authenticate that report. Run `verify` on the current files first. These
maintenance changes are included in GitHub v0.1.7 and are absent from npm 0.1.0.

## Reference

- [Project overview](https://chumanic.com/projects/skillsync/)
- [Offline domain adaptation](./docs/domain-adaptation.md)
- [Expansion and deep optimization roadmap](./docs/deep-optimization-roadmap.md)
- [Security and privacy](./docs/security-boundary.md)
- [Compatibility profiles](./docs/compatibility.md)
- [CI](./docs/ci.md)
- [Runner](./docs/runner-contract.md)
- [Full design](./SkillSync-Complete-Design.md)

### Offline verification review

Install GitHub v0.1.7 or build the source checkout, then run `skillsync verify --path ./skills --format html > verification.html`. Open the report locally to review severity groups, causes, and next steps. Summary counts cover all findings; details are capped at 256 deduplicated issues. JSON retains complete evidence. No scripts, network assets, Skill execution, or automatic fixes are added. Inspired by [MLflow's reviewable tracking UI](https://mlflow.org/docs/latest/ml/tracking/). This option is included in the GitHub v0.1.7 package; npm 0.1.0 does not include it.
