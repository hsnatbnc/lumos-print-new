# ── Stage 1: install production dependencies ──────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Copy manifests first — Docker layer cache means pnpm install
# only re-runs when package.json or lockfile actually changes.
COPY package.json pnpm-lock.yaml ./

RUN corepack enable pnpm && pnpm install --frozen-lockfile --prod

# ── Stage 2: final runtime image ──────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Non-root user for security
RUN addgroup -S lumos && adduser -S lumos -G lumos

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

USER lumos

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

# Tini is built into node:alpine — ensures proper signal forwarding
# so `docker stop` / ECS task stops cleanly
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
