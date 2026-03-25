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

const WebSocket = require('ws');
const { pub, sub } = require('./redis');

const WS_PATH    = '/ws';          // WebSocket endpoint path
const REDIS_PFX  = 'WS:';         // Redis channel prefix e.g. "WS:NIFTY"
const FULL_PFX   = 'WS_FULL:';    // Redis key prefix for full data e.g. "WS_FULL:NIFTY"
const FULL_TTL   = 120;           // seconds — full data expires if no updates

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

/** Send full snapshot to one WebSocket client */
async function sendFull(ws, symbol) {
  try {
    const raw = await pub.get(`${FULL_PFX}${symbol}`);
    if (!raw) {
      ws.send(JSON.stringify({ type: 'error', message: `No data for ${symbol} yet` }));
      return;
    }
    ws.send(JSON.stringify({ type: 'full', symbol, data: JSON.parse(raw) }));
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

  wss.on('connection', (ws, req) => {
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

module.exports = { setupWebSocket, publishUpdate };
