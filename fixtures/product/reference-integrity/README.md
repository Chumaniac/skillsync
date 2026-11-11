# Offline reference integrity

This source-only synthetic example checks that three citation records reference
two existing, uniquely identified source records. Repeated citations are allowed.

```bash
npm run build
node dist/cli/index.js artifacts \
  --contract fixtures/product/reference-integrity/contract.json \
  --path fixtures/product/reference-integrity/artifacts --format json
```

In a disposable copy, replacing `SOURCE2` in `citations.csv` with `UNKNOWN`
produces `artifact.reference-missing` for data row 2. Reports omit that value.
Duplicate source IDs fail the existing CSV uniqueness check. File names may be
ordered either way; all physical checks finish before references are compared.

The same contract can bind review findings to a changed-file catalog, knowledge
claims to a source catalog, or orders to a customer catalog. IDs are exact
nonempty strings. The referenced target must declare its single-column unique
key. Composite keys, JSON references and numeric/coerced IDs are unsupported.
Only declared reference fields are indexed, using SHA-256 fingerprints; the
100,000-cell aggregate ceiling counts repeated IDs too. Indexes are released on
overflow, which fails with `artifact.reference-capacity`.

This verifies local file consistency, not source truth, reviewer identity,
customer ownership or permission to perform business actions. It does not run a
Skill, fetch sources or activate a provider. Published npm0.1.0 lacks this command.
