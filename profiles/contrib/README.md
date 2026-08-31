# Contrib Profiles

Community-contributed agent capability profiles. Each file is a versioned YAML validated by `skillsync profile validate`.

## Adding a profile

1. Copy a builtin profile from `../*.v1.yaml` as a template.
2. Required fields: `id` (lowercase `a-z0-9-`), `version` (positive int), `docsUrl` (`https://`), `skill_path.project` + `skill_path.user`, `features` map, `semantics` map.
3. Validate: `node dist/cli/index.js profile validate --path profiles/contrib/your-agent.v1.yaml`
4. List: `node dist/cli/index.js profile list --profile-dir profiles/contrib`

Builtin profiles remain the source of truth for `codex`, `claude-code`, `cursor`. Contrib profiles never shadow builtins unless you place a file with the same `id` in `~/.config/skillsync/profiles/` or pass `--profile-dir` explicitly; builtin discovery is otherwise preserved.

## Discovery order

`profiles/contrib/` (checked into repo) → `~/.config/skillsync/profiles/` → `--profile-dir <path>` (explicit). Later entries win on `id` collision, but `profile list` will show both.

## Example

See `windsurf.v1.yaml` for a minimal contrib profile.
