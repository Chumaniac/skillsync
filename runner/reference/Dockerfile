FROM node:22-bookworm-slim AS node-runtime

FROM debian:bookworm-slim

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY runner/reference/runner.mjs /usr/local/bin/skillsync-runner

RUN chmod 0555 /usr/local/bin/skillsync-runner

ENV PATH=/usr/local/bin:/usr/bin:/bin

LABEL org.skillsync.runner.protocol="skillsync.runner.v1" \
      org.skillsync.runner.contract="1" \
      org.skillsync.runner.entrypoint="/usr/local/bin/skillsync-runner"

ENTRYPOINT ["/usr/local/bin/skillsync-runner"]
