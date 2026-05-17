'use strict';
// liveCache.js — in-process Map backed by liveserver1 MongoDB (replaces Redis).
//
// Reads  : instant from local Map (sync, zero latency)
// Writes : to Map immediately + liveserver1 MongoDB (fire-and-forget)
// Startup: warmed via warmAllSymbols() in websocket.js → no Redis cold-start needed

const _map = new Map();

function _upsert(key, value) {
  try {
    const { LiveServer1 } = require('./db/models/LiveServer1');
    LiveServer1.updateOne(
      { symbol: key },
      { $set: { ...value, symbol: key, updatedAt: new Date() } },
      { upsert: true }
    ).catch(() => {});
  } catch (_) {}
}

module.exports = {
  /** Sync read from local Map — always instant */
  get: (key) => _map.get(key),

  /** Sync existence check */
  has: (key) => _map.has(key),

  /** Sync iterator over all entries */
  entries: () => _map.entries(),

  /** Write to Map + persist to liveserver1 MongoDB */
  set: (key, value) => {
    _map.set(key, value);
    _upsert(key, value);
  },

  /** Warm Map from DB without triggering a write-back (used by loadLatestSnapshot) */
  setFromDB: (key, value) => {
    _map.set(key, value);
  },

  /** Remove from Map + liveserver1 MongoDB */
  delete: (key) => {
    _map.delete(key);
    try {
      const { LiveServer1 } = require('./db/models/LiveServer1');
      LiveServer1.deleteOne({ symbol: key }).catch(() => {});
    } catch (_) {}
  },
};
