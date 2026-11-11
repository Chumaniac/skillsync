# Multi-organization integer reconciliation

Status: source candidate0.1.6, 2026-10-10. IDs and amounts are synthetic.
This fixture is absent from GitHub0.1.4/npm0.1.0 and runs no Skill, network,
account or payment operation. Build the current source:

```bash
npm ci
npm run build
node dist/cli/index.js artifacts \
  --contract fixtures/product/tenant-reconciliation/contract.json \
  --path fixtures/product/tenant-reconciliation/artifacts --format json
```

ORG_A and ORG_B both use ORDER_1. Their expectations are 1,000 and 2,000 minor
units. Split allocation rows pass when grouped by the ordered
`["tenant_id", "order_id"]` tuple. A rule using only `order_id` merges these
organizations and can miss allocation errors.

Preserve the successful input and copy a fault into an independent directory:

```bash
workspace="$(mktemp -d)"
cp -R fixtures/product/tenant-reconciliation/artifacts "$workspace/artifacts"
cp fixtures/product/tenant-reconciliation/faults/shifted-allocations.csv \
  "$workspace/artifacts/allocations.csv"
node dist/cli/index.js artifacts \
  --contract fixtures/product/tenant-reconciliation/contract.json \
  --path "$workspace/artifacts" --format json
```

The second command exits1 and reports two mismatched tuple totals. Global
counts and total3,000 remain consistent. Keys have two to four required exact
string components; all components and values consume the bounded cell budget.
Findings expose only declared paths/columns and counts, not organization/order
values or per-record amounts.

Reports retain `execution: not-run` and `provenance: not-authenticated`.
Requirements and their ownership must be reviewed separately. No identity,
source truth, authorization or real financial integration is established.
See [artifact rules](../../../docs/artifact-delivery.md).
