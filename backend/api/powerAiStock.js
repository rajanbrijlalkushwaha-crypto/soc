// API/powerAiStock.js
// ═══════════════════════════════════════════════════════════════════
// POWER AI STOCK FILTER ENGINE  —  AUTO-FETCH EDITION
// ───────────────────────────────────────────────────────────────────
// NEW FEATURES vs original:
//   ▸ AUTO-WATCH  : Every 5 seconds checks if any stock folder has new
//                   data files since last scan → triggers incremental scan
//   ▸ DAILY AUDIT : Once every 24 hours scans all date folders across
//                   all symbols to find any missing Power AI Stock results
//                   and fills them in automatically
//
// Criteria (same logic as existing shifting detection):
//
// POWERFUL SUPPORT STOCK (good for BUY from support):
//   PUT side  : Support strike has 100% (vol/OI/OIChg) since morning
//               OR shifted SFBTT (bottom→top) at some point
//               Strike is ATM or within 1 strike of ATM
//   CALL side : Resistance is 2-3 strikes ABOVE support strike
//               NO strike between support and resistance has >60% on CALL side
//               NO shifting on call side since morning (stable resistance)
//
// POWERFUL RESISTANCE STOCK (good for SELL from resistance):
//   CALL side : Resistance strike has 100% (vol/OI/OIChg) since morning
//               OR shifted SFTB (top→bottom) at some point (good)
//               Strike is ATM or within 1 strike of ATM
//   PUT side  : Support is 2-3 strikes BELOW resistance strike
//               NO strike between support and resistance has >60% on PUT side
//               NO shifting SFBTT on put side (stable support below)
//
// Output saved to: Data/Power AI Stock/{DATE}/{symbol}_{expiry}.json
// ═══════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PATHS } = require('../config/paths');

// ─── Re-use helpers from chain.js (copied inline to keep independent) ────────

function getFolders(p) {
  try { return fs.readdirSync(p).filter(x => fs.statSync(path.join(p, x)).isDirectory()); }
  catch (e) { return []; }
}

function getDataFiles(p) {
  try {
    return fs.readdirSync(p).filter(x =>
      (x.endsWith('.json') || x.endsWith('.json.gz')) && !x.startsWith('_')
    );
  } catch (e) { return []; }
}

function parseTimeFromFilename(filename) {
  try {
    const base  = filename.replace('.json.gz', '').replace('.json', '');
    const parts = base.split('_');
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].match(/^\d{2}-\d{2}-\d{2}$/)) return parts[i].replace(/-/g, ':');
    }
    return '00:00:00';
  } catch (e) { return '00:00:00'; }
}

function decompressChainData(oc) {
  if (!oc || !Array.isArray(oc)) return [];
  return oc.map(s => ({
    strike_price: s.s,
    underlying_spot_price: s.u || 0,
    call_options: { market_data: { oi: s.c.oi, prev_oi: s.c.oi - s.c.oc, volume: s.c.v, ltp: s.c.lp } },
    put_options:  { market_data: { oi: s.p.oi, prev_oi: s.p.oi - s.p.oc, volume: s.p.v, ltp: s.p.lp } }
  }));
}

function readChainFile(filePath) {
  if (filePath.endsWith('.gz')) {
    const raw  = zlib.gunzipSync(fs.readFileSync(filePath));
    const cj   = JSON.parse(raw.toString());
    return {
      metadata: { time_hhmmss: cj.m?.time_hhmmss },
      option_chain: decompressChainData(cj.oc || [])
    };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ─── Core snapshot analyser ──────────────────────────────────────────────────

function analyzeSnapshot(chain, spotPrice) {
  const sorted = [...chain].sort((a, b) => a.strike_price - b.strike_price);

  let atmIdx = 0, minDiff = Infinity;
  sorted.forEach((r, i) => {
    const d = Math.abs(r.strike_price - spotPrice);
    if (d < minDiff) { minDiff = d; atmIdx = i; }
  });

  const strikeGap = sorted.length > 1
    ? Math.abs(sorted[1].strike_price - sorted[0].strike_price)
    : 50;

  const winStart = Math.max(0, atmIdx - 12);
  const winEnd   = Math.min(sorted.length, atmIdx + 13);
  const window   = sorted.slice(winStart, winEnd);

  let maxCV = 1, maxCO = 1, maxCOC = 1;
  let maxPV = 1, maxPO = 1, maxPOC = 1;

  window.forEach(r => {
    const cc = r.call_options?.market_data || {};
    const pc = r.put_options?.market_data  || {};
    if ((cc.volume || 0) > maxCV)  maxCV  = cc.volume;
    if ((cc.oi     || 0) > maxCO)  maxCO  = cc.oi;
    const coc = Math.abs((cc.oi || 0) - (cc.prev_oi || 0));
    if (coc > maxCOC) maxCOC = coc;
    if ((pc.volume || 0) > maxPV)  maxPV  = pc.volume;
    if ((pc.oi     || 0) > maxPO)  maxPO  = pc.oi;
    const poc = Math.abs((pc.oi || 0) - (pc.prev_oi || 0));
    if (poc > maxPOC) maxPOC = poc;
  });

  const strikeMap = {};
  window.forEach(r => {
    const s  = r.strike_price;
    const cc = r.call_options?.market_data || {};
    const pc = r.put_options?.market_data  || {};
    strikeMap[s] = {
      call: {
        vol:   Math.round((cc.volume || 0) / maxCV  * 100),
        oi:    Math.round((cc.oi     || 0) / maxCO  * 100),
        oiChg: Math.round(Math.abs((cc.oi || 0) - (cc.prev_oi || 0)) / maxCOC * 100)
      },
      put: {
        vol:   Math.round((pc.volume || 0) / maxPV  * 100),
        oi:    Math.round((pc.oi     || 0) / maxPO  * 100),
        oiChg: Math.round(Math.abs((pc.oi || 0) - (pc.prev_oi || 0)) / maxPOC * 100)
      }
    };
  });

  function strongest(side) {
    const strikes = Object.keys(strikeMap).map(Number).sort((a, b) => a - b);
    const atmStrike = sorted[atmIdx]?.strike_price || spotPrice;
    let search;

    if (side === 'call') {
      const si = strikes.findIndex(s => s >= atmStrike - strikeGap * 2);
      search = si >= 0 ? strikes.slice(si) : strikes;
    } else {
      const ei = strikes.findIndex(s => s > atmStrike + strikeGap * 2);
      search = (ei > 0 ? strikes.slice(0, ei) : [...strikes]).reverse();
    }

    for (const strike of search) {
      const d = strikeMap[strike][side];
      if (d.vol >= 95 || d.oi >= 95 || d.oiChg >= 95) {
        return { strike, vol: d.vol, oi: d.oi, oiChg: d.oiChg };
      }
    }
    return null;
  }

  return {
    atmStrike: sorted[atmIdx]?.strike_price || spotPrice,
    strikeGap,
    strikeMap,
    resistance: strongest('call'),
    support:    strongest('put')
  };
}

// ─── Scan one date folder → full day timeline ────────────────────────────────

function buildDayTimeline(datePath) {
  const files = getDataFiles(datePath).sort();
  if (files.length === 0) return null;

  const timeline = [];
  let started = false;

  for (const file of files) {
    try {
      const data = readChainFile(path.join(datePath, file));
      if (!data.option_chain || data.option_chain.length === 0) continue;

      const spot    = data.option_chain[0].underlying_spot_price || 0;
      const timeStr = data.metadata?.time_hhmmss || parseTimeFromFilename(file);

      if (timeStr < '09:15:00' && !started) continue;
      started = true;

      const snap = analyzeSnapshot(data.option_chain, spot);
      timeline.push({ time: timeStr, spot, snap });
    } catch (e) { /* skip bad files */ }
  }

  return timeline.length >= 2 ? timeline : null;
}

// ─── Power AI criteria evaluation ────────────────────────────────────────────

function evaluatePowerCriteria(timeline) {
  if (!timeline || timeline.length < 2) return null;

  const first = timeline[0].snap;
  const last  = timeline[timeline.length - 1].snap;
  const sg    = first.strikeGap || 50;

  let prevRes = null, prevSup = null;
  const callShifts = [];
  const putShifts  = [];

  for (const { time, snap } of timeline) {
    if (snap.resistance && prevRes !== null && snap.resistance.strike !== prevRes) {
      callShifts.push({
        from: prevRes,
        to:   snap.resistance.strike,
        type: snap.resistance.strike > prevRes ? 'SFBTT' : 'SFTB',
        time
      });
    }
    if (snap.support && prevSup !== null && snap.support.strike !== prevSup) {
      putShifts.push({
        from: prevSup,
        to:   snap.support.strike,
        type: snap.support.strike > prevSup ? 'SFBTT' : 'SFTB',
        time
      });
    }
    prevRes = snap.resistance?.strike ?? prevRes;
    prevSup = snap.support?.strike    ?? prevSup;
  }

  const latestRes    = last.resistance;
  const latestSup    = last.support;
  const latestStrMap = last.strikeMap;

  function isStrong(stk, side) {
    const d = latestStrMap[stk]?.[side];
    return d && (d.vol >= 95 || d.oi >= 95 || d.oiChg >= 95);
  }

  function maxPctBetween(low, high, side) {
    let mx = 0;
    for (const [k, v] of Object.entries(latestStrMap)) {
      const stk = Number(k);
      if (stk > low && stk < high) {
        const d = v[side];
        mx = Math.max(mx, d.vol, d.oi, d.oiChg);
      }
    }
    return mx;
  }

  function supportConsistency(targetStrike) {
    let count = 0;
    for (const { snap } of timeline) {
      if (snap.support?.strike === targetStrike) count++;
    }
    return count / timeline.length;
  }

  function resistanceConsistency(targetStrike) {
    let count = 0;
    for (const { snap } of timeline) {
      if (snap.resistance?.strike === targetStrike) count++;
    }
    return count / timeline.length;
  }

  function snapshotQualifiesSupport(snap, putShiftsSoFar, callShiftsSoFar) {
    if (!snap.support || !snap.resistance) return false;
    const supStr = snap.support.strike;
    const resStr = snap.resistance.strike;
    const diff   = resStr - supStr;
    const apart  = Math.round(diff / sg);
    const sMap   = snap.strikeMap || {};
    const supNearATM   = Math.abs(supStr - snap.atmStrike) <= sg;
    const resAbove2to3 = apart >= 2 && apart <= 3 && diff > 0;
    const putD         = sMap[supStr]?.put;
    const putStrong    = putD && (putD.vol >= 95 || putD.oi >= 95 || putD.oiChg >= 95);
    const hasSFBTT     = putShiftsSoFar.some(s => s.type === 'SFBTT');
    const supValid     = putStrong || hasSFBTT;
    let mx = 0;
    for (const [k, v] of Object.entries(sMap)) {
      const stk = Number(k);
      if (stk > supStr && stk < resStr) mx = Math.max(mx, v.call.vol, v.call.oi, v.call.oiChg);
    }
    const noCallShifting = callShiftsSoFar.length === 0;
    return supNearATM && resAbove2to3 && supValid && mx <= 60 && noCallShifting;
  }

  function snapshotQualifiesResistance(snap, putShiftsSoFar, callShiftsSoFar) {
    if (!snap.resistance || !snap.support) return false;
    const resStr = snap.resistance.strike;
    const supStr = snap.support.strike;
    const diff   = resStr - supStr;
    const apart  = Math.round(diff / sg);
    const sMap   = snap.strikeMap || {};
    const resNearATM   = Math.abs(resStr - snap.atmStrike) <= sg;
    const supBelow2to3 = apart >= 2 && apart <= 3 && diff > 0;
    const callD        = sMap[resStr]?.call;
    const callStrong   = callD && (callD.vol >= 95 || callD.oi >= 95 || callD.oiChg >= 95);
    const hasSFTB      = callShiftsSoFar.some(s => s.type === 'SFTB');
    const resValid     = callStrong || hasSFTB;
    let mx = 0;
    for (const [k, v] of Object.entries(sMap)) {
      const stk = Number(k);
      if (stk > supStr && stk < resStr) mx = Math.max(mx, v.put.vol, v.put.oi, v.put.oiChg);
    }
    const noPutSFBTT = !putShiftsSoFar.some(s => s.type === 'SFBTT');
    return resNearATM && supBelow2to3 && resValid && mx <= 60 && noPutSFBTT;
  }

  const QUALIFY_FROM = '09:20:00';
  let firstQualifiedTimeSup = null;
  let firstQualifiedTimeRes = null;
  {
    let pRes = null, pSup = null;
    const cShiftsSoFar = [];
    const pShiftsSoFar = [];
    for (const { time, snap } of timeline) {
      if (snap.resistance && pRes !== null && snap.resistance.strike !== pRes) {
        cShiftsSoFar.push({ from: pRes, to: snap.resistance.strike,
          type: snap.resistance.strike > pRes ? 'SFBTT' : 'SFTB', time });
      }
      if (snap.support && pSup !== null && snap.support.strike !== pSup) {
        pShiftsSoFar.push({ from: pSup, to: snap.support.strike,
          type: snap.support.strike > pSup ? 'SFBTT' : 'SFTB', time });
      }
      pRes = snap.resistance?.strike ?? pRes;
      pSup = snap.support?.strike    ?? pSup;

      if (time < QUALIFY_FROM) continue;

      if (!firstQualifiedTimeSup && snapshotQualifiesSupport(snap, pShiftsSoFar, cShiftsSoFar)) {
        firstQualifiedTimeSup = time;
      }
      if (!firstQualifiedTimeRes && snapshotQualifiesResistance(snap, pShiftsSoFar, cShiftsSoFar)) {
        firstQualifiedTimeRes = time;
      }
      if (firstQualifiedTimeSup && firstQualifiedTimeRes) break;
    }
  }

  const details = {
    supportStrike:          latestSup?.strike ?? null,
    resistanceStrike:       latestRes?.strike ?? null,
    atmStrike:              last.atmStrike,
    strikeGap:              sg,
    callShifts,
    putShifts,
    isPowerSupport:         false,
    isPowerResistance:      false,
    supportScore:           0,
    resistanceScore:        0,
    reasons:                [],
    firstQualifiedTimeSup,
    firstQualifiedTimeRes
  };

  // ── POWER SUPPORT CHECK ──────────────────────────────────────────────────────
  if (latestSup && latestRes) {
    const supStrike = latestSup.strike;
    const resStrike = latestRes.strike;
    const strikeDiff = resStrike - supStrike;
    const strikesApart = Math.round(strikeDiff / sg);

    const supNearATM      = Math.abs(supStrike - last.atmStrike) <= sg;
    const resAbove2to3    = strikesApart >= 2 && strikesApart <= 3 && strikeDiff > 0;
    const maxCallBetween  = maxPctBetween(supStrike, resStrike, 'call');
    const noHighCallBetween = maxCallBetween <= 60;
    const putStrong       = isStrong(supStrike, 'put');
    const putHasSFBTT     = putShifts.some(s => s.type === 'SFBTT');
    const supValid        = putStrong || putHasSFBTT;
    const noCallShifting  = callShifts.length === 0;
    const supConsistency  = supportConsistency(supStrike);

    let score = 0;
    const reasons = [];

    if (supNearATM)        { score += 25; reasons.push(`Support ${supStrike} near ATM ${last.atmStrike}`); }
    if (resAbove2to3)      { score += 20; reasons.push(`Resistance ${resStrike} is ${strikesApart} strikes above support`); }
    if (noHighCallBetween) { score += 20; reasons.push(`No CALL >60% between ${supStrike}-${resStrike} (max ${maxCallBetween}%)`); }
    if (putStrong)         { score += 20; reasons.push(`PUT ${supStrike} is 100% strong`); }
    if (putHasSFBTT)       { score += 10; reasons.push(`PUT SFBTT shift detected: ${JSON.stringify(putShifts)}`); }
    if (noCallShifting)    { score += 15; reasons.push('No CALL shifting since morning (stable resistance)'); }
    if (supConsistency > 0.7) { score += 10; reasons.push(`Support consistent ${(supConsistency*100).toFixed(0)}% of day`); }

    details.supportScore = score;

    if (score >= 70 && supValid && supNearATM && resAbove2to3 && noHighCallBetween) {
      details.isPowerSupport = true;
      details.reasons.push(...reasons.map(r => '[SUPPORT] ' + r));
    }
  }

  // ── POWER RESISTANCE CHECK ───────────────────────────────────────────────────
  if (latestRes && latestSup) {
    const resStrike = latestRes.strike;
    const supStrike = latestSup.strike;
    const strikeDiff = resStrike - supStrike;
    const strikesApart = Math.round(strikeDiff / sg);

    const resNearATM       = Math.abs(resStrike - last.atmStrike) <= sg;
    const supBelow2to3     = strikesApart >= 2 && strikesApart <= 3 && strikeDiff > 0;
    const maxPutBetween    = maxPctBetween(supStrike, resStrike, 'put');
    const noHighPutBetween = maxPutBetween <= 60;
    const callStrong       = isStrong(resStrike, 'call');
    const callHasSFTB      = callShifts.some(s => s.type === 'SFTB');
    const resValid         = callStrong || callHasSFTB;
    const noPutSFBTT       = !putShifts.some(s => s.type === 'SFBTT');
    const resConsistency   = resistanceConsistency(resStrike);

    let score = 0;
    const reasons = [];

    if (resNearATM)        { score += 25; reasons.push(`Resistance ${resStrike} near ATM ${last.atmStrike}`); }
    if (supBelow2to3)      { score += 20; reasons.push(`Support ${supStrike} is ${strikesApart} strikes below resistance`); }
    if (noHighPutBetween)  { score += 20; reasons.push(`No PUT >60% between ${supStrike}-${resStrike} (max ${maxPutBetween}%)`); }
    if (callStrong)        { score += 20; reasons.push(`CALL ${resStrike} is 100% strong`); }
    if (callHasSFTB)       { score += 10; reasons.push(`CALL SFTB shift detected: ${JSON.stringify(callShifts)}`); }
    if (noPutSFBTT)        { score += 15; reasons.push('PUT has no SFBTT shift (stable / SFTB only)'); }
    if (resConsistency > 0.7) { score += 10; reasons.push(`Resistance consistent ${(resConsistency*100).toFixed(0)}% of day`); }

    details.resistanceScore = score;

    if (score >= 70 && resValid && resNearATM && supBelow2to3 && noHighPutBetween) {
      details.isPowerResistance = true;
      details.reasons.push(...reasons.map(r => '[RESISTANCE] ' + r));
    }
  }

  return details;
}

// ─── Main scanner: one symbol/expiry/date ────────────────────────────────────

function scanOneDate(symbol, expiry, date, dataRoot) {
  const safeSymbol = symbol.toUpperCase().replace(/\s+/g, '_');
  const datePath   = path.join(dataRoot, safeSymbol, expiry, date);
  if (!fs.existsSync(datePath)) return null;

  const timeline = buildDayTimeline(datePath);
  if (!timeline) return null;

  const result = evaluatePowerCriteria(timeline);
  if (!result) return null;

  const last = timeline[timeline.length - 1];

  const firstTimeSup = result.firstQualifiedTimeSup || timeline[0].time;
  const firstTimeRes = result.firstQualifiedTimeRes || timeline[0].time;
  const firstTime    = result.isPowerSupport    ? firstTimeSup
                     : result.isPowerResistance ? firstTimeRes
                     : timeline[0].time;

  return {
    symbol,
    expiry,
    date,
    spot:              last.spot,
    atmStrike:         result.atmStrike,
    strikeGap:         result.strikeGap,
    supportStrike:     result.supportStrike,
    resistanceStrike:  result.resistanceStrike,
    isPowerSupport:    result.isPowerSupport,
    isPowerResistance: result.isPowerResistance,
    supportScore:      result.supportScore,
    resistanceScore:   result.resistanceScore,
    callShifts:        result.callShifts,
    putShifts:         result.putShifts,
    reasons:           result.reasons,
    snapshotCount:     timeline.length,
    firstTime,
    firstTimeSup,
    firstTimeRes,
    lastTime:          last.time
  };
}

// ─── Save result to Data/Power AI Stock/{date}/{symbol}_{expiry}.json ────────

function saveResult(result, dataRoot) {
  if (!result) return;

  const outDir = path.join(dataRoot, 'Power AI Stock', result.date);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const safeSym  = result.symbol.toUpperCase().replace(/\s+/g, '_');
  const fileName = `${safeSym}_${result.expiry}.json`;
  const outPath  = path.join(outDir, fileName);

  fs.writeFileSync(outPath, JSON.stringify({
    ...result,
    generated_at: new Date().toISOString()
  }, null, 2));

  return outPath;
}

// ─── Save day summary ─────────────────────────────────────────────────────────

function saveDaySummary(date, allResults, dataRoot) {
  const outDir = path.join(dataRoot, 'Power AI Stock', date);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const powerSupport    = allResults.filter(r => r.isPowerSupport);
  const powerResistance = allResults.filter(r => r.isPowerResistance);
  const both            = allResults.filter(r => r.isPowerSupport && r.isPowerResistance);

  const summary = {
    date,
    generated_at:     new Date().toISOString(),
    total_scanned:    allResults.length,
    power_support:    powerSupport.map(r => {
      const sg  = r.strikeGap || 50;
      const rev = r.supportStrike != null && r.spot != null
        ? r.supportStrike + Math.round((r.spot - r.supportStrike) * 0.5 / sg) * sg
        : null;
      return {
        symbol:          r.symbol,
        expiry:          r.expiry,
        spot:            r.spot,
        firstTime:       r.firstTimeSup || r.firstTime,
        support:         r.supportStrike,
        supportReversal: rev,
        resistance:      r.resistanceStrike,
        strikeGap:       sg,
        score:           r.supportScore
      };
    }),
    power_resistance: powerResistance.map(r => {
      const sg  = r.strikeGap || 50;
      const rev = r.resistanceStrike != null && r.spot != null
        ? r.resistanceStrike - Math.round((r.resistanceStrike - r.spot) * 0.5 / sg) * sg
        : null;
      return {
        symbol:               r.symbol,
        expiry:               r.expiry,
        spot:                 r.spot,
        firstTime:            r.firstTimeRes || r.firstTime,
        support:              r.supportStrike,
        resistance:           r.resistanceStrike,
        resistanceReversal:   rev,
        strikeGap:            sg,
        score:                r.resistanceScore
      };
    }),
    both_criteria: both.map(r => ({
      symbol: r.symbol,
      expiry: r.expiry,
      spot:   r.spot
    }))
  };

  fs.writeFileSync(
    path.join(outDir, '_summary.json'),
    JSON.stringify(summary, null, 2)
  );

  return summary;
}

// ─── Full scan: all symbols → all expiries → target date ─────────────────────

function runPowerAIScan(targetDate, dataRoot) {
  // Track ALL results (power or not) — needed for correct total_scanned in summary
  const allResults = [];
  const symbols = getFolders(dataRoot).filter(s => s !== 'Power AI Stock');

  for (const symbol of symbols) {
    const expiries = getFolders(path.join(dataRoot, symbol));

    for (const expiry of expiries) {
      const dates = getFolders(path.join(dataRoot, symbol, expiry));

      const datesToScan = targetDate === 'ALL'
        ? dates
        : dates.filter(d => d === targetDate);

      for (const date of datesToScan) {
        try {
          const result = scanOneDate(symbol, expiry, date, dataRoot);
          if (!result) continue;

          saveResult(result, dataRoot);
          allResults.push(result); // push ALL results for correct total_scanned
        } catch (e) { /* skip errors silently */ }
      }
    }
  }

  if (targetDate !== 'ALL') {
    // Single date: save summary with all scanned results
    const summary = saveDaySummary(targetDate, allResults, dataRoot);
    return summary;
  }

  // ALL mode: group by date and save a summary per date
  const byDate = {};
  for (const r of allResults) {
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(r);
  }
  for (const [date, results] of Object.entries(byDate)) {
    try { saveDaySummary(date, results, dataRoot); } catch(e) {}
  }
  return allResults;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTO-WATCH ENGINE
//  ─────────────────
//  ON EVERY SERVER REBOOT:
//     • Full scan of ALL Data/{symbol}/{expiry}/{date}/ folders
//     • Saves/overwrites every result and every _summary.json
//     • Runs in background with 150ms stagger (won't block server)
//
//  LIVE WATCHER  (every 5 seconds, starts after boot scan completes)
//     • Checks each Data/{symbol}/{expiry}/{TODAY}/ folder
//     • Compares file count against last-known count stored in watchState
//     • If new files found → re-scan that symbol/expiry for today
//     • Updates _summary.json for today
//
//  DAILY AUDIT   (every 24 hours after first boot scan)
//     • Walks ALL Data/{symbol}/{expiry}/{date}/ folders
//     • Checks if Power AI Stock/{date}/{symbol}_{expiry}.json exists
//     • Any missing → scan and fill in
//     • Runs sequentially with 150ms gaps to avoid CPU spike
// ═══════════════════════════════════════════════════════════════════════════════

function startAutoWatch(dataRoot) {
  // ── Shared state ─────────────────────────────────────────────────────────────
  // watchState[symbol][expiry] = { fileCount: N, lastScanAt: timestamp }
  const watchState = {};
  // Always use IST date — data folders are named in IST (UTC+5:30)
  const today = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];

  // ── LIVE WATCHER — runs every 5 seconds ──────────────────────────────────────
  function liveWatch() {
    const date    = today();
    const symbols = getFolders(dataRoot).filter(s => s !== 'Power AI Stock');
    const changed = []; // collect {symbol, expiry} pairs that have new data

    for (const symbol of symbols) {
      if (!watchState[symbol]) watchState[symbol] = {};

      const expiries = getFolders(path.join(dataRoot, symbol));
      for (const expiry of expiries) {
        const datePath  = path.join(dataRoot, symbol, expiry, date);
        const fileCount = getDataFiles(datePath).length;
        const prev      = watchState[symbol][expiry];

        if (!prev) {
          // First time we see this symbol/expiry — record count, don't scan yet
          watchState[symbol][expiry] = { fileCount, lastScanAt: 0 };
          continue;
        }

        if (fileCount > prev.fileCount) {
          // New file(s) arrived — queue a rescan
          changed.push({ symbol, expiry, date });
          watchState[symbol][expiry].fileCount    = fileCount;
          watchState[symbol][expiry].lastScanAt   = Date.now();
        }
      }
    }

    if (changed.length > 0) {
      // Rescan changed symbol/expiries and collect ALL results (power or not)
      const rescannedResults = [];

      for (const { symbol, expiry, date: d } of changed) {
        try {
          const result = scanOneDate(symbol, expiry, d, dataRoot);
          if (result) {
            saveResult(result, dataRoot);
            rescannedResults.push(result); // push ALL, not just power stocks
          }
        } catch (e) { /* silent */ }
      }

      // Merge with already-saved today results (ALL files, not just power stocks)
      // to rebuild a complete summary with correct total_scanned
      try {
        const powerDir = path.join(dataRoot, 'Power AI Stock', today());
        const existing = fs.existsSync(powerDir)
          ? getDataFiles(powerDir)
              .filter(f => !f.startsWith('_'))
              .map(f => {
                try { return JSON.parse(fs.readFileSync(path.join(powerDir, f), 'utf8')); }
                catch (e) { return null; }
              })
              .filter(Boolean)
          : [];

        // Replace rescanned entries, keep the rest — ALL results for total_scanned
        const rescannedKeys = new Set(changed.map(c => `${c.symbol}_${c.expiry}`));
        const merged = [
          ...existing.filter(r => !rescannedKeys.has(`${r.symbol}_${r.expiry}`)),
          ...rescannedResults
        ];

        saveDaySummary(today(), merged, dataRoot);
      } catch (e) { /* silent */ }
    }
  }

  // ── DAILY AUDIT — runs once at startup then every 24 hours ──────────────────
  function dailyAudit() {
    const powerDir = path.join(dataRoot, 'Power AI Stock');
    const symbols  = getFolders(dataRoot).filter(s => s !== 'Power AI Stock');
    const missing  = []; // { symbol, expiry, date }

    for (const symbol of symbols) {
      const safeSym  = symbol.toUpperCase().replace(/\s+/g, '_');
      const expiries = getFolders(path.join(dataRoot, symbol));

      for (const expiry of expiries) {
        const dates = getFolders(path.join(dataRoot, symbol, expiry));

        for (const date of dates) {
          const expected = path.join(powerDir, date, `${safeSym}_${expiry}.json`);
          if (!fs.existsSync(expected)) {
            missing.push({ symbol, expiry, date });
          }
        }
      }
    }

    if (missing.length === 0) {
      return;
    }

    // Process missing entries with a small stagger to avoid CPU spike
    let idx = 0;
    function processNext() {
      if (idx >= missing.length) return;
      const { symbol, expiry, date } = missing[idx++];
      try {
        const result = scanOneDate(symbol, expiry, date, dataRoot);
        if (result) saveResult(result, dataRoot);
      } catch (e) { /* silent */ }
      setTimeout(processNext, 150);
    }
    processNext();
  }

  // ── BOOT FULL SCAN — runs ONCE on every server reboot ───────────────────────
  // Scans ALL symbols / expiries / dates and saves/overwrites every result.
  // Also rebuilds _summary.json for every date found.
  // Runs in background with 150ms stagger so server stays responsive.
  // After boot scan finishes → starts the live watcher + schedules daily audit.
  function bootFullScan(onComplete) {
    console.log('[PowerAI] 🚀 Boot scan started — scanning ALL data...');

    const symbols = getFolders(dataRoot).filter(s => s !== 'Power AI Stock');

    // Build flat list of all {symbol, expiry, date} to process
    const allWork = [];
    for (const symbol of symbols) {
      const expiries = getFolders(path.join(dataRoot, symbol));
      for (const expiry of expiries) {
        const dates = getFolders(path.join(dataRoot, symbol, expiry));
        for (const date of dates) {
          allWork.push({ symbol, expiry, date });
        }
      }
    }

    if (allWork.length === 0) {
      console.log('[PowerAI] ⚠️  No data found during boot scan.');
      onComplete();
      return;
    }

    console.log(`[PowerAI] Boot scan: ${allWork.length} symbol/expiry/date combinations to process.`);

    // Track results per date so we can rebuild summaries
    const resultsByDate = {}; // date → [result, ...]

    let idx = 0;
    function processNext() {
      if (idx >= allWork.length) {
        // All done — rebuild _summary.json for every date that had results
        const dates = Object.keys(resultsByDate).sort();
        for (const date of dates) {
          try {
            saveDaySummary(date, resultsByDate[date], dataRoot);
          } catch (e) { /* silent */ }
        }
        // Always ensure today's summary folder exists (even if empty) so
        // today appears in the /api/power-ai/dates dropdown immediately
        const todayIST = today();
        const todaySummaryPath = path.join(dataRoot, 'Power AI Stock', todayIST, '_summary.json');
        if (!fs.existsSync(todaySummaryPath)) {
          try { saveDaySummary(todayIST, [], dataRoot); } catch (e) { /* silent */ }
        }
        console.log(`[PowerAI] ✅ Boot scan complete. Processed ${allWork.length} entries across ${dates.length} dates.`);
        onComplete();
        return;
      }

      const { symbol, expiry, date } = allWork[idx++];
      try {
        const result = scanOneDate(symbol, expiry, date, dataRoot);
        if (result) {
          saveResult(result, dataRoot);
          if (!resultsByDate[date]) resultsByDate[date] = [];
          // Push ALL results (power or not) so total_scanned is correct in summary
          resultsByDate[date].push(result);
        }
      } catch (e) { /* silent */ }

      setTimeout(processNext, 150); // stagger to avoid CPU spike
    }
    processNext();
  }

  // ── Startup sequence ─────────────────────────────────────────────────────────
  // Wait 5s so server is fully ready, then:
  //   1. Run FULL boot scan (ALL data, old + new) — overwrites everything
  //   2. After boot scan finishes → seed watchState + start live watcher
  //   3. Schedule daily audit every 24h (fills only newly missing entries)
  setTimeout(() => {

    bootFullScan(() => {
      // Boot scan done — now seed watchState with current file counts
      const date    = today();
      const symbols = getFolders(dataRoot).filter(s => s !== 'Power AI Stock');
      for (const symbol of symbols) {
        if (!watchState[symbol]) watchState[symbol] = {};
        const expiries = getFolders(path.join(dataRoot, symbol));
        for (const expiry of expiries) {
          const datePath  = path.join(dataRoot, symbol, expiry, date);
          const fileCount = getDataFiles(datePath).length;
          watchState[symbol][expiry] = { fileCount, lastScanAt: Date.now() };
        }
      }

      // Start live watcher every 5 seconds
      setInterval(liveWatch, 5000);
      console.log('[PowerAI] 👀 Live watcher started (every 5s).');

      // Run daily audit every 24 hours (only fills gaps, doesn't rescan everything)
      setInterval(dailyAudit, 24 * 60 * 60 * 1000);
      console.log('[PowerAI] 🕐 Daily audit scheduled (every 24h).');
    });

  }, 5000); // 5s after server start
}

// ─── Express routes ───────────────────────────────────────────────────────────

module.exports = function(app) {

  const DATA_ROOT = PATHS.MARKET;

  // ── GET /api/power-ai/scan/:date
  app.get('/api/power-ai/scan/:date', (req, res) => {
    try {
      let date = req.params.date;
      if (date === 'today') date = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];

      const result = runPowerAIScan(date, DATA_ROOT);
      res.json({ success: true, date, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/power-ai/scan-all
  app.get('/api/power-ai/scan-all', (req, res) => {
    try {
      const results = runPowerAIScan('ALL', DATA_ROOT);
      res.json({ success: true, total: results.length, results });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/power-ai/results/:date
  app.get('/api/power-ai/results/:date', (req, res) => {
    try {
      let date = req.params.date;
      if (date === 'today') date = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];

      const summaryPath = path.join(DATA_ROOT, 'Power AI Stock', date, '_summary.json');

      if (!fs.existsSync(summaryPath)) {
        const result = runPowerAIScan(date, DATA_ROOT);
        return res.json({ success: true, fresh: true, date, ...result });
      }

      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      res.json({ success: true, fresh: false, ...summary });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/power-ai/stock/:date/:symbol/:expiry
  app.get('/api/power-ai/stock/:date/:symbol/:expiry', (req, res) => {
    try {
      let { date, symbol, expiry } = req.params;
      if (date === 'today') date = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];

      const safeSym  = symbol.toUpperCase().replace(/\s+/g, '_');
      const filePath = path.join(DATA_ROOT, 'Power AI Stock', date, `${safeSym}_${expiry}.json`);

      if (!fs.existsSync(filePath)) {
        const result = scanOneDate(symbol, expiry, date, DATA_ROOT);
        if (!result) return res.status(404).json({ error: 'No data found' });
        saveResult(result, DATA_ROOT);
        return res.json({ success: true, fresh: true, ...result });
      }

      res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/power-ai/rescan/:date
  app.get('/api/power-ai/rescan/:date', (req, res) => {
    try {
      let date = req.params.date;
      if (date === 'today') date = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
      const result = runPowerAIScan(date, DATA_ROOT);
      res.json({ success: true, rescanned: true, date, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/power-ai/rescan-all-old
  app.get('/api/power-ai/rescan-all-old', (req, res) => {
    try {
      const powerDir = path.join(DATA_ROOT, 'Power AI Stock');
      if (!fs.existsSync(powerDir)) return res.json({ success: true, total: 0 });
      const dates = getFolders(powerDir).sort();
      let rescanned = 0;
      for (const date of dates) {
        try { runPowerAIScan(date, DATA_ROOT); rescanned++; } catch(e) {}
      }
      res.json({ success: true, rescanned, dates });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/power-ai/dates
  app.get('/api/power-ai/dates', (req, res) => {
    try {
      const powerDir = path.join(DATA_ROOT, 'Power AI Stock');
      if (!fs.existsSync(powerDir)) return res.json([]);
      const dates = getFolders(powerDir).sort().reverse();
      res.json(dates);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── GET /api/power-ai/watch-status
  // Shows live watcher health — useful for debugging
  app.get('/api/power-ai/watch-status', (req, res) => {
    res.json({
      success:     true,
      message:     'On reboot: full ALL scan runs automatically. Then: live watch every 5s + daily audit every 24h.',
      server_time: new Date().toISOString()
    });
  });

  // ── Start auto-watch engine ──────────────────────────────────────────────────
  startAutoWatch(DATA_ROOT);

};

// ─── Direct run support: node powerAiStock.js [date] ─────────────────────────
if (require.main === module) {
  const DATA_ROOT  = path.join(__dirname, '..', 'Data');
  const targetDate = process.argv[2] || new Date().toISOString().split('T')[0];
  runPowerAIScan(targetDate === 'all' ? 'ALL' : targetDate, DATA_ROOT);
}

// Export for use in other modules
module.exports.runPowerAIScan = runPowerAIScan;
module.exports.scanOneDate    = scanOneDate;