# Expected delivery coverage — local candidate

This source-only candidate detects a different omission from dangling references:
all delivered rows can point to valid orders while an expected order has no rows.
The synthetic expected-order table is an explicit checklist, not an authenticated
order system. `require_all_targets: true` requires every declared unique target ID
to appear in the selected source field at least once. The default remains false.

Build the candidate source, then run:

```bash
node dist/cli/index.js artifacts --contract fixtures/product/delivery-coverage/contract.json --path fixtures/product/delivery-coverage/artifacts --format json
```

The complete example passes. In a temporary copy, remove the `DEMO-ORDER-B` item
line while retaining its expected-order row: the report fails with
`artifact.reference-unused` at target data-row 2, without showing the ID. Adding
a line for an undeclared order still fails the existing `reference-missing` check.

Adapt the two tables to declared findings and evidence for code review, required
references and citations for knowledge material, or expected records and actual
delivery rows for operations. Coverage establishes local reference presence only:
it does not establish review quality, source truth, approval, payment or shipment.

Only nonempty exact CSV strings and single-column unique targets are supported.
All relation checks remain within the shared 100,000-cell index and 256-finding
ceilings; the indexes store fingerprints and row numbers rather than ID contents.
No runtime, network, account or real business integration is executed.

As of this candidate, the new coverage option is local, not pushed to GitHub main
or included in a public npm package.
