# Workspace scan baseline

Recorded: 2026-11-02. Scope: synthetic local inputs, Node 24.17.0, Darwin arm64.
The [recorded JSON](workspace-scans-20261102.json) includes the exact workspace
scanner source digest, every sample, process memory, and runtime identity.

Run `npm run build` followed by `node benchmarks/workspace-scans.mjs`. Fixtures
are created in a private temporary directory and removed afterward. Each case
uses a fresh child process and three pairs of the existing before/after scans.
No Skill runs, network requests, original datasets, or cross-request cache are
involved.

| Synthetic input | Files | Bytes | Descriptive p95 per scan pair | Whole-process peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Small | 16 | 4,096 | 10.68 ms | 57.53 MiB |
| Byte-limit case | 4 | 67,108,864 | 57.67 ms | 149.27 MiB |
| Near file limit | 9,999 | 0 | 1,770.93 ms | 215.72 MiB |

The nearest-rank p95 of three samples is descriptive, not a production latency
guarantee. CPU time is recorded separately. Peak RSS includes module imports
and the entire child process, not just input buffers or a single function.
Memory units follow the [Node resource usage contract](https://nodejs.org/docs/latest-v24.x/api/process.html#processresourceusage).

The file-count case is the clearest local cost. The duplicate scans are an
intentional mutation boundary across inspection or a child process, not a
redundant cache miss. Removing the second scan or reusing a snapshot across
requests could accept changed input. This change retains those checks and
records a reproducible baseline; it does not claim a CPU or memory reduction.
