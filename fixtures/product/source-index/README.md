# Synthetic knowledge source inventory

This local candidate checks two fictional document references in actual CSV/JSON
files. It reuses the physical artifact command and independent count/sum checks.
The `https_url` field adds an exact, explicitly declared DNS-host requirement.
The example.test domains and SYN-NOTE identifiers are synthetic; no website is
visited, source content verified, vault opened or provider executed.

After building this candidate source checkout:

```bash
npm run build
node dist/cli/index.js artifacts \
  --contract fixtures/product/source-index/contract.json \
  --path fixtures/product/source-index/artifacts --format json
```

Declared bounds: two files, 64 KiB per file, 128 KiB total, 1,000 CSV records.
URL fields are at most 2,048 characters with at most 16 exact declared hosts.
The fixture remains unchanged during negative checks; tests operate on copies.
The new URL type is not in main or npm0.1.0 until separately approved publication.
