// In-memory subscription status cache — avoids an Atlas round-trip on every bootstrap.
// TTL: 5 min. Invalidated immediately when a payment is verified or a sub is modified.
const _cache = new Map();
const TTL = 5 * 60_000;

module.exports = {
  get(uid) {
    const hit = _cache.get(uid);
    if (hit && Date.now() - hit.ts < TTL) return { found: true, sub: hit.sub };
    return { found: false };
  },
  set(uid, sub) {
    _cache.set(uid, { sub, ts: Date.now() });
  },
  del(uid) {
    _cache.delete(uid);
  },
};
