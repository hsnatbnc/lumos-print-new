/**
 * upstream.js
 *
 * Creates a single shared undici Pool pointed at lumosapi.com.
 * A Pool keeps a fixed number of persistent TCP connections open,
 * so every proxy request reuses an existing socket instead of
 * paying the TCP + TLS handshake cost on every call.
 *
 * This is the single most impactful change vs. the PHP version:
 * PHP-FPM + cURL opened a brand-new connection on every request.
 */

import fp from 'fastify-plugin'
import { Pool } from 'undici'

const UPSTREAM_ORIGIN = 'https://lumosapi.com'

// Keep up to 10 sockets open to the upstream at all times.
// Tune this number based on observed concurrency.
const pool = new Pool(UPSTREAM_ORIGIN, {
  connections: 10,
  pipelining: 1,
  keepAliveTimeout: 30_000,   // 30 s — keep idle sockets alive
  keepAliveMaxTimeout: 60_000,
  headersTimeout: 10_000,     // 10 s — fail fast if upstream hangs on headers
  bodyTimeout: 15_000,        // 15 s — fail fast if upstream hangs mid-body
  connect: {
    rejectUnauthorized: true,  // always verify TLS
  },
})

async function upstreamPlugin(fastify) {
  fastify.decorate('upstream', pool)

  fastify.addHook('onClose', async () => {
    await pool.close()
  })
}

export default fp(upstreamPlugin, { name: 'upstream' })
