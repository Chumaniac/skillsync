# Reviewing Skill evidence

The browser checks SKILL.md frontmatter. Use the local workbench to inspect the directory, compare saved findings, and review a repair plan before writing changes.

## Local workflow

The existing directory verification, immutable history, reviewed repair plans, backups, rechecks and batch acceptance remain in place. The new example action fills a fixed fixture directory without running it. Structured evidence can be inspected and downloaded from a saved verification record without rerunning the command.

The service retains loopback, Origin, nonce, UUID, bounded-read and history-integrity checks. Viewing or exporting evidence never executes a Skill, certifies its author or grants repair authority.

## Validation

Build and type checks, 54 focused workbench tests, actual local CLI verification and JSON download, and desktop/390px/320px browser flows passed. Hosted checks also run the existing repository-wide regression and verification gates. Real providers and production deployment are outside this change.

## Local startup

```sh
npm ci
npm run build
node dist/cli/index.js gui --state-dir /absolute/private/report-directory
```

## Live browser navigation

The static entry page accepts an explicit user-activated top-level navigation, including a reload that retains cross-site Fetch Metadata. The literal loopback Host, Origin, API nonce and mutation checks remain enforced. Cross-site iframes, script/API reads and writes are rejected. This fixes a real Chrome launch refusal without changing file-selection or repair authority.
