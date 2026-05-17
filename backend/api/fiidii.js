'use strict';
const express = require('express');
const axios   = require('axios');
const router  = express.Router();
const { FIIDII } = require('../db/models/FIIDII');

const UPSTOX_BASE = 'https://api.upstox.com/v2';

// Convert epoch ms → 'YYYY-MM-DD' (IST)
function tsToDate(ms) {
  const d = new Date(Number(ms) + 5.5 * 3600 * 1000);
  return d.toISOString().split('T')[0];
}

// Convert raw INR → Crore (rounded to 2dp)
function toCr(val) {
  if (!val) return 0;
  const n = Number(val);
  // If already looks like Crores (< 1,000,000) keep as-is; else divide by 1e7
  return n > 1_000_000 ? Math.round((n / 1e7) * 100) / 100 : Math.round(n * 100) / 100;
}

// Fetch 30 days of FII cash market data from Upstox
async function fetchFII(token, from) {
  const params = {
    data_type: 'NSE_EQ|CASH',
    interval:  '1D',
  };
  if (from) params.from = from;

  const resp = await axios.get(`${UPSTOX_BASE}/market/fii`, {
    params,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return resp.data?.data?.['NSE_EQ|CASH'] || resp.data?.data?.['NSE_EQ_CASH'] || [];
}

// Fetch 30 days of DII cash market data from Upstox
async function fetchDII(token, from) {
  const params = {
    data_type: 'NSE_EQ|CASH',
    interval:  '1D',
  };
  if (from) params.from = from;

  const resp = await axios.get(`${UPSTOX_BASE}/market/dii`, {
    params,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return resp.data?.data?.['NSE_EQ|CASH'] || resp.data?.data?.['NSE_EQ_CASH'] || [];
}

// Fetch both FII + DII, merge by date, upsert into socuptick DB
async function fetchAndSave(token) {
  // 30 trading days back from today
  const from = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString().split('T')[0];

  const [fiiRows, diiRows] = await Promise.all([
    fetchFII(token, from),
    fetchDII(token, from),
  ]);

  if (!fiiRows.length && !diiRows.length) throw new Error('Empty FII/DII response from Upstox');

  // Build date-keyed map from FII
  const byDate = {};
  for (const r of fiiRows) {
    const date = tsToDate(r.time_stamp);
    if (!byDate[date]) byDate[date] = { date };
    byDate[date].fii_buy  = toCr(r.buy_amount);
    byDate[date].fii_sell = toCr(r.sell_amount);
    byDate[date].fii_net  = Math.round((toCr(r.buy_amount) - toCr(r.sell_amount)) * 100) / 100;
  }

  // Merge DII
  for (const r of diiRows) {
    const date = tsToDate(r.time_stamp);
    if (!byDate[date]) byDate[date] = { date };
    byDate[date].dii_buy  = toCr(r.buy_amount);
    byDate[date].dii_sell = toCr(r.sell_amount);
    byDate[date].dii_net  = Math.round((toCr(r.buy_amount) - toCr(r.sell_amount)) * 100) / 100;
  }

  const records = Object.values(byDate).filter(r => r.date);
  if (!records.length) throw new Error('No records after merge');

  const ops = records.map(r => ({
    updateOne: {
      filter: { date: r.date },
      update: { $set: { ...r, fetchedAt: new Date() } },
      upsert: true,
    },
  }));

  await FIIDII.bulkWrite(ops);
  console.log(`[FII/DII] Saved ${ops.length} records to socuptick DB`);
  return ops.length;
}

// GET /api/fiidii — last 30 days from DB; auto-fetch if empty
router.get('/', async (req, res) => {
  try {
    const rows = await FIIDII.find().sort({ date: -1 }).limit(30).lean();
    if (rows.length) return res.json({ success: true, data: rows });

    // DB empty — try live fetch
    const token = req.app?.locals?.upstoxToken;
    if (!token) return res.json({ success: true, data: [] });

    await fetchAndSave(token);
    const fresh = await FIIDII.find().sort({ date: -1 }).limit(30).lean();
    res.json({ success: true, data: fresh });
  } catch (err) {
    console.error('[FII/DII] GET error:', err.message);
    res.json({ success: false, error: err.message, data: [] });
  }
});

// POST /api/fiidii/refresh — manual trigger
router.post('/refresh', async (req, res) => {
  try {
    const token = req.app?.locals?.upstoxToken;
    if (!token) return res.status(400).json({ success: false, error: 'No Upstox token available' });
    const count = await fetchAndSave(token);
    res.json({ success: true, saved: count });
  } catch (err) {
    console.error('[FII/DII] Refresh error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Daily 4 PM IST scheduler ──────────────────────────────────────────────────
let _lastFetchDate = null;

function scheduleDailyFetch(getTokenFn) {
  setInterval(() => {
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    const hh  = ist.getUTCHours();
    const mm  = ist.getUTCMinutes();
    const dd  = ist.toISOString().split('T')[0];
    const dow = ist.getUTCDay(); // 0=Sun, 6=Sat

    if (dow === 0 || dow === 6) return;   // skip weekends
    if (hh !== 16 || mm > 2) return;      // fire at 16:00–16:02 IST
    if (_lastFetchDate === dd) return;     // already ran today

    _lastFetchDate = dd;
    const token = getTokenFn();
    if (!token) return;

    console.log('[FII/DII] 4 PM IST trigger — fetching...');
    fetchAndSave(token)
      .then(n => console.log(`[FII/DII] Scheduled save: ${n} records`))
      .catch(e => console.error('[FII/DII] Scheduled fetch error:', e.message));
  }, 60_000);
}

module.exports = router;
module.exports.scheduleDailyFetch = scheduleDailyFetch;
module.exports.fetchAndSave = fetchAndSave;
