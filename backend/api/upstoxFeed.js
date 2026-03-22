// API/upstoxFeed.js
// ── Real-time + Historical OHLC via Upstox WebSocket & Historical Candle API ──
//
// LIVE:
//   • Connects to Upstox Market Data WebSocket (protobuf, ltpc mode)
//   • Builds tick-by-tick OHLC candles in RAM for 1/3/5/15m timeframes
//   • Persists today's 1m candles to disk on every candle close
//   • Falls back to 1-second REST polling if WebSocket is unavailable
//   • Pushes candle updates to browser clients via our own WebSocket at /ws/chart
//
// HISTORICAL:
//   • On startup: scans Data/{symbol}/ folders, collects all trade dates,
//     fetches missing dates (≤30 days old) from Upstox 1m historical API, saves to disk
//   • Endpoint: GET /api/chart/historical/:symbol?tf=5&from=DATE&to=DATE
//     → reads from disk (Data/{symbol}/{expiry}/{date}/_chart_upstox.json), aggregates to TF
//     → falls back to live Upstox API if disk miss (recent dates only)

const axios     = require('axios');
const WebSocket = require('ws');
const protobuf  = require('protobufjs');
const path      = require('path');
const fs        = require('fs');
const { PATHS } = require('../config/paths');

// ── Instrument key map ───────────────────────────────────────────────────────
const INSTRUMENT_KEYS = {
  NIFTY:      'NSE_INDEX|Nifty 50',
  BANKNIFTY:  'NSE_INDEX|Nifty Bank',
  MIDCPNIFTY: 'NSE_INDEX|NIFTY MID SELECT',
  FINNIFTY:   'NSE_INDEX|Nifty Financial Services',
  SENSEX:     'BSE_INDEX|SENSEX',
  BANKEX:     'BSE_INDEX|BANKEX',
  RELIANCE:   'NSE_EQ|INE002A01018',
  INFY:       'NSE_EQ|INE009A01021',
  TCS:        'NSE_EQ|INE467B01029',
  HDFCBANK:   'NSE_EQ|INE040A01034',
  ICICIBANK:  'NSE_EQ|INE090A01021',
  AXISBANK:   'NSE_EQ|INE238A01034',
  ADANIENT:   'NSE_EQ|INE423A01024',
};

const KEY_TO_SYMBOL = Object.fromEntries(
  Object.entries(INSTRUMENT_KEYS).map(([sym, key]) => [key, sym])
);

const TIMEFRAMES = [1, 3, 5, 15];

// ── Disk storage: Data/{SYMBOL}/{expiry}/{date}/_chart_upstox.json ───────────
// Matches the existing convention (_chart_spot.json, _chart_strategy40.json)
const DATA_ROOT = PATHS.MARKET;

function chartUpstoxFile(symbol, expiry, date) {
  return path.join(DATA_ROOT, symbol, expiry, date, '_chart_upstox.json');
}

// Cache: symbol+date → expiry (avoid repeated dir scans)
const _expiryCache = {};

// Find which expiry folder contains a given trade date for a symbol
function findExpiry(symbol, date) {
  const key = `${symbol}|${date}`;
  if (_expiryCache[key]) return _expiryCache[key];
  try {
    const symDir  = path.join(DATA_ROOT, symbol);
    const expiries = fs.readdirSync(symDir).filter(e =>
      /^\d{4}-\d{2}-\d{2}$/.test(e) &&
      fs.statSync(path.join(symDir, e)).isDirectory()
    );
    for (const expiry of expiries) {
      const datePath = path.join(symDir, expiry, date);
      if (fs.existsSync(datePath) && fs.statSync(datePath).isDirectory()) {
        _expiryCache[key] = expiry;
        return expiry;
      }
    }
  } catch (_) {}
  return null;
}

// ── Save / load 1m candles to/from disk ─────────────────────────────────────
function saveCandlesToDisk(symbol, date, candles1m, expiryHint) {
  const expiry = expiryHint || findExpiry(symbol, date);
  if (!expiry) return; // date folder doesn't exist yet — skip
  try {
    fs.writeFileSync(
      chartUpstoxFile(symbol, expiry, date),
      JSON.stringify({ symbol, date, candles: candles1m }),
      'utf8'
    );
  } catch (e) {
    console.error(`[upstox] save ${symbol}/${expiry}/${date} error:`, e.message);
  }
}

function loadCandlesFromDisk(symbol, date, expiryHint) {
  const expiry = expiryHint || findExpiry(symbol, date);
  if (!expiry) return null;
  try {
    const f = chartUpstoxFile(symbol, expiry, date);
    if (!fs.existsSync(f)) return null;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(j.candles) ? j.candles : null;
  } catch (_) { return null; }
}

// Find and load the latest saved date's candles for a symbol
function loadLatestCandlesFromDisk(symbol) {
  try {
    const symDir = path.join(DATA_ROOT, symbol);
    if (!fs.existsSync(symDir)) return null;
    let latestDate = null, latestExpiry = null;
    for (const expiry of fs.readdirSync(symDir).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e))) {
      const eDir = path.join(symDir, expiry);
      if (!fs.statSync(eDir).isDirectory()) continue;
      for (const d of fs.readdirSync(eDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
        if (fs.existsSync(path.join(eDir, d, '_chart_upstox.json'))) {
          if (!latestDate || d > latestDate) { latestDate = d; latestExpiry = expiry; }
        }
      }
    }
    if (!latestDate) return null;
    return loadCandlesFromDisk(symbol, latestDate, latestExpiry);
  } catch (_) { return null; }
}

// Check if candle file already exists

// ── Aggregate 1m candles to any higher timeframe ─────────────────────────────
// Slot alignment: slot = floor(time / (tf*60)) * (tf*60)
// (Works correctly because our epoch uses IST-treated-as-UTC)
function aggregate(candles1m, tf) {
  if (tf === 1 || !candles1m?.length) return candles1m || [];
  const tfSec = tf * 60;
  const result = [];
  let cur = null;
  for (const c of candles1m) {
    const slot = Math.floor(c.time / tfSec) * tfSec;
    if (!cur || cur.time !== slot) {
      if (cur) result.push(cur);
      cur = { time: slot, open: c.open, high: c.high, low: c.low, close: c.close };
    } else {
      cur.high  = Math.max(cur.high, c.high);
      cur.low   = Math.min(cur.low,  c.low);
      cur.close = c.close;
    }
  }
  if (cur) result.push(cur);
  return result;
}

// ── Upstox timestamp → chart epoch ──────────────────────────────────────────
// "2025-01-10T09:15:00+05:30" → strip +05:30 → treat IST local time as UTC
// so lightweight-charts shows IST times on the time axis correctly.
function upstoxTsToEpoch(tsStr) {
  const clean = tsStr.replace(/[+-]\d{2}:?\d{2}$/, 'Z');
  return Math.floor(new Date(clean).getTime() / 1000);
}

// ── Fetch 1m candles from Upstox API ────────────────────────────────────────
// fromDate = null → intraday (today); otherwise historical range
async function fetchFrom1mAPI({ instrKey, fromDate, toDate, token }) {
  const encoded = encodeURIComponent(instrKey);
  let url;
  if (!fromDate) {
    url = `https://api.upstox.com/v3/historical-candle/intraday/${encoded}/minutes/1`;
  } else {
    const to = toDate || new Date().toISOString().split('T')[0];
    url = `https://api.upstox.com/v3/historical-candle/${encoded}/minutes/1/${to}/${fromDate}`;
  }
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    timeout: 10000,
  });
  return (res.data?.data?.candles || [])
    .map(c => ({ time: upstoxTsToEpoch(c[0]), open: c[1], high: c[2], low: c[3], close: c[4] }))
    .sort((a, b) => a.time - b.time);
}

// ── Backfill: scan Data folders, fetch missing dates from Upstox ─────────────
// Runs once on startup (after token is confirmed valid).
async function backfillUpstoxCandles(getToken) {
  const token = getToken();
  if (!token) return;

  console.log('[upstox] Starting historical candle backfill...');

  // Collect all trade dates per symbol from existing Data/{symbol}/{expiry}/{date}/ structure
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 29); // Upstox 1m data: past 30 days
  const cutoffStr = cutoff.toISOString().split('T')[0];

  for (const symbol of Object.keys(INSTRUMENT_KEYS)) {
    const symDir = path.join(DATA_ROOT, symbol);
    if (!fs.existsSync(symDir)) continue;

    // Collect { date, expiry } pairs from existing Data/{symbol}/{expiry}/{date}/ structure
    const datePairs = []; // [{ date, expiry }]
    try {
      const expiries = fs.readdirSync(symDir).filter(e =>
        /^\d{4}-\d{2}-\d{2}$/.test(e) &&
        fs.statSync(path.join(symDir, e)).isDirectory()
      );
      for (const expiry of expiries) {
        const expiryDir = path.join(symDir, expiry);
        fs.readdirSync(expiryDir)
          .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) &&
            fs.statSync(path.join(expiryDir, d)).isDirectory() &&
            d >= cutoffStr && d < today.toISOString().split('T')[0]
          )
          .forEach(d => datePairs.push({ date: d, expiry }));
      }
    } catch (_) {}

    if (!datePairs.length) continue;

    const missing = datePairs;
    const missingDates = [...new Set(missing.map(p => p.date))].sort();
    console.log(`[upstox] ${symbol}: backfilling ${missingDates.length} date(s): ${missingDates.join(', ')}`);

    try {
      const all1m = await fetchFrom1mAPI({
        instrKey: INSTRUMENT_KEYS[symbol],
        fromDate: missingDates[0],
        toDate:   missingDates[missingDates.length - 1],
        token,
      });

      if (!all1m.length) {
        console.log(`[upstox] ${symbol}: no candles returned`);
        continue;
      }

      // Split by date
      const byDate = {};
      for (const c of all1m) {
        const d = new Date(c.time * 1000).toISOString().split('T')[0];
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(c);
      }

      let saved = 0;
      for (const { date, expiry } of missing) {
        if (byDate[date]) {
          saveCandlesToDisk(symbol, date, byDate[date], expiry);
          saved++;
        }
      }
      console.log(`[upstox] ${symbol}: saved ${saved} date file(s)`);
    } catch (e) {
      console.error(`[upstox] ${symbol} backfill error:`, e.message);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('[upstox] Backfill complete.');
}

// ── In-memory candle store (live, today only) ────────────────────────────────
const candleStore = {};

// ── Browser WebSocket subscriptions ─────────────────────────────────────────
const subscriptions = new Map();

function broadcast(symbol, tf, type, payload) {
  for (const [ws, sub] of subscriptions) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (sub.symbol === symbol && sub.tf === tf) {
      ws.send(JSON.stringify({ type, symbol, tf, ...payload }));
    }
  }
}

// ── Candle builder (from live ticks) ────────────────────────────────────────
function getISTComponents() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return {
    h: ist.getUTCHours(), m: ist.getUTCMinutes(), s: ist.getUTCSeconds(),
    dateStr: ist.toISOString().split('T')[0],
  };
}

function getCandleTimeStr(h, m, tf) {
  const slotMin = Math.floor((h * 60 + m) / tf) * tf;
  return `${String(Math.floor(slotMin / 60)).padStart(2,'0')}:${String(slotMin % 60).padStart(2,'0')}`;
}

function isMarketHours(h, m) {
  const t = h * 60 + m;
  return t >= 9 * 60 && t <= 15 * 60 + 30;
}

function processTick(symbol, price) {
  const { h, m, dateStr } = getISTComponents();
  if (!isMarketHours(h, m)) return;

  if (!candleStore[symbol]) {
    candleStore[symbol] = {};
    TIMEFRAMES.forEach(tf => { candleStore[symbol][tf] = { candles: [], current: null }; });
  }

  let closedCandle1m = null;

  TIMEFRAMES.forEach(tf => {
    const store   = candleStore[symbol][tf];
    const timeStr = getCandleTimeStr(h, m, tf);
    const tsEpoch = Math.floor(new Date(`${dateStr}T${timeStr}:00Z`).getTime() / 1000);

    if (!store.current || store.current.time !== tsEpoch) {
      if (store.current) {
        store.candles.push({ ...store.current });
        if (store.candles.length > 400) store.candles.shift();
        broadcast(symbol, tf, 'candle_close', { candle: store.current });
        if (tf === 1) closedCandle1m = store.current; // capture for disk flush
      }
      store.current = { time: tsEpoch, open: price, high: price, low: price, close: price };
    } else {
      store.current.high  = Math.max(store.current.high, price);
      store.current.low   = Math.min(store.current.low,  price);
      store.current.close = price;
    }

    broadcast(symbol, tf, 'candle', { candle: { ...store.current } });
  });

  // Persist to disk whenever a 1m candle closes (keeps daily file up-to-date)
  if (closedCandle1m) {
    const candles1m = [
      ...candleStore[symbol][1].candles,
      ...(candleStore[symbol][1].current ? [candleStore[symbol][1].current] : []),
    ];
    saveCandlesToDisk(symbol, dateStr, candles1m);
  }
}

function getCandles(symbol, tf) {
  const store = candleStore[symbol]?.[tf];
  if (!store) return [];
  const result = [...store.candles];
  if (store.current) result.push({ ...store.current });
  return result;
}

// ── Load today's candles from disk into RAM on startup ───────────────────────
function loadTodayFromDisk() {
  const ist     = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
  const dateStr = ist.toISOString().split('T')[0];

  for (const symbol of Object.keys(INSTRUMENT_KEYS)) {
    const candles1m = loadCandlesFromDisk(symbol, dateStr); // findExpiry called inside
    if (!candles1m?.length) continue;

    if (!candleStore[symbol]) {
      candleStore[symbol] = {};
      TIMEFRAMES.forEach(tf => { candleStore[symbol][tf] = { candles: [], current: null }; });
    }

    // Populate candle store from disk (last candle goes to current, rest to candles[])
    TIMEFRAMES.forEach(tf => {
      const aggregated = aggregate(candles1m, tf);
      if (!aggregated.length) return;
      candleStore[symbol][tf].candles = aggregated.slice(0, -1);
      candleStore[symbol][tf].current = { ...aggregated[aggregated.length - 1] };
    });

    console.log(`[upstox] Loaded ${candles1m.length} 1m candles from disk for ${symbol} (${dateStr})`);
  }
}

// ── Protobuf schema ──────────────────────────────────────────────────────────
let FeedResponse = null;
protobuf.load(path.join(__dirname, 'MarketDataFeed.proto'))
  .then(root => {
    FeedResponse = root.lookupType('com.upstox.marketdatafeeder.rpc.proto.FeedResponse');
    console.log('✅ Upstox proto schema loaded');
  })
  .catch(e => console.error('❌ Proto load error:', e.message));

// ── Upstox WebSocket connection ──────────────────────────────────────────────
let _upstoxWs    = null;
let _getToken    = () => '';
let _reconnTimer = null;
let _reconnDelay = 5_000;   // exponential backoff: 5s → 10s → 20s … capped at 5min

function isMarketHours() {
  // IST = UTC+5:30
  const now = new Date();
  const istMin = (now.getUTCHours() * 60 + now.getUTCMinutes()) + 330;
  const istMod = istMin % (24 * 60);          // handle day rollover
  const day    = now.getUTCDay();             // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;   // weekend
  return istMod >= 9 * 60 && istMod <= 15 * 60 + 35; // 09:00–15:35 IST
}

// Direct WebSocket connection — zero API calls.
// Sends Authorization header in the HTTP Upgrade handshake (not a REST call).
// Upstox authenticates and redirects to the live feed endpoint automatically.
function connectUpstoxWs() {
  clearTimeout(_reconnTimer);
  if (_upstoxWs &&
    (_upstoxWs.readyState === WebSocket.OPEN ||
     _upstoxWs.readyState === WebSocket.CONNECTING)) return;

  const token = _getToken();
  if (!token) {
    _reconnTimer = setTimeout(connectUpstoxWs, 15_000);
    return;
  }

  const ws = new WebSocket('wss://api.upstox.com/v2/feed/market-data-feed', {
    headers: { Authorization: `Bearer ${token}`, Accept: '*/*' },
    followRedirects: true,
  });
  _upstoxWs = ws;

  ws.on('open', () => {
    _reconnDelay = 5_000; // reset backoff on successful connect
    console.log('✅ Upstox WebSocket connected — tick-by-tick LTP (0 API calls)');
    ws.send(JSON.stringify({
      guid:   'chart-' + Date.now(),
      method: 'sub',
      data:   { mode: 'ltpc', instrumentKeys: Object.values(INSTRUMENT_KEYS) },
    }));
  });

  ws.on('message', (data, isBinary) => {
    if (!FeedResponse) return;
    try {
      const msg   = FeedResponse.decode(new Uint8Array(isBinary ? data : Buffer.from(data)));
      const feeds = msg.feeds || {};
      for (const [instrKey, feed] of Object.entries(feeds)) {
        const ltp = feed?.ltpc?.ltp;
        if (!ltp || ltp <= 0) continue;
        const sym = KEY_TO_SYMBOL[instrKey];
        if (sym) processTick(sym, ltp);
      }
    } catch (_) {}
  });

  ws.on('close', code => {
    _upstoxWs = null;
    const authFail = code === 4001 || code === 4003 || code === 401;

    if (authFail) {
      console.log(`⚠️  Upstox WS auth failed (${code}) — retry in 10 min`);
      _reconnDelay = 10 * 60_000;
      _reconnTimer = setTimeout(connectUpstoxWs, _reconnDelay);
      return;
    }

    if (!isMarketHours()) {
      // Outside market hours — wait quietly, check every 5 min
      _reconnDelay = 5 * 60_000;
      _reconnTimer = setTimeout(connectUpstoxWs, _reconnDelay);
      return;
    }

    // During market hours — exponential backoff with cap at 5 min
    console.log(`⚠️  Upstox WS closed (${code}) — reconnecting in ${Math.round(_reconnDelay / 1000)}s`);
    _reconnTimer = setTimeout(connectUpstoxWs, _reconnDelay);
    _reconnDelay = Math.min(_reconnDelay * 2, 5 * 60_000);
  });

  ws.on('error', err => {
    // Suppress noisy logs for auth errors (token expired)
    if (!err.message?.includes('401') && !err.message?.includes('410')) {
      console.error('Upstox WS error:', err.message);
    }
    try { ws.terminate(); } catch (_) {}
    _upstoxWs = null;
  });
}

// ── Module export ────────────────────────────────────────────────────────────
module.exports = function(app, httpServer, CONFIG) {
  _getToken = () => CONFIG.ACCESS_TOKEN;

  // Load today's persisted candles into RAM before starting WS
  loadTodayFromDisk();

  // Start Upstox WebSocket (REST fallback auto-starts on failure)
  connectUpstoxWs();

  // Backfill historical candles from Upstox API after startup settles
  setTimeout(() => backfillUpstoxCandles(_getToken), 20_000);

  // ── Our WebSocket server for browser clients ─────────────────────────────
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws/chart' });
  wss.on('connection', ws => {
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'subscribe') {
          const symbol  = (msg.symbol || '').toUpperCase();
          const tf      = parseInt(msg.tf) || 5;
          subscriptions.set(ws, { symbol, tf });
          ws.send(JSON.stringify({ type: 'init', symbol, tf, candles: getCandles(symbol, tf) }));
        }
      } catch (_) {}
    });
    ws.on('close', () => subscriptions.delete(ws));
    ws.on('error', () => subscriptions.delete(ws));
  });

  // ── REST: historical + intraday OHLC ────────────────────────────────────
  // GET /api/chart/historical/:symbol?tf=5                     → today intraday
  // GET /api/chart/historical/:symbol?tf=5&from=DATE&to=DATE   → date range
  // Aliases: folder names from Data/ may differ from INSTRUMENT_KEYS keys
  const SYMBOL_ALIASES = {
    NIFTY_BANK:       'BANKNIFTY',
    NIFTY_MID_SELECT: 'MIDCPNIFTY',
    NIFTY50:          'NIFTY',
    BANKNIFTY50:      'BANKNIFTY',
  };

  app.get('/api/chart/historical/:symbol', async (req, res) => {
    const raw     = req.params.symbol.toUpperCase();
    const symbol  = SYMBOL_ALIASES[raw] || raw;
    const tf      = parseInt(req.query.tf) || 5;
    const from    = req.query.from || null;
    const to      = req.query.to   || null;
    const instrKey = INSTRUMENT_KEYS[symbol];
    if (!instrKey) return res.status(400).json({ error: 'Unknown symbol', candles: [] });

    const token = _getToken();

    // ── Single date or today ─────────────────────────────────────────────
    if (!from || from === to) {
      const date  = from || null;
      const today = new Date();
      const ist   = new Date(today.getTime() + 5.5 * 60 * 60 * 1000);
      const todayStr = ist.toISOString().split('T')[0];
      const isToday  = !date || date === todayStr;

      if (isToday) {
        // 1. RAM store (live WebSocket ticks)
        const ramCandles = getCandles(symbol, 1);
        if (ramCandles.length) {
          return res.json({ symbol, tf, candles: aggregate(ramCandles, tf) });
        }
        // 2. Today's disk file
        const diskCandles = loadCandlesFromDisk(symbol, todayStr);
        if (diskCandles?.length) {
          return res.json({ symbol, tf, candles: aggregate(diskCandles, tf) });
        }
        // 3. Upstox intraday API
        if (token) {
          try {
            const c1m = await fetchFrom1mAPI({ instrKey, fromDate: null, toDate: null, token });
            if (c1m.length) {
              saveCandlesToDisk(symbol, todayStr, c1m);
              return res.json({ symbol, tf, candles: aggregate(c1m, tf) });
            }
          } catch (_) {}
        }
        // 4. Fall back to latest saved date from disk (e.g. yesterday)
        const latestCandles = loadLatestCandlesFromDisk(symbol);
        if (latestCandles?.length) {
          return res.json({ symbol, tf, candles: aggregate(latestCandles, tf), fromLatest: true });
        }
        return res.json({ symbol, tf, candles: [] });
      }

      // Specific past date
      const disk = loadCandlesFromDisk(symbol, date);
      if (disk?.length) {
        return res.json({ symbol, tf, candles: aggregate(disk, tf) });
      }

      // Not on disk — try Upstox historical API (only available for past ~30 days)
      if (!token) return res.json({ symbol, tf, candles: [] });
      try {
        const c1m = await fetchFrom1mAPI({ instrKey, fromDate: date, toDate: date, token });
        if (c1m.length) saveCandlesToDisk(symbol, date, c1m);
        return res.json({ symbol, tf, candles: aggregate(c1m, tf) });
      } catch (e) {
        return res.json({ symbol, tf, candles: [] });
      }
    }

    // ── Date range ───────────────────────────────────────────────────────────
    // Collect dates in range
    const start  = new Date(from + 'T00:00:00Z');
    const end    = new Date(to   + 'T00:00:00Z');
    const allCandles = [];
    const missingDates = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dStr = d.toISOString().split('T')[0];
      const disk = loadCandlesFromDisk(symbol, dStr);
      if (disk?.length) {
        allCandles.push(...disk);
      } else {
        missingDates.push(dStr);
      }
    }

    // Fetch missing dates from Upstox in one API call
    if (missingDates.length && token) {
      try {
        const c1m = await fetchFrom1mAPI({
          instrKey, fromDate: missingDates[0], toDate: missingDates[missingDates.length - 1], token,
        });
        // Split by date, save, accumulate
        const byDate = {};
        for (const c of c1m) {
          const dStr = new Date(c.time * 1000).toISOString().split('T')[0];
          if (!byDate[dStr]) byDate[dStr] = [];
          byDate[dStr].push(c);
        }
        for (const [dStr, candles] of Object.entries(byDate)) {
          if (missingDates.includes(dStr)) saveCandlesToDisk(symbol, dStr, candles);
          allCandles.push(...candles);
        }
      } catch (_) {}
    }

    allCandles.sort((a, b) => a.time - b.time);
    return res.json({ symbol, tf, candles: aggregate(allCandles, tf) });
  });

  // ── REST: live RAM candle store (current day tick candles) ───────────────
  app.get('/api/chart/ws-candles/:symbol', (req, res) => {
    const symbol  = req.params.symbol.toUpperCase();
    const tf      = parseInt(req.query.tf) || 5;
    res.json({ symbol, tf, candles: getCandles(symbol, tf) });
  });
};

module.exports.getCandles  = getCandles;
module.exports.processTick = processTick;
