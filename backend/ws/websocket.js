/**
 * ws/websocket.js
 *
 * WebSocket server — real-time option chain delivery.
 *
 * Protocol (client → server):
 *   { "action": "subscribe",   "symbol": "NIFTY" }
 *   { "action": "unsubscribe", "symbol": "NIFTY" }
 *   { "action": "ping" }
 *
 * Protocol (server → client):
 *   { "type": "full", "symbol": "NIFTY",     "data": { ...fullSnapshot } }
 *   { "type": "diff", "symbol": "NIFTY",     "data": { ...diffOnly } }
 *   { "type": "pong" }
 *   { "type": "error", "message": "..." }
 *
 * Scalability:
 *   - Each server process subscribes to Redis channels for the symbols
 *     its connected clients care about.
 *   - Redis Pub/Sub distributes updates across multiple Node processes
 *     (e.g., PM2 cluster mode, multiple servers behind a load-balancer).
 *   - A single Redis channel per symbol (e.g., "WS:NIFTY") carries the
 *     JSON-stringified diff message, broadcast by whichever process computed it.
 */

const WebSocket  = require('ws');
const path       = require('path');
const fs         = require('fs');
const fsPromises = require('fs').promises;
const zlib       = require('zlib');
const { promisify } = require('util');
const { pub, sub } = require('./redis');
const liveCache = require('../liveCache');

const gunzipAsync = promisify(zlib.gunzip);

const WS_PATH       = '/ws';   // WebSocket endpoint path
const REDIS_PFX     = 'WS:';  // Redis channel prefix  e.g. "WS:NIFTY"
const FULL_PFX      = 'WS_FULL:'; // Redis key prefix  e.g. "WS_FULL:NIFTY"
const FULL_TTL      = 120;     // seconds — full data expires if no updates
const HEARTBEAT_MS  = 30_000;  // ping interval — detect dead connections

// ── State ─────────────────────────────────────────────────────────────────────
// clients: Map<WebSocket, Set<symbol>>
const clients = new Map();

// Channels this process is subscribed to in Redis
const subscribedChannels = new Set();

// ── Redis Pub/Sub → broadcast to WebSocket clients ────────────────────────────
sub.on('message', (channel, message) => {
  if (!channel.startsWith(REDIS_PFX)) return;
  const symbol = channel.slice(REDIS_PFX.length); // "WS:NIFTY" → "NIFTY"

  for (const [ws, syms] of clients) {
    if (ws.readyState === WebSocket.OPEN && syms.has(symbol)) {
      ws.send(message); // already JSON-stringified diff message
    }
  }
});

sub.on('error', () => {}); // already handled in redis.js

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Ensure this process is subscribed to the Redis channel for `symbol` */
async function ensureRedisSubscription(symbol) {
  const channel = `${REDIS_PFX}${symbol}`;
  if (!subscribedChannels.has(channel)) {
    await sub.subscribe(channel);
    subscribedChannels.add(channel);
  }
}

/**
 * Load latest snapshot from disk for a symbol — fully async, never blocks event loop.
 * Scans Data/{symbol}/{expiry}/{date}/ for the newest .json.gz file.
 */
async function loadLatestFromDisk(symbol) {
  try {
    const dataDir = path.join(__dirname, '..', 'Data');
    if (!fs.existsSync(dataDir)) return null;

    // Case-insensitive folder match
    const symLower  = symbol.toLowerCase();
    const entries   = await fsPromises.readdir(dataDir);
    const symFolder = entries.find(d => d.toLowerCase() === symLower);
    if (!symFolder) return null;

    const symPath = path.join(dataDir, symFolder);
    const today   = new Date().toISOString().split('T')[0];

    // Pick nearest future expiry (or most recent past)
    const expDirs  = await fsPromises.readdir(symPath);
    const expiries = (await Promise.all(expDirs.map(async e => {
      const s = await fsPromises.stat(path.join(symPath, e)).catch(() => null);
      return s?.isDirectory() ? e : null;
    }))).filter(Boolean).sort();

    const future = expiries.filter(e => e >= today);
    const expiry = future[0] || expiries.at(-1);
    if (!expiry) return null;

    const expPath  = path.join(symPath, expiry);
    const dateDirs = await fsPromises.readdir(expPath);
    const dates    = (await Promise.all(dateDirs.map(async d => {
      const s = await fsPromises.stat(path.join(expPath, d)).catch(() => null);
      return s?.isDirectory() ? d : null;
    }))).filter(Boolean).sort();

    const dateDir = dates.at(-1);
    if (!dateDir) return null;

    const datePath = path.join(expPath, dateDir);
    const allFiles = await fsPromises.readdir(datePath);
    const files    = allFiles.filter(f => f.endsWith('.json.gz') || f.endsWith('.json')).sort();
    const latest   = files.at(-1);
    if (!latest) return null;

    const filePath = path.join(datePath, latest);
    const buf      = await fsPromises.readFile(filePath);
    let raw;
    if (latest.endsWith('.gz')) {
      raw = JSON.parse((await gunzipAsync(buf)).toString());
    } else {
      raw = JSON.parse(buf.toString('utf8'));
    }

    // Transform compressed format (short keys from compressChainData) to frontend snapshot
    // Saved format: { s: strike, u: spot, c: { po,th,ga,ve,de,iv,oc,oi,v,lp,lc }, p: {...} }
    const rows      = raw.oc || [];
    const spotPrice = rows[0]?.u || 0;
    const chain     = rows.map(row => ({
      strike: row.s,
      call: {
        pop: row.c?.po||0, theta: row.c?.th||0, gamma: row.c?.ga||0,
        vega: row.c?.ve||0, delta: row.c?.de||0, iv: row.c?.iv||0,
        oi_change: row.c?.oc||0,
        oi: row.c?.oi||0, volume: row.c?.v||0,
        ltp: row.c?.lp||0, ltp_change: row.c?.lc||0
      },
      put: {
        pop: row.p?.po||0, theta: row.p?.th||0, gamma: row.p?.ga||0,
        vega: row.p?.ve||0, delta: row.p?.de||0, iv: row.p?.iv||0,
        oi_change: row.p?.oc||0,
        oi: row.p?.oi||0, volume: row.p?.v||0,
        ltp: row.p?.lp||0, ltp_change: row.p?.lc||0
      }
    }));

    const snap = {
      symbol:     symFolder,
      expiry,
      date:       raw.m?.fi?.split(' ')[0] || dateDir,
      time:       raw.m?.time_hhmmss || '00:00:00',
      spot_price: spotPrice,
      chain,
      fromDisk:   true   // flag so client knows it's historical
    };

    // Warm liveCache and Redis so next request is instant
    liveCache.set(symbol, snap);
    pub.setex(`${FULL_PFX}${symbol}`, FULL_TTL, JSON.stringify(snap)).catch(() => {});

    return snap;
  } catch (_) {
    return null;
  }
}

/** Send full snapshot to one WebSocket client — Redis → liveCache → disk */
async function sendFull(ws, symbol) {
  try {
    // 1. Redis (fastest — already serialised)
    const raw = await pub.get(`${FULL_PFX}${symbol}`);
    if (raw) {
      ws.send(JSON.stringify({ type: 'full', symbol, data: JSON.parse(raw) }));
      return;
    }

    // 2. liveCache (in-process RAM)
    if (liveCache.has(symbol)) {
      const snap = liveCache.get(symbol);
      pub.setex(`${FULL_PFX}${symbol}`, FULL_TTL, JSON.stringify(snap)).catch(() => {});
      ws.send(JSON.stringify({ type: 'full', symbol, data: snap }));
      return;
    }

    // 3. Disk — read latest .json.gz (also warms liveCache + Redis for next time)
    const snap = loadLatestFromDisk(symbol);
    if (snap) {
      ws.send(JSON.stringify({ type: 'full', symbol, data: snap }));
      return;
    }

    ws.send(JSON.stringify({ type: 'error', message: `No data for ${symbol} yet` }));
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to load snapshot' }));
  }
}

// ── Main setup ────────────────────────────────────────────────────────────────

/**
 * Attach WebSocket server to the existing HTTP server.
 * Call this once after httpServer is created.
 *
 * @param {import('http').Server} httpServer
 */
function setupWebSocket(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: WS_PATH });

  // ── Server-side heartbeat — detect and evict dead connections ─────────────
  // A client that drops off the network won't trigger 'close'. Without this,
  // dead connections pile up in the clients Map and waste memory + send attempts.
  const heartbeatTimer = setInterval(() => {
    for (const [ws] of clients) {
      if (!ws.isAlive) {
        clients.delete(ws);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();    // browser responds automatically with pong
    }
  }, HEARTBEAT_MS);

  wss.on('close', () => clearInterval(heartbeatTimer));

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });   // reset liveness flag on pong

    clients.set(ws, new Set());

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      const { action } = msg;
      const symbol = msg.symbol?.toUpperCase().replace(/\s+/g, '_');

      if (action === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      if (!symbol) return;

      if (action === 'subscribe') {
        const subs = clients.get(ws);
        if (!subs) return;
        subs.add(symbol);

        // Subscribe this process to the Redis channel (idempotent)
        await ensureRedisSubscription(symbol).catch(() => {});

        // Send full snapshot immediately so the client has a baseline
        await sendFull(ws, symbol);

      } else if (action === 'unsubscribe') {
        clients.get(ws)?.delete(symbol);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  console.log(`[WS] WebSocket server ready at ws://..${WS_PATH}`);
  return wss;
}

// ── Called by data pipeline (server.js) when new snapshot arrives ─────────────

/**
 * Store full snapshot in Redis and publish diff to all subscribers.
 * Called every ~5 s per symbol by saveOptionChainData().
 *
 * @param {string} symbol   - e.g. "NIFTY_50" (UPPERCASE)
 * @param {object} full     - complete snapshot object
 * @param {object|null} diff - minimal diff vs previous snapshot (null = no change)
 */
async function publishUpdate(symbol, full, diff) {
  const sym = symbol.toUpperCase();

  // Always refresh full snapshot in Redis (keeps TTL alive)
  await pub.setex(`${FULL_PFX}${sym}`, FULL_TTL, JSON.stringify(full));

  // Only publish if something actually changed (avoids empty WebSocket frames)
  if (!diff) return;

  const msg = JSON.stringify({ type: 'diff', symbol: sym, data: diff });
  await pub.publish(`${REDIS_PFX}${sym}`, msg);
}

/**
 * On startup: scan Data/ for ALL symbol folders, load latest .json.gz for each,
 * warm liveCache + Redis so every symbol is ready before any user connects.
 * Old Redis keys for a symbol are overwritten each time new data arrives (TTL=120s).
 */
async function warmAllSymbolsFromDisk() {
  const dataDir = path.join(__dirname, '..', 'Data');
  if (!fs.existsSync(dataDir)) return;

  const symFolders = fs.readdirSync(dataDir).filter(d => {
    try { return fs.statSync(path.join(dataDir, d)).isDirectory(); } catch { return false; }
  });

  let loaded = 0;
  // Process one symbol per event-loop tick — never blocks the server
  for (const folder of symFolders) {
    await new Promise(resolve => setImmediate(resolve));   // yield to event loop
    const symbol = folder.toUpperCase();
    const snap   = loadLatestFromDisk(symbol);
    if (snap) {
      loaded++;
      console.log(`[WS] ✅ Warmed ${symbol} from disk (${snap.chain?.length || 0} strikes)`);
    }
  }
  console.log(`[WS] Disk warm-up done: ${loaded}/${symFolders.length} symbols ready in Redis`);
}

module.exports = { setupWebSocket, publishUpdate, warmAllSymbolsFromDisk };
