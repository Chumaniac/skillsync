# Per-order integer reconciliation

Status: source candidate for 0.1.5, 2026-10-09. This fixture is not in public
npm0.1.0 or the existing GitHub0.1.4 archive. All IDs and amounts are synthetic.
No account, payment, source fetch or Skill execution occurs.

Two expected orders total 3,000 minor units. Three allocation rows split one
order into 400 + 600 and deliver 2,000 to the other. File/schema/reference,
target coverage and global summary checks pass. The new check independently
groups integer values by the exact order ID and compares every group's total.

```bash
npm ci
npm run build
node dist/cli/index.js artifacts \
  --contract fixtures/product/keyed-reconciliation/contract.json \
  --path fixtures/product/keyed-reconciliation/artifacts --format json
```

The report keeps `execution: not-run` and `provenance: not-authenticated`.
Reconciliation summaries contain declared paths/columns and counts, not IDs,
key fingerprints or amounts.

## Balanced but wrong

The alternate allocation file still has three rows, valid covered IDs and a
3,000 total. It assigns 1,100 and 1,900 instead of 1,000 and 2,000. Existing
global checks alone cannot detect this shift; per-key reconciliation fails.
Use an independent temporary copy, preserving the successful fixture:

```bash
workspace="$(mktemp -d)"
cp -R fixtures/product/keyed-reconciliation/artifacts "$workspace/artifacts"
cp fixtures/product/keyed-reconciliation/faults/shifted-allocations.csv \
  "$workspace/artifacts/allocations.csv"
node dist/cli/index.js artifacts \
  --contract fixtures/product/keyed-reconciliation/contract.json \
  --path "$workspace/artifacts" --format json
```

The second command exits 1 and reports two mismatched key totals. It does not
authenticate the expected file or prove business authorization. Users must
review and protect their requirements separately.

The same rule can compare findings per changed file, citation counts per
source, or units per operational task. Use integer minor units/counts rather
than floating-point amounts. See [artifact rules](../../../docs/artifact-delivery.md)
and the [expansion roadmap](../../../docs/deep-optimization-roadmap.md).
