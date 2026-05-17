/**
 * cluster.js — 4-CPU launcher for 10x throughput
 *
 * Usage:  node backend/cluster.js
 *
 * Architecture:
 *   Master    — forks workers, relays IPC
 *   Worker 0  — HTTP + API + data fetch cycle (the "primary" worker)
 *   Worker 1-3 — HTTP + API only (no fetching — saves API quota)
 *
 * liveCache sync: after each data save, worker 0 sends { type:'lc', symbol, data }
 * to master → master broadcasts to workers 1-3 → each worker updates its liveCache
 * and refreshes its pre-gzip response cache.
 *
 * Sessions: MemoryStore per worker. Regular users have no session requirement
 * (requireAuth is open). Admin users should use the same worker — Cloudflare
 * sticky-routes or just accept that admins occasionally need to re-login.
 */

'use strict';
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const cluster = require('cluster');
const os      = require('os');

const NUM_WORKERS = os.cpus().length; // 4 on this machine

if (cluster.isPrimary) {
  console.log(`[Cluster] Master ${process.pid} — spawning ${NUM_WORKERS} workers`);

  let fetcherDead = false;

  for (let i = 0; i < NUM_WORKERS; i++) {
    const env = { CLUSTER_ROLE: i === 0 ? 'fetcher' : 'server' };
    cluster.fork(env);
  }

  // Relay liveCache IPC from fetcher worker → all other workers
  cluster.on('message', (sender, msg) => {
    if (msg?.type !== 'lc') return;
    for (const id in cluster.workers) {
      const w = cluster.workers[id];
      if (w && w.process.pid !== sender.process.pid && w.isConnected()) {
        try { w.send(msg); } catch (_) {}
      }
    }
  });

  cluster.on('exit', (dead, code, signal) => {
    const role = dead.process.env?.CLUSTER_ROLE || 'server';
    console.log(`[Cluster] Worker ${dead.process.pid} (${role}) exited — restarting`);
    // Restart with same role
    const env = { CLUSTER_ROLE: role };
    const newWorker = cluster.fork(env);
    if (role === 'fetcher') {
      console.log(`[Cluster] New fetcher is PID ${newWorker.process.pid}`);
    }
  });

} else {
  // ── Worker ────────────────────────────────────────────────────────────────
  const role = process.env.CLUSTER_ROLE || 'server';
  console.log(`[Cluster] Worker ${process.pid} starting as ${role}`);

  if (role !== 'fetcher') {
    // Non-fetcher workers: receive liveCache updates from master and sync local cache
    const liveCache = require('./liveCache');
    process.on('message', (msg) => {
      if (msg?.type !== 'lc') return;
      try {
        const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data;
        liveCache.set(msg.symbol, data);
        // Refresh pre-gzip response cache for this worker
        try { require('./api/chain').notifyLiveCacheUpdated(msg.symbol, data); } catch (_) {}
      } catch (_) {}
    });
  }

  // All workers run the full server (HTTP + WS + API routes)
  require('./server.js');
}
