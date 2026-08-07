# Contributing to SkillSync

Thanks for helping improve SkillSync. The project is an evidence and verification layer for Agent Skills, so contributions should prefer reproducible evidence over broad claims.

## Before opening a change

- Read the [README](README.md), [security boundary](docs/security-boundary.md), and relevant design document.
- Keep changes scoped to one behavior or contract.
- Do not add real credentials, private keys, cookies, provider tokens, user home paths, or live service endpoints.
- Do not enable real network access, credential injection, microVM execution, or remote Worker execution in fixtures or CI.

## Local checks

Use Node.js 20 or newer and run:

```bash
npm ci
npm test
npm run type-check
npm run lint
npm run build
npm pack --dry-run
```

New rules should include positive, negative, and boundary fixtures. Changes to public reports must preserve bounded output and must not expose file contents, prompts, environment values, or credentials.

## Pull requests

Describe the user-visible behavior, the safety boundary, and the exact checks you ran. If a change affects a contract or report format, include the before/after example and update the relevant documentation and changelog entry.

Please keep commits focused and avoid committing generated `dist/`, `coverage/`, `node_modules/`, local environment files, or `.superpowers/` execution ledgers.
