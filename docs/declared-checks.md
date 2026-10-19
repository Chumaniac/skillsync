# Review declared cross-file checks

Artifact text, JSON and standalone HTML reports now include the validated cross-file declarations and file/byte limits. The three supported kinds are CSV summaries, reference existence/metadata bindings, and integer reconciliation by identity. This lets a reviewer see the selected paths, fields, identity columns and mappings without reopening the contract.

Declarations describe expectations; they are separate from completed observations and findings. They remain visible when a required file is missing. Invalid contracts have no inferred declaration list, and legacy JSON baselines without this optional metadata remain accepted. Per-file type, digest and scalar-value rules remain in the original contract: expected values, enum choices, raw IDs and cell values are not copied into the list.

The contract/parser limit is 128 cross-file checks. HTML shows all 128 and up to 8 mappings per check, clips metadata at 160 characters and has no scripts or external requests. JSON retains complete declared mappings; report input remains bounded and validated when used as a baseline.

Method reference: [CLI-Anything's structured and verifiable output](https://github.com/HKUDS/CLI-Anything/blob/34f519533bc175d2fe287ab8316b0dd99bb9cc43/README.md), Apache-2.0, reviewed from the 2026-10-19 Trending snapshot. Only the output-review method is borrowed; no upstream executable or plugin is installed.

From a source checkout, try the original synthetic fixture:

```sh
node dist/cli/index.js artifacts --contract fixtures/product/declared-checks/contract.json --path fixtures/product/declared-checks/artifacts --format html > declared-checks.html
```

The packaged CLI includes the same fixture under its package directory. Open the resulting HTML and select **Declared checks** to review all three kinds before inspecting outcomes.
