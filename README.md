# lumos-print-service v2

High-performance Node.js/Fastify proxy that replaces the original PHP-FPM implementation.

## Why the rewrite?

The original service was a collection of standalone PHP scripts served by PHP-FPM. Every incoming request caused PHP-FPM to **spawn a new process** and **open a new TCP+TLS connection** to `lumosapi.com`. With dozens of printers polling `pending_orders.php` every second, this resulted in 60+ concurrent PHP processes — each consuming ~20 MB of RAM and a full CPU share — saturating all 4 cores of the c7g.xlarge instance.

| | PHP-FPM (old) | Node.js/Fastify (new) |
|---|---|---|
| **Concurrency model** | 1 process per request | Single event loop, async I/O |
| **TCP connections to upstream** | New connection per request | Persistent pool (10 sockets) |
| **Memory per connection** | ~20 MB (PHP process) | ~0 MB (async callback) |
| **Process spawning overhead** | Every request | None |
| **Expected CPU on c7g.xlarge** | 100% (observed) | < 5% under same load |

## Endpoints

All endpoints mirror the original PHP scripts exactly — no client changes required.

| Method | Path | Query params |
|--------|------|-------------|
| `GET` | `/lumos-pos/api/get_categories.php` | `shop_id` |
| `GET` | `/lumos-pos/api/pending_orders.php` | `shop_id` |
| `GET` | `/lumos-pos/api/get_orders_for_bill.php` | `shop_id` |
| `GET` | `/lumos-pos/api/get_cancel_printed_products.php` | `shop_id` |
| `GET` | `/lumos-pos/api/get_paying_order_v2.php` | `shop_id` |
| `GET` | `/lumos-pos/api/clear_printed_orders.php` | `shop_id` |
| `GET` | `/lumos-pos/api/mark_order_printed.php` | `id` |
| `POST` | `/lumos-pos/api/delete_cancel_printed_product.php` | JSON body |
| `GET` | `/health` | — |

## Project structure

```
src/
  server.js          # Fastify app bootstrap, plugins, error handler
  plugins/
    upstream.js      # Shared undici Pool — persistent connections to lumosapi.com
  routes/
    proxy.js         # All 8 proxy route handlers
ecosystem.config.cjs # PM2 cluster config (4 workers for c7g.xlarge)
Dockerfile           # Multi-stage Alpine image
```

## Deployment on EC2 (direct, no Docker)

```bash
# 1. Install Node.js 22 (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Install pnpm and PM2
sudo npm install -g pnpm pm2

# 3. Clone and install
git clone https://github.com/hsnatbnc/lumos-print-new.git
cd lumos-print-new
pnpm install --prod

# 4. Create log directory
sudo mkdir -p /var/log/lumos-print
sudo chown $USER /var/log/lumos-print

# 5. Start with PM2 (4 workers, cluster mode)
pm2 start ecosystem.config.cjs --env production

# 6. Save and enable on reboot
pm2 save
pm2 startup   # follow the printed command to register the systemd service
```

## Deployment with Docker

```bash
docker build -t lumos-print-service .
docker run -d \
  --name lumos-print \
  --restart unless-stopped \
  -p 3000:3000 \
  lumos-print-service
```

## Nginx reverse proxy (recommended)

Point your existing nginx config at port 3000 instead of PHP-FPM:

```nginx
server {
    listen 80;
    server_name your-ec2-domain.com;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Connection "";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_read_timeout 30s;
    }
}
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the server listens on |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `production` | Enables structured JSON logging |

## Rate limiting

Each IP is limited to **120 requests per minute** (2 req/s). This is generous for a printer client but prevents runaway polling from a misconfigured device from affecting other clients.
