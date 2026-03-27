// liveCache.js — in-process write-through cache backed by Redis
//
// Reads  : instant from local Map (sync, zero latency)
// Writes : to Map immediately + Redis in background (fire-and-forget)
// Startup: warms local Map from Redis so data survives pm2 restarts
//
// Uses the shared `pub` client from ws/redis.js — no extra Redis connection.
// If Redis is unavailable the module falls back silently to pure Map behaviour.

const { pub } = require('./ws/redis');

const _map   = new Map();
const PREFIX = 'lc:';    // short prefix to save Redis key space
const TTL    = 120;      // auto-expire after 2 min (refreshed every ~5 s by live feed)

// ── Warm local Map from Redis on startup ─────────────────────────────────────
pub.keys(`${PREFIX}*`).then(async keys => {
  let loaded = 0;
  for (const key of keys) {
    try {
      const raw = await pub.get(key);
      if (raw) { _map.set(key.slice(PREFIX.length), JSON.parse(raw)); loaded++; }
    } catch {}
  }
  if (loaded > 0) console.log(`[liveCache] ♻️  Warmed ${loaded} symbols from Redis`);
}).catch(() => {});

// ── Public API ────────────────────────────────────────────────────────────────
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
    if (pub.status === 'ready') {
      pub.setex(`${PREFIX}${key}`, TTL, JSON.stringify(value)).catch(() => {});
    }
  },
};
