# Dockerfile
FROM node:22-slim AS builder
WORKDIR /app
# better-sqlite3 has no prebuilt binary for every platform npm ci might
# target here (notably linux/arm64 under buildx/qemu emulation) and falls
# back to compiling its native addon via node-gyp, which needs Python and a
# C++ toolchain — node:22-slim ships neither.
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
# gosu drops root privileges after entrypoint.sh aligns the popcornpoll
# user's uid/gid with the mounted DATA_DIR (PUID/PGID) — needed so a bind
# mount to an arbitrary host path doesn't require the operator to manually
# chown it to match a uid baked into the image.
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd -r -g 999 popcornpoll && useradd -r -u 999 -g popcornpoll popcornpoll
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/server ./server
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown -R popcornpoll:popcornpoll /data /app

ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Starts as root so entrypoint.sh can fix DATA_DIR ownership, then execs the
# real process as popcornpoll (uid/gid $PUID/$PGID, default 999) — the
# container's own process never runs as root.
ENTRYPOINT ["/entrypoint.sh"]
CMD ["npx", "tsx", "server/index.ts"]
