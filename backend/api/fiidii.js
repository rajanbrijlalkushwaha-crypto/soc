'use strict';
const express = require('express');
const axios   = require('axios');
const router  = express.Router();
const { FIIDII } = require('../db/models/FIIDII');

const UPSTOX_BASE = 'https://api.upstox.com/v2';

function getToken(req) {
  return req?.app?.locals?.upstoxToken || global._upstoxToken || null;
}

// Parse Upstox date string to YYYY-MM-DD
// Upstox returns dates like "15-May-2026" or "2026-05-15"
function parseDate(raw) {
  if (!raw) return null;
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // "15-May-2026"
  const m = raw.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (m) {
    const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                     Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
    return `${m[3]}-${months[m[2]] || '01'}-${m[1]}`;
  }
  return null;
}

// Fetch from Upstox and upsert into DB
async function fetchAndSave(token) {
  const resp = await axios.get(`${UPSTOX_BASE}/market/fii-dii`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });

  const rows = resp.data?.data;
  if (!Array.isArray(rows) || !rows.length) throw new Error('Empty FII/DII response');

  const ops = rows.map(r => {
    const date = parseDate(r.date);
    if (!date) return null;
    return {
      updateOne: {
        filter: { date },
        update: {
          $set: {
            date,
            fii_buy:   r.fii_buy_value  ?? r.fiiBuyValue  ?? 0,
            fii_sell:  r.fii_sell_value ?? r.fiiSellValue ?? 0,
            fii_net:   r.fii_net_value  ?? r.fiiNetValue  ?? 0,
            dii_buy:   r.dii_buy_value  ?? r.diiBuyValue  ?? 0,
            dii_sell:  r.dii_sell_value ?? r.diiSellValue ?? 0,
            dii_net:   r.dii_net_value  ?? r.diiNetValue  ?? 0,
            fetchedAt: new Date(),
          },
        },
        upsert: true,
      },
    };
  }).filter(Boolean);

  if (ops.length) await FIIDII.bulkWrite(ops);
  console.log(`[FII/DII] Saved ${ops.length} records`);
  return ops.length;
}

// GET /api/fiidii — last 30 days from DB, fallback to Upstox live if DB empty
router.get('/', async (req, res) => {
  try {
    const rows = await FIIDII.find().sort({ date: -1 }).limit(30).lean();
    if (rows.length) return res.json({ success: true, data: rows });

    // DB empty — fetch live
    const token = getToken(req);
    if (!token) return res.json({ success: true, data: [] });
    await fetchAndSave(token);
    const fresh = await FIIDII.find().sort({ date: -1 }).limit(30).lean();
    res.json({ success: true, data: fresh });
  } catch (err) {
    res.json({ success: false, error: err.message, data: [] });
  }
});

// POST /api/fiidii/refresh — manual trigger (admin)
router.post('/refresh', async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) return res.status(400).json({ success: false, error: 'No token' });
    const count = await fetchAndSave(token);
    res.json({ success: true, saved: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Daily 4 PM IST scheduler ─────────────────────────────────────────────────
let _lastFetchDate = null;

function scheduleDailyFetch(getTokenFn) {
  setInterval(() => {
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    const hh  = ist.getUTCHours();
    const mm  = ist.getUTCMinutes();
    const dd  = ist.toISOString().split('T')[0];

    // Fire once daily at 16:00–16:01 IST on weekdays
    const dow = ist.getUTCDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) return;
    if (hh !== 16 || mm !== 0) return;
    if (_lastFetchDate === dd) return;

    _lastFetchDate = dd;
    const token = getTokenFn();
    if (!token) return;

    console.log('[FII/DII] 4 PM IST — fetching latest data...');
    fetchAndSave(token)
      .then(n => console.log(`[FII/DII] Scheduled fetch saved ${n} records`))
      .catch(e => console.error('[FII/DII] Scheduled fetch error:', e.message));
  }, 60_000); // check every minute
}

module.exports = router;
module.exports.scheduleDailyFetch = scheduleDailyFetch;
module.exports.fetchAndSave = fetchAndSave;
