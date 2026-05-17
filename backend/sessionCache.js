// Shared in-memory session cache.
// Avoids a MongoDB lookup on every API request for single-session enforcement.
// TTL: 30s — old session kicked out within 30s of new login.

const _cache = new Map();
const TTL    = 30_000;

module.exports = {
  get(uid) {
    const hit = _cache.get(uid);
    if (hit && Date.now() - hit.ts < TTL) return hit.activeSessionId;
    return undefined; // miss
  },
  set(uid, activeSessionId) {
    _cache.set(uid, { activeSessionId, ts: Date.now() });
  },
  del(uid) {
    _cache.delete(uid);
  },
};
