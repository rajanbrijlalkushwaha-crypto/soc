// liveCache.js
// Shared in-memory store for the latest live option chain data.
// Node.js module cache makes this a singleton — the same Map instance
// is shared between server.js and API/chain.js within one process.
//
// Key   : safeSymbolName  (e.g. "NIFTY_50", "BANK_NIFTY")
// Value : full JSON response object ready to send to the browser
//
// Updated every ~5 s by saveOptionChainData() when new data arrives.
// Served instantly by /api/live/:symbol without any disk I/O.

const liveCache = new Map();

module.exports = liveCache;
