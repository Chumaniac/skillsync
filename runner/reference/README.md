# SkillSync Reference Runner

This directory contains an inert, contract-compatible Runner used for local
Docker lifecycle and boundary smoke tests. It reads the staged `SKILL.md` as
data and emits bounded `skillsync.runner.v1` read evidence. It never interprets
Skill text, invokes a provider, writes outputs, accesses the network, or reads
credentials.

Build it locally from the repository root:

```sh
docker build -f runner/reference/Dockerfile -t skillsync/reference:dev .
```

External image references accepted by `runner validate --image` remain
immutable `repository@sha256:...` references. A local Docker image ID is only
an immutable execution binding for the controlled local smoke; do not wrap it
as a repository digest. Run that smoke with the raw image ID:

```sh
IMAGE_ID=$(docker image inspect --format '{{.Id}}' skillsync/reference:dev)
SKILLSYNC_DOCKER_INTEGRATION=1 \
SKILLSYNC_REFERENCE_IMAGE="$IMAGE_ID" \
  npm test -- tests/integration/docker-reference.test.ts
```

The checked-in fixture contains a valid placeholder digest so it remains
parseable without a local Docker daemon. The opt-in Docker workflow validates
the locally built image's Config file, then binds its smoke test to the local
image ID; it does not modify the fixture or pull a remote image.

This image is a boundary reference, not an Agent quality certification or a
provider adapter.
