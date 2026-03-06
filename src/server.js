/**
 * server.js — Lumos Print Service v2
 *
 * Why this is dramatically faster than the PHP version:
 *
 *  PHP-FPM model (old):
 *    1 request → 1 new process → 1 new TCP+TLS handshake to lumosapi.com
 *    With 64 printers polling every second = 64 processes constantly spawning
 *
 *  Node.js/Fastify model (new):
 *    1 long-running process handles ALL requests via an async event loop
 *    A shared undici Pool keeps persistent sockets to lumosapi.com open
 *    No process spawning, no repeated handshakes — pure I/O multiplexing
 */

import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import upstreamPlugin from './plugins/upstream.js'
import proxyRoutes from './routes/proxy.js'

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const HOST = process.env.HOST ?? '0.0.0.0'
const IS_DEV = process.env.NODE_ENV !== 'production'

// ── Logger config ────────────────────────────────────────────────────────────
// In dev, try to load pino-pretty for colorized output.
// Falls back to plain JSON if pino-pretty is not installed (e.g. prod --omit=dev).
let loggerConfig = true
if (IS_DEV) {
  try {
    await import('pino-pretty')
    loggerConfig = { transport: { target: 'pino-pretty', options: { colorize: true } } }
  } catch {
    // pino-pretty not available — fall back to JSON logs
  }
}

const fastify = Fastify({ logger: loggerConfig })

// ── CORS ──────────────────────────────────────────────────────────────────────
// Mirrors the PHP `Access-Control-Allow-Origin: *` headers.
await fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
})

// ── Rate limiting ─────────────────────────────────────────────────────────────
// 50 restaurants × 4 endpoints × 1 req/2s = ~2 req/s per IP, ~100 req/s total.
// 600 req/min (10/s) per IP gives 5x headroom while catching runaway loops.
// Uses X-Real-IP from nginx since all requests arrive from 127.0.0.1 otherwise.
await fastify.register(rateLimit, {
  max: 600,
  timeWindow: '1 minute',
  keyGenerator: (request) => request.headers['x-real-ip'] || request.ip,
  errorResponseBuilder: (_request, context) => ({
    success: false,
    message: `Rate limit exceeded. Retry after ${context.after}.`,
  }),
})

// ── Upstream connection pool ──────────────────────────────────────────────────
await fastify.register(upstreamPlugin)

// ── Proxy routes ──────────────────────────────────────────────────────────────
await fastify.register(proxyRoutes)

// ── Health check ──────────────────────────────────────────────────────────────
fastify.get('/health', { logLevel: 'silent' }, async (request) => {
  const result = {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }

  if (request.query.deep === 'true') {
    try {
      const { statusCode } = await fastify.upstream.request({
        method: 'HEAD',
        path: '/',
        headersTimeout: 5_000,
      })
      result.upstream = statusCode < 500 ? 'ok' : 'degraded'
    } catch {
      result.upstream = 'down'
      result.status = 'degraded'
    }
  }

  return result
})

// ── Global error handler ──────────────────────────────────────────────────────
fastify.setErrorHandler((error, _request, reply) => {
  fastify.log.error(error)

  // Fastify validation errors (missing/invalid query params)
  if (error.validation) {
    return reply.code(400).send({
      success: false,
      message: error.message,
    })
  }

  // Upstream connectivity errors
  reply.code(502).send({
    success: false,
    message: 'Upstream proxy error',
    error: IS_DEV ? error.message : undefined,
  })
})

// ── Graceful shutdown ─────────────────────────────────────────────────────────
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    fastify.log.info({ signal }, 'Shutting down gracefully')
    await fastify.close()
    process.exit(0)
  })
}

// ── Start ─────────────────────────────────────────────────────────────────────
try {
  await fastify.listen({ port: PORT, host: HOST })
  process.send?.('ready') // Signal PM2 that the app is ready (no-op outside PM2)
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
