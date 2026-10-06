# Synthetic order summary artifacts

These fictional outputs exercise actual-file inspection, not a provider or database.
Use the source CLI with `artifacts --contract fixtures/product/order-summary/contract.json
--path fixtures/product/order-summary/artifacts --format json`.

The contract verifies exact headers, valid dates, nonnegative safe integers, unique
days, required JSON fields and schema_version1, then independently compares CSV
record counts and integer sums with the summary. Reports omit cell and JSON values.
