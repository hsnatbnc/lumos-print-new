/**
 * proxy.js
 *
 * All 8 lumos-pos API proxy routes.
 * Every handler reuses the shared undici Pool (fastify.upstream)
 * registered by the upstream plugin — no new TCP connections per request.
 *
 * Client-facing methods (as confirmed):
 *   GET  /lumos-pos/api/get_categories.php
 *   GET  /lumos-pos/api/pending_orders.php
 *   GET  /lumos-pos/api/get_orders_for_bill.php
 *   GET  /lumos-pos/api/get_cancel_printed_products.php
 *   GET  /lumos-pos/api/get_paying_order_v2.php
 *   GET  /lumos-pos/api/clear_printed_orders.php
 *   GET  /lumos-pos/api/mark_order_printed.php
 *   POST /lumos-pos/api/delete_cancel_printed_product.php
 */

const UPSTREAM_BASE = '/lumos-pos/api'
const MAX_GET_ATTEMPTS = 2
const RETRY_DELAY_MS = 200

/**
 * Extract auth-related headers from the incoming request to forward upstream.
 */
function getForwardHeaders(request) {
  const forwarded = {}
  if (request.headers.authorization) {
    forwarded.authorization = request.headers.authorization
  }
  if (request.headers.cookie) {
    forwarded.cookie = request.headers.cookie
  }
  return forwarded
}

/**
 * Shared helper — forward a GET request to the upstream and pipe the response.
 * querystring is forwarded as-is so all existing ?shop_id= / ?id= params work.
 * Retries once on connection-level errors (not HTTP 4xx/5xx).
 */
async function proxyGet(fastify, request, reply, path) {
  const qs = new URLSearchParams(request.query).toString()
  const upstreamPath = `${UPSTREAM_BASE}/${path}${qs ? '?' + qs : ''}`

  let lastError
  for (let attempt = 1; attempt <= MAX_GET_ATTEMPTS; attempt++) {
    try {
      const { statusCode, headers, body } = await fastify.upstream.request({
        method: 'GET',
        path: upstreamPath,
        headers: {
          accept: 'application/json',
          ...getForwardHeaders(request),
        },
      })

      // Forward the upstream status code and content-type
      reply.code(statusCode)
      if (headers['content-type']) {
        reply.header('content-type', headers['content-type'])
      }

      return reply.send(body)
    } catch (err) {
      lastError = err
      if (attempt < MAX_GET_ATTEMPTS) {
        fastify.log.warn({ err, attempt, path }, 'Upstream request failed, retrying')
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }
    }
  }

  throw lastError
}

/**
 * Shared helper — forward a POST request with a JSON body to the upstream.
 */
async function proxyPost(fastify, request, reply, path) {
  const qs = new URLSearchParams(request.query).toString()
  const upstreamPath = `${UPSTREAM_BASE}/${path}${qs ? '?' + qs : ''}`
  const rawBody = JSON.stringify(request.body)

  const { statusCode, headers, body } = await fastify.upstream.request({
    method: 'POST',
    path: upstreamPath,
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(rawBody).toString(),
      accept: 'application/json',
      ...getForwardHeaders(request),
    },
    body: rawBody,
  })

  reply.code(statusCode)
  if (headers['content-type']) {
    reply.header('content-type', headers['content-type'])
  }

  return reply.send(body)
}

export default async function proxyRoutes(fastify) {
  // ── GET endpoints ──────────────────────────────────────────────────────────

  fastify.get('/lumos-pos/api/get_categories.php', {
    schema: {
      querystring: {
        type: 'object',
        required: ['shop_id'],
        properties: { shop_id: { type: 'integer', minimum: 1 } },
      },
    },
  }, async (request, reply) => {
    return proxyGet(fastify, request, reply, 'get_categories.php')
  })

  fastify.get('/lumos-pos/api/pending_orders.php', {
    schema: {
      querystring: {
        type: 'object',
        required: ['shop_id'],
        properties: { shop_id: { type: 'integer', minimum: 1 } },
      },
    },
  }, async (request, reply) => {
    return proxyGet(fastify, request, reply, 'pending_orders.php')
  })

  fastify.get('/lumos-pos/api/get_orders_for_bill.php', {
    schema: {
      querystring: {
        type: 'object',
        required: ['shop_id'],
        properties: { shop_id: { type: 'integer', minimum: 1 } },
      },
    },
  }, async (request, reply) => {
    return proxyGet(fastify, request, reply, 'get_orders_for_bill.php')
  })

  fastify.get('/lumos-pos/api/get_cancel_printed_products.php', {
    schema: {
      querystring: {
        type: 'object',
        required: ['shop_id'],
        properties: { shop_id: { type: 'integer', minimum: 1 } },
      },
    },
  }, async (request, reply) => {
    return proxyGet(fastify, request, reply, 'get_cancel_printed_products.php')
  })

  fastify.get('/lumos-pos/api/get_paying_order_v2.php', {
    schema: {
      querystring: {
        type: 'object',
        required: ['shop_id'],
        properties: { shop_id: { type: 'integer', minimum: 1 } },
      },
    },
  }, async (request, reply) => {
    return proxyGet(fastify, request, reply, 'get_paying_order_v2.php')
  })

  fastify.get('/lumos-pos/api/clear_printed_orders.php', {
    schema: {
      querystring: {
        type: 'object',
        required: ['shop_id'],
        properties: { shop_id: { type: 'integer', minimum: 1 } },
      },
    },
  }, async (request, reply) => {
    return proxyGet(fastify, request, reply, 'clear_printed_orders.php')
  })

  fastify.get('/lumos-pos/api/mark_order_printed.php', {
    schema: {
      querystring: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', minimum: 1 } },
      },
    },
  }, async (request, reply) => {
    return proxyGet(fastify, request, reply, 'mark_order_printed.php')
  })

  // ── POST endpoints ─────────────────────────────────────────────────────────

  fastify.post('/lumos-pos/api/delete_cancel_printed_product.php', {
    schema: {
      body: {
        type: 'object',
        // body is forwarded as-is; upstream defines the exact shape
      },
    },
  }, async (request, reply) => {
    return proxyPost(fastify, request, reply, 'delete_cancel_printed_product.php')
  })
}
