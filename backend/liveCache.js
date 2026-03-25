// liveCache.js — Redis write-through cache
//
// Reads  : instant from local Map (sync, zero latency — no network round-trip)
// Writes : to both Map + Redis (fire-and-forget, never blocks)
// Startup: warms local Map from Redis so data survives pm2 restarts
//
// Key    : UPPERCASE symbol name e.g. "NIFTY_50", "BANK_NIFTY"
// Value  : full JSON response object ready to send to the browser
//
// If Redis is unavailable the module falls back silently to pure Map behaviour.

const Redis = require('ioredis');

const _map    = new Map();
const PREFIX  = 'lc:';   // short prefix to save Redis key space
const TTL_SEC = 120;      // auto-expire after 2 min (refreshed every ~5 s by live feed)

// ── Connect ──────────────────────────────────────────────────────────────────
let redis = null;
try {
  redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    lazyConnect:          false,
    enableOfflineQueue:   false,   // don't queue commands when disconnected
    connectTimeout:       2000,
    maxRetriesPerRequest: 1,
    retryStrategy:        () => null, // don't retry — fall back to Map only
  });

  redis.on('error', () => {}); // suppress noisy connection errors

  // ── Warm local Map from Redis on startup ───────────────────────────────────
  redis.keys(`${PREFIX}*`).then(async keys => {
    let loaded = 0;
    for (const key of keys) {
      try {
        const raw = await redis.get(key);
        if (raw) { _map.set(key.slice(PREFIX.length), JSON.parse(raw)); loaded++; }
      } catch {}
    }
    if (loaded > 0) console.log(`[liveCache] ♻️  Warmed ${loaded} symbols from Redis`);
  }).catch(() => {});

} catch {
  redis = null;
}

// ── Public API (identical surface to the old Map) ────────────────────────────
module.exports = {
  /** Sync read from local Map — always instant */
  get:     (key) => _map.get(key),

  /** Sync existence check */
  has:     (key) => _map.has(key),

  /** Sync iterator over all entries */
  entries: ()    => _map.entries(),

  /** Write to Map immediately; persist to Redis in background */
  set: (key, value) => {
    _map.set(key, value);
    if (redis && redis.status === 'ready') {
      redis.setex(`${PREFIX}${key}`, TTL_SEC, JSON.stringify(value)).catch(() => {});
    }
  },
};
