## What changed

<!-- Describe the user-visible behavior and the files/contracts affected. -->

## Safety boundary

- [ ] No credentials, private keys, cookies, or private file contents were added.
- [ ] No ambient environment, home directory, Docker socket, SSH agent, or broad host mount was introduced.
- [ ] Real network, provider credentials, microVM, and remote Worker capabilities remain disabled unless separately approved.

## Verification

- [ ] `npm test`
- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm pack --dry-run`

## Documentation

- [ ] README, contract docs, and changelog are updated when behavior or public claims changed.
- [ ] Reports remain bounded and do not expose content, prompts, environment values, or credentials.
