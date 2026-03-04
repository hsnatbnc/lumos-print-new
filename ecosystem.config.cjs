/**
 * PM2 Ecosystem Config — lumos-print-service
 *
 * Run on the EC2 instance (no Docker):
 *   npm install -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup   # survive reboots
 *
 * The c7g.xlarge has 4 vCPUs.
 * We run 4 Node.js workers (cluster mode) — one per core.
 * Each worker has its own event loop and undici pool.
 * PM2 load-balances incoming connections across all 4 workers.
 */
module.exports = {
  apps: [
    {
      name: 'lumos-print-service',
      script: './src/server.js',
      instances: 4,           // match number of vCPUs on c7g.xlarge
      exec_mode: 'cluster',
      node_args: '--max-old-space-size=256',

      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
      },

      // Auto-restart if memory exceeds 300 MB per worker
      max_memory_restart: '300M',

      // Graceful reload — zero downtime deploys
      wait_ready: true,
      listen_timeout: 5000,
      kill_timeout: 5000,

      // Logging
      out_file: '/var/log/lumos-print/out.log',
      error_file: '/var/log/lumos-print/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
}
