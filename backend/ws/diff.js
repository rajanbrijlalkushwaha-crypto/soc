/**
 * ws/diff.js
 *
 * Computes the minimal diff between two option chain snapshots.
 *
 * Input shape (one snapshot):
 * {
 *   spot_price, time, expiry, date, lot_size,
 *   chain: [{ strike, call: { oi, oi_change, ltp, ltp_change, volume, iv, delta, gamma, theta, vega, pop }, put: {...} }]
 * }
 *
 * Output: null if nothing changed, otherwise:
 * {
 *   spot_price?,   // only if changed
 *   time?,
 *   expiry?,
 *   chain: {       // only strikes that changed
 *     "22450": { call?: { oi?: 1200, ... }, put?: { ltp?: 5.3 } },
 *     ...
 *   }
 * }
 */

/**
 * Compare two plain objects — return an object containing only changed keys.
 * Values are taken from `next`.
 */
function diffObj(prev, next) {
  if (!prev && !next) return {};
  if (!prev) return { ...next };
  if (!next) return {};

  const changed = {};
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);

  for (const k of allKeys) {
    // Simple value comparison (numbers, strings, booleans — no nested objects here)
    if (prev[k] !== next[k]) {
      changed[k] = next[k] ?? null;
    }
  }
  return changed;
}

/**
 * Compute diff of chain arrays (indexed by strike price).
 * Returns null if nothing changed.
 */
function diffChain(prevChain, nextChain) {
  if (!nextChain?.length) return null;

  // Index previous snapshot by strike for O(1) lookup
  const prevMap = {};
  for (const row of (prevChain || [])) {
    prevMap[row.strike] = row;
  }

  const changes = {};

  for (const row of nextChain) {
    const { strike, call, put } = row;
    const prev = prevMap[strike];

    if (!prev) {
      // Brand-new strike (rare — e.g., deep ITM added after big move)
      changes[strike] = { call, put };
      continue;
    }

    const strikeChanges = {};

    const callDiff = diffObj(prev.call, call);
    if (Object.keys(callDiff).length) strikeChanges.call = callDiff;

    const putDiff = diffObj(prev.put, put);
    if (Object.keys(putDiff).length) strikeChanges.put = putDiff;

    if (Object.keys(strikeChanges).length) {
      changes[strike] = strikeChanges;
    }
  }

  return Object.keys(changes).length ? changes : null;
}

/**
 * Main export: diff two full snapshots.
 * Returns null if there are zero changes (skip sending to clients).
 *
 * @param {object} prev - previous snapshot (may be null on first call)
 * @param {object} next - new snapshot
 * @returns {object|null}
 */
function diffSnapshot(prev, next) {
  if (!prev) return null; // first snapshot → always send FULL, never DIFF

  const result = {};

  // ── Top-level scalar fields ──────────────────────────────────────────────
  if (prev.spot_price !== next.spot_price) result.spot_price = next.spot_price;
  if (prev.spot_vwap  !== next.spot_vwap)  result.spot_vwap  = next.spot_vwap;
  if (prev.time       !== next.time)       result.time       = next.time;
  if (prev.expiry     !== next.expiry)     result.expiry     = next.expiry;
  if (prev.date       !== next.date)       result.date       = next.date;

  // ── Chain diff ────────────────────────────────────────────────────────────
  const chainDiff = diffChain(prev.chain, next.chain);
  if (chainDiff) result.chain = chainDiff;

  // ── Chains map (all expiries) — fast per-expiry early-exit check ─────────
  // Avoids serializing the entire chains object (was 2× JSON.stringify per cycle per instrument)
  if (next.chains) {
    const prevExps = prev.chains ? Object.keys(prev.chains) : [];
    const nextExps = Object.keys(next.chains);
    let chainsChanged = prevExps.length !== nextExps.length ||
      nextExps.some(e => !prev.chains?.[e]);
    if (!chainsChanged) {
      // Spot-check: compare total OI sum for each expiry (cheap proxy for content change)
      for (const exp of nextExps) {
        const nc = next.chains[exp], pc = prev.chains[exp];
        if (!pc || nc.length !== pc.length) { chainsChanged = true; break; }
        let nSum = 0, pSum = 0;
        for (let i = 0; i < nc.length; i++) {
          nSum += (nc[i].call?.oi || 0) + (nc[i].put?.oi || 0);
          pSum += (pc[i].call?.oi || 0) + (pc[i].put?.oi || 0);
        }
        if (nSum !== pSum) { chainsChanged = true; break; }
      }
    }
    if (chainsChanged) result.chains = next.chains;
  }
  if (next.availableExpiries) {
    const pe = prev.availableExpiries, ne = next.availableExpiries;
    if (!pe || pe.length !== ne.length || ne.some((e, i) => e !== pe[i])) {
      result.availableExpiries = ne;
    }
  }
  if (prev.nextExpiry !== next.nextExpiry) result.nextExpiry = next.nextExpiry;

  return Object.keys(result).length ? result : null; // null = no change, skip publish
}

module.exports = { diffSnapshot };
