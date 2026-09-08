# syntax=docker/dockerfile:1
#
# Codex Remote gateway image.
#
# This image intentionally does NOT install the Codex CLI. The gateway shells
# out to `codex app-server --stdio`, and this deployment shares the host's
# Codex install + login by bind-mounting ~/.codex (see compose.yaml). The host
# binary is a self-contained static-musl executable, so it runs unchanged here.
#
# The container runs as UID 1000 (the `node` user), which must own the mounted
# host files (workspaces + ~/.codex). On hosts whose user is not uid 1000,
# either remap or override the user in compose.yaml.

# ---- build: full dependency tree + production build -------------------------
FROM node:22.23.2-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.app.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
COPY scripts ./scripts
COPY public ./public

RUN npm run build

# ---- runtime: only what the server needs at run time -------------------------
FROM node:22.23.2-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

# The host-mounted Codex binary uses the container's native TLS trust store.
# bookworm-slim does not include one, which causes HTTPS requests to fail with
# `invalid peer certificate: UnknownIssuer`.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# `npm ci --omit=dev` keeps the image lean; web-push and friends are prod deps.
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built PWA + server + ops scripts. State that must persist (`.remote-push.json`)
# is mounted as a host file by compose.yaml, never baked into the image.
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --from=build --chown=node:node /app/scripts ./scripts

USER node

EXPOSE 5173

# /api/healthz returns 200 only once the Codex app-server child is ready.
# Keep in sync with CODEX_REMOTE_PORT if you override it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5173/api/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "dist-server/index.js"]
