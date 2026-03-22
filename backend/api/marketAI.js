// API/marketAI.js
// ═══════════════════════════════════════════════════════
// MARKET AI — Reads today's option chain data (shifting,
// strategy40, OI charts) and sends to Claude for analysis
// ═══════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const https = require('https');
const { PATHS } = require('../config/paths');

const DATA_ROOT    = PATHS.MARKET;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

// ── helpers ──────────────────────────────────────────────────────────
function getFolders(p) {
  try { return fs.readdirSync(p).filter(x => fs.statSync(path.join(p,x)).isDirectory()); }
  catch(e) { return []; }
}
function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return null; }
}

// ── Build a rich data summary for ONE symbol/date ────────────────────
function buildSymbolSummary(symbol, date) {
  const safeSymbol = symbol.toUpperCase().replace(/\s+/g, '_');
  const symbolPath = path.join(DATA_ROOT, safeSymbol);
  const expiries   = getFolders(symbolPath).sort();
  if (!expiries.length) return null;

  // Use nearest future expiry or latest
  const today    = date || new Date().toISOString().split('T')[0];
  const expiry   = expiries.find(e => e >= today) || expiries[expiries.length - 1];
  const datePath = path.join(symbolPath, expiry, today);
  if (!fs.existsSync(datePath)) return null;

  const shifting   = readJSON(path.join(datePath, '_shifting.json'));
  const strategy40 = readJSON(path.join(datePath, '_chart_strategy40.json'));
  const oiChart    = readJSON(path.join(datePath, '_chart_oi.json'));

  if (!shifting && !strategy40) return null;

  // ── Summarise shifting ───────────────────────────────────────────
  const timeline = shifting?.timeline || [];
  const firstSnap = timeline[0]   || {};
  const lastSnap  = timeline[timeline.length - 1] || {};

  const resShifts = shifting?.shifts?.resistance || [];
  const supShifts = shifting?.shifts?.support    || [];

  // Spot movement
  const spotOpen  = firstSnap.spot || 0;
  const spotNow   = lastSnap.spot  || 0;
  const spotChg   = spotNow - spotOpen;
  const spotChgPct = spotOpen > 0 ? ((spotChg / spotOpen) * 100).toFixed(2) : 0;

  // Current levels
  const curRes = lastSnap.resistance?.strike || strategy40?.resistance_reversal || null;
  const curSup = lastSnap.support?.strike    || strategy40?.support_reversal    || null;

  // OI summary from oiChart — pick ATM strikes
  let oiSummary = '';
  if (oiChart?.strikes) {
    const strikes = Object.keys(oiChart.strikes).map(Number).sort((a,b)=>a-b);
    const atmIdx  = strikes.reduce((bi, s, i) =>
      Math.abs(s - spotNow) < Math.abs(strikes[bi] - spotNow) ? i : bi, 0);
    const window  = strikes.slice(Math.max(0, atmIdx-3), atmIdx+4);
    oiSummary = window.map(stk => {
      const d = oiChart.strikes[stk];
      const lastCall = d?.call?.[d.call.length-1] || {};
      const lastPut  = d?.put?.[d.put.length-1]   || {};
      return `${stk}: CE vol=${lastCall.vol_pct}% OI=${lastCall.oi_pct}% | PE vol=${lastPut.vol_pct}% OI=${lastPut.oi_pct}%`;
    }).join('\n  ');
  }

  return {
    symbol,
    expiry,
    date: today,
    spot: { open: spotOpen, current: spotNow, change: spotChg, changePct: spotChgPct },
    resistance: { current: curRes, original: strategy40?.resistance || null, shifts: resShifts },
    support:    { current: curSup, original: strategy40?.support    || null, shifts: supShifts },
    snapshotCount: timeline.length,
    firstTime: firstSnap.time,
    lastTime:  lastSnap.time,
    oiWindow: oiSummary,
  };
}

// ── Build full market context string ─────────────────────────────────
function buildMarketContext(symbols, date) {
  const today = date || new Date().toISOString().split('T')[0];
  const summaries = [];

  for (const sym of symbols) {
    const s = buildSymbolSummary(sym, today);
    if (s) summaries.push(s);
  }

  if (!summaries.length) return null;

  let ctx = `DATE: ${today}\nSNAPSHOTS ANALYSED: ${summaries[0]?.snapshotCount || 0} (${summaries[0]?.firstTime} → ${summaries[0]?.lastTime})\n\n`;

  for (const s of summaries) {
    ctx += `══ ${s.symbol} (Expiry: ${s.expiry}) ══\n`;
    ctx += `Spot: ${s.spot.open} → ${s.spot.current} (${s.spot.changePct > 0 ? '+' : ''}${s.spot.changePct}%)\n`;
    ctx += `Resistance: ${s.resistance.current || '--'} (original: ${s.resistance.original || '--'})\n`;
    ctx += `Support:    ${s.support.current    || '--'} (original: ${s.support.original    || '--'})\n`;

    if (s.resistance.shifts.length) {
      ctx += `Resistance shifts: ${s.resistance.shifts.map(sh => `${sh.type} ${sh.from}→${sh.to} @${sh.time}`).join(', ')}\n`;
    } else {
      ctx += `Resistance: No shifting (stable all day)\n`;
    }

    if (s.support.shifts.length) {
      ctx += `Support shifts: ${s.support.shifts.map(sh => `${sh.type} ${sh.from}→${sh.to} @${sh.time}`).join(', ')}\n`;
    } else {
      ctx += `Support: No shifting (stable all day)\n`;
    }

    if (s.oiWindow) {
      ctx += `OI % near ATM:\n  ${s.oiWindow}\n`;
    }
    ctx += '\n';
  }

  return ctx;
}

// ── Call Claude API ───────────────────────────────────────────────────
function callClaude(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const text = parsed.content?.[0]?.text || '';
          resolve(text);
        } catch(e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Express routes ────────────────────────────────────────────────────
module.exports = function(app) {

  // POST /api/market-ai/chat
  // Body: { message: string, date?: string, symbols?: string[] }
  app.post('/api/market-ai/chat', async (req, res) => {
    try {
      if (!ANTHROPIC_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
      }

      const { message, date, symbols: reqSymbols } = req.body;
      if (!message) return res.status(400).json({ error: 'message required' });

      const today = date || new Date().toISOString().split('T')[0];

      // Auto-detect symbols from Data folder if not specified
      let symbols = reqSymbols;
      if (!symbols || !symbols.length) {
        symbols = getFolders(DATA_ROOT).filter(s => s !== 'Power AI Stock');
      }

      const marketContext = buildMarketContext(symbols, today);

      const systemPrompt = `You are SOC.AI — an expert Indian stock market analyst specialising in options and index trading using the Broms 4.0 strategy.

You have access to LIVE option chain data collected every 5 minutes since market open (9:15 AM IST).

Your analysis is based on:
- OI (Open Interest) percentage distributions
- Volume percentages  
- OI Change patterns
- Resistance/Support levels detected from max OI strikes
- Shifting patterns: SFBTT (Shifted From Bottom To Top = bullish support) and SFTB (Shifted From Top To Bottom = bearish resistance breakdown)
- Strategy 4.0 Broms levels (resistance reversal, support reversal)

Rules:
- Be concise and direct — traders need quick answers
- Always mention specific strike levels
- Say if data is insufficient
- Use ✅ for bullish signals, ⚠️ for caution, ❌ for bearish
- Format responses cleanly with line breaks
- End with a 1-line actionable summary

${marketContext ? `CURRENT MARKET DATA:\n${marketContext}` : 'No market data available for today yet.'}`;

      const reply = await callClaude(systemPrompt, message);
      res.json({ reply, date: today, symbols });

    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/market-ai/summary/:date?
  // Quick auto-analysis without user message
  app.get('/api/market-ai/summary/:date?', async (req, res) => {
    try {
      if (!ANTHROPIC_KEY) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in .env' });
      }

      const today = req.params.date || new Date().toISOString().split('T')[0];
      const symbols = getFolders(DATA_ROOT).filter(s => s !== 'Power AI Stock');
      const marketContext = buildMarketContext(symbols, today);

      if (!marketContext) {
        return res.json({ reply: 'No data available for today yet. Market data will appear once the server starts collecting.', date: today });
      }

      const systemPrompt = `You are SOC.AI — expert Indian options market analyst using Broms 4.0 strategy. Be concise, use bullet points, mention specific strikes. Use ✅ bullish, ⚠️ neutral, ❌ bearish signals.`;

      const userMessage = `Analyse today's option chain data and tell me:\n1. Where is the market headed?\n2. Key resistance and support levels\n3. Any significant shifts since morning\n4. Trade suggestion\n\nDATA:\n${marketContext}`;

      const reply = await callClaude(systemPrompt, userMessage);
      res.json({ reply, date: today });

    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

};