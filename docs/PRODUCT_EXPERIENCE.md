# Product experience

The workbench is a local efficiency tool. Show the current task, its inputs, results and next action. Examples fill or preview inputs; they do not submit work or grant permissions. Keep synthetic data, local calculations, saved evidence and live results distinct.

## Visual rules

Use a neutral background (#f7f7f5), white surfaces, dark text (#242424), secondary text (#62655f), thin borders (#dedfd9) and a restrained action color (#31594d). Preserve warning and error colors. Use system fonts and existing local font assets; do not add remote font requests.

Body text is 14-16px with generous line height. Use clear headings, spacing in 8px steps, small corners and minimal shadows. Use approximately 200ms color and border transitions and respect reduced-motion preferences. Keep visible keyboard focus, labelled controls and status messages. Main touch actions are at least 44px; narrow screens use one column and bounded table scrolling.

## Data and interaction rules

Provide examples, explicit run/save/export actions, useful empty states and actionable errors. Retain inputs after failures and invalidate old results after input changes. Bound history, input sizes and retained resources. Preserve invalid stored data rather than silently resetting it. Never include credentials in reports or diagnostics.

The supplied reference page was not accessible through the available reader. These changes follow the user's written description of a restrained, practical product style.

## Implemented workflow

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
