# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lumos Print Service v2 — a Node.js/Fastify HTTP proxy that replaces a legacy PHP-FPM service. It proxies POS API requests to `lumosapi.com` using persistent connection pooling via undici.

## Commands

```bash
pnpm install          # Install dependencies
pnpm run dev          # Dev server with --watch hot reload (port 3000)
pnpm start            # Production server
```

No test framework, linter, or build step exists. The codebase is pure ES modules (`"type": "module"`), no compilation needed.

## Architecture

Three source files:

- **`src/server.js`** — Fastify app bootstrap. Registers plugins in order: CORS → rate-limit → upstream pool → proxy routes → health check. Configures pino-pretty logging in dev, JSON in production.

- **`src/plugins/upstream.js`** — Fastify plugin that creates a shared `undici.Pool` (10 persistent connections to `https://lumosapi.com`). Decorates the Fastify instance as `fastify.upstream`. Closes pool on shutdown.

- **`src/routes/proxy.js`** — 8 proxy route handlers mirroring legacy PHP endpoints. Uses shared `proxyGet()`/`proxyPost()` helpers that forward requests through `fastify.upstream`. All routes live under `/lumos-pos/api/` and use Fastify JSON Schema validation for query params/body.

## Key Conventions

- Async/await throughout, no callbacks
- All proxy endpoints forward query params as-is to the upstream origin
- Error responses: 400 for validation errors, 502 for upstream failures
- Production hides error details; dev mode includes `error.message`
- Rate limiting: 120 req/min per IP
- CORS: `origin: '*'` (mirrors original PHP behavior)

## Deployment

- **EC2:** PM2 cluster mode with 4 workers (`ecosystem.config.cjs`), 256MB heap each
- **Docker:** Multi-stage Alpine build, Node 22, non-root user, tini for signal handling
- **Env vars:** `PORT` (default 3000), `HOST` (default 0.0.0.0), `NODE_ENV`
