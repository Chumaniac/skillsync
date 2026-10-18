# Citation metadata example

Status: current source; not in the published v0.1.7 package.

This original synthetic catalog binds each citation ID to the declared source
row and checks the exact digest and revision strings. It does not fetch a
source, authenticate an author, or validate a teaching rule.

```sh
skillsync artifacts --contract fixtures/product/citation-metadata/contract.json \
  --path fixtures/product/citation-metadata/artifacts --format html > review.html
```

A source build is required. In a copied artifact directory, change a citation's
revision from `r1` to `r2` while keeping its source ID. The current-source check
reports `artifact.reference-value-mismatch`, the CSV data-record position and
the declared metadata columns. It does not copy the ID or cell values into
JSON, text or HTML. Preserve the original example when trying a correction.

See the [contract guide](../../../docs/artifact-delivery.md#bind-citations-to-exact-source-metadata).
