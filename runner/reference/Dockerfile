FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS node-runtime

FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY runner/reference/runner.mjs /usr/local/bin/skillsync-runner

RUN chmod 0555 /usr/local/bin/skillsync-runner

ENV PATH=/usr/local/bin:/usr/bin:/bin

LABEL org.skillsync.runner.protocol="skillsync.runner.v1" \
      org.skillsync.runner.contract="1" \
      org.skillsync.runner.entrypoint="/usr/local/bin/skillsync-runner"

ENTRYPOINT ["/usr/local/bin/skillsync-runner"]
