# Compatibility profiles

SkillSync treats Agent capability profiles as versioned evidence, not as a
hard-coded conversion table. A profile contains an ID, version, official
documentation URL, project/user paths, feature statuses, and semantic rules.

Current v1 profile sources:

| Profile | Documentation | Default paths | Evidence posture |
| --- | --- | --- | --- |
| `codex@1` | [Build skills](https://learn.chatgpt.com/docs/build-skills) | `.agents/skills`, `~/.agents/skills` | `name`/`description` supported; other extensions remain `unknown` until verified |
| `claude-code@1` | [Claude Code skills](https://code.claude.com/docs/en/skills) | `.claude/skills`, `~/.claude/skills` | standard metadata and documented extensions represented in the profile |
| `cursor@1` | [Cursor Agent Skills](https://cursor.com/docs/skills) | `.cursor/skills`, `~/.cursor/skills` | standard metadata supported; undocumented extensions remain `unknown` |
| `windsurf@1` *(contrib)* | [Windsurf Skills](https://docs.windsurf.com/skills) | `.windsurf/skills`, `~/.windsurf/skills` | contrib example, validates registry |
| `opencode@1` *(contrib)* | [OpenCode Skills](https://opencode.ai/docs/skills) | `.opencode/skills`, `~/.opencode/skills` | contrib example, `hooks` supported |

Use `skillsync compat --target codex,claude-code` to compare one Skill with
multiple targets. `supported` produces a pass finding; `ignored` and
`runtime-dependent` produce warnings; `unsupported` fails; and missing profile
evidence produces `unknown`, never an invented pass.

```bash
# Use contrib + user profiles
skillsync compat --path ./my-skill --target windsurf,opencode --profile-dir ./my-profiles
skillsync verify --path ./my-skill --target windsurf --profile-dir ~/.config/skillsync/profiles

# Validate a new profile before contributing
skillsync profile validate --path profiles/contrib/windsurf.v1.yaml
skillsync profile list --profile-dir profiles/contrib
```

When an Agent changes its Skill semantics, add a new profile version and a
fixture before changing the evaluator. Keep the previous version available so
lock and report history remains interpretable.

## Profile registry

Builtins (`codex`, `claude-code`, `cursor`) ship in `profiles/*.v1.yaml`.
External profiles are discovered in order:

1. `profiles/contrib/*.yaml` (checked into the repo, community-contributed)
2. `~/.config/skillsync/profiles/*.yaml` (user local overrides)
3. `--profile-dir <path>` (explicit per-invocation, wins on collision)

Each file must pass `CapabilityProfileDocumentSchema` (`id` matches `^[a-z0-9][a-z0-9-]*$`, `version` positive int, `docsUrl` https, `skill_path`, `features`, `semantics`). Invalid files are skipped in `compat`/`verify` but `profile validate` surfaces the error with stable `profile.invalid` diagnostics.

Verification policy can be supplied explicitly without changing the scanned
Skill files:

```bash
skillsync verify --path .agents/skills --target codex \
  --policy .skillsync/policy.yaml --format json
```

The policy file accepts YAML or JSON in the versioned schema from the design
document. Invalid or unreadable policy configuration is reported as
`policy.invalid` with exit code `2`.

## Lock interoperability

`skillsync lock --from` accepts both the SkillSync v1 lock shape and the current
`npx skills` v3 global lock shape. For v3 entries, `sourceUrl`, `sourceType`,
`ref`, and `skillPath` are normalized into the internal source record, while
the original installer fields remain under `metadata.external`.

The installer `skillFolderHash` is a source-tree hash, not a SkillSync content
digest, so it is never treated as equivalent. An imported v3 lock can be
inspected with `lock --from`, but `lock --check` fails closed until a
SkillSync `content_digest` is generated for the installed Skill. This keeps
source update tracking and local content verification as separate claims.

Lock files use `schema_version: 1` (frozen). Future breaking changes will introduce `schema_version: 2` with a migration note; `1` remains readable indefinitely.

