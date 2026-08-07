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

The image must be addressed by an immutable digest when used by SkillSync. A
local image ID can be used to construct a smoke-test reference:

```sh
IMAGE_ID=$(docker image inspect --format '{{.Id}}' skillsync/reference:dev)
skillsync test --fixture fixtures/behavior/docker-reference \
  --execute --backend docker
```

The checked-in fixture contains a valid placeholder digest so it remains
parseable without a local Docker daemon. The opt-in Docker workflow creates a
temporary manifest bound to the locally built image ID; it does not modify the
fixture or pull a remote image.

This image is a boundary reference, not an Agent quality certification or a
provider adapter.
