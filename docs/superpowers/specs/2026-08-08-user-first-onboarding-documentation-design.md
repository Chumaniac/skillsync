# User-First Onboarding Documentation Design

## Goal

Make the public documentation answer one question within the first minute: what can I do with SkillSync immediately after installing it?

## Reader outcome

A reader should be able to:

1. Understand that SkillSync verifies an Agent Skill's provenance, compatibility, and local changes without executing the Skill.
2. See a real terminal result before reading technical reference material.
3. Run a useful check in a directory containing `SKILL.md` with:

   ```bash
   npx --yes --package=@chumanic/skillsync@0.1.0 --call 'skillsync verify --path . --target codex'
   ```

4. Know the current maturity and boundaries before adopting the tool.

## README experience

The README will start with a plain-language value statement, followed by a visible `Alpha · v0.1.0 · Node.js 20+` status line. The next content will be a real terminal screenshot and the copyable `npx` command.

The first screen will state the essential boundary in user language: SkillSync checks local Skill content offline; it does not execute Skill scripts, read credentials, or enable live provider, remote-worker, or runtime capabilities.

## Demonstration

The documentation will embed one static terminal screenshot rendered from the actual published `0.1.0` command output against a safe repository fixture. The image will be linked as the online-viewable demonstration and will not use fabricated findings, user data, or local paths.

The command shown for users will target their current Skill directory. It will explicitly say that they should run it from a folder containing `SKILL.md`.

## Information architecture

The README will retain a short, product-oriented flow:

1. Value, maturity, and boundaries.
2. Demonstration and first command.
3. Typical uses and a compact explanation of output.
4. Advanced reference links grouped without per-file summaries.

Architecture notes, historical release preparation, and internal design material remain available in the repository, but will not lead the onboarding path or be described as required reading.

## Scope and non-goals

- Keep the current CLI surface and npm version unchanged.
- Do not add a hosted web demo or a new `demo` command.
- Do not present offline checks as live execution, security certification, or automatic remediation.
- Keep all user-facing Markdown in English.

## Acceptance checks

- The README contains the verified copyable `npx --call` command and the Alpha status label.
- The embedded image matches a command run using the published package.
- Markdown links resolve and the existing English-only documentation check passes.
- The documentation test covers the new onboarding promises without requiring release-preparation prose in the README.
