# Sandboxed Superset host: runs the headless host-service (packages/host-service
# src/serve.ts bundle) in a container so remotely-dispatched workspaces/agents
# execute with a container boundary and a deliberately restricted cloud
# identity instead of the developer's personal credentials.
#
# Build (from repo root):
#   docker compose -f docker/sandbox-host/docker-compose.yml build
#
# The builder stage mirrors packages/cli/scripts/build-dist-linux-docker.sh /
# .github/workflows/build-cli.yml: bun install with scripts disabled, rebuild
# the native addons (node-pty, @parcel/watcher) against Node 22, then reuse
# the repo's own `build:dist` pipeline which stages bin/superset,
# bin/superset-host, lib/host-service.js, lib/pty-daemon.js, lib/node,
# lib/node_modules (glibc native addons) and share/migrations.

ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION} AS builder

# Node is needed for node-gyp (native addon ABI) and matches the ABI (127) of
# the Node 22 runtime that build-dist bundles into lib/node.
ARG NODE_VERSION=22.22.2
ARG TARGETARCH

RUN apt-get update -qq \
	&& apt-get install -y --no-install-recommends \
		curl python3 make g++ ca-certificates xz-utils \
	&& rm -rf /var/lib/apt/lists/*

RUN NODE_ARCH="$([ "$TARGETARCH" = "amd64" ] && echo x64 || echo arm64)" \
	&& curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
		| tar -xJ -C /usr/local --strip-components=1 \
	&& node --version

WORKDIR /work
COPY . .

# Bun occasionally hits transient integrity-check failures on cold caches in
# Docker; retry once with a cleared cache (same as build-dist-linux-docker.sh).
RUN bun install --frozen --ignore-scripts || \
	(rm -rf ~/.bun/install/cache && bun install --frozen --ignore-scripts)

RUN PTY_DIR=$(ls -d node_modules/.bun/node-pty@*/node_modules/node-pty) \
	&& (cd "$PTY_DIR" && npx --yes node-gyp rebuild) \
	&& npm rebuild @parcel/watcher

# Baked into the CLI binary at build time; the host-service itself reads them
# from the environment at runtime, so these only affect `superset` CLI defaults.
ARG RELAY_URL=https://relay.superset.sh
ARG SUPERSET_API_URL=https://api.superset.sh
ARG SUPERSET_WEB_URL=https://app.superset.sh

RUN TARGET="linux-$([ "$TARGETARCH" = "amd64" ] && echo x64 || echo arm64)" \
	&& cd packages/cli \
	&& bun run build:dist --target="$TARGET" \
	&& mv "dist/superset-$TARGET" /superset-dist


FROM debian:bookworm-slim AS runtime

# git: worktree/clone operations (simple-git + execFile("git", ...))
# gh: PR operations and git-token fallback used by the host-service
# jq: entrypoint parses config.json
# gosu: drop from root to the unprivileged user after fixing /etc/machine-id
# python3 + google-cloud-cli: agents fetch their (allowlisted) secrets with the
#   restricted service account — this identity is the whole point of the image.
RUN apt-get update -qq \
	&& apt-get install -y --no-install-recommends \
		ca-certificates curl git jq gosu openssh-client procps python3 gnupg \
	&& curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
		-o /usr/share/keyrings/githubcli-archive-keyring.gpg \
	&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
		> /etc/apt/sources.list.d/github-cli.list \
	&& curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
		| gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
	&& echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
		> /etc/apt/sources.list.d/google-cloud-sdk.list \
	&& apt-get update -qq \
	&& apt-get install -y --no-install-recommends gh google-cloud-cli \
	&& rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash --uid 1000 superset

COPY --from=builder /superset-dist /opt/superset
COPY docker/sandbox-host/entrypoint.sh /usr/local/bin/sandbox-host-entrypoint
RUN chmod 755 /usr/local/bin/sandbox-host-entrypoint /opt/superset/bin/*

ENV PATH="/opt/superset/bin:${PATH}" \
	SUPERSET_HOME_DIR=/data \
	HOST_MIGRATIONS_FOLDER=/opt/superset/share/migrations \
	SUPERSET_PTY_DAEMON_SCRIPT_PATH=/opt/superset/lib/pty-daemon.js

VOLUME /data
EXPOSE 4879

# Entrypoint starts as root (machine-id + volume ownership), then gosu's to
# the superset user before exec'ing the host service.
ENTRYPOINT ["/usr/local/bin/sandbox-host-entrypoint"]
