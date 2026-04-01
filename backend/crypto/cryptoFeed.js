/**
 * crypto/cryptoFeed.js
 *
 * Delta Exchange India WebSocket feed for crypto option chains.
 * Saves to data/crypto/{BTC|ETH|SOL}/{expiry}/{date}/file.json.gz every 10s.
 */

'use strict';

const WebSocket  = require('ws');
const fs         = require('fs');
const path       = require('path');
const zlib       = require('zlib');
const axios      = require('axios');
const { PATHS }  = require('../config/paths');

// Separate in-memory cache — completely isolated from Upstox liveCache
const cryptoCache = new Map(); // key: "BTC_2025-03-28" → snapshot

// ── Config ─────────────────────────────────────────────────────────────────────
const DELTA_WS      = 'wss://socket.india.delta.exchange';
const DELTA_REST    = 'https://api.india.delta.exchange/v2';
const UNDERLYINGS   = ['BTC', 'ETH', 'SOL'];
const SAVE_INTERVAL = 10_000;
const MAX_EXPIRIES  = 2;
const RECONNECT_MS  = 5_000;
const CRYPTO_DIR    = PATHS.CRYPTO_MARKET;

// ── State ──────────────────────────────────────────────────────────────────────
const tickers  = {};   // productSymbol → latest tick object
const products = {};   // productSymbol → product metadata
const expiries = {};   // underlying → ['2025-03-28', '2025-04-25']
let   wsClient      = null;
let   isRunning     = false;
let   saveTimer     = null;
let   reconnectTimer= null;

// ── Helpers ────────────────────────────────────────────────────────────────────
function log(msg) { console.log(`[CryptoFeed] ${msg}`); }

function getISTNow() {
  const now = new Date(Date.now() + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return {
    date:        `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())}`,
    time:        `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`,
    forFilename: `${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}`,
  };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseExpiry(settlementTime) {
  if (!settlementTime) return null;
  // settlement_time is ISO string like "2025-03-28T12:00:00Z"
  return settlementTime.split('T')[0];
}

async function apiGet(url) {
  const res = await axios.get(url, {
    headers: {
      'Accept':     'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; SOC-Bot/1.0)',
    },
    timeout: 15000,
  });
  return res.data;
}

// ── REST: load products catalog ────────────────────────────────────────────────
async function loadProducts() {
  // Clear previous state
  for (const k of Object.keys(products)) delete products[k];
  for (const k of Object.keys(expiries)) delete expiries[k];

  const underlyings = UNDERLYINGS.join(',');
  const expMap = {};
  let   page   = 1;
  let   total  = 0;
  let   loaded = 0;
  let   _seenUnknown = null;

  while (true) {
    const url  = `${DELTA_REST}/products?contract_types=call_options,put_options` +
                 `&states=live&underlying_asset_symbols=${underlyings}` +
                 `&page_size=200&page=${page}`;
    log(`Fetching products page ${page}...`);
    const data   = await apiGet(url);
    const result = data.result || [];

    for (const p of result) {
      const underlying = p.underlying_asset?.symbol;
      if (!underlying) continue;
      if (!UNDERLYINGS.includes(underlying)) {
        // log once per unique symbol to find correct name
        if (!_seenUnknown) _seenUnknown = new Set();
        if (!_seenUnknown.has(underlying)) { log(`Skipping underlying: "${underlying}"`); _seenUnknown.add(underlying); }
        continue;
      }

      const expiry = parseExpiry(p.settlement_time);
      if (!expiry) continue;

      products[p.symbol] = {
        symbol:        p.symbol,
        underlying,
        expiry,
        strike:        parseFloat(p.strike_price) || 0,
        type:          p.contract_type === 'call_options' ? 'call' : 'put',
        contractValue: parseFloat(p.contract_value) || 0.001,
      };

      if (!expMap[underlying]) expMap[underlying] = new Set();
      expMap[underlying].add(expiry);
      loaded++;
    }

    total = data.meta?.total_count || loaded;
    if (loaded >= total || result.length === 0) break;
    page++;
  }

  // Keep 2 nearest expiries per underlying
  for (const u of UNDERLYINGS) {
    expiries[u] = [...(expMap[u] || [])].sort().slice(0, MAX_EXPIRIES);
    log(`${u} expiries: [${expiries[u].join(', ')}]`);
  }

  log(`Products loaded: ${loaded} total`);
  if (loaded === 0) throw new Error('No products returned from Delta Exchange API');
}

// ── WebSocket ──────────────────────────────────────────────────────────────────
function buildSubscriptions() {
  const channels = [];
  for (const [sym, prod] of Object.entries(products)) {
    const exp = expiries[prod.underlying] || [];
    if (!exp.includes(prod.expiry)) continue;
    channels.push({ name: `v2/ticker:${sym}` });
  }
  return channels;
}

function connect() {
  if (wsClient) {
    try { wsClient.terminate(); } catch (_) {}
    wsClient = null;
  }

  log(`Connecting to ${DELTA_WS}...`);
  const ws = new WebSocket(DELTA_WS);
  wsClient  = ws;

  ws.on('open', () => {
    log('WS connected');
    const channels = buildSubscriptions();
    if (channels.length === 0) {
      log('WARNING: No channels built — products may be empty');
      return;
    }

    // Delta Exchange format: one channel "v2/ticker" with symbols array
    const symbols = channels.map(c => c.name.replace('v2/ticker:', ''));

    // Send in batches of 100 symbols
    const BATCH = 100;
    for (let i = 0; i < symbols.length; i += BATCH) {
      ws.send(JSON.stringify({
        type:    'subscribe',
        payload: {
          channels: [{
            name:    'v2/ticker',
            symbols: symbols.slice(i, i + BATCH),
          }],
        },
      }));
    }
    log(`Subscribed to ${symbols.length} symbols on v2/ticker`);
  });

  let _dc = 0;
  ws.on('message', (rawBuf) => {
    try {
      const raw = rawBuf.toString();
      if (_dc < 3) { log(`RAW[${_dc}]: ${raw.slice(0, 400)}`); _dc++; }
      const msg = JSON.parse(raw);

      // Subscription confirmation — ignore
      if (msg.type === 'subscriptions') return;

      // Ticker update — Delta Exchange sends type = "v2/ticker"
      if (msg.type === 'v2/ticker') {
        const sym = msg.symbol;
        if (sym) tickers[sym] = msg;  // store all, filter during snapshot build
        return;
      }

      // Heartbeat — ignore silently
      if (msg.type === 'heartbeat') return;

      // Log unknown types
      log(`WS unknown type: ${msg.type} symbol: ${msg.symbol || '-'}`);
    } catch (e) {
      log(`WS parse error: ${e.message}`);
    }
  });

  ws.on('close', (code) => {
    log(`WS closed (${code}) — reconnecting in ${RECONNECT_MS/1000}s`);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    log(`WS error: ${err.message}`);
    // close event will fire after error, triggering reconnect
  });
}

function scheduleReconnect() {
  if (reconnectTimer || !isRunning) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (isRunning) connect();
  }, RECONNECT_MS);
}

// ── Build snapshot from current tickers ───────────────────────────────────────
function buildSnapshot(underlying, expiry) {
  const strikeMap = {};

  for (const [sym, prod] of Object.entries(products)) {
    if (prod.underlying !== underlying || prod.expiry !== expiry) continue;
    const tick = tickers[sym];
    if (!tick) continue;

    const cv        = prod.contractValue;                         // e.g. 0.001
    const spot      = parseFloat(tick.spot_price) || 0;
    const ltp       = parseFloat(tick.close) || 0;
    const markVol   = parseFloat(tick.mark_vol) || 0;
    const ltpChgPct = parseFloat(tick.ltp_change_24h) || 0;     // already a % like "8.56"
    const g         = tick.greeks || {};                          // greeks are nested

    const side = {
      ltp,
      ltp_change: parseFloat((ltp * ltpChgPct / 100).toFixed(2)),
      iv:         parseFloat((markVol * 100).toFixed(4)),
      oi:         parseInt(tick.oi_contracts) || 0,
      oi_change:  Math.round((parseFloat(tick.oi_change_usd_6h) || 0) / ((spot * cv) || 1)),
      volume:     Math.round((parseFloat(tick.volume) || 0) / (cv || 0.001)),  // volume is in BTC
      delta:      parseFloat(g.delta) || 0,
      gamma:      parseFloat(g.gamma) || 0,
      theta:      parseFloat(g.theta) || 0,
      vega:       parseFloat(g.vega)  || 0,
    };

    const strike = prod.strike;
    if (!strikeMap[strike]) strikeMap[strike] = { _spot: spot };
    strikeMap[strike][prod.type] = side;
    if (spot > 0) strikeMap[strike]._spot = spot;
  }

  const strikes = Object.keys(strikeMap).map(Number).sort((a, b) => a - b);
  if (!strikes.length) return null;

  let spot = 0;
  for (const s of strikes) {
    if (strikeMap[s]._spot > 0) { spot = strikeMap[s]._spot; break; }
  }

  const chain = strikes
    .map(s => ({ strike: s, call: strikeMap[s].call || null, put: strikeMap[s].put || null }))
    .filter(r => r.call || r.put);

  if (!chain.length) return null;

  const ist = getISTNow();
  return { symbol: underlying, expiry, date: ist.date, time: ist.time, spot_price: spot, lot_size: 1, chain, isCrypto: true };
}

// ── Disk save ──────────────────────────────────────────────────────────────────
function saveToDisk(underlying, expiry, snapshot) {
  try {
    const ist     = getISTNow();
    const dir     = path.join(CRYPTO_DIR, underlying, expiry, ist.date);
    ensureDir(dir);

    const file    = path.join(dir, `${underlying}_${expiry}_${ist.forFilename}.json.gz`);
    const payload = JSON.stringify({
      m: { symbol: underlying, expiry, date: ist.date, time: ist.time, source: 'delta_exchange', lot_size: 1 },
      spot_price: snapshot.spot_price,
      chain:      snapshot.chain,
    });

    zlib.gzip(Buffer.from(payload), (err, buf) => {
      if (err) { log(`gzip error ${underlying}/${expiry}: ${err.message}`); return; }
      fs.promises.writeFile(file, buf)
        .then(() => log(`✅ Saved ${underlying}/${expiry} ${ist.time} (${(buf.length/1024).toFixed(1)}kb)`))
        .catch(e => log(`write error ${underlying}/${expiry}: ${e.message}`));
    });
  } catch (e) {
    log(`saveToDisk error: ${e.message}`);
  }
}

// ── Save cycle ─────────────────────────────────────────────────────────────────
function runSaveCycle() {
  const tickCount = Object.keys(tickers).length;
  if (tickCount === 0) {
    log('Save cycle: no tickers yet — waiting for WS data');
    return;
  }

  let saved = 0;
  const ist = getISTNow();

  for (const underlying of UNDERLYINGS) {
    for (const expiry of (expiries[underlying] || [])) {
      const snapshot = buildSnapshot(underlying, expiry);
      if (!snapshot) {
        log(`No data for ${underlying}/${expiry}`);
        continue;
      }

      const cacheKey = `${underlying}_${expiry}`;
      cryptoCache.set(cacheKey, snapshot);

      saveToDisk(underlying, expiry, snapshot);
      saved++;
    }
  }

  log(`Save cycle ${ist.time}: ${saved} saved, ${tickCount} tickers active`);
}

// ── Public API ─────────────────────────────────────────────────────────────────
async function start() {
  if (isRunning) {
    log('Already running');
    return;
  }
  isRunning = true;
  ensureDir(CRYPTO_DIR);

  log('Loading products...');
  try {
    await loadProducts();
  } catch (e) {
    log(`Product load failed: ${e.message} — retrying in 15s`);
    isRunning = false;  // allow retry to enter start() properly
    setTimeout(start, 15_000);
    return;
  }

  connect();

  if (saveTimer) clearInterval(saveTimer);
  saveTimer = setInterval(runSaveCycle, SAVE_INTERVAL);
  log('Feed started — saving every 10s');
}

function stop() {
  if (!isRunning) return;
  isRunning = false;
  if (saveTimer)      { clearInterval(saveTimer);   saveTimer      = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (wsClient)       { try { wsClient.terminate(); } catch (_) {} wsClient = null; }
  log('Feed stopped');
}

function getStatus() {
  return {
    running:     isRunning,
    connected:   wsClient?.readyState === WebSocket.OPEN,
    products:    Object.keys(products).length,
    tickerCount: Object.keys(tickers).length,
    expiries:    { ...expiries },
  };
}

// Get live snapshot for a specific underlying + expiry
function getSnapshot(underlying, expiry) {
  return cryptoCache.get(`${underlying}_${expiry}`) || null;
}

// Get all available underlyings and their expiries
function getAvailable() {
  const result = {};
  for (const [u, exps] of Object.entries(expiries)) {
    result[u] = exps;
  }
  return result;
}

module.exports = { start, stop, getStatus, getSnapshot, getAvailable };
