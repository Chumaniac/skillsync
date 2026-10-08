# Bounded material intake labels

This synthetic source example checks actual CSV and JSON using closed string
options. It demonstrates a shared intake format for code-review material,
knowledge references and operations data; it performs no semantic review,
approval, authenticated handoff or external platform connection.

```bash
npm run build
node dist/cli/index.js artifacts \
  --contract fixtures/product/review-intake/contract.json \
  --path fixtures/product/review-intake/artifacts --format json
```

Three synthetic records have exact declared domains and decision labels. The
summary independently matches their row count and three reference markers. An
unknown or mistyped label fails even when numeric summaries still match. A
permitted label such as `ready` does not prove a person reviewed or approved the
material; the labels are only declared data values. Reference markers do not
prove source truth.

The contract allows two files, 16 KiB per file, 32 KiB total and 1,000 CSV rows.
`one_of` accepts 1–32 unique literal strings of at most 256 UTF-16 code units,
with no surrounding whitespace, control or format characters. Matching is exact:
no trimming, case folding, regular-expression evaluation or type coercion. An
empty option requires `allow_empty: true`. Values are not included in findings.

These checks use the current source implementation. They are not in the public
npm0.1.0 package, and are physical-file evidence with execution `not-run` and
provenance `not-authenticated`.
