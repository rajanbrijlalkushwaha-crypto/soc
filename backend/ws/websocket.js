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
 *   { "type": "full", "symbol": "NIFTY", "data": { ...fullSnapshot } }
 *   { "type": "diff", "symbol": "NIFTY", "data": { ...diffOnly } }
 *   { "type": "pong" }
 *   { "type": "error", "message": "..." }
 *
 * Live data served from liveserver1 MongoDB (no Redis).
 * Diffs broadcast directly to connected clients (no Redis pub/sub).
 */

const WebSocket  = require('ws');
const path       = require('path');
const fs         = require('fs');
const fsPromises = require('fs').promises;
const zlib       = require('zlib');
const { promisify } = require('util');
const liveCache = require('../liveCache');
const { OptionChain, unpackDoc } = require('../db/models/OptionChain');
const { LiveServer1 } = require('../db/models/LiveServer1');

const gunzipAsync = promisify(zlib.gunzip);

const WS_PATH      = '/ws';
const HEARTBEAT_MS = 30_000;

// clients: Map<WebSocket, Set<symbol>>
const clients = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function ocToChain(rows) {
  return (rows || []).map(row => ({
    strike: row.s,
    call: {
      pop: row.c?.po||0, theta: row.c?.th||0, gamma: row.c?.ga||0,
      vega: row.c?.ve||0, delta: row.c?.de||0, iv: row.c?.iv||0,
      oi_change: row.c?.oc||0, oi: row.c?.oi||0, volume: row.c?.v||0,
      ltp: row.c?.lp||0, ltp_change: row.c?.lc||0
    },
    put: {
      pop: row.p?.po||0, theta: row.p?.th||0, gamma: row.p?.ga||0,
      vega: row.p?.ve||0, delta: row.p?.de||0, iv: row.p?.iv||0,
      oi_change: row.p?.oc||0, oi: row.p?.oi||0, volume: row.p?.v||0,
      ltp: row.p?.lp||0, ltp_change: row.p?.lc||0
    }
  }));
}

/**
 * Load latest snapshot for a symbol.
 * Priority: liveserver1 MongoDB → OptionChain MongoDB → disk.
 * Warms liveCache Map (without writing back to liveserver1).
 */
async function loadLatestSnapshot(symbol) {
  const sym = symbol.toUpperCase();

  // ── 0. liveserver1 (uncompressed, one doc per symbol — fastest) ──────────
  try {
    const live = await LiveServer1.findOne({ symbol: sym }).lean();
    if (live) {
      const snap = {
        symbol:             live.symbol,
        expiry:             live.expiry             || '',
        date:               live.date               || '',
        time:               live.time               || '',
        spot_price:         live.spot_price         || 0,
        spot_vwap:          live.spot_vwap          || 0,
        spot_prev_close:    live.spot_prev_close    || 0,
        spot_change:        live.spot_change        || 0,
        spot_pct_change:    live.spot_pct_change    || 0,
        futures_ltp:        live.futures_ltp        || 0,
        futures_prev_close: live.futures_prev_close || 0,
        futures_change:     live.futures_change     || 0,
        futures_pct_change: live.futures_pct_change || 0,
        lot_size:           live.lot_size           || 1,
        chain:              live.chain              || [],
        chains:             live.chains             || {},
        availableExpiries:  live.availableExpiries  || [],
        currentExpiry:      live.currentExpiry      || live.expiry || '',
        nextExpiry:         live.nextExpiry         || null,
        isExpiryDay:        live.isExpiryDay        || false,
      };
      liveCache.setFromDB(sym, snap); // warm Map only, no write-back
      return snap;
    }
  } catch (_) {}

  // ── 1. MongoDB OptionChain (compressed, historical) ──────────────────────
  try {
    const today = new Date().toISOString().split('T')[0];
    const latestPerExpiry = await OptionChain.aggregate([
      { $match: { symbol: sym } },
      { $sort:  { ts: -1 } },
      { $group: { _id: '$expiry', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $sort: { expiry: 1 } },
    ]);

    if (latestPerExpiry.length > 0) {
      const primary    = latestPerExpiry.find(d => d.expiry >= today) || latestPerExpiry[0];
      const primaryDoc = unpackDoc(primary);
      const chain      = ocToChain(primaryDoc.oc);

      const chains            = {};
      const availableExpiries = [];
      for (const raw of latestPerExpiry) {
        const d = unpackDoc(raw);
        if (!d || d.expiry < today) continue;
        availableExpiries.push(d.expiry);
        chains[d.expiry] = ocToChain(d.oc);
      }
      if (!availableExpiries.includes(primaryDoc.expiry)) availableExpiries.unshift(primaryDoc.expiry);
      availableExpiries.sort();
      if (!chains[primaryDoc.expiry]) chains[primaryDoc.expiry] = chain;

      const snap = {
        symbol:             sym,
        expiry:             primaryDoc.expiry,
        date:               primaryDoc.date,
        time:               primaryDoc.time,
        spot_price:         primaryDoc.m?.spot_price      || 0,
        lot_size:           primaryDoc.m?.lot_size        || 1,
        spot_prev_close:    primaryDoc.m?.spot_prev_close || 0,
        spot_change:        primaryDoc.m?.spot_change     || 0,
        spot_pct_change:    primaryDoc.m?.spot_pct_change || 0,
        futures_ltp:        primaryDoc.m?.futures_ltp     || 0,
        futures_prev_close: primaryDoc.m?.futures_prev    || 0,
        futures_change:     primaryDoc.m?.futures_change  || 0,
        futures_pct_change: primaryDoc.m?.futures_pct     || 0,
        chain,
        chains,
        availableExpiries,
        currentExpiry:      primaryDoc.expiry,
        nextExpiry:         availableExpiries[1] || null,
      };
      liveCache.setFromDB(sym, snap);
      return snap;
    }
  } catch (_) {}

  // ── 2. Disk fallback ──────────────────────────────────────────────────────
  try {
    const dataDir = path.join(__dirname, '..', 'Data');
    if (!fs.existsSync(dataDir)) return null;

    const symLower  = sym.toLowerCase();
    const entries   = await fsPromises.readdir(dataDir);
    const symFolder = entries.find(d => d.toLowerCase() === symLower);
    if (!symFolder) return null;

    const symPath = path.join(dataDir, symFolder);
    const today   = new Date().toISOString().split('T')[0];
    const expDirs  = await fsPromises.readdir(symPath);
    const expiries = (await Promise.all(expDirs.map(async e => {
      const s = await fsPromises.stat(path.join(symPath, e)).catch(() => null);
      return s?.isDirectory() ? e : null;
    }))).filter(Boolean).sort();

    const expiry = (expiries.filter(e => e >= today)[0]) || expiries.at(-1);
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
    const gzFiles  = allFiles.filter(f => f.endsWith('.json.gz') || f.endsWith('.json')).sort();
    const latest   = gzFiles.at(-1);
    if (!latest) return null;

    const buf = await fsPromises.readFile(path.join(datePath, latest));
    const raw = JSON.parse((latest.endsWith('.gz') ? (await gunzipAsync(buf)) : buf).toString());
    const chain = ocToChain(raw.oc || []);

    const snap = {
      symbol:     symFolder,
      expiry,
      date:       raw.m?.fi?.split(' ')[0] || dateDir,
      time:       raw.m?.time_hhmmss       || '00:00:00',
      spot_price: raw.oc?.[0]?.u           || 0,
      lot_size:   raw.m?.lot_size          || 1,
      chain,
    };
    liveCache.setFromDB(sym, snap);
    return snap;
  } catch (_) {
    return null;
  }
}

/** Send full snapshot to one WebSocket client */
async function sendFull(ws, symbol) {
  try {
    // 1. liveCache Map (zero latency, sync)
    if (liveCache.has(symbol)) {
      ws.send(JSON.stringify({ type: 'full', symbol, data: liveCache.get(symbol) }));
      return;
    }
    // 2. liveserver1 MongoDB / disk fallback (warms liveCache for next request)
    const snap = await loadLatestSnapshot(symbol);
    if (snap) {
      ws.send(JSON.stringify({ type: 'full', symbol, data: snap }));
      return;
    }
    ws.send(JSON.stringify({ type: 'error', message: `No data for ${symbol} yet` }));
  } catch (_) {
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to load snapshot' }));
  }
}

/** Broadcast full snapshot to all clients subscribed to symbol (called by upstoxWs) */
function broadcastFull(symbol, full) {
  const sym = symbol.toUpperCase();
  const msg = JSON.stringify({ type: 'full', symbol: sym, data: full });
  for (const [ws, syms] of clients) {
    if (ws.readyState === WebSocket.OPEN && syms.has(sym)) {
      ws.send(msg);
    }
  }
}

/**
 * Publish diff to all subscribers directly (no Redis).
 * liveCache.set() already upserted to liveserver1, so no extra DB write here.
 */
async function publishUpdate(symbol, full, diff) {
  const sym = symbol.toUpperCase();
  if (!diff) return;
  const msg = JSON.stringify({ type: 'diff', symbol: sym, data: diff });
  for (const [ws, syms] of clients) {
    if (ws.readyState === WebSocket.OPEN && syms.has(sym)) {
      ws.send(msg);
    }
  }
}

// ── Main setup ────────────────────────────────────────────────────────────────

function setupWebSocket(httpServer) {
  const wss = new WebSocket.Server({ server: httpServer, path: WS_PATH });

  const heartbeatTimer = setInterval(() => {
    for (const [ws] of clients) {
      if (!ws.isAlive) { clients.delete(ws); ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  wss.on('close', () => clearInterval(heartbeatTimer));

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    clients.set(ws, new Set());

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      const { action } = msg;
      const symbol = msg.symbol?.toUpperCase().replace(/\s+/g, '_');

      if (action === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      if (!symbol) return;

      if (action === 'subscribe') {
        const subs = clients.get(ws);
        if (!subs) return;
        subs.add(symbol);
        await sendFull(ws, symbol);
      } else if (action === 'unsubscribe') {
        clients.get(ws)?.delete(symbol);
      }
    });

    ws.on('close', () => { clients.delete(ws); });
    ws.on('error', () => { clients.delete(ws); });
  });

  console.log(`[WS] WebSocket server ready at ws://..${WS_PATH}`);
  return wss;
}

// Priority symbols warmed first in parallel
const WARM_PRIORITY = ['NIFTY_50', 'BANKNIFTY', 'MIDCPNIFTY', 'FINNIFTY', 'SENSEX', 'BANKEX', 'NIFTY_NEXT_50'];

async function warmAllSymbols() {
  let symbols = [];
  try {
    const dbSyms = await OptionChain.distinct('symbol');
    symbols = [...new Set(dbSyms)];
  } catch (_) {}

  const dataDir = path.join(__dirname, '..', 'Data');
  if (fs.existsSync(dataDir)) {
    const diskSyms = fs.readdirSync(dataDir)
      .filter(d => { try { return fs.statSync(path.join(dataDir, d)).isDirectory(); } catch { return false; } })
      .map(d => d.toUpperCase());
    symbols = [...new Set([...symbols, ...diskSyms])];
  }

  const priority = WARM_PRIORITY.filter(s => symbols.includes(s));
  const rest     = symbols.filter(s => !WARM_PRIORITY.includes(s));

  const priSnaps = await Promise.all(priority.map(async sym => {
    const snap = await loadLatestSnapshot(sym);
    if (snap) console.log(`[WS] ✅ Warmed ${sym} (${snap.chain?.length || 0} strikes)`);
    return snap ? 1 : 0;
  }));
  let loaded = priSnaps.reduce((a, b) => a + b, 0);

  for (const symbol of rest) {
    await new Promise(resolve => setImmediate(resolve));
    const snap = await loadLatestSnapshot(symbol);
    if (snap) {
      loaded++;
      console.log(`[WS] ✅ Warmed ${symbol} (${snap.chain?.length || 0} strikes)`);
    }
  }
  console.log(`[WS] Warm-up done: ${loaded}/${symbols.length} symbols ready`);
}

const warmAllSymbolsFromDisk = warmAllSymbols;

module.exports = { setupWebSocket, publishUpdate, warmAllSymbolsFromDisk, broadcastFull };
