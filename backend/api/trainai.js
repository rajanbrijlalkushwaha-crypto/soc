// API/trainai.js — Option Chain AI Pattern Analysis Engine
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PATHS } = require('../config/paths');

// ── File helpers ──────────────────────────────────────────────────────────────
function folders(p) {
  try { return fs.readdirSync(p).filter(x => fs.statSync(path.join(p,x)).isDirectory()); }
  catch(e) { return []; }
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch(e) { return null; }
}

function getDataFiles(p) {
  try {
    return fs.readdirSync(p)
      .filter(x => (x.endsWith('.json') || x.endsWith('.json.gz')) && !x.startsWith('_'))
      .sort();
  } catch(e) { return []; }
}

function decompressChain(oc) {
  if (!Array.isArray(oc)) return [];
  return oc.map(strike => ({
    strike_price: strike.s,
    underlying_spot_price: strike.u || 0,
    call_options: {
      market_data: {
        oi: strike.c?.oi || 0,
        prev_oi: (strike.c?.oi || 0) - (strike.c?.oc || 0),
        volume: strike.c?.v || 0,
        ltp: strike.c?.lp || 0,
      },
      option_greeks: { iv: strike.c?.iv || 0, delta: strike.c?.de || 0 }
    },
    put_options: {
      market_data: {
        oi: strike.p?.oi || 0,
        prev_oi: (strike.p?.oi || 0) - (strike.p?.oc || 0),
        volume: strike.p?.v || 0,
        ltp: strike.p?.lp || 0,
      },
      option_greeks: { iv: strike.p?.iv || 0, delta: strike.p?.de || 0 }
    }
  }));
}

function readSnapshotFile(filePath) {
  try {
    if (filePath.endsWith('.gz')) {
      const buf  = fs.readFileSync(filePath);
      const j    = JSON.parse(zlib.gunzipSync(buf).toString());
      return {
        metadata: { time_hhmmss: j.m?.time_hhmmss, lot_size: j.m?.lot_size || 1 },
        option_chain: decompressChain(j.oc || [])
      };
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch(e) { return null; }
}

// ── Time helpers ─────────────────────────────────────────────────────────────
function toMin(t) {
  if (!t) return 0;
  const [h, m] = t.substring(0,5).split(':').map(Number);
  return h * 60 + m;
}

// ── Compute indicators from a single snapshot ─────────────────────────────────
function computeIndicators(chain, spot) {
  if (!chain?.length || spot <= 0) return null;
  const sorted = [...chain].sort((a,b) => a.strike_price - b.strike_price);

  // Find ATM index
  let atmIdx = 0, minDiff = Infinity;
  sorted.forEach((r, i) => {
    const d = Math.abs(r.strike_price - spot);
    if (d < minDiff) { minDiff = d; atmIdx = i; }
  });

  const atm       = sorted[atmIdx];
  const strikeGap = sorted.length > 1 ? Math.abs(sorted[1].strike_price - sorted[0].strike_price) : 50;

  // PCR + Volume ratio
  let totalCallOI = 0, totalPutOI = 0, totalCallVol = 0, totalPutVol = 0;
  let maxCallOI = 0, maxCallStrike = atm.strike_price;
  let maxPutOI  = 0, maxPutStrike  = atm.strike_price;

  sorted.forEach(r => {
    const coi = r.call_options?.market_data?.oi || 0;
    const poi = r.put_options?.market_data?.oi  || 0;
    totalCallOI  += coi;
    totalPutOI   += poi;
    totalCallVol += r.call_options?.market_data?.volume || 0;
    totalPutVol  += r.put_options?.market_data?.volume  || 0;
    if (coi > maxCallOI) { maxCallOI = coi; maxCallStrike = r.strike_price; }
    if (poi > maxPutOI)  { maxPutOI  = poi; maxPutStrike  = r.strike_price; }
  });

  const pcr      = totalCallOI  > 0 ? totalPutOI  / totalCallOI  : 0;
  const vcratio  = totalCallVol > 0 ? totalPutVol / totalCallVol : 0;

  // ATM OI changes
  const atmCallOI    = atm.call_options?.market_data?.oi      || 0;
  const atmPutOI     = atm.put_options?.market_data?.oi       || 0;
  const atmCallPrevOI= atm.call_options?.market_data?.prev_oi || 0;
  const atmPutPrevOI = atm.put_options?.market_data?.prev_oi  || 0;
  const atmCallOIChg = atmCallOI - atmCallPrevOI;
  const atmPutOIChg  = atmPutOI  - atmPutPrevOI;

  // IV Skew (put IV - call IV at ATM)
  const callIV = atm.call_options?.option_greeks?.iv || 0;
  const putIV  = atm.put_options?.option_greeks?.iv  || 0;
  const ivSkew = putIV - callIV;

  // OI writing above (call resistance) and below (put support) ATM
  let callWritingAbove = 0, putWritingBelow = 0;
  for (let i = atmIdx + 1; i <= Math.min(atmIdx + 3, sorted.length - 1); i++) {
    const oi  = sorted[i].call_options?.market_data?.oi      || 0;
    const poi = sorted[i].call_options?.market_data?.prev_oi || 0;
    callWritingAbove += Math.max(0, oi - poi);
  }
  for (let i = atmIdx - 1; i >= Math.max(0, atmIdx - 3); i--) {
    const oi  = sorted[i].put_options?.market_data?.oi      || 0;
    const poi = sorted[i].put_options?.market_data?.prev_oi || 0;
    putWritingBelow += Math.max(0, oi - poi);
  }

  // Spot position relative to ATM
  const spotAboveATM = spot - atm.strike_price; // + = above strike, - = below

  // Delta-based reversal levels at ATM (same formula as MCTR reversal engine)
  // Resistance reversal: between ATM (put side) and ATM+1 (call side)
  let supportReversal = null, supportStrike = null;
  let resistanceReversal = null, resistanceStrike = null;

  if (atmIdx < sorted.length - 1) {
    const above   = sorted[atmIdx + 1];
    const ceDelta = parseFloat(above.call_options?.option_greeks?.delta || 0);
    const peDelta = parseFloat(atm.put_options?.option_greeks?.delta   || 0);
    const ceLtp   = parseFloat(above.call_options?.market_data?.ltp    || 0);
    const peLtp   = parseFloat(atm.put_options?.market_data?.ltp       || 0);
    const den = ceDelta - peDelta;
    if (den !== 0) {
      resistanceReversal = Math.round(spot - (ceLtp - peLtp) / den);
      resistanceStrike   = above.strike_price;
    }
  }

  if (atmIdx > 0) {
    const below   = sorted[atmIdx - 1];
    const ceDelta = parseFloat(atm.call_options?.option_greeks?.delta  || 0);
    const peDelta = parseFloat(below.put_options?.option_greeks?.delta || 0);
    const ceLtp   = parseFloat(atm.call_options?.market_data?.ltp      || 0);
    const peLtp   = parseFloat(below.put_options?.market_data?.ltp     || 0);
    const den = ceDelta - peDelta;
    if (den !== 0) {
      supportReversal = Math.round(spot - (ceLtp - peLtp) / den);
      supportStrike   = atm.strike_price;
    }
  }

  return {
    spot, atmStrike: atm.strike_price, strikeGap,
    pcr: parseFloat(pcr.toFixed(3)),
    vcratio: parseFloat(vcratio.toFixed(3)),
    ivSkew: parseFloat(ivSkew.toFixed(2)),
    totalCallOI, totalPutOI, totalCallVol, totalPutVol,
    atmCallOI, atmPutOI, atmCallOIChg, atmPutOIChg,
    maxCallStrike, maxPutStrike, maxCallOI, maxPutOI,
    callWritingAbove, putWritingBelow, spotAboveATM,
    supportReversal, supportStrike,
    resistanceReversal, resistanceStrike,
  };
}

// ── Detect active signals at a snapshot ─────────────────────────────────────
function detectSignals(snap, prev, shiftingTimeline) {
  const ind  = snap.ind;
  const signals = [];

  // PCR level
  if (ind.pcr >= 1.3)  signals.push('PCR_HIGH');
  else if (ind.pcr <= 0.7) signals.push('PCR_LOW');

  // PCR momentum vs previous snapshot
  if (prev) {
    const dp = ind.pcr - prev.ind.pcr;
    if (dp > 0.08)  signals.push('PCR_RISING');
    else if (dp < -0.08) signals.push('PCR_FALLING');
  }

  // OI writing
  const callWriteThresh = ind.totalCallOI * 0.015;
  const putWriteThresh  = ind.totalPutOI  * 0.015;
  if (ind.callWritingAbove > callWriteThresh) signals.push('CALL_WRITING');
  if (ind.putWritingBelow  > putWriteThresh)  signals.push('PUT_WRITING');

  // ATM OI action
  if (ind.atmCallOIChg > 0 && ind.atmPutOIChg  < 0) signals.push('CALL_BUILD_PUT_UNWIND');
  if (ind.atmPutOIChg  > 0 && ind.atmCallOIChg < 0) signals.push('PUT_BUILD_CALL_UNWIND');

  // IV skew
  if (ind.ivSkew >  2.5) signals.push('PUT_IV_SKEW');
  if (ind.ivSkew < -2.5) signals.push('CALL_IV_SKEW');

  // Volume
  if (ind.vcratio > 1.5) signals.push('HIGH_PUT_VOL');
  if (ind.vcratio < 0.67) signals.push('HIGH_CALL_VOL');

  // Shifting events near this time (±10 min)
  if (Array.isArray(shiftingTimeline)) {
    const tM = toMin(snap.time);
    const near = shiftingTimeline.find(e =>
      Math.abs(toMin(e.time) - tM) <= 10 && (e.support?.shift || e.resistance?.shift)
    );
    if (near?.support?.shift    === 'SFTB')  signals.push('SUP_SFTB');
    if (near?.support?.shift    === 'SFBTT') signals.push('SUP_SFBTT');
    if (near?.resistance?.shift === 'SFTB')  signals.push('RES_SFTB');
    if (near?.resistance?.shift === 'SFBTT') signals.push('RES_SFBTT');
  }

  return signals.slice(0, 3); // cap at 3 to keep pattern keys manageable
}

// ── Analyze one day ──────────────────────────────────────────────────────────
function analyzeDay(datePath, symbol, expiry, date) {
  const files = getDataFiles(datePath);
  if (files.length < 5) return null;

  // Build timeline
  const timeline = [];
  for (const file of files) {
    const data = readSnapshotFile(path.join(datePath, file));
    if (!data?.option_chain?.length) continue;
    const spot = data.option_chain[0]?.underlying_spot_price || 0;
    if (spot <= 0) continue;
    const time = (data.metadata?.time_hhmmss || '00:00:00').substring(0, 5);
    if (time < '09:15' || time > '15:35') continue;
    const ind = computeIndicators(data.option_chain, spot);
    if (!ind) continue;
    timeline.push({ time, spot, ind });
  }

  if (timeline.length < 5) return null;
  timeline.sort((a,b) => a.time.localeCompare(b.time));

  // Load supporting data
  const shiftingData = readJSON(path.join(datePath, '_shifting.json'));
  const mctrData     = readJSON(path.join(datePath, '_mctr.json'));
  const s40Data      = readJSON(path.join(datePath, '_chart_strategy40.json'));
  const shiftTimeline = shiftingData?.timeline || [];

  const LEADS = [5, 10, 15, 20, 30]; // minutes ahead to check
  const strikeGap = timeline[0]?.ind?.strikeGap || 50;
  const moveThresh = strikeGap / 4; // ~12-25 pts for nifty

  // Pre-compute confirmed signals: signal must appear in 2 consecutive snapshots
  // This removes noise and gives only real, sustained signals
  const confirmedAt = []; // { idx, time, sigs, ind }
  for (let i = 1; i < timeline.length; i++) {
    const snap = timeline[i];
    const prev = timeline[i - 1];
    const sigsCur  = detectSignals(snap, prev, shiftTimeline);
    const sigsPrev = i > 1 ? detectSignals(prev, timeline[i-2], shiftTimeline) : [];
    // A confirmed signal = at least one common signal in both consecutive snapshots
    const common = sigsCur.filter(s => sigsPrev.includes(s));
    if (common.length > 0) {
      confirmedAt.push({ idx: i, time: snap.time, sigs: common, ind: snap.ind, spot: snap.spot });
    }
  }

  // Pattern accumulator (uses confirmed signals only)
  const patternAcc = {};

  for (const conf of confirmedAt) {
    const tM = toMin(conf.time);
    for (const lead of LEADS) {
      const target = timeline.find(s => toMin(s.time) >= tM + lead);
      if (!target) continue;
      const delta = target.spot - conf.spot;
      if (Math.abs(delta) < moveThresh) continue;
      const dir = delta > 0 ? 'UP' : 'DOWN';
      const key = conf.sigs.join('+');
      if (!patternAcc[key]) patternAcc[key] = { sigs: conf.sigs, leads: {} };
      if (!patternAcc[key].leads[lead]) patternAcc[key].leads[lead] = { UP: 0, DOWN: 0, total: 0 };
      patternAcc[key].leads[lead][dir]++;
      patternAcc[key].leads[lead].total++;
    }
  }

  // ── Time-window analysis ─────────────────────────────────────────────────
  // For each session window, find significant moves and trace back to first warning
  const SESSION_WINDOWS = [
    { label: 'Opening',      from: '09:15', to: '10:00', icon: '🌅' },
    { label: 'Mid-Morning',  from: '10:00', to: '12:00', icon: '📈' },
    { label: 'Midday',       from: '12:00', to: '13:30', icon: '☀️'  },
    { label: 'Afternoon',    from: '13:30', to: '15:35', icon: '🌆' },
  ];

  // Detect significant moves: spot changes > strikeGap/2 within any 15-min window
  const significantMoves = [];
  for (let i = 0; i < timeline.length; i++) {
    const snap = timeline[i];
    const tM   = toMin(snap.time);
    // Look 15 min ahead
    const fwd = timeline.find(s => toMin(s.time) >= tM + 15);
    if (!fwd) continue;
    const delta  = fwd.spot - snap.spot;
    if (Math.abs(delta) < strikeGap / 2) continue; // only big moves
    const dir = delta > 0 ? 'UP' : 'DOWN';
    // For this move, find earliest confirmed signal before it
    const moveTime = toMin(fwd.time);
    const earlySignals = confirmedAt.filter(c => {
      const cMin = toMin(c.time);
      return cMin < moveTime && moveTime - cMin <= 30; // within 30 min before move
    });
    const firstSignal = earlySignals[0]; // earliest
    significantMoves.push({
      move_time:      fwd.time,
      signal_time:    firstSignal?.time || null,
      lead_min:       firstSignal ? moveTime - toMin(firstSignal.time) : null,
      direction:      dir,
      pts:            Math.round(delta),
      signals:        firstSignal?.sigs || [],
      spot_at_signal: firstSignal?.spot || snap.spot,
      spot_at_move:   Math.round(fwd.spot),
      from_strike:    firstSignal ? (dir === 'UP' ? firstSignal.ind.supportStrike    : firstSignal.ind.resistanceStrike)   : null,
      from_reversal:  firstSignal ? (dir === 'UP' ? firstSignal.ind.supportReversal  : firstSignal.ind.resistanceReversal) : null,
    });
  }

  // De-duplicate moves (keep the biggest move per 20-min window)
  const dedupedMoves = [];
  let lastMoveMin = -99;
  significantMoves
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)) // biggest first
    .forEach(m => {
      const mMin = toMin(m.move_time);
      if (mMin - lastMoveMin > 20) { dedupedMoves.push(m); lastMoveMin = mMin; }
    });
  dedupedMoves.sort((a, b) => a.move_time.localeCompare(b.move_time));

  // Build window summary
  const timeWindowAnalysis = SESSION_WINDOWS.map(win => {
    const movesInWindow = dedupedMoves.filter(m =>
      m.move_time >= win.from && m.move_time < win.to
    );
    const withSignals = movesInWindow.filter(m => m.lead_min !== null);
    const avgLead = withSignals.length
      ? Math.round(withSignals.reduce((s, m) => s + m.lead_min, 0) / withSignals.length)
      : null;
    const upMoves   = movesInWindow.filter(m => m.direction === 'UP').length;
    const downMoves = movesInWindow.filter(m => m.direction === 'DOWN').length;
    return {
      ...win,
      total_moves:    movesInWindow.length,
      up_moves:       upMoves,
      down_moves:     downMoves,
      avg_lead_min:   avgLead,
      moves:          movesInWindow,
    };
  }).filter(w => w.total_moves > 0);

  // Build key_patterns
  const keyPatterns = [];
  for (const [key, acc] of Object.entries(patternAcc)) {
    let bestLead = null, bestAcc = 0, bestDir = null, bestOcc = 0;
    for (const [lead, counts] of Object.entries(acc.leads)) {
      if (counts.total < 2) continue;
      const upA  = counts.UP   / counts.total;
      const downA= counts.DOWN / counts.total;
      const a    = Math.max(upA, downA);
      if (a > bestAcc) {
        bestAcc  = a;
        bestLead = parseInt(lead);
        bestDir  = upA >= downA ? 'UP' : 'DOWN';
        bestOcc  = counts.total;
      }
    }
    if (!bestLead || bestAcc < 0.60) continue;
    keyPatterns.push({
      pattern:       key,
      signals:       acc.sigs,
      direction:     bestDir,
      accuracy_pct:  Math.round(bestAcc * 100),
      lead_time_min: bestLead,
      occurrences:   bestOcc,
    });
  }
  keyPatterns.sort((a,b) => b.accuracy_pct - a.accuracy_pct || b.occurrences - a.occurrences);

  // Build predictive signals list — use confirmed signals only (more reliable)
  const predictiveSignals = [];
  for (const conf of confirmedAt) {
    const tM = toMin(conf.time);
    for (const lead of LEADS) {
      const target = timeline.find(s => toMin(s.time) >= tM + lead);
      if (!target) continue;
      const delta = target.spot - conf.spot;
      if (Math.abs(delta) < moveThresh) continue;
      const dir = delta > 0 ? 'UP' : 'DOWN';
      predictiveSignals.push({
        time:           conf.time,
        signals:        conf.sigs,
        confirmed:      true,
        direction:      dir,
        minutes_before: lead,
        spot_at_signal: conf.spot,
        spot_after:     Math.round(target.spot),
        actual_move:    `${dir === 'UP' ? '+' : ''}${Math.round(delta)} pts in ${lead} min`,
        pcr:            parseFloat(conf.ind.pcr.toFixed(2)),
        atm_strike:     conf.ind.atmStrike,
        // Which strike's reversal the move originates from
        from_strike:    dir === 'UP' ? conf.ind.supportStrike    : conf.ind.resistanceStrike,
        from_reversal:  dir === 'UP' ? conf.ind.supportReversal  : conf.ind.resistanceReversal,
      });
      break; // first matching lead only
    }
  }

  // Spot stats
  const spots       = timeline.map(s => s.spot);
  const openSpot    = spots[0];
  const closeSpot   = spots[spots.length - 1];
  const highSpot    = Math.max(...spots);
  const lowSpot     = Math.min(...spots);
  const overallChg  = closeSpot - openSpot;
  const dayDir      = overallChg > 50 ? 'UP' : overallChg < -50 ? 'DOWN' : 'FLAT';

  // Best lead overall (most common)
  let bestLeadOverall = 15;
  if (keyPatterns.length > 0) {
    const lc = {};
    keyPatterns.forEach(p => { lc[p.lead_time_min] = (lc[p.lead_time_min] || 0) + 1; });
    bestLeadOverall = parseInt(Object.entries(lc).sort((a,b) => b[1]-a[1])[0]?.[0] || 15);
  }

  const avgAcc = keyPatterns.length > 0
    ? Math.round(keyPatterns.reduce((s, p) => s + p.accuracy_pct, 0) / keyPatterns.length)
    : 0;

  // PCR stats
  const pcrValues = timeline.map(s => s.ind.pcr);
  const avgPCR    = pcrValues.length ? (pcrValues.reduce((a,b) => a+b,0) / pcrValues.length).toFixed(2) : '—';
  const openPCR   = pcrValues[0]?.toFixed(2) || '—';
  const closePCR  = pcrValues[pcrValues.length - 1]?.toFixed(2) || '—';

  // Why market went up/down — build reason list
  const whyReasons = buildWhyReasons(timeline, keyPatterns, shiftTimeline, mctrData, dayDir);

  const result = {
    date, symbol, expiry,
    analyzed_at: new Date().toISOString(),
    total_snapshots: timeline.length,
    spot_range: {
      open: Math.round(openSpot), high: Math.round(highSpot),
      low: Math.round(lowSpot),   close: Math.round(closeSpot),
      change: Math.round(overallChg), direction: dayDir,
    },
    pcr_stats: { open: openPCR, close: closePCR, avg: avgPCR },
    mctr: mctrData
      ? { support: mctrData.mctr_support?.strike, resistance: mctrData.mctr_resistance?.strike }
      : null,
    strategy40: s40Data
      ? { support: s40Data.support, resistance: s40Data.resistance,
          support_reversal: s40Data.support_reversal, resistance_reversal: s40Data.resistance_reversal }
      : null,
    key_patterns:         keyPatterns.slice(0, 8),
    predictive_signals:   predictiveSignals.slice(0, 20),
    best_lead_time_min:   bestLeadOverall,
    overall_accuracy_pct: avgAcc,
    why_market_moved:     whyReasons,
    time_window_analysis: timeWindowAnalysis,
    significant_moves:    dedupedMoves,
    summary: buildSummary({ dayDir, overallChg, bestLeadOverall, avgAcc, keyPatterns, avgPCR }),
  };

  fs.writeFileSync(path.join(datePath, '_trainai.json'), JSON.stringify(result, null, 2));
  return result;
}

// ── Why did market move? — human-readable reasons ────────────────────────────
function buildWhyReasons(timeline, keyPatterns, shiftTimeline, mctrData, dayDir) {
  const reasons = [];
  if (!timeline.length) return reasons;

  const pcrValues = timeline.map(s => s.ind.pcr);
  const pcrOpen   = pcrValues[0];
  const pcrClose  = pcrValues[pcrValues.length - 1];
  const pcrTrend  = pcrClose > pcrOpen + 0.1 ? 'rising' : pcrClose < pcrOpen - 0.1 ? 'falling' : 'stable';

  // PCR reason
  if (pcrTrend === 'rising')
    reasons.push({ icon: '📈', label: 'PCR Rising', detail: `PCR moved from ${pcrOpen.toFixed(2)} to ${pcrClose.toFixed(2)} — increasing put writing signals bullish sentiment` });
  else if (pcrTrend === 'falling')
    reasons.push({ icon: '📉', label: 'PCR Falling', detail: `PCR dropped from ${pcrOpen.toFixed(2)} to ${pcrClose.toFixed(2)} — call writing dominated, bearish signal` });

  // Top pattern
  const top = keyPatterns[0];
  if (top) {
    const verb = top.direction === 'UP' ? 'bullish' : 'bearish';
    reasons.push({
      icon: top.direction === 'UP' ? '🟢' : '🔴',
      label: `Key Signal: ${top.pattern}`,
      detail: `${top.accuracy_pct}% accurate ${verb} signal — gave ~${top.lead_time_min} min advance warning. Occurred ${top.occurrences} times.`
    });
  }

  // Shift reasons
  const sftbCount  = shiftTimeline.filter(e => e.support?.shift === 'SFTB'  || e.resistance?.shift === 'SFTB').length;
  const sfbttCount = shiftTimeline.filter(e => e.support?.shift === 'SFBTT' || e.resistance?.shift === 'SFBTT').length;
  if (sftbCount > sfbttCount && sftbCount > 0)
    reasons.push({ icon: '⬆️', label: 'SFTB Dominates', detail: `${sftbCount} SFTB (shift from top to bottom) events detected — bullish OI movement` });
  else if (sfbttCount > sftbCount && sfbttCount > 0)
    reasons.push({ icon: '⬇️', label: 'SFBTT Dominates', detail: `${sfbttCount} SFBTT (shift from bottom to top) events — bearish OI movement` });

  // MCTR proximity
  if (mctrData) {
    const lastSpot = timeline[timeline.length - 1]?.spot || 0;
    const mctrSup  = mctrData.mctr_support?.strike;
    const mctrRes  = mctrData.mctr_resistance?.strike;
    if (mctrSup && Math.abs(lastSpot - mctrSup) < 100)
      reasons.push({ icon: '🛡️', label: 'MCTR Support Hold', detail: `Close held near MCTR support at ${mctrSup} — buyers defended the level` });
    if (mctrRes && Math.abs(lastSpot - mctrRes) < 100)
      reasons.push({ icon: '🚧', label: 'MCTR Resistance Test', detail: `Close near MCTR resistance at ${mctrRes} — sellers capped the rally` });
  }

  // Call/Put writing dominant signal
  const hasCallWriting = keyPatterns.some(p => p.pattern.includes('CALL_WRITING') && p.direction === 'DOWN');
  const hasPutWriting  = keyPatterns.some(p => p.pattern.includes('PUT_WRITING')  && p.direction === 'UP');
  if (hasCallWriting)
    reasons.push({ icon: '✍️', label: 'Call Writing at Resistance', detail: 'Heavy call writing above ATM capped upside — sellers were active' });
  if (hasPutWriting)
    reasons.push({ icon: '✍️', label: 'Put Writing at Support', detail: 'Heavy put writing below ATM provided a floor — bulls added support' });

  // Final direction reason
  if (dayDir === 'UP')
    reasons.push({ icon: '🚀', label: 'Net Bullish Day', detail: 'Combination of put writing, rising PCR, and SFTB shifts drove the upward move' });
  else if (dayDir === 'DOWN')
    reasons.push({ icon: '💥', label: 'Net Bearish Day', detail: 'Call writing, falling PCR, and SFBTT shifts confirmed selling pressure' });
  else
    reasons.push({ icon: '↔️', label: 'Sideways Market', detail: 'Balanced OI on both sides — neither bulls nor bears had conviction' });

  return reasons.slice(0, 6);
}

function buildSummary({ dayDir, overallChg, bestLeadOverall, avgAcc, keyPatterns, avgPCR }) {
  const dirWord = dayDir === 'UP' ? 'moved UP' : dayDir === 'DOWN' ? 'fell' : 'traded sideways';
  let s = `Market ${dirWord} by ${Math.abs(Math.round(overallChg))} pts. Avg PCR: ${avgPCR}. `;
  if (bestLeadOverall) s += `Signals visible ~${bestLeadOverall} min before the move. `;
  if (avgAcc > 0) s += `Pattern accuracy: ${avgAcc}%. `;
  if (keyPatterns[0]) {
    const p = keyPatterns[0];
    s += `Strongest signal: "${p.pattern}" → ${p.direction} (${p.accuracy_pct}% accuracy, ${p.lead_time_min} min lead).`;
  }
  return s;
}

// ── Batch run all dates ───────────────────────────────────────────────────────
let _runStatus = { running: false, last_run: null, last_result: null };

function runAllAnalysis(forceAll = false) {
  // Note: caller (route or scheduleAutoRun) sets _runStatus.running = true before calling
  _runStatus.running = true;

  const dataDir = PATHS.MARKET;
  if (!fs.existsSync(dataDir)) { _runStatus.running = false; return { analyzed: 0, skipped: 0, errors: 0 }; }

  let analyzed = 0, skipped = 0, errors = 0;
  const today = new Date().toISOString().split('T')[0];

  folders(dataDir).forEach(symbol => {
    folders(path.join(dataDir, symbol)).forEach(expiry => {
      folders(path.join(dataDir, symbol, expiry)).forEach(date => {
        const datePath  = path.join(dataDir, symbol, expiry, date);
        const resultFile = path.join(datePath, '_trainai.json');

        // Skip if already analyzed (unless forceAll or today's date)
        if (!forceAll && fs.existsSync(resultFile) && date !== today) { skipped++; return; }

        try {
          const r = analyzeDay(datePath, symbol, expiry, date);
          if (r) analyzed++; else skipped++;
        } catch(e) { errors++; console.error(`[TrainAI] Error ${symbol}/${expiry}/${date}:`, e.message); }
      });
    });
  });

  const result = { analyzed, skipped, errors, ran_at: new Date().toISOString() };
  _runStatus = { running: false, last_run: new Date().toISOString(), last_result: result };
  return result;
}

// ── Aggregate: top patterns across all analyzed days for a symbol ─────────────
function getSymbolInsights(symbol) {
  const symDir = path.join(PATHS.MARKET, symbol.toUpperCase().replace(/\s+/g, '_'));
  if (!fs.existsSync(symDir)) return null;

  const allResults = [];
  folders(symDir).forEach(expiry => {
    folders(path.join(symDir, expiry)).forEach(date => {
      const r = readJSON(path.join(symDir, expiry, date, '_trainai.json'));
      if (r) allResults.push(r);
    });
  });

  if (!allResults.length) return null;
  allResults.sort((a,b) => a.date.localeCompare(b.date));

  // Aggregate patterns
  const pm = {};
  allResults.forEach(r => {
    (r.key_patterns || []).forEach(p => {
      if (!pm[p.pattern]) pm[p.pattern] = { count: 0, acc_sum: 0, dir: {} };
      pm[p.pattern].count++;
      pm[p.pattern].acc_sum += p.accuracy_pct;
      pm[p.pattern].dir[p.direction] = (pm[p.pattern].dir[p.direction] || 0) + 1;
    });
  });

  const topPatterns = Object.entries(pm)
    .map(([pattern, d]) => ({
      pattern,
      days:         d.count,
      avg_accuracy: Math.round(d.acc_sum / d.count),
      direction:    Object.entries(d.dir).sort((a,b) => b[1]-a[1])[0]?.[0] || '—',
    }))
    .filter(p => p.days >= 2)
    .sort((a,b) => b.avg_accuracy - a.avg_accuracy)
    .slice(0, 10);

  const avgLead = Math.round(allResults.reduce((s,r) => s + (r.best_lead_time_min || 15), 0) / allResults.length);
  const avgAcc  = Math.round(allResults.reduce((s,r) => s + (r.overall_accuracy_pct || 0), 0) / allResults.length);

  return {
    symbol,
    total_days:          allResults.length,
    avg_lead_time_min:   avgLead,
    avg_accuracy_pct:    avgAcc,
    top_patterns:        topPatterns,
    recent_days:         allResults.slice(-7).reverse(),
  };
}

// ── Indicator Access Config ───────────────────────────────────────────────────
const INDICATOR_FILE = PATHS.INDICATOR_ACCESS;

const DEFAULT_INDICATORS = [
  { id: 'option_chain',   name: 'Option Chain Table',   desc: 'Live/Historical option chain data',        admin: true,  member: true,  user: true  },
  { id: 'pcr',            name: 'PCR & MMI Indicators',  desc: 'Put-Call Ratio, Market Mood Index',        admin: true,  member: true,  user: false },
  { id: 'mctr',           name: 'MCTR Strategy',         desc: 'Market Cycle Trend Reversal strikes',      admin: true,  member: true,  user: false },
  { id: 'strategy40',     name: 'Strategy 4.0 / Bromos', desc: 'Bromos R/S premarket levels',             admin: true,  member: true,  user: false },
  { id: 'shifting',       name: 'Shifting Data',         desc: 'OI shift events & modal',                  admin: true,  member: true,  user: false },
  { id: 'oi_chart',       name: 'OI Chart',              desc: 'Open Interest chart per strike',           admin: true,  member: true,  user: false },
  { id: 'spot_chart',     name: 'Spot / Price Chart',    desc: 'Spot price movement chart',                admin: true,  member: true,  user: false },
  { id: 'greeks',         name: 'Greeks',                desc: 'Delta, Gamma, Theta, Vega, IV',           admin: true,  member: true,  user: false },
  { id: 'ltp_calc',       name: 'LTP Calculator',        desc: 'LTP-based profit/loss calculator',         admin: true,  member: true,  user: false },
  { id: 'power_ai_stock', name: 'Power AI Stock',        desc: 'AI-scored stock option analysis',          admin: true,  member: true,  user: false },
  { id: 'ai_train',       name: 'AI Train Panel',        desc: 'AI pattern analysis from historical data', admin: true,  member: true,  user: false },
  { id: 'soc_ai',         name: 'SOC AI Chat',           desc: 'AI market assistant chat panel',           admin: true,  member: true,  user: true  },
  { id: 'historical',     name: 'Historical Data',       desc: 'Past date option chain browsing',          admin: true,  member: true,  user: false },
];

function loadIndicators() {
  if (fs.existsSync(INDICATOR_FILE)) {
    const saved = readJSON(INDICATOR_FILE);
    if (Array.isArray(saved)) {
      // Merge: add any new defaults, keep existing settings
      const savedMap = {};
      saved.forEach(i => { savedMap[i.id] = i; });
      return DEFAULT_INDICATORS.map(def => savedMap[def.id]
        ? { ...def, admin: savedMap[def.id].admin, member: savedMap[def.id].member, user: savedMap[def.id].user }
        : def
      );
    }
  }
  // Save defaults
  fs.writeFileSync(INDICATOR_FILE, JSON.stringify(DEFAULT_INDICATORS, null, 2));
  return DEFAULT_INDICATORS;
}

function saveIndicators(indicators) {
  fs.writeFileSync(INDICATOR_FILE, JSON.stringify(indicators, null, 2));
}

// ── Auto-schedule: startup + every 15 min during market hours + close ────────
function isMarketHoursIST() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const total = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return total >= 9 * 60 + 14 && total <= 15 * 60 + 36; // 09:14–15:36
}

function scheduleAutoRun() {
  // Run once shortly after server starts (catches restarts during market hours)
  setTimeout(() => {
    if (!_runStatus.running) {
      console.log('[TrainAI] Startup auto-analysis...');
      _runStatus.running = true;
      setImmediate(() => runAllAnalysis(false));
    }
  }, 20_000);

  setInterval(() => {
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const h = ist.getUTCHours(), m = ist.getUTCMinutes();

    // After market close: run once at 15:35
    if (h === 15 && m === 35 && !_runStatus.running) {
      console.log('[TrainAI] Auto-running analysis after market close...');
      _runStatus.running = true;
      setImmediate(() => runAllAnalysis(false));
      return;
    }

    // During market hours: re-analyse today every 15 minutes (keeps live signals fresh)
    if (isMarketHoursIST() && m % 15 === 0 && !_runStatus.running) {
      console.log('[TrainAI] Intraday auto-analysis...');
      _runStatus.running = true;
      setImmediate(() => runAllAnalysis(false));
    }
  }, 60_000); // check every minute
}

// ── Express Routes ────────────────────────────────────────────────────────────
module.exports = function(app) {
  // Use same session fields as the rest of the app:
  //   req.session.userId, req.session.userVerified, req.session.userRole
  const authCheck = (req, res, next) => {
    if (req.session && req.session.userId && req.session.userVerified) return next();
    res.status(401).json({ error: 'Unauthorized' });
  };

  const adminOrMember = (req, res, next) => {
    const role = req.session?.userRole || 'user';
    if (role === 'admin' || role === 'member') return next();
    res.status(403).json({ error: 'Access denied — admin or member only' });
  };

  const adminOnly = (req, res, next) => {
    if ((req.session?.userRole || 'user') === 'admin') return next();
    res.status(403).json({ error: 'Admin only' });
  };

  // GET status of AI Train engine
  app.get('/api/trainai/status', authCheck, adminOrMember, (req, res) => {
    res.json({ success: true, status: _runStatus });
  });

  // POST run analysis manually
  app.post('/api/trainai/run', authCheck, adminOrMember, (req, res) => {
    if (_runStatus.running) return res.json({ success: false, message: 'Analysis already running' });
    // Manual run always processes all dates including old historical data
    const forceAll = true;
    // Mark running BEFORE the timeout so the check inside runAllAnalysis doesn't race
    _runStatus.running = true;
    setImmediate(() => {
      try { runAllAnalysis(forceAll); }
      catch(e) { _runStatus = { running: false, last_run: new Date().toISOString(), last_result: { analyzed: 0, skipped: 0, errors: 1 } }; }
    });
    res.json({ success: true, message: 'Analysis started in background' });
  });

  // GET results for a specific day
  app.get('/api/trainai/result/:symbol/:expiry/:date', authCheck, adminOrMember, (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safe = symbol.toUpperCase().replace(/\s+/g, '_');
      const f = path.join(PATHS.MARKET, safe, expiry, date, '_trainai.json');
      if (!fs.existsSync(f)) return res.json({ success: false, message: 'No analysis for this date. Run AI Train first.' });
      res.json({ success: true, result: readJSON(f) });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET pattern match — all historical dates that share the same patterns as the selected date
  app.get('/api/trainai/pattern-match/:symbol/:expiry/:date', authCheck, adminOrMember, (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safe    = symbol.toUpperCase().replace(/\s+/g, '_');
      const symDir  = path.join(PATHS.MARKET, safe);

      // Load selected date's result
      const targetFile = path.join(symDir, expiry, date, '_trainai.json');
      const target     = readJSON(targetFile);
      if (!target) return res.json({ success: false, message: 'No analysis for selected date. Run AI Train first.' });

      const targetPatternObjs = target.key_patterns || [];
      const targetPatterns    = targetPatternObjs.map(p => p.pattern);
      if (!targetPatterns.length) return res.json({ success: true, target_patterns: [], matches: [], stats: {} });

      // Scan every other analyzed date for the same symbol
      const matches = [];
      folders(symDir).forEach(exp => {
        folders(path.join(symDir, exp)).forEach(dt => {
          if (exp === expiry && dt === date) return; // skip the selected date itself
          const f = path.join(symDir, exp, dt, '_trainai.json');
          const r = readJSON(f);
          if (!r?.key_patterns?.length) return;

          for (const kp of r.key_patterns) {
            if (targetPatterns.includes(kp.pattern)) {
              matches.push({
                date:                dt,
                expiry:              exp,
                pattern:             kp.pattern,
                predicted_direction: kp.direction,
                accuracy_pct:        kp.accuracy_pct,
                lead_time_min:       kp.lead_time_min,
                occurrences:         kp.occurrences,
                actual_direction:    r.spot_range?.direction,
                actual_change:       r.spot_range?.change,
                spot_open:           r.spot_range?.open,
                spot_close:          r.spot_range?.close,
                // Did the prediction match actual direction?
                match: kp.direction === r.spot_range?.direction,
              });
              break; // one entry per date (first matching pattern)
            }
          }
        });
      });

      matches.sort((a, b) => b.date.localeCompare(a.date));

      // Summary stats per pattern
      const stats = {};
      for (const pt of targetPatterns) {
        const rows = matches.filter(m => m.pattern === pt);
        const correct = rows.filter(m => m.match).length;
        stats[pt] = { total: rows.length, correct, accuracy: rows.length ? Math.round(correct / rows.length * 100) : 0 };
      }

      res.json({ success: true, target_patterns: targetPatternObjs, matches, stats });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET aggregated symbol insights
  app.get('/api/trainai/insights/:symbol', authCheck, adminOrMember, (req, res) => {
    try {
      const insights = getSymbolInsights(req.params.symbol);
      if (!insights) return res.json({ success: false, message: 'No analyzed data for this symbol yet.' });
      res.json({ success: true, insights });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET list of all analyzed dates for a symbol
  app.get('/api/trainai/dates/:symbol', authCheck, adminOrMember, (req, res) => {
    try {
      const safe   = req.params.symbol.toUpperCase().replace(/\s+/g, '_');
      const symDir = path.join(PATHS.MARKET, safe);
      const dates  = [];
      folders(symDir).forEach(expiry => {
        folders(path.join(symDir, expiry)).forEach(date => {
          const f = path.join(symDir, expiry, date, '_trainai.json');
          if (fs.existsSync(f)) dates.push({ expiry, date });
        });
      });
      dates.sort((a,b) => b.date.localeCompare(a.date));
      res.json({ success: true, dates });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── Live AI Signal RAM Cache ────────────────────────────────────────────────
  // Refreshed every 60 s from the latest date's _trainai.json files.
  // Served instantly from memory for live-mode chart overlays.
  let _liveAiCache = { data: null, ts: 0, date: null };

  function computeAiSignals(date) {
    try {
      const dataRoot  = PATHS.MARKET;
      const resistance = [];
      const support    = [];

      folders(dataRoot).forEach(sym => {
        const symDir = path.join(dataRoot, sym);

        // Pre-build pattern history for this symbol across ALL dates
        // patternHistory[patternName] = { total, correct, offsets_up[], offsets_down[] }
        // offsets_up:   how far below support_reversal the actual LOW went (support patterns)
        // offsets_down: how far above resistance_reversal the actual HIGH went (resistance patterns)
        const patternHistory = {};
        folders(symDir).forEach(exp => {
          folders(path.join(symDir, exp)).forEach(dt => {
            const hf = path.join(symDir, exp, dt, '_trainai.json');
            const hr = readJSON(hf);
            if (!hr?.key_patterns?.length) return;

            const hs40 = hr.strategy40 || {};
            const low  = hr.spot_range?.low;
            const high = hr.spot_range?.high;

            // Derive direction if not stored (older files)
            const srDir = hr.spot_range?.direction ||
              (hr.spot_range?.change > 50 ? 'UP' : hr.spot_range?.change < -50 ? 'DOWN' : 'FLAT');

            for (const kp of hr.key_patterns) {
              if (!kp.pattern) continue;
              if (!patternHistory[kp.pattern]) {
                patternHistory[kp.pattern] = { total: 0, correct: 0, actual_up: 0, actual_down: 0, offsets_up: [], offsets_down: [] };
              }
              const ph = patternHistory[kp.pattern];
              ph.total++;
              if (kp.direction === srDir) ph.correct++;
              if (srDir === 'UP')   ph.actual_up++;
              else if (srDir === 'DOWN') ph.actual_down++;

              // Collect reversal overshoot data
              if (kp.direction === 'UP') {
                // Get the best reversal value for this date's support signal
                const sigRev = (hr.predictive_signals || [])
                  .filter(s => s.direction === 'UP' && s.from_reversal != null)
                  .sort((a, b) => (a.time || '').localeCompare(b.time || ''))[0]?.from_reversal;
                const rev = sigRev ?? hs40.support_reversal;
                if (rev != null && low != null) {
                  const offset = Math.round(rev - low); // how far below reversal low went
                  if (offset >= 0 && offset <= 500) ph.offsets_up.push(offset);
                }
              } else if (kp.direction === 'DOWN') {
                const sigRev = (hr.predictive_signals || [])
                  .filter(s => s.direction === 'DOWN' && s.from_reversal != null)
                  .sort((a, b) => (a.time || '').localeCompare(b.time || ''))[0]?.from_reversal;
                const rev = sigRev ?? hs40.resistance_reversal;
                if (rev != null && high != null) {
                  const offset = Math.round(high - rev); // how far above reversal high went
                  if (offset >= 0 && offset <= 500) ph.offsets_down.push(offset);
                }
              }
            }
          });
        });

        folders(symDir).forEach(expiry => {
          const f = path.join(symDir, expiry, date, '_trainai.json');
          const r = readJSON(f);
          if (!r) return;

          const keyPatterns = r.key_patterns || [];
          if (!keyPatterns.length) return;

          const s40Raw = readJSON(path.join(symDir, expiry, date, '_chart_strategy40.json'));
          const s40 = s40Raw || r.strategy40 || {};

          const MIN_ACCURACY = 70;
          const upPatterns   = keyPatterns.filter(p => p.direction === 'UP'   && p.accuracy_pct >= MIN_ACCURACY);
          const downPatterns = keyPatterns.filter(p => p.direction === 'DOWN' && p.accuracy_pct >= MIN_ACCURACY);


          const histStats = (patterns) => {
            let total = 0, correct = 0, actual_up = 0, actual_down = 0;
            for (const p of patterns) {
              const h = patternHistory[p.pattern];
              if (!h) continue;
              total      += h.total;
              correct    += h.correct;
              actual_up  += h.actual_up;
              actual_down += h.actual_down;
            }
            const hist_total = total;
            return {
              hist_total,
              hist_correct:  correct,
              hist_accuracy: hist_total > 0 ? Math.round(correct / hist_total * 100) : null,
              hist_rise_pct: hist_total > 0 ? Math.round(actual_up   / hist_total * 100) : null,
              hist_fall_pct: hist_total > 0 ? Math.round(actual_down / hist_total * 100) : null,
              hist_rise_days: actual_up,
              hist_fall_days: actual_down,
            };
          };

          const base = {
            symbol:           sym.replace(/_/g, ' '),
            expiry,
            date,
            spot_open:        r.spot_range?.open,
            spot_close:       r.spot_range?.close,
            actual_direction: r.spot_range?.direction,
            actual_change:    r.spot_range?.change,
          };

          // Create one card per signal-time for each high-accuracy pattern match
          // Trade score: 0–100
          // 50 pts: pattern accuracy (full range: 100% → 50pts, 90% → 45pts)
          // 30 pts: historical direction alignment (fall% for DOWN, rise% for UP)
          // 20 pts: data reliability from occurrences (capped at 10)
          const calcScore = (pat, histS, dir) => {
            const accScore  = Math.round(Math.min(pat.accuracy_pct, 100) / 100 * 50);
            const dirPct    = dir === 'DOWN' ? (histS.hist_fall_pct ?? 0) : (histS.hist_rise_pct ?? 0);
            const dirScore  = Math.round(dirPct / 100 * 30);
            const occScore  = Math.round(Math.min(pat.occurrences, 10) / 10 * 20);
            return Math.min(100, Math.max(0, accScore + dirScore + occScore));
          };

          const pushSignals = (patterns, dir, arr, s40Strike, s40Reversal) => {
            if (!patterns.length) return;
            const patternMap = {};
            patterns.forEach(p => { patternMap[p.pattern] = p; });
            const patternKeys = new Set(Object.keys(patternMap));
            const histS = histStats(patterns);

            // Collect all predictive_signals that match a high-accuracy pattern
            const matchedSigs = (r.predictive_signals || [])
              .filter(s => s.direction === dir && patternKeys.has((s.signals || []).join('+')))
              .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

            // Deduplicate by time — one card per firing time
            const seenTimes = new Set();
            for (const sig of matchedSigs) {
              if (seenTimes.has(sig.time)) continue;
              seenTimes.add(sig.time);
              const sigKey = (sig.signals || []).join('+');
              const matchedPat = patternMap[sigKey] || patterns.sort((a, b) => b.accuracy_pct - a.accuracy_pct)[0];
              arr.push({
                ...base,
                ...histS,
                trade_score:    calcScore(matchedPat, histS, dir),
                pattern:        matchedPat.pattern,
                accuracy_pct:   matchedPat.accuracy_pct,
                lead_time_min:  matchedPat.lead_time_min,
                occurrences:    matchedPat.occurrences,
                all_patterns:   patterns.map(p => p.pattern),
                from_strike:    sig.from_strike   ?? s40Strike   ?? null,
                from_reversal:  sig.from_reversal ?? s40Reversal ?? null,
                trade_time:     sig.time,
                trade_point:    sig.spot_at_signal ?? r.spot_range?.open ?? null,
                minutes_before: sig.minutes_before ?? null,
                signals:        sig.signals ?? [],
              });
            }

            // If no matching predictive_signal found, fall back to first signal of that direction
            if (seenTimes.size === 0) {
              const fallback = (r.predictive_signals || [])
                .filter(s => s.direction === dir)
                .sort((a, b) => (a.time || '').localeCompare(b.time || ''))[0];
              const best = patterns.sort((a, b) => b.accuracy_pct - a.accuracy_pct)[0];
              arr.push({
                ...base,
                ...histS,
                trade_score:    calcScore(best, histS, dir),
                pattern:        best.pattern,
                accuracy_pct:   best.accuracy_pct,
                lead_time_min:  best.lead_time_min,
                occurrences:    best.occurrences,
                all_patterns:   patterns.map(p => p.pattern),
                from_strike:    fallback?.from_strike   ?? s40Strike   ?? null,
                from_reversal:  fallback?.from_reversal ?? s40Reversal ?? null,
                trade_time:     fallback?.time          ?? null,
                trade_point:    fallback?.spot_at_signal ?? r.spot_range?.open ?? null,
                minutes_before: fallback?.minutes_before ?? null,
                signals:        fallback?.signals ?? [],
              });
            }
          };

          pushSignals(downPatterns, 'DOWN', resistance, s40.resistance, s40.resistance_reversal);
          pushSignals(upPatterns,   'UP',   support,    s40.support,    s40.support_reversal);
        });
      });

      resistance.sort((a, b) => (b.trade_score || 0) - (a.trade_score || 0) || (a.trade_time || '').localeCompare(b.trade_time || ''));
      support.sort((a, b)    => (b.trade_score || 0) - (a.trade_score || 0) || (a.trade_time || '').localeCompare(b.trade_time || ''));

      return { resistance, support };
    } catch(e) { return null; }
  }

  function refreshLiveAiSignalCache() {
    try {
      const dataRoot = PATHS.MARKET;
      const today    = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];

      // If market is open and today's _trainai.json is missing for any symbol, trigger analysis
      if (isMarketHoursIST() && !_runStatus.running) {
        let todayMissing = false;
        folders(dataRoot).forEach(sym => {
          if (todayMissing) return;
          folders(path.join(dataRoot, sym)).forEach(exp => {
            if (todayMissing) return;
            const datePath = path.join(dataRoot, sym, exp, today);
            if (fs.existsSync(datePath) && !fs.existsSync(path.join(datePath, '_trainai.json'))) {
              todayMissing = true;
            }
          });
        });
        if (todayMissing) {
          console.log('[TrainAI] Live cache: today missing _trainai.json — triggering analysis...');
          _runStatus.running = true;
          setImmediate(() => runAllAnalysis(false));
        }
      }

      // Find latest date across all symbols that has a _trainai.json
      const dateSet = new Set();
      folders(dataRoot).forEach(sym => {
        folders(path.join(dataRoot, sym)).forEach(exp => {
          folders(path.join(dataRoot, sym, exp)).forEach(dt => {
            if (fs.existsSync(path.join(dataRoot, sym, exp, dt, '_trainai.json'))) dateSet.add(dt);
          });
        });
      });
      if (!dateSet.size) return;
      const latestDate = [...dateSet].sort().at(-1);
      const result = computeAiSignals(latestDate);
      if (result) {
        _liveAiCache = { data: { success: true, date: latestDate, ...result }, ts: Date.now(), date: latestDate };
      }
    } catch(e) {}
  }

  // Initial warm-up + every 60 s refresh
  setTimeout(() => {
    refreshLiveAiSignalCache();
    setInterval(refreshLiveAiSignalCache, 60_000);
  }, 8000);

  // GET live AI Stock signals — served from RAM, refreshed every 60 s
  app.get('/api/trainai/stock-signals/live', authCheck, adminOrMember, (req, res) => {
    // If market is open and today's analysis hasn't run yet, trigger immediately
    if (isMarketHoursIST() && !_runStatus.running) {
      const dataRoot = PATHS.MARKET;
      const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
      let todayMissing = false;
      folders(dataRoot).forEach(sym => {
        if (todayMissing) return;
        folders(path.join(dataRoot, sym)).forEach(exp => {
          if (todayMissing) return;
          const datePath = path.join(dataRoot, sym, exp, today);
          if (fs.existsSync(datePath) && !fs.existsSync(path.join(datePath, '_trainai.json'))) {
            todayMissing = true;
          }
        });
      });
      if (todayMissing) {
        console.log('[TrainAI] Live endpoint: today missing _trainai.json — triggering immediate analysis...');
        _runStatus.running = true;
        setImmediate(() => runAllAnalysis(false));
      }
    }
    if (_liveAiCache.data) return res.json(_liveAiCache.data);
    // Cache not ready yet — compute on-demand
    refreshLiveAiSignalCache();
    if (_liveAiCache.data) return res.json(_liveAiCache.data);
    res.json({ success: false, resistance: [], support: [] });
  });

  // GET AI Stock signals for a date — all symbols, split resistance/support
  app.get('/api/trainai/stock-signals/:date', authCheck, adminOrMember, (req, res) => {
    const { date } = req.params;
    // Serve from cache when the requested date matches live cache
    if (date === _liveAiCache.date && _liveAiCache.data) return res.json(_liveAiCache.data);
    const result = computeAiSignals(date);
    if (!result) return res.status(500).json({ success: false, resistance: [], support: [] });
    res.json({ success: true, date, ...result });
  });

  // GET all dates that have at least one AI Train result (any symbol)
  app.get('/api/trainai/stock-dates', authCheck, adminOrMember, (req, res) => {
    try {
      const dataRoot = PATHS.MARKET;
      const dateSet  = new Set();
      folders(dataRoot).forEach(sym => {
        const symDir = path.join(dataRoot, sym);
        folders(symDir).forEach(expiry => {
          folders(path.join(symDir, expiry)).forEach(date => {
            const f = path.join(symDir, expiry, date, '_trainai.json');
            if (fs.existsSync(f)) dateSet.add(date);
          });
        });
      });
      const dates = [...dateSet].sort((a,b) => b.localeCompare(a));
      res.json({ success: true, dates });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // GET indicator access list (any logged-in user)
  app.get('/api/indicators', authCheck, (req, res) => {
    res.json({ success: true, indicators: loadIndicators() });
  });

  // POST save indicator access (admin only)
  app.post('/api/indicators', authCheck, adminOnly, (req, res) => {
    try {
      const { indicators } = req.body;
      if (!Array.isArray(indicators)) return res.status(400).json({ error: 'Invalid payload' });
      saveIndicators(indicators);
      res.json({ success: true, message: 'Indicator settings saved' });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Start auto schedule
  scheduleAutoRun();
};

module.exports.runAllAnalysis  = runAllAnalysis;
module.exports.analyzeDay      = analyzeDay;
module.exports.loadIndicators  = loadIndicators;
