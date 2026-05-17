/**
 * ws/upstoxWs.js
 *
 * Upstox WebSocket v3 subscriber.
 * - Decodes Protobuf binary frames
 * - Maintains per-symbol option chain state in memory
 * - Publishes live state to DragonflyDB (OC:<SYMBOL>)
 * - Stores full snapshot to OC_STATE:<SYMBOL> for new subscriber snapshots
 * - Throttled MongoDB write to websocketoc collection every 5s per symbol
 * - Updates tick OHLC (1-minute candles) per symbol:strike:type
 * - OI baseline refreshed every 30s from REST (caller invokes updateOiBaseline)
 * - Reconnects with exponential backoff on disconnect
 */

'use strict';

const WebSocket  = require('ws');
const path       = require('path');
const protobuf   = require('protobufjs');
const { pub }              = require('./redis');         // kept for Socket.IO OC channel only
const { connectDB }        = require('../db/mongoose');
const liveCache            = require('../liveCache');
const { broadcastFull }    = require('./websocket');
const { WebSocketLiveServer1 } = require('../db/models/WebSocketLiveServer1');
const { WebSocketTickData }    = require('../db/models/WebSocketTickData');
const zlib = require('zlib');

// ── Proto loader (loaded once) ───────────────────────────────────────────────
let _FeedResponse = null;
async function loadProto() {
  if (_FeedResponse) return _FeedResponse;
  const root = await protobuf.load(path.join(__dirname, '../proto/MarketDataFeed.proto'));
  _FeedResponse = root.lookupType('com.upstox.marketdatafeeder.rpc.proto.FeedResponse');
  return _FeedResponse;
}

// ── State ────────────────────────────────────────────────────────────────────
let _ws      = null;
let _config  = null;                       // { UPSTOX_BASE_URL, ... }  from server CONFIG
let _retryMs = 5000;
let _retryTimer = null;
let _running = false;

// instrument key sets per symbol
// _instruments[symbol] = { indexKey, futuresKey, optionKeys: Set<string> }
const _instruments = {};

// live chain state per symbol
// _state[symbol] = { spot, spot_chg, fut_ltp, chain: { strike: { CE:{...}, PE:{...} } }, expiry }
const _state = {};

// OI baseline from REST: _oiBase[instrumentKey] = prevOi (number)
const _oiBase = {};

// Tick OHLC candles (1-minute): _ohlc[symbol][strike][type] = { o,h,l,c,ts }
const _ohlc = {};

// Last MongoDB write time per symbol (throttle to 5s)
const _lastDbWrite = {};

// ── Helpers ──────────────────────────────────────────────────────────────────
function getIstNow() {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return now.toISOString().replace('T', ' ').substring(0, 19);
}

function log(msg) {
  console.log(`[UpstoxWS ${getIstNow()}] ${msg}`);
}

// Parse option instrument key → { symbol, strike, type }
// e.g. NSE_FO|NIFTY25MAY2524000CE  or BSE_FO|SENSEX25MAY2572000PE
function parseOptionKey(key) {
  try {
    const part = key.split('|')[1]; // NIFTY25MAY2524000CE
    const m = part.match(/^([A-Z]+)(\d{2})([A-Z]{3})(\d{2})(\d+)(CE|PE)$/);
    if (!m) return null;
    return { symbol: m[1], strike: Number(m[5]), type: m[6] };
  } catch { return null; }
}

// ── OHLC candle update ───────────────────────────────────────────────────────
function updateOhlc(symbol, strike, type, ltp) {
  if (!_ohlc[symbol]) _ohlc[symbol] = {};
  if (!_ohlc[symbol][strike]) _ohlc[symbol][strike] = {};
  const prev = _ohlc[symbol][strike][type];

  // current 1-minute bucket (IST)
  const bucketMs = Math.floor((Date.now() + 5.5 * 3600 * 1000) / 60000) * 60000;

  if (!prev || prev.ts !== bucketMs) {
    _ohlc[symbol][strike][type] = { o: ltp, h: ltp, l: ltp, c: ltp, ts: bucketMs };
  } else {
    if (ltp > prev.h) prev.h = ltp;
    if (ltp < prev.l) prev.l = ltp;
    prev.c = ltp;
  }
}

// Expose closed candle (previous minute) for charting
function getClosedCandle(symbol, strike, type) {
  const c = _ohlc[symbol]?.[strike]?.[type];
  if (!c) return null;
  const bucketMs = Math.floor((Date.now() + 5.5 * 3600 * 1000) / 60000) * 60000;
  return c.ts < bucketMs ? c : null; // only return if bucket already closed
}

// ── Process a single decoded tick ────────────────────────────────────────────
function processTick(instrumentKey, feed) {
  const info = parseOptionKey(instrumentKey);
  if (!info) return; // futures / spot tick — handle separately below

  const { symbol, strike, type } = info;
  if (!_state[symbol]) return; // not subscribed to this symbol yet

  const st = _state[symbol];
  if (!st.chain[strike]) st.chain[strike] = {};

  const leg = st.chain[strike];
  const prev = leg[type] || {};

  // Extract fields from either optionChain or marketFF
  let ltp, vol, oi, iv, delta, bid, ask, cp;
  const og = feed.fullFeed?.optionChain;
  const mf = feed.fullFeed?.marketFF;
  const lt = feed.ltpc;

  if (og) {
    ltp   = og.ltpcLtp   ?? og.ltpc_ltp   ?? 0;
    cp    = og.ltpcCp    ?? og.ltpc_cp    ?? 0;
    vol   = og.vtt  ?? 0;
    oi    = og.oi   ?? 0;
    iv    = og.iv   ?? 0;
    delta = og.delta ?? 0;
    bid   = og.bq?.[0]?.price ?? 0;
    ask   = og.sq?.[0]?.price ?? 0;
  } else if (mf) {
    ltp   = mf.ltpcLtp   ?? mf.ltpc_ltp   ?? 0;
    cp    = mf.ltpcCp    ?? mf.ltpc_cp    ?? 0;
    vol   = mf.vtt  ?? 0;
    oi    = mf.oi   ?? 0;
    bid   = mf.bq?.[0]?.price ?? 0;
    ask   = mf.sq?.[0]?.price ?? 0;
  } else if (lt) {
    ltp = lt.ltp ?? 0;
    cp  = lt.cp  ?? 0;
  } else return;

  const oiBase  = _oiBase[instrumentKey] ?? oi;
  const oiChg   = oi - oiBase;
  const ltpChg  = cp > 0 ? ltp - cp : (prev.ltp ? ltp - prev.ltp : 0);

  leg[type] = { ltp, ltp_chg: ltpChg, oi, oi_chg: oiChg, vol, iv, delta, bid, ask };

  updateOhlc(symbol, strike, type, ltp);
}

function processFuturesTick(symbol, feed) {
  if (!_state[symbol]) return;
  const og = feed.fullFeed?.optionChain;
  const mf = feed.fullFeed?.marketFF;
  const lt = feed.ltpc;
  let ltp = 0;
  if (og)     ltp = og.ltpcLtp ?? og.ltpc_ltp ?? 0;
  else if (mf) ltp = mf.ltpcLtp ?? mf.ltpc_ltp ?? 0;
  else if (lt) ltp = lt.ltp ?? 0;
  if (ltp > 0) _state[symbol].fut_ltp = ltp;
}

function processIndexTick(symbol, feed) {
  if (!_state[symbol]) return;
  const mf = feed.fullFeed?.marketFF;
  const lt = feed.ltpc;
  let ltp = 0, cp = 0, atp = 0;
  if (mf) {
    ltp = mf.ltpcLtp ?? mf.ltpc_ltp ?? 0;
    cp  = mf.ltpcCp  ?? mf.ltpc_cp  ?? 0;
    atp = mf.atp     ?? 0;
  } else if (lt) {
    ltp = lt.ltp ?? 0;
    cp  = lt.cp  ?? 0;
  }
  if (ltp > 0) {
    _state[symbol].spot     = ltp;
    _state[symbol].spot_chg = cp > 0 ? ltp - cp : 0;
  }
  // atp from feed works for equity; for indices use candle-based VWAP
  if (atp > 0) {
    _state[symbol].spot_vwap = atp;
  } else {
    try {
      const vwap = require('../api/upstoxFeed').getVwap(symbol);
      if (vwap > 0) _state[symbol].spot_vwap = vwap;
    } catch (_) {}
  }
}

// ── Publish state to Redis ────────────────────────────────────────────────────
async function publishState(symbol) {
  const st = _state[symbol];
  if (!st) return;

  // Build flat chain sorted by strike (tick format: ce/pe keys)
  const chain = Object.entries(st.chain)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([strike, legs]) => ({
      strike: Number(strike),
      ce: legs.CE || null,
      pe: legs.PE || null,
    }));

  // ── Way 2a: publish to OC:SYMBOL (Socket.IO, tick format) ────────────────
  const socketPayload = JSON.stringify({
    symbol, expiry: st.expiry || '',
    spot: st.spot, spot_chg: st.spot_chg, fut_ltp: st.fut_ltp,
    ts: Date.now(), chain,
  });
  try {
    await pub.publish(`OC:${symbol}`, socketPayload);
    await pub.set(`OC_STATE:${symbol}`, socketPayload, 'EX', 3600);
  } catch (_) {}

  // ── Way 2b: publish to WS:SYMBOL (native WebSocket, same format as Way 1) ─
  // Convert tick chain to Way 1 field names so LiveOCPage/OptionChainTable work
  const existing = liveCache.get(symbol) || {};
  const wsChain = chain.map(r => ({
    strike: r.strike,
    call: r.ce ? {
      ltp: r.ce.ltp || 0, ltp_change: r.ce.ltp_chg || 0,
      oi: r.ce.oi || 0,   oi_change: r.ce.oi_chg || 0,
      volume: r.ce.vol || 0, iv: r.ce.iv || 0, delta: r.ce.delta || 0,
    } : null,
    put: r.pe ? {
      ltp: r.pe.ltp || 0, ltp_change: r.pe.ltp_chg || 0,
      oi: r.pe.oi || 0,   oi_change: r.pe.oi_chg || 0,
      volume: r.pe.vol || 0, iv: r.pe.iv || 0, delta: r.pe.delta || 0,
    } : null,
  }));

  const expiry = st.expiry || existing.expiry || '';
  const full = {
    symbol,
    expiry,
    date:               existing.date               || new Date().toISOString().split('T')[0],
    time:               getIstNow().split(' ')[1],
    spot_price:         st.spot                     || existing.spot_price        || 0,
    spot_vwap:          st.spot_vwap                || existing.spot_vwap         || (() => { try { return require('../api/upstoxFeed').getVwap(symbol) || 0; } catch(_) { return 0; } })(),
    spot_prev_close:    existing.spot_prev_close    || 0,
    spot_change:        st.spot_chg                 || existing.spot_change       || 0,
    spot_pct_change:    existing.spot_pct_change    || 0,
    futures_ltp:        st.fut_ltp                  || existing.futures_ltp       || 0,
    futures_prev_close: existing.futures_prev_close || 0,
    futures_change:     existing.futures_change     || 0,
    futures_pct_change: existing.futures_pct_change || 0,
    lot_size:           existing.lot_size           || 1,
    chain:              wsChain,
    chains:             existing.chains             || {},
    availableExpiries:  existing.availableExpiries  || (expiry ? [expiry] : []),
    currentExpiry:      expiry,
    nextExpiry:         existing.nextExpiry         || null,
  };

  // Save uncompressed live snapshot to websocketliveserver1 (fire-and-forget)
  WebSocketLiveServer1.updateOne(
    { symbol },
    { $set: { ...full, symbol, updatedAt: new Date() } },
    { upsert: true }
  ).catch(() => {});

  // Broadcast full snapshot directly to all subscribed WS clients (no Redis)
  try { broadcastFull(symbol, full); } catch (_) {}

  // ── Throttled MongoDB write (every 5s per symbol) ─────────────────────────
  const now = Date.now();
  if (!_lastDbWrite[symbol] || now - _lastDbWrite[symbol] >= 5000) {
    _lastDbWrite[symbol] = now;
    writeToMongo(symbol, chain, st).catch(() => {});
  }
}

async function writeToMongo(symbol, chain, st) {
  try {
    await connectDB();
    const chainData = chain.map(r => ({
      strike: r.strike,
      ce: r.ce ? { ltp: r.ce.ltp, ltp_chg: r.ce.ltp_chg, oi: r.ce.oi, oi_chg: r.ce.oi_chg,
                    vol: r.ce.vol, iv: r.ce.iv, delta: r.ce.delta, bid: r.ce.bid, ask: r.ce.ask } : undefined,
      pe: r.pe ? { ltp: r.pe.ltp, ltp_chg: r.pe.ltp_chg, oi: r.pe.oi, oi_chg: r.pe.oi_chg,
                    vol: r.pe.vol, iv: r.pe.iv, delta: r.pe.delta, bid: r.pe.bid, ask: r.pe.ask } : undefined,
    }));
    const chainGz = zlib.gzipSync(JSON.stringify(chainData));
    await WebSocketTickData.create({
      symbol,
      expiry:   st.expiry || '',
      ts:       new Date(),
      spot:     st.spot,
      spot_chg: st.spot_chg,
      fut_ltp:  st.fut_ltp,
      chainGz,
    });
  } catch (_) {}
}

// ── Register instruments ─────────────────────────────────────────────────────
// Called after each REST fetch cycle with instrument keys for a symbol
function registerInstruments({ symbol, indexKey, futuresKey, optionKeys, expiry }) {
  if (!_instruments[symbol]) _instruments[symbol] = { indexKey: '', futuresKey: '', optionKeys: new Set() };
  const inst = _instruments[symbol];
  if (indexKey)   inst.indexKey   = indexKey;
  if (futuresKey) inst.futuresKey = futuresKey;
  if (expiry)     inst.expiry     = expiry;
  if (optionKeys) optionKeys.forEach(k => inst.optionKeys.add(k));

  if (!_state[symbol]) {
    _state[symbol] = { spot: 0, spot_chg: 0, spot_vwap: 0, fut_ltp: 0, chain: {}, expiry: expiry || '' };
  } else if (expiry) {
    _state[symbol].expiry = expiry;
  }

  // If WS is open — resubscribe with updated keys
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    subscribeSymbol(symbol);
  }
}

// Update OI baseline from REST data
// chainRows: array of { call_options: { instrument_key, market_data: { oi } }, put_options: { ... } }
function updateOiBaseline(chainRows) {
  for (const row of chainRows || []) {
    const ck = row.call_options?.instrument_key;
    const pk = row.put_options?.instrument_key;
    const cOi = row.call_options?.market_data?.oi ?? 0;
    const pOi = row.put_options?.market_data?.oi ?? 0;
    if (ck) _oiBase[ck] = cOi;
    if (pk) _oiBase[pk] = pOi;
  }
}

// ── WebSocket subscribe ───────────────────────────────────────────────────────
function subscribeSymbol(symbol) {
  const inst = _instruments[symbol];
  if (!inst || !_ws || _ws.readyState !== WebSocket.OPEN) return;

  const keys = [];
  if (inst.indexKey)   keys.push(inst.indexKey);
  if (inst.futuresKey) keys.push(inst.futuresKey);
  inst.optionKeys.forEach(k => keys.push(k));

  if (!keys.length) return;

  _ws.send(JSON.stringify({
    guid:   `sub_${symbol}_${Date.now()}`,
    method: 'sub',
    data:   { mode: 'full', instrumentKeys: keys },
  }));
  log(`Subscribed ${symbol}: ${keys.length} instruments`);
}

// ── WebSocket connect ─────────────────────────────────────────────────────────
async function connect(config) {
  _config = config;
  _running = true;
  await loadProto();
  _connect();
}

function _connect() {
  if (!_running) return;

  const tokens = _getTokens();
  if (!tokens.length) {
    log('No access tokens — retrying in 30s');
    _retryTimer = setTimeout(_connect, 30000);
    return;
  }
  const token = tokens[0].token;

  // Direct WebSocket connection with Authorization header (same pattern as upstoxFeed.js)
  try {
    _ws = new WebSocket('wss://api.upstox.com/v2/feed/market-data-feed', {
      headers: { Authorization: `Bearer ${token}`, Accept: '*/*' },
      followRedirects: true,
    });
    _ws.binaryType = 'nodebuffer';
    _retryMs = 5000; // reset backoff on successful connect attempt
  } catch (e) {
    log(`WS create error: ${e.message} — retrying in ${_retryMs / 1000}s`);
    scheduleReconnect();
    return;
  }

  _ws.on('open', () => {
    log('Connected to Upstox WebSocket');
    for (const sym of Object.keys(_instruments)) subscribeSymbol(sym);
  });

  _ws.on('message', async (data) => {
    try {
      const FeedResponse = await loadProto();
      const msg   = FeedResponse.decode(data);
      const feeds = msg.feeds || {};

      for (const [key, feed] of Object.entries(feeds)) {
        for (const [sym, inst] of Object.entries(_instruments)) {
          if (inst.indexKey === key) {
            processIndexTick(sym, feed);
            await publishState(sym);
            break;
          }
          if (inst.futuresKey === key) {
            processFuturesTick(sym, feed);
            await publishState(sym);
            break;
          }
          if (inst.optionKeys.has(key)) {
            processTick(key, feed);
            await publishState(sym);
            break;
          }
        }
      }
    } catch (_) {}
  });

  _ws.on('close', (code) => {
    log(`Disconnected (${code}) — reconnecting in ${_retryMs / 1000}s`);
    scheduleReconnect();
  });

  _ws.on('error', (e) => {
    log(`WS error: ${e.message}`);
    // close event fires after error, triggering reconnect
  });
}

function scheduleReconnect() {
  if (_retryTimer) clearTimeout(_retryTimer);
  _retryTimer = setTimeout(() => {
    _retryMs = Math.min(_retryMs * 2, 60000); // max 60s
    _connect();
  }, _retryMs);
}

function disconnect() {
  _running = false;
  if (_retryTimer) clearTimeout(_retryTimer);
  if (_ws) { try { _ws.close(); } catch (_) {} _ws = null; }
}

// Read access tokens from upstox_apps.json (same pattern as server.js)
const fs   = require('fs');
const { PATHS } = require('../config/paths');
function _getTokens() {
  try {
    return JSON.parse(fs.readFileSync(PATHS.UPSTOX_APPS, 'utf8'))
      .filter(a => a.access_token)
      .map(a => ({ id: a.id, token: a.access_token }));
  } catch { return []; }
}

// Expose OHLC for API routes
function getOhlcCandles(symbol, strike, type) {
  return _ohlc[symbol]?.[strike]?.[type] || null;
}

function getState(symbol) {
  return _state[symbol] || null;
}

module.exports = { connect, disconnect, registerInstruments, updateOiBaseline, getOhlcCandles, getState, getClosedCandle };
