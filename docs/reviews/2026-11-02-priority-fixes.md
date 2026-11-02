# Priority fixes and isolated verification

Date: 2026-11-02. Status: implementation and local verification complete; main delivery is recorded separately. Reviewed base: `c36f334f904aafbdb129be3539b95f0a38e5d471`.

| Item | Outcome | Evidence |
| --- | --- | --- |
| Git source identity | Declared URL/commit is unknown remote identity; explicit strict policy blocks it | Provenance and policy regressions |
| Artifact report state | Passed reports cannot contain failed receipt binding | Six state combinations and pre-inspection baseline rejection |
| Batch declarations | Passed reports bind canonical contract metadata; legacy packets require an explicit contract | Rehashed-tampering, legacy byte preservation, retry and CLI/Workbench rendering checks |
| Repeated scans | Required mutation checks retained; synthetic limits measured | [Scan baseline](../benchmarks/workspace-scans.md) |

The local full suite passed 740 tests, with one explicitly skipped Docker reference scenario. Type checking, lint, build, package dry-run and the exact CI SARIF verification command passed. There was no live provider, remote worker, network capability activation, npm release, production deployment, or read of user datasets.

Three provenance/policy regressions and two report-state regressions first failed, then passed after implementation. Batch tests first reproduced acceptance of changed declarations and unbound legacy evidence. A further Workbench legacy-view failure identified a lost contract-validation context; the parser and both HTML renderers now retain that context. No assertion was relaxed.

The original package remains immutable. Legacy revalidation and failed-only retry preserve original bytes and passed reports. Integrity hashes do not authenticate authorship; independent package digests and explicit contracts retain their separate roles.
