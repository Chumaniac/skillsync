# Expected delivery coverage — GitHub v0.1.4

This packaged synthetic example detects a different omission from dangling references:
all delivered rows can point to valid orders while an expected order has no rows.
The synthetic expected-order table is an explicit checklist, not an authenticated
order system. `require_all_targets: true` requires every declared unique target ID
to appear in the selected source field at least once. The default remains false.

Build the source or install the GitHub package, then run from the repository/package root:

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

The coverage option was introduced in source 0.1.3 and is included in the
published GitHub v0.1.4 package. The packaged example passed after installing
that public archive. The npm registry remains at 0.1.0; GitHub distribution and
real business acceptance are separate evidence.
