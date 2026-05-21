'use strict';
// liveCache.js — in-process Map backed by liveserver1 MongoDB (replaces Redis).
//
// Reads  : instant from local Map (sync, zero latency)
// Writes : to Map immediately; MongoDB persisted via debounced batch every 5s
//          (was: one upsert per set() call → 50 concurrent writes per cycle overloaded local Mongo)
// Startup: warmed via warmAllSymbols() in websocket.js → no cold-start needed

const _map     = new Map();
const _dirty   = new Map(); // symbol → value pending MongoDB flush
let   _flushTimer = null;

function _scheduleBatchFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(async () => {
    _flushTimer = null;
    if (!_dirty.size) return;
    const entries = [..._dirty.entries()];
    _dirty.clear();
    try {
      const { LiveServer1 } = require('./db/models/LiveServer1');
      await Promise.all(entries.map(([key, value]) =>
        LiveServer1.updateOne(
          { symbol: key },
          { $set: { ...value, symbol: key, updatedAt: new Date() } },
          { upsert: true }
        ).catch(() => {})
      ));
    } catch (_) {}
  }, 5_000); // flush all dirty symbols once every 5s
}

module.exports = {
  /** Sync read from local Map — always instant */
  get: (key) => _map.get(key),

  /** Sync existence check */
  has: (key) => _map.has(key),

  /** Sync iterator over all entries */
  entries: () => _map.entries(),

  /** Write to Map immediately; MongoDB persisted in next batch flush */
  set: (key, value) => {
    _map.set(key, value);
    _dirty.set(key, value);
    _scheduleBatchFlush();
  },

  /** Warm Map from DB without triggering a write-back (used by loadLatestSnapshot) */
  setFromDB: (key, value) => {
    _map.set(key, value);
  },

  /** Remove from Map + liveserver1 MongoDB */
  delete: (key) => {
    _map.delete(key);
    _dirty.delete(key);
    try {
      const { LiveServer1 } = require('./db/models/LiveServer1');
      LiveServer1.deleteOne({ symbol: key }).catch(() => {});
    } catch (_) {}
  },
};
