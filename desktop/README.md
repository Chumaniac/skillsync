# SkillSync macOS application

Build this repository with the installed Node 24 runtime, then build its native window from a clean source checkout:

```sh
npm run build
python3 desktop/build_app.py --output /a/new/output/directory
```

Open `SkillSync.app` directly. It starts its own loopback workbench on port 19002, uses system WebKit and retains the existing Host, Origin, nonce, operation-lock and explicit repair-confirmation checks. It needs this installed source workspace and its Node runtime; no terminal or separate browser tab is needed for daily use. It does not execute Skills.

The application's private history is in `~/Library/Application Support/SkillSync/workspace`. Selecting a Skill directory does not change that history location. Existing externally configured workbench histories remain where they were; the application does not copy or overwrite them.

The three task sections share a quiet sidebar. File and directory selection, scriptless report frames and exports retain their existing workflows. Closing during an active operation asks before leaving; the app stops only the Node process it started, and the server retains its existing cancellation/backup/recovery behavior.

Native smoke checks use port 19012, a dedicated canonical cache directory and nonpersistent WebKit storage. They never use the normal history directory. The project tests use synthetic files and explicit cleanup. Build output is not a user-data backup. Local builds use ad-hoc signing and are not notarized redistribution releases.
