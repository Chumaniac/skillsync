# Offline domain adaptation

These source examples adapt existing SkillSync checks to three material-review
contexts. They are bundled under `fixtures/behavior`; no new provider, runtime,
network permission, Agent installation, or dependency is enabled.

| Fixture | Materials | Check | Evidence boundary |
| --- | --- | --- | --- |
| `domain-code-review` | Synthetic patch and review checklist | Required files and forbidden private folders | Structural preflight; no code review or script execution |
| `domain-knowledge-reference` | Bundled source and note template | Reference presence and private-folder exclusion | Presence is not external source truth or a vault integration |
| `domain-data-export` | Synthetic export event trace | Declared writes, required output, no tools/network | Offline Replay evidence; no real dataset, database, or analytics execution |

## Use the source build

```bash
npm ci
npm run build
node dist/cli/index.js test --fixture fixtures/behavior/domain-code-review \
  --agent codex --format json
node dist/cli/index.js test --fixture fixtures/behavior/domain-knowledge-reference \
  --agent codex --format json
node dist/cli/index.js test --fixture fixtures/behavior/domain-data-export --format json
node dist/cli/index.js test --fixture fixtures/behavior/domain-data-export \
  --execute --backend replay --format json
```

The v1 fixtures report `preflight-pass` and `execution: not-run` for their complete
materials. Missing references or a private folder produce explicit findings.
The v2 fixture also preflights without execution by default. The final command
explicitly replays synthetic events; `execution.backend: replay` does not mean
that a live Agent wrote the export. Changing the write to an undeclared path must
fail the invariant checks. No Docker image is pulled or executed by these examples.

Use `verify` separately for provenance, structure, and target-profile findings.
Use `fix --plan`, inspect, `fix --apply`, then a fresh `verify` for an approved
change. A `report` with both plan and receipt requires matching plan digests.
These findings are review material, not automatic permission to run a Skill.

The examples are current source additions, not part of the published npm0.1.0
package. Keep npm installation and source0.1.2 capabilities separate. Capability
profiles are maintained by this project using Agent documentation; a profile is
not vendor certification, and unknown/runtime-dependent features stay explicit.

## Next slices

- Current local candidate: the [knowledge source inventory](../fixtures/product/source-index/README.md)
  checks actual bounded CSV/JSON, exact HTTPS host declarations and independent
  reference counts. It is unmerged and does not verify external source truth.
- Add further versioned input-schema checks and bounded fixture resources.
- Add references and output-evidence requirements for additional domains.
- Validate a separately approved local execution backend using synthetic inputs
  before describing it as an actual integration.
- Keep [compatibility](compatibility.md), [security boundaries](security-boundary.md),
  and [the project overview](https://chumanic.com/projects/skillsync/) synchronized.
