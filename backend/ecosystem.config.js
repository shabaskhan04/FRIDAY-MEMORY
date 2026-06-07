/**
 * PM2 Ecosystem Configuration
 *
 * Production deployment on DigitalOcean:
 *   pm2 start ecosystem.config.js --env production
 *
 * View logs:
 *   pm2 logs friday-api
 *   pm2 logs friday-reflect-cron
 *   pm2 logs friday-digest-cron
 */
module.exports = {
  apps: [
    // ── API server (clustered across available CPUs) ────────────
    {
      name: "friday-api",
      script: "dist/server.js",

      // Use 2 workers on a 2-vCPU DO Droplet.
      // Increase to "max" on larger instances.
      instances: 2,
      exec_mode: "cluster",

      // Restart if memory climbs above 400 MB
      max_memory_restart: "400M",

      // Incremental restart on deploy (zero-downtime)
      wait_ready: true,
      listen_timeout: 10000,

      env_production: {
        NODE_ENV: "production",
        PORT: 3001,
      },

      // Preserve logs between restarts
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },

    // ── Daily reflection cron (03:00 server time) ───────────────
    {
      name: "friday-reflect-cron",
      script: "dist/workers/reflect.worker.js",

      instances: 1,
      exec_mode: "fork",

      // PM2 cron — restarts (i.e. runs) the process on this schedule.
      // The worker itself does its work and exits with code 0.
      cron_restart: "0 3 * * *",

      // Do NOT auto-restart after normal exit (exit 0)
      autorestart: false,
      watch: false,

      env_production: {
        NODE_ENV: "production",
        REFLECT_HOURS_BACK: "24",
      },

      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },

    // ── Weekly digest cron (Monday 08:00 server time) ───────────
    {
      name: "friday-digest-cron",
      script: "dist/workers/digest.worker.js",

      instances: 1,
      exec_mode: "fork",

      cron_restart: "0 8 * * 1",
      autorestart: false,
      watch: false,

      env_production: {
        NODE_ENV: "production",
      },

      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
