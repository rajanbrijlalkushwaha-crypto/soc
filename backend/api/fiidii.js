'use strict';
const express = require('express');
const axios   = require('axios');
const router  = express.Router();
const { FIIDII } = require('../db/models/FIIDII');

const UPSTOX_BASE = 'https://api.upstox.com/v2';

// Token getter injected from server.js via init()
let _getToken = () => null;

function init(getTokenFn) {
  _getToken = getTokenFn;
}

// epoch ms → 'YYYY-MM-DD' IST
function tsToDate(ms) {
  const d = new Date(Number(ms) + 5.5 * 3600 * 1000);
  return d.toISOString().split('T')[0];
}

// Raw INR → Crore (if value > 1,000,000 it's raw INR, else already in Cr)
function toCr(val) {
  if (!val) return 0;
  const n = Number(val);
  return n > 1_000_000
    ? Math.round((n / 1e7) * 100) / 100
    : Math.round(n * 100) / 100;
}

// Single Upstox FII fetch for a given from-date (max 30 trading days)
async function fetchFIIPage(token, from) {
  const resp = await axios.get(`${UPSTOX_BASE}/market/fii`, {
    params: { data_type: 'NSE_EQ|CASH', interval: '1D', from },
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    timeout: 15000,
  });
  const data = resp.data?.data || {};
  // Upstox may return the key with or without URL-encoding the pipe
  return data['NSE_EQ|CASH'] || data['NSE_EQ%7CCASH'] || Object.values(data)[0] || [];
}

// Single Upstox DII fetch for a given from-date
async function fetchDIIPage(token, from) {
  const resp = await axios.get(`${UPSTOX_BASE}/market/dii`, {
    params: { data_type: 'NSE_EQ|CASH', interval: '1D', from },
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    timeout: 15000,
  });
  const data = resp.data?.data || {};
  return data['NSE_EQ|CASH'] || data['NSE_EQ%7CCASH'] || Object.values(data)[0] || [];
}

// Step back one trading day (skip Sat/Sun)
function prevTradingDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().split('T')[0];
}

// Merge FII + DII arrays (both keyed by time_stamp) into DB upsert ops
function buildOps(fiiRows, diiRows) {
  const byDate = {};

  for (const r of fiiRows) {
    const date = tsToDate(r.time_stamp);
    if (!byDate[date]) byDate[date] = { date };
    byDate[date].fii_buy  = toCr(r.buy_amount);
    byDate[date].fii_sell = toCr(r.sell_amount);
    byDate[date].fii_net  = Math.round((toCr(r.buy_amount) - toCr(r.sell_amount)) * 100) / 100;
  }

  for (const r of diiRows) {
    const date = tsToDate(r.time_stamp);
    if (!byDate[date]) byDate[date] = { date };
    byDate[date].dii_buy  = toCr(r.buy_amount);
    byDate[date].dii_sell = toCr(r.sell_amount);
    byDate[date].dii_net  = Math.round((toCr(r.buy_amount) - toCr(r.sell_amount)) * 100) / 100;
  }

  return Object.values(byDate)
    .filter(r => r.date)
    .map(r => ({
      updateOne: {
        filter: { date: r.date },
        update: { $set: { ...r, fetchedAt: new Date() } },
        upsert: true,
      },
    }));
}

// Fetch latest 30 trading days (API 'from' = end-date, returns rows going backward)
async function fetchAndSave(token) {
  const today = new Date().toISOString().split('T')[0];
  const [fiiRows, diiRows] = await Promise.all([
    fetchFIIPage(token, today),
    fetchDIIPage(token, today),
  ]);
  if (!fiiRows.length && !diiRows.length) throw new Error('Empty response — check token');
  const ops = buildOps(fiiRows, diiRows);
  if (ops.length) await FIIDII.bulkWrite(ops);
  console.log(`[FII/DII] Saved ${ops.length} records`);
  return ops.length;
}

// Download ALL data back to startDate — paginate backward (API returns ≤30 rows per 'from'/end-date)
async function downloadAll(token, startDate) {
  let endDate    = new Date().toISOString().split('T')[0];
  let totalSaved = 0;
  let page       = 0;
  const MAX_PAGES = 20;

  while (page < MAX_PAGES) {
    console.log(`[FII/DII] Fetching page ${page + 1} ending at ${endDate}...`);
    const [fiiRows, diiRows] = await Promise.all([
      fetchFIIPage(token, endDate).catch(() => []),
      fetchDIIPage(token, endDate).catch(() => []),
    ]);

    if (!fiiRows.length && !diiRows.length) break;

    const ops = buildOps(fiiRows, diiRows);
    if (ops.length) {
      await FIIDII.bulkWrite(ops);
      totalSaved += ops.length;
    }

    // Earliest date in this page — go back one trading day for next page
    const allDates    = [...fiiRows, ...diiRows].map(r => tsToDate(r.time_stamp)).sort();
    const earliestDate = allDates[0];
    if (!earliestDate || earliestDate <= startDate) break;

    endDate = prevTradingDay(earliestDate);
    page++;
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[FII/DII] Download complete — ${totalSaved} total records saved`);
  return totalSaved;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/fiidii — return all saved records (up to 100, sorted newest first)
router.get('/', async (req, res) => {
  try {
    const rows = await FIIDII.find().sort({ date: -1 }).limit(100).lean();
    if (rows.length) return res.json({ success: true, data: rows });

    // DB empty — auto-fetch
    const token = _getToken();
    if (!token) return res.json({ success: true, data: [], message: 'No token — restart backend' });
    await fetchAndSave(token);
    const fresh = await FIIDII.find().sort({ date: -1 }).limit(100).lean();
    res.json({ success: true, data: fresh });
  } catch (err) {
    console.error('[FII/DII] GET error:', err.message);
    res.json({ success: false, error: err.message, data: [] });
  }
});

// POST /api/fiidii/refresh — fetch last 30 days
router.post('/refresh', async (req, res) => {
  try {
    const token = _getToken();
    if (!token) return res.status(400).json({ success: false, error: 'No Upstox token' });
    const count = await fetchAndSave(token);
    res.json({ success: true, saved: count });
  } catch (err) {
    console.error('[FII/DII] Refresh error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/fiidii/download-all — bulk download from April 1 2026
router.post('/download-all', async (req, res) => {
  try {
    const token = _getToken();
    if (!token) return res.status(400).json({ success: false, error: 'No Upstox token' });
    const startDate = req.body?.from || '2026-04-01';
    // Fire in background — respond immediately
    res.json({ success: true, message: `Downloading all data from ${startDate}...` });
    downloadAll(token, startDate)
      .then(n => console.log(`[FII/DII] download-all done: ${n} records`))
      .catch(e => console.error('[FII/DII] download-all error:', e.message));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Daily scheduler: 4:00 PM + 4:30 PM IST (Mon–Fri) ────────────────────────
// Upstox publishes FII/DII data after market close (3:30 PM IST).
// We fetch at 4:00 PM and again at 4:30 PM to catch any delayed publication.
const _fetched = new Set(); // tracks "YYYY-MM-DD_HH:MM" to avoid double-fire

function scheduleDailyFetch() {
  setInterval(() => {
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    const hh  = ist.getUTCHours();
    const mm  = ist.getUTCMinutes();
    const dd  = ist.toISOString().split('T')[0];
    const dow = ist.getUTCDay();

    if (dow === 0 || dow === 6) return; // skip weekends

    // Fire at 16:00–16:02 and 16:30–16:32 IST
    const is4pm   = hh === 16 && mm <= 2;
    const is430pm = hh === 16 && mm >= 30 && mm <= 32;
    if (!is4pm && !is430pm) return;

    const slot = `${dd}_${is4pm ? '16:00' : '16:30'}`;
    if (_fetched.has(slot)) return;
    _fetched.add(slot);

    const token = _getToken();
    if (!token) return;

    const label = is4pm ? '4:00 PM' : '4:30 PM';
    console.log(`[FII/DII] ${label} IST — auto-fetching...`);
    fetchAndSave(token)
      .then(n => console.log(`[FII/DII] Saved ${n} records`))
      .catch(e => console.error('[FII/DII] Schedule error:', e.message));
  }, 60_000);
}

module.exports = router;
module.exports.init = init;
module.exports.scheduleDailyFetch = scheduleDailyFetch;
