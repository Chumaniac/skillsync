# Multi-delivery acceptance and portable review

Current source adds an explicit acceptance plan over one artifact contract and up to 16 named artifact or SkillTape delivery directories. It runs the existing physical-file engine sequentially, never Skill code. A result passes only when every current batch has complete passing evidence. Incomplete input, saturated findings or unverifiable delivery binding remain incomplete.

```json
{
  "schema": "skillsync.acceptance-plan/v1",
  "contract": "contract.json",
  "batches": [
    {"id": "north", "path": "deliveries/north", "kind": "artifacts"},
    {"id": "south", "path": "deliveries/south", "kind": "artifacts"}
  ]
}
```

Paths are relative to the plan directory. Choose real directories without symbolic parents and declare only contract files. Undeclared files/directories are rejected before body inspection. Delivery mode also expects the existing receipt and delivery manifest.

```bash
skillsync batch preview --plan /project/acceptance-plan.json
skillsync batch run --plan /project/acceptance-plan.json --output /project/first-review.json
# Correct failed sources, then produce a separate immutable package.
skillsync batch run --plan /project/acceptance-plan.json --previous /project/first-review.json --retry-failed --output /project/corrected-review.json
skillsync batch inspect --package /project/corrected-review.json --contract /project/contract.json --plan /project/acceptance-plan.json --format html > review.html
```

The run exits 0 for all passed, 1 for failed, or 2 for incomplete/invalid evidence. Inspection exits 0 when the package is internally valid even if its acceptance result failed; use the embedded status/exitCode when making an acceptance decision. Output files must be new; existing packages and source files are never overwritten. A retry verifies passed input hashes before reusing evidence. Changed contract bytes, case identities or passed input content require a fresh run, without reusing the previous package. Current and prior reports remain available for comparison; unknown or truncated evidence cannot claim resolved findings.

In **gui**, expand **多批次验收与离线复核包**, choose a plan and preflight it, then explicitly run into a new file. After a correction, select the prior package and the failed-only option, preflight again and run into another new file. Open an existing package read-only with an optional expected SHA-256 obtained independently. Opening evidence clears any single-Skill repair capability. Cancellation may retain an already published package: inspect the chosen output before retrying.

The single JSON package includes the exact original plan SHA-256, the public declaration, per-batch file inventory, file/report hashes, complete bounded reports and comparisons. It omits source bodies, raw record values, contract expected scalar values and absolute source paths. Relative file names, case names and column metadata may still be sensitive. The scriptless HTML view can be reconstructed offline; oversized detail views are omitted with a visible notice, while the bounded JSON evidence remains.

Shared admission limits: 16 batches, 10,000 files, 20,000 input entries, 16 MiB/file and 64 MiB total input. Each report is at most 1 MiB, all current/prior reports together at most 8 MiB, and the final package at most 16 MiB. Plan metadata is limited to 256 KiB and contract metadata to 64 KiB. Processing is serial; metadata is checked before file bodies and stable source bindings are rechecked.

Package verification checks internal structure, counts, file/report digest bindings and comparison consistency. An expected package SHA-256 binds exact bytes; supplying the original contract also verifies its exact bytes and declaration scope. Optional `--plan` checks exact plan bytes without reading source data; a source-path mapping change also invalidates prior-plan reuse. These checks do not authenticate authorship, fetch cited sources, rerun original business data, or establish production acceptance. A self-consistent replacement package can be written by anyone; keep the digest through an independent trusted channel.

The design independently applies declared validation batches and retained validation results described by [Great Expectations Checkpoints](https://docs.greatexpectations.io/docs/reference/api/checkpoint_class/) and [Frictionless validation](https://framework.frictionlessdata.io/docs/guides/validating-data). No upstream code or runtime dependency is copied. This source change does not republish existing v0.3.0 downloads or npm releases.
