# Actual artifact delivery checks

The candidate source command `artifacts` checks local output files against a
versioned contract. It opens actual bytes; it does not execute a Skill, Replay,
Docker, provider or remote service. This command is not in the published npm0.1.0
package. Existing `test` preflight and Replay event evidence keep their semantics.

## Run a physical check

```bash
npm ci
npm run build
node dist/cli/index.js artifacts \
  --contract fixtures/product/order-summary/contract.json \
  --path fixtures/product/order-summary/artifacts --format json
```

Use `--delivery /path/to/bundle` instead of `--path` for a SkillTape source bundle
created by `verify --delivery-dir`. The checker validates its layout, exact
Receipt hash, artifact hashes/sizes, and deterministic artifact-set digest before
accepting a complete result. A consistently rewritten manifest is not signed or
authenticated evidence; the report marks provenance as not authenticated.

## Declared requirements

The [synthetic contract](../fixtures/product/order-summary/contract.json) declares:

- capacity ceilings and a complete allowlist of required files;
- exact CSV headers, scalar types, real calendar dates, row limits, unique keys,
  optional expected hashes, and rejection of formula-risk text prefixes;
- JSON top-level field types, required values and optional rejection of extras;
- independently recomputed CSV record counts and safe integer sums compared with
  declared JSON fields. Integer sums avoid unspecified floating-point tolerances.

Source builds support `https_url` scalar fields in CSV
columns and JSON top-level fields. Every such field requires `allowed_hosts`:
1–16 unique, exact lowercase ASCII DNS names. Wildcards, bare localhost and IP
literals are not host declarations. URL values are limited to 2,048 characters;
literal whitespace/control/format characters and backslashes are rejected.
The native URL parser must return HTTPS, the exact declared hostname, no userinfo
and the default port (explicit443 is accepted). Host suffixes and undeclared
subdomains fail. Other scalar types cannot carry `allowed_hosts`.

The [synthetic knowledge source inventory](../fixtures/product/source-index/README.md)
uses real CSV/JSON files plus existing unique-ID, date, capacity and summary rules.
This extension is not included in published npm0.1.0. It does not fetch URLs, resolve DNS,
follow redirects, assess the source text or prove that a named host is public or
trustworthy. Exact URL spelling remains unchanged for uniqueness comparisons.
Optional JSON fields may be omitted; an empty URL does not represent a source.

String fields can declare `one_of` with 1–32 unique exact options, each limited
to 256 UTF-16 code units. Options cannot contain surrounding whitespace, control
or format characters. Other scalar types cannot carry `one_of`; an `equals`
value must also be in the declared list. An empty option requires
`allow_empty: true`. Matching does not trim, normalize, fold case or coerce types;
CSV formula rejection still applies. Optional JSON fields may still be omitted.

For example, `{ "name": "currency", "type": "string", "one_of": ["CNY", "USD"] }`
checks only that the label is one of the caller's declarations. The
[material intake catalog](../fixtures/product/review-intake/README.md) demonstrates
domain and decision labels in physical CSV/JSON plus independent reference totals.
These classifications do not authenticate reviewers, authorize actions or prove
business correctness. This source extension is not in npm0.1.0; findings omit
the actual string values.

`bytes` rules check integrity and capacity without interpreting content. JSON
checks cover declared top-level fields, not full JSON Schema or arbitrary
expressions. Contract files are limited to 64 KiB. Limits must be explicit and
within the shared 10,000-file/16 MiB-file/64 MiB-total workspace ceilings.

`reference_exists` checks an exact nonempty string ID from one CSV against a
declared single-column `unique_by` key in another CSV. Both columns must be
declared required strings with `allow_empty: false`. File traversal order does
not affect references. IDs are not trimmed, normalized or folded; numeric IDs,
JSON references and composite keys are unsupported. Existing scalar, formula,
duplicate-key and physical inventory checks continue to fail independently.
The [synthetic citation catalog](../fixtures/product/reference-integrity/README.md)
includes a runnable contract and explains adaptations for review, knowledge and
operations data. Only declared reference fields are retained as SHA-256
fingerprints with source row numbers. At most 100,000 referenced cells are
indexed per invocation, counting repeated IDs and deduplicating field declarations.
Exceeding this ceiling releases indexes and fails with `artifact.reference-capacity`.
Missing references report relative file, field and data-row number, never the ID
or fingerprint. This checks internal consistency without authenticating records.

Duplicate JSON keys are rejected, including escaped-key aliases in metadata and
payloads. JSON depth is capped at 64 and object keys at 100,000; individual keys
are at most 1,024 characters. CSV rows stop at the declared field count instead
of allocating an array for millions of separators. Manifest order is checked
by UTF-8 path bytes. Directory allowlists use precomputed prefix sets.

The inventory is streamed and checked before payload reads. Extra paths, links,
special files, excess depth/entries and capacity overruns fail. Single-file reads
are bounded and no-follow where supported; metadata and content changes during
inspection fail. This is inspection of a stable caller-selected snapshot, not an
OS sandbox against a same-privilege process actively replacing directory parents.

CSV parsing preserves spaces and supports quoted commas, multiline values,
escaped quotes and CRLF, plus the common LF extension. The format basis is
[RFC 4180](https://www.rfc-editor.org/rfc/rfc4180.html). Text-prefix checks include
ASCII/full-width formula starters and leading controls discussed by
[OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection).
The checker rejects risky parsed cells; it neither rewrites files nor guarantees
safe interpretation in every spreadsheet application or locale.

## Reports and exit codes

Exit0 means declared checks passed, exit1 an artifact finding, and exit2 invalid
input/contract. JSON/text reports contain relative paths, digests, sizes, record
counts and stable findings, not raw cells, JSON values, process output or host
absolute paths. Cross-file totals remain internal. Findings identify the file,
declared field and data-record number where appropriate.

The [fixture](../fixtures/product/order-summary/README.md) proves physical file
checks with fictional outputs. The complete cross-project example separately
runs a local summarizer, preserves a SkillTape bundle, passes this checker and
rejects corruption and an internally inconsistent summary in copies. None of
those checks establishes customer-data truth, model/Agent acceptance or a live
production/business integration.
