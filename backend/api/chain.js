// API/chain.js
const fs = require("fs");
const path = require("path");
const zlib = require('zlib');
const liveCache = require('../liveCache');
const { PATHS } = require('../config/paths');

function resolveSymbol(sym) {
  return String(sym).toUpperCase().replace(/\s+/g, '_');
}

function folders(p){
  try {
    return fs.readdirSync(p).filter(x=>fs.statSync(path.join(p,x)).isDirectory());
  } catch (e) {
    return [];
  }
}


function files(p){ 
  try {
    return fs.readdirSync(p).filter(x => 
      (x.endsWith(".json") || x.endsWith(".json.gz")) && !x.startsWith("_")
    );
  } catch (e) {
    return [];
  }
}

function parseTimeFromFilename(filename) {
  try {
    // Remove .json.gz or .json extension
    const baseName = filename.replace('.json.gz', '').replace('.json', '');
    const parts = baseName.split('_');
    
    // NEW FORMAT: SYMBOL_EXPIRY_YYYY-MM-DD_HH-MM-SS
    // The time part should be the last part after splitting by _
    const timePart = parts[parts.length - 1];
    
    // Check if it matches HH-MM-SS format
    if (timePart && timePart.match(/^\d{2}-\d{2}-\d{2}$/)) {
      // Convert HH-MM-SS to HH:MM:SS
      return timePart.replace(/-/g, ':');
    }
    
    // Fallback: try to find time pattern anywhere in parts
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].match(/^\d{2}-\d{2}-\d{2}$/)) {
        return parts[i].replace(/-/g, ':');
      }
    }
    
    return "00:00:00";
  } catch (e) {
    return "00:00:00";
  }
}

// Helper: Decompress chain data
// FIXED: Added IV (Implied Volatility) field
function decompressChainData(compressedData) {
  if (!compressedData || !Array.isArray(compressedData)) return [];
  
  return compressedData.map(strike => {
    return {
      strike_price: strike.s,
      underlying_spot_price: strike.u || 0,
      call_options: {
        market_data: {
          oi: strike.c.oi,
          prev_oi: strike.c.oi - strike.c.oc,
          volume: strike.c.v,
          ltp: strike.c.lp,
          close_price: strike.c.lp - strike.c.lc
        },
        option_greeks: {
          pop: strike.c.po,
          theta: strike.c.th,
          gamma: strike.c.ga,
          vega: strike.c.ve,
          delta: strike.c.de,
          iv: strike.c.iv || 0  // IMPLIED VOLATILITY - NEW
        }
      },
      put_options: {
        market_data: {
          oi: strike.p.oi,
          prev_oi: strike.p.oi - strike.p.oc,
          volume: strike.p.v,
          ltp: strike.p.lp,
          close_price: strike.p.lp - strike.p.lc
        },
        option_greeks: {
          pop: strike.p.po,
          theta: strike.p.th,
          gamma: strike.p.ga,
          vega: strike.p.ve,
          delta: strike.p.de,
          iv: strike.p.iv || 0  // IMPLIED VOLATILITY - NEW
        }
      }
    };
  });
}

// Helper: Read and parse compressed or uncompressed file
function readOptionChainFile(filePath) {
  try {
    let data;
    
    if (filePath.endsWith('.gz')) {
      // Read compressed file
      const compressedData = fs.readFileSync(filePath);
      const decompressedData = zlib.gunzipSync(compressedData);
      const compressedJson = JSON.parse(decompressedData.toString());
      
      // Extract data from compressed format
      data = {
        metadata: {
          instrument: compressedJson.m?.i,
          instrument_name: compressedJson.m?.in,
          expiry_date: compressedJson.m?.e,
          fetched_at_utc: compressedJson.m?.fu,
          fetched_at_ist: compressedJson.m?.fi,
          fetched_at_ist_iso: compressedJson.m?.fi_iso,
          strikes_count: compressedJson.m?.sc,
          source: compressedJson.m?.s,
          timezone: compressedJson.m?.tz,
          lot_size: compressedJson.m?.lot_size || 1,
          time_hhmmss: compressedJson.m?.time_hhmmss
        },
        analysis: compressedJson.a,
        option_chain: decompressChainData(compressedJson.oc || [])
      };
    } else {
      // Read uncompressed file
      const fileContent = fs.readFileSync(filePath, "utf8");
      data = JSON.parse(fileContent);
    }
    
    return data;
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error.message}`);
  }
}

// ── Signal RAM cache ─────────────────────────────────────────────────────────
// Serves shifting + MCTR + strategy40 for live symbol from memory.
// Populated on each /api/signals/live request; refreshed every 5 s by TTL.
const _sigCache = new Map(); // symbol → { data, ts }

function safeReadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(_) { return null; }
}

module.exports = function(app){

  // ============ FRONTEND API ENDPOINTS ============

  // Get all symbols (for both live and historical)
app.get("/api/symbols", (req, res) => {
  try {
    const dataPath = PATHS.MARKET;


    // If Data folder does not exist, return empty array (JSON safe)
    if (!fs.existsSync(dataPath)) {
      return res.json([]);
    }

    // Read only folders (symbols)
    const symbols = fs.readdirSync(dataPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name.toUpperCase());


    // ALWAYS return JSON array
    res.setHeader("Content-Type", "application/json");
    res.status(200).json(symbols);

  } catch (err) {

    // Even on error → return valid JSON (frontend will never break)
    res.status(200).json([]);
  }
});


  // Get available expiries for live data (for dropdown)
  app.get("/api/live/expiries/:symbol", (req, res) => {
    try {
      const symbol = req.params.symbol;
      const safeSymbol = resolveSymbol(symbol);
      const symbolPath = path.join(PATHS.MARKET, safeSymbol);
      
      if (!fs.existsSync(symbolPath)) {
        return res.status(404).json({ error: "Symbol not found" });
      }
      
      // Get all expiry folders
      const expiryFolders = folders(symbolPath).sort();
      
      // Get today's date
      const today = new Date().toISOString().split('T')[0];
      
      // Filter to get expiries with today's data
      const expiriesWithTodayData = [];
      
      for (const expiry of expiryFolders) {
        const expiryPath = path.join(symbolPath, expiry);
        const dateFolders = folders(expiryPath).sort();
        const latestDate = dateFolders.at(-1);
        
        // Only include if has today's data
        if (latestDate === today) {
          expiriesWithTodayData.push({
            expiry: expiry,
            isCurrentExpiry: expiry === today,
            isExpiryDay: expiry === today
          });
        }
      }
      
      // Also get future expiries (even if no today's data yet)
      const futureExpiries = expiryFolders.filter(exp => exp >= today);
      
      res.json({
        symbol: symbol,
        today: today,
        isExpiryDay: futureExpiries[0] === today,
        currentExpiry: futureExpiries[0] || expiryFolders.at(-1),
        nextExpiry: futureExpiries[1] || null,
        expiriesWithTodayData: expiriesWithTodayData,
        allExpiries: expiryFolders
      });
      
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get latest live data for a symbol (with optional expiry selection)
  app.get("/api/live/:symbol", (req, res) => {
    try {
      // Normalize: resolve actual folder name (case-insensitive match against Data/)
      const safeSymbol = resolveSymbol(req.params.symbol);
      const requestedExpiry = req.query.expiry; // Optional: specific expiry

      // ── RAM CACHE HIT ──────────────────────────────────────────────────────
      // liveCache keys use original folder casing (e.g. "Nifty_50").
      // Try exact match first, then case-insensitive fallback.
      if (!requestedExpiry) {
        if (liveCache.has(safeSymbol)) {
          return res.json(liveCache.get(safeSymbol));
        }
        // Case-insensitive fallback (frontend may send uppercased symbol)
        const lowerReq = safeSymbol.toLowerCase();
        for (const [k, v] of liveCache.entries()) {
          if (k.toLowerCase() === lowerReq) return res.json(v);
        }
      }
      // ── END CACHE HIT ──────────────────────────────────────────────────────

      // Find the latest file for this symbol — scan Data/ for case-insensitive match
      const dataDir = PATHS.MARKET;
      const lowerReq = safeSymbol.toLowerCase();
      const actualFolder = fs.existsSync(dataDir)
        ? (fs.readdirSync(dataDir).find(d => d.toLowerCase() === lowerReq) || safeSymbol)
        : safeSymbol;
      const symbolPath = path.join(dataDir, actualFolder);
      
      if (!fs.existsSync(symbolPath)) {
        return res.status(404).json({
          error: `No data found for symbol: ${safeSymbol}`,
          suggestions: ["Check if symbol exists", "Data may not be loaded yet"]
        });
      }
      
      // Get all expiry folders
      const expiryFolders = folders(symbolPath).sort();
      
      if (expiryFolders.length === 0) {
        return res.status(404).json({ error: "No expiry data found" });
      }
      
      // Get today's date
      const today = new Date().toISOString().split('T')[0];
      
      // Determine which expiry to use
      let selectedExpiry;
      
      if (requestedExpiry) {
        // User requested specific expiry
        if (expiryFolders.includes(requestedExpiry)) {
          selectedExpiry = requestedExpiry;
        } else {
          return res.status(404).json({ error: `Expiry ${requestedExpiry} not found` });
        }
      } else {
        // Auto-select: Use latest expiry that is >= today (future or current expiry)
        // Filter expiries that are >= today, then pick the first (nearest future expiry)
        const futureExpiries = expiryFolders.filter(exp => exp >= today);
        
        if (futureExpiries.length > 0) {
          // Use the nearest future expiry (first in the filtered list)
          selectedExpiry = futureExpiries[0];
        } else {
          // If no future expiries, use the last (most recent) expiry
          selectedExpiry = expiryFolders[expiryFolders.length - 1];
        }
      }
      
      
      const expiryPath = path.join(symbolPath, selectedExpiry);
      
      // Get all date folders
      const dateFolders = folders(expiryPath).sort();
      
      if (dateFolders.length === 0) {
        return res.status(404).json({ error: "No date data found" });
      }
      
      const latestDate = dateFolders.at(-1);
      
      const datePath = path.join(expiryPath, latestDate);
      
      // Get all JSON files (both compressed and uncompressed)
      const jsonFiles = files(datePath).sort();
      
      if (jsonFiles.length === 0) {
        return res.status(404).json({ error: "No time data found" });
      }
      
      const latestFile = jsonFiles.at(-1);
      
      const filePath = path.join(datePath, latestFile);
      
      // Read and parse the file
      const data = readOptionChainFile(filePath);
      
      // Check if option_chain exists
      if (!data.option_chain || data.option_chain.length === 0) {
        return res.status(404).json({ error: "No option chain data in file" });
      }
      
      
      // Extract spot price and time
      let spotPrice = 0;
      let timeHHMMSS = "00:00:00";
      
      if (data.option_chain && data.option_chain.length > 0) {
        spotPrice = data.option_chain[0].underlying_spot_price || 0;
      }
      
      // Get time from metadata or filename
      if (data.metadata && data.metadata.time_hhmmss) {
        timeHHMMSS = data.metadata.time_hhmmss;
      } else {
        timeHHMMSS = parseTimeFromFilename(latestFile);
      }
      
      
      // Check if today is expiry day and get available expiries
      const futureExpiries = expiryFolders.filter(exp => exp >= today).sort();
      const isExpiryDay = futureExpiries[0] === today;
      
      // Get expiries that have today's data
      const expiriesWithTodayData = [];
      for (const expiry of expiryFolders) {
        const expPath = path.join(symbolPath, expiry);
        const dFolders = folders(expPath).sort();
        if (dFolders.at(-1) === today) {
          expiriesWithTodayData.push(expiry);
        }
      }
      
      // Transform data to match frontend format
      const chain = data.option_chain.map(row => {
        const cc = row.call_options?.market_data || {};
        const pc = row.put_options?.market_data || {};
        const cg = row.call_options?.option_greeks || {};
        const pg = row.put_options?.option_greeks || {};
        
        return {
          strike: row.strike_price,
          call: {
            pop: cg?.pop || 0,
            theta: cg?.theta || 0,
            gamma: cg?.gamma || 0,
            vega: cg?.vega || 0,
            delta: cg?.delta || 0,
            iv: cg?.iv || 0,
            oi_change: (cc.oi || 0) - (cc.prev_oi || 0),
            oi: cc.oi || 0,
            volume: cc.volume || 0,
            ltp: cc.ltp || 0,
            ltp_change: (cc.ltp || 0) - (cc.close_price || 0)
          },
          put: {
            pop: pg?.pop || 0,
            theta: pg?.theta || 0,
            gamma: pg?.gamma || 0,
            vega: pg?.vega || 0,
            delta: pg?.delta || 0,
            iv: pg?.iv || 0,
            oi_change: (pc.oi || 0) - (pc.prev_oi || 0),
            oi: pc.oi || 0,
            volume: pc.volume || 0,
            ltp: pc.ltp || 0,
            ltp_change: (pc.ltp || 0) - (pc.close_price || 0)
          }
        };
      });
      
      
      res.json({
        symbol: safeSymbol,
        expiry: selectedExpiry,
        date: latestDate,
        time: timeHHMMSS,
        spot_price: spotPrice,
        lot_size: data.metadata?.lot_size || 1,
        chain: chain,
        // Additional info for expiry selection
        isExpiryDay: isExpiryDay,
        currentExpiry: futureExpiries[0] || selectedExpiry,
        nextExpiry: futureExpiries[1] || null,
        availableExpiries: expiriesWithTodayData
      });
      
    } catch (error) {
      res.status(500).json({ 
        error: "Failed to load live data",
        message: error.message 
      });
    }
  });

  // ── Combined signals endpoint (shifting + MCTR + strategy40) ─────────────
  // Returns all signal files for the live symbol in ONE request.
  // Uses a 5 s in-memory cache so 100 concurrent users all get served from RAM.
  app.get("/api/signals/live/:symbol", (req, res) => {
    try {
      const symbol = resolveSymbol(req.params.symbol);

      // Check cache (5 s TTL)
      const hit = _sigCache.get(symbol);
      if (hit && Date.now() - hit.ts < 5000) {
        return res.json(hit.data);
      }

      // Resolve latest date path — prefer liveCache, fallback to disk scan
      const live = liveCache.get(symbol);
      let dateDir, resolvedExpiry, resolvedDate;
      if (live) {
        resolvedExpiry = live.expiry;
        resolvedDate   = live.date;
        dateDir = path.join(PATHS.MARKET, symbol, live.expiry, live.date);
      } else {
        // liveCache empty (server just started / market closed) — find latest folder on disk
        const dataRoot = path.join(PATHS.MARKET, symbol);
        const expiryFolders = folders(dataRoot).sort();
        const latestExpiry  = expiryFolders.at(-1);
        if (!latestExpiry) return res.json({ shifting: null, mctr: null, strategy40: null, bromosYesterday: null });
        const expiryPath  = path.join(dataRoot, latestExpiry);
        const dateFolders = folders(expiryPath).sort();
        const latestDate  = dateFolders.at(-1);
        if (!latestDate) return res.json({ shifting: null, mctr: null, strategy40: null, bromosYesterday: null });
        resolvedExpiry = latestExpiry;
        resolvedDate   = latestDate;
        dateDir = path.join(expiryPath, latestDate);
      }
      const shifting   = safeReadJson(path.join(dateDir, '_shifting.json'));
      const mctr       = safeReadJson(path.join(dateDir, '_mctr.json'));
      const strategy40 = safeReadJson(path.join(dateDir, '_chart_strategy40.json'));
      // Previous day locked data — read directly from D-1's _chart_strategy40.json
      // (gap-corrected values are baked in there after server startup regeneration)
      const expiryPathForBromos = path.join(PATHS.MARKET, symbol, resolvedExpiry);
      const allDatesForBromos   = folders(expiryPathForBromos).sort();
      const prevDateIdx         = allDatesForBromos.indexOf(resolvedDate) - 1;
      const bromosYesterday     = prevDateIdx >= 0
        ? safeReadJson(path.join(expiryPathForBromos, allDatesForBromos[prevDateIdx], '_chart_strategy40.json'))
        : null;

      const data = { shifting, mctr, strategy40, bromosYesterday, expiry: resolvedExpiry, date: resolvedDate };
      _sigCache.set(symbol, { data, ts: Date.now() });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============ HISTORICAL DATA ENDPOINTS ============

  // Get all expiry dates for a symbol (historical)
  app.get("/api/historical/expiries/:symbol", (req, res) => {
    try {
      const symbol = req.params.symbol;
      const safeSymbol = resolveSymbol(symbol);
      const p = path.join(PATHS.MARKET, safeSymbol);
      
      if (!fs.existsSync(p)) {
        return res.status(404).json({ error: "Symbol not found" });
      }
      
      const expiries = folders(p).sort();
      res.json(expiries);
    } catch (error) {
      res.status(500).json({ error: "Failed to load expiries" });
    }
  });

  // Get all dates for a symbol and expiry (historical)
  app.get("/api/historical/dates/:symbol/:expiry", (req, res) => {
    try {
      const { symbol, expiry } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const p = path.join(PATHS.MARKET, safeSymbol, expiry);
      
      if (!fs.existsSync(p)) {
        return res.status(404).json({ error: "Expiry not found" });
      }
      
      const dates = folders(p).sort();
      res.json(dates);
    } catch (error) {
      res.status(500).json({ error: "Failed to load dates" });
    }
  });

  // Get all times (snapshots) for a symbol, expiry, and date
  app.get("/api/historical/times/:symbol/:expiry/:date", (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const p = path.join(PATHS.MARKET, safeSymbol, expiry, date);
      
      if (!fs.existsSync(p)) {
        return res.status(404).json({ error: "Date not found" });
      }
      
      const jsonFiles = files(p).sort();
      
      // Create array of snapshot objects with HH:MM:SS time
      const snapshots = jsonFiles.map(filename => {
        // Try to extract time from metadata first
        let time = parseTimeFromFilename(filename);
        
        // If we can read the file, get time from metadata
        try {
          const filePath = path.join(p, filename);
          const data = readOptionChainFile(filePath);
          if (data.metadata && data.metadata.time_hhmmss) {
            time = data.metadata.time_hhmmss;
          }
        } catch (e) {
          // Fall back to filename parsing
        }
        
        return {
          file: filename,
          time: time, // HH:MM:SS format
          file_time: time.replace(/:/g, '-'), // Convert to HH-MM-SS for filename
          date: date,
          expiry: expiry,
          symbol: symbol
        };
      });
      
      // Sort by time (HH:MM:SS)
      snapshots.sort((a, b) => {
        const timeA = a.time.split(':').map(Number);
        const timeB = b.time.split(':').map(Number);
        return (timeA[0] * 3600 + timeA[1] * 60 + timeA[2]) - 
               (timeB[0] * 3600 + timeB[1] * 60 + timeB[2]);
      });
      
      res.json(snapshots);
    } catch (error) {
      res.status(500).json({ error: "Failed to load times" });
    }
  });

  // Get specific snapshot data
  app.get("/api/historical/snapshot/:symbol/:expiry/:date/:time", (req, res) => {
    try {
      const { symbol, expiry, date, time } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const fileTime = time.replace(/:/g, '-'); // Convert HH:MM:SS to HH-MM-SS
      
      // NEW FORMAT: SYMBOL_EXPIRY_YYYY-MM-DD_HH-MM-SS.json.gz
      // Try compressed file first
      let filename = `${safeSymbol}_${expiry}_${date}_${fileTime}.json.gz`;
      let filePath = path.join(PATHS.MARKET, safeSymbol, expiry, date, filename);
      
      // If compressed file doesn't exist, try uncompressed
      if (!fs.existsSync(filePath)) {
        filename = `${safeSymbol}_${expiry}_${date}_${fileTime}.json`;
        filePath = path.join(PATHS.MARKET, safeSymbol, expiry, date, filename);
      }
      
      // If file doesn't exist, try to find it by scanning all files in the directory
      if (!fs.existsSync(filePath)) {
        const dirPath = path.join(PATHS.MARKET, safeSymbol, expiry, date);
        const filesList = files(dirPath);
        
        // Find file containing the time (more flexible matching)
        const foundFile = filesList.find(f => {
          const baseName = f.replace('.json.gz', '').replace('.json', '');
          // Match files that end with _HH-MM-SS pattern
          return baseName.endsWith(`_${fileTime}`) || baseName.includes(`_${date}_${fileTime}`);
        });
        
        if (foundFile) {
          filename = foundFile;
          filePath = path.join(dirPath, filename);
        } else {
          return res.status(404).json({ 
            error: "Snapshot not found",
            expected: filename,
            available: filesList.slice(0, 5)
          });
        }
      }
      
      // Read and parse the file
      const data = readOptionChainFile(filePath);
      
      // Extract spot price
      let spotPrice = 0;
      if (data.option_chain && data.option_chain.length > 0) {
        spotPrice = data.option_chain[0].underlying_spot_price || 0;
      }
      
      // Get time from metadata
      let timeHHMMSS = time;
      if (data.metadata && data.metadata.time_hhmmss) {
        timeHHMMSS = data.metadata.time_hhmmss;
      }
      
      // Transform data
      const chain = data.option_chain.map(row => {
        const cc = row.call_options?.market_data || {};
        const pc = row.put_options?.market_data || {};
        const cg = row.call_options?.option_greeks || {};
        const pg = row.put_options?.option_greeks || {};
        
        return {
          strike: row.strike_price,
          call: {
            pop: cg?.pop || 0,
            theta: cg?.theta || 0,
            gamma: cg?.gamma || 0,
            vega: cg?.vega || 0,
            delta: cg?.delta || 0,
            iv: cg?.iv || 0,  // IMPLIED VOLATILITY - NEW
            oi_change: (cc.oi || 0) - (cc.prev_oi || 0),
            oi: cc.oi || 0,
            volume: cc.volume || 0,
            ltp: cc.ltp || 0,
            ltp_change: (cc.ltp || 0) - (cc.close_price || 0)
          },
          put: {
            pop: pg?.pop || 0,
            theta: pg?.theta || 0,
            gamma: pg?.gamma || 0,
            vega: pg?.vega || 0,
            delta: pg?.delta || 0,
            iv: pg?.iv || 0,  // IMPLIED VOLATILITY - NEW
            oi_change: (pc.oi || 0) - (pc.prev_oi || 0),
            oi: pc.oi || 0,
            volume: pc.volume || 0,
            ltp: pc.ltp || 0,
            ltp_change: (pc.ltp || 0) - (pc.close_price || 0)
          }
        };
      });
      
      res.json({
        symbol: symbol,
        expiry: expiry,
        date: date,
        time: timeHHMMSS,
        spot_price: spotPrice,
        lot_size: data.metadata?.lot_size || 1,
        chain: chain
      });

    } catch (error) {
      res.status(500).json({
        error: "Failed to load snapshot",
        message: error.message 
      });
    }
  });

  // ============ COMPATIBILITY ENDPOINTS (for existing frontend) ============

  // Get latest expiry for a symbol
  app.get("/api/expiry/:symbol", (req, res) => {
    try {
      const symbol = req.params.symbol;
      const safeSymbol = resolveSymbol(symbol);
      const p = path.join(PATHS.MARKET, safeSymbol);
      
      if (!fs.existsSync(p)) {
        return res.json(null);
      }
      
      const expiries = folders(p).sort();
      if (expiries.length === 0) {
        return res.json(null);
      }
      
      res.json(expiries.at(-1));
    } catch (error) {
      res.status(500).json({ error: "Failed to load expiry" });
    }
  });

  // Get latest date for a symbol and expiry
  app.get("/api/date/:symbol/:expiry", (req, res) => {
    try {
      const { symbol, expiry } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const p = path.join(PATHS.MARKET, safeSymbol, expiry);
      
      if (!fs.existsSync(p)) {
        return res.json(null);
      }
      
      const dates = folders(p).sort();
      if (dates.length === 0) {
        return res.json(null);
      }
      
      res.json(dates.at(-1));
    } catch (error) {
      res.status(500).json({ error: "Failed to load date" });
    }
  });

  // Get latest chain data (compatibility endpoint)
  app.get("/api/chain/:symbol/:expiry/:date", (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const p = path.join(PATHS.MARKET, safeSymbol, expiry, date);
      
      // Get latest file
      const jsonFiles = files(p).sort();
      if (jsonFiles.length === 0) {
        return res.status(404).json({ error: "No data files found" });
      }
      
      const latestFile = jsonFiles.at(-1);
      const filePath = path.join(p, latestFile);
      
      const data = readOptionChainFile(filePath);
      
      // Extract spot price
      let spotPrice = 0;
      if (data.option_chain && data.option_chain.length > 0) {
        spotPrice = data.option_chain[0].underlying_spot_price;
      }
      
      // Transform data
      const chain = data.option_chain.map(row => {
        const cc = row.call_options?.market_data || {};
        const pc = row.put_options?.market_data || {};
        const cg = row.call_options?.option_greeks || {};
        const pg = row.put_options?.option_greeks || {};
        
        return {
          strike: row.strike_price,
          call: {
            pop: cg?.pop || 0,
            theta: cg?.theta || 0,
            gamma: cg?.gamma || 0,
            vega: cg?.vega || 0,
            delta: cg?.delta || 0,
            iv: cg?.iv || 0,  // IMPLIED VOLATILITY - NEW
            oi_change: (cc.oi || 0) - (cc.prev_oi || 0),
            oi: cc.oi || 0,
            volume: cc.volume || 0,
            ltp: cc.ltp || 0,
            ltp_change: (cc.ltp || 0) - (cc.close_price || 0)
          },
          put: {
            pop: pg?.pop || 0,
            theta: pg?.theta || 0,
            gamma: pg?.gamma || 0,
            vega: pg?.vega || 0,
            delta: pg?.delta || 0,
            iv: pg?.iv || 0,  // IMPLIED VOLATILITY - NEW
            oi_change: (pc.oi || 0) - (pc.prev_oi || 0),
            oi: pc.oi || 0,
            volume: pc.volume || 0,
            ltp: pc.ltp || 0,
            ltp_change: (pc.ltp || 0) - (pc.close_price || 0)
          }
        };
      });
      
      res.json({
        spot_price: spotPrice,
        lot_size: data.metadata?.lot_size || 1,
        chain: chain
      });
      
    } catch (error) {
      res.status(500).json({ error: "Failed to load chain data" });
    }
  });

  // ============ ADDITIONAL HELPER ENDPOINTS ============

  // Get all available data for debugging
  app.get("/api/debug/data", (req, res) => {
    try {
      const dataPath = PATHS.MARKET;
      const structure = {};
      
      function scanDir(dirPath, currentLevel) {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        
        items.forEach(item => {
          if (item.isDirectory()) {
            currentLevel[item.name] = {};
            scanDir(path.join(dirPath, item.name), currentLevel[item.name]);
          } else if (item.isFile() && (item.name.endsWith('.json') || item.name.endsWith('.json.gz'))) {
            if (!currentLevel.files) currentLevel.files = [];
            const stats = fs.statSync(path.join(dirPath, item.name));
            currentLevel.files.push({
              name: item.name,
              size: stats.size,
              size_kb: (stats.size / 1024).toFixed(2),
              compressed: item.name.endsWith('.gz'),
              modified: stats.mtime
            });
          }
        });
      }
      
      if (fs.existsSync(dataPath)) {
        scanDir(dataPath, structure);
      }
      
      res.json({
        success: true,
        data_path: dataPath,
        structure: structure
      });
    } catch (error) {
      res.status(500).json({ 
        error: "Failed to scan data directory",
        message: error.message 
      });
    }
  });

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({
      status: "OK",
      timestamp: new Date().toISOString(),
      timestamp_ist: new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000)).toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      compression: "gzip supported"
    });
  });

  // ============ CANDLESTICK CHART API ENDPOINTS ============

  // Helper: Build OHLC candles from price snapshots
  function buildCandlesFromSnapshots(snapshots, timeframe) {
    if (!snapshots || snapshots.length === 0) return [];
    
    const candles = [];
    let candleStart = null;
    let candlePrices = [];
    
    // Sort snapshots by time
    snapshots.sort((a, b) => a.time.localeCompare(b.time));
    
    snapshots.forEach(snap => {
      const timeParts = snap.time.split(':');
      const hour = parseInt(timeParts[0]);
      const minute = parseInt(timeParts[1]);
      const totalMinutes = hour * 60 + minute;
      
      // Calculate candle start time (aligned to timeframe)
      const candleStartMinute = Math.floor(totalMinutes / timeframe) * timeframe;
      const candleStartHour = Math.floor(candleStartMinute / 60);
      const candleStartMin = candleStartMinute % 60;
      const candleTimeStr = `${String(candleStartHour).padStart(2, '0')}:${String(candleStartMin).padStart(2, '0')}`;
      
      if (candleStart !== candleTimeStr) {
        // Save previous candle
        if (candleStart && candlePrices.length > 0) {
          candles.push({
            time: candleStart,
            open: candlePrices[0],
            high: Math.max(...candlePrices),
            low: Math.min(...candlePrices),
            close: candlePrices[candlePrices.length - 1]
          });
        }
        
        // Start new candle
        candleStart = candleTimeStr;
        candlePrices = [snap.price];
      } else {
        candlePrices.push(snap.price);
      }
    });
    
    // Don't forget the last candle
    if (candleStart && candlePrices.length > 0) {
      candles.push({
        time: candleStart,
        open: candlePrices[0],
        high: Math.max(...candlePrices),
        low: Math.min(...candlePrices),
        close: candlePrices[candlePrices.length - 1]
      });
    }
    
    return candles;
  }

  // Get candles for live data (today)
  app.get("/api/candles/live/:symbol", async (req, res) => {
    try {
      const symbol = req.params.symbol;
      const safeSymbol = resolveSymbol(symbol);
      const timeframe = parseInt(req.query.timeframe) || 5;
      
      const symbolPath = path.join(PATHS.MARKET, safeSymbol);
      
      if (!fs.existsSync(symbolPath)) {
        return res.status(404).json({ error: "Symbol not found" });
      }
      
      // Get latest expiry
      const expiryFolders = folders(symbolPath).sort();
      if (expiryFolders.length === 0) {
        return res.status(404).json({ error: "No expiry data" });
      }
      const latestExpiry = expiryFolders.at(-1);
      
      // Get latest date
      const expiryPath = path.join(symbolPath, latestExpiry);
      const dateFolders = folders(expiryPath).sort();
      if (dateFolders.length === 0) {
        return res.status(404).json({ error: "No date data" });
      }
      const latestDate = dateFolders.at(-1);
      
      // Get all files for this date
      const datePath = path.join(expiryPath, latestDate);
      const jsonFiles = files(datePath).sort();
      
      // Extract spot prices from each file
      const snapshots = [];
      
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(datePath, file);
          const data = readOptionChainFile(filePath);
          
          let spotPrice = 0;
          if (data.option_chain && data.option_chain.length > 0) {
            spotPrice = data.option_chain[0].underlying_spot_price || 0;
          }
          
          // Get time from metadata or filename
          let timeStr = "00:00:00";
          if (data.metadata && data.metadata.time_hhmmss) {
            timeStr = data.metadata.time_hhmmss;
          } else {
            timeStr = parseTimeFromFilename(file);
          }
          
          if (spotPrice > 0) {
            snapshots.push({
              time: timeStr,
              price: spotPrice
            });
          }
        } catch (e) {
        }
      }
      
      // Build candles
      const candles = buildCandlesFromSnapshots(snapshots, timeframe);
      
      res.json({
        symbol: symbol,
        expiry: latestExpiry,
        date: latestDate,
        timeframe: timeframe,
        candles: candles,
        total_snapshots: snapshots.length
      });
      
    } catch (error) {
      res.status(500).json({ error: "Failed to get candles", message: error.message });
    }
  });

  // Get candles for historical data
  app.get("/api/candles/:symbol/:expiry/:date", async (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const timeframe = parseInt(req.query.timeframe) || 5;
      
      const datePath = path.join(PATHS.MARKET, safeSymbol, expiry, date);
      
      if (!fs.existsSync(datePath)) {
        return res.status(404).json({ error: "Data path not found" });
      }
      
      // Get all files for this date
      const jsonFiles = files(datePath).sort();
      
      // Extract spot prices from each file
      const snapshots = [];
      
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(datePath, file);
          const data = readOptionChainFile(filePath);
          
          let spotPrice = 0;
          if (data.option_chain && data.option_chain.length > 0) {
            spotPrice = data.option_chain[0].underlying_spot_price || 0;
          }
          
          // Get time from metadata or filename
          let timeStr = "00:00:00";
          if (data.metadata && data.metadata.time_hhmmss) {
            timeStr = data.metadata.time_hhmmss;
          } else {
            timeStr = parseTimeFromFilename(file);
          }
          
          if (spotPrice > 0) {
            snapshots.push({
              time: timeStr,
              price: spotPrice
            });
          }
        } catch (e) {
        }
      }
      
      // Build candles
      const candles = buildCandlesFromSnapshots(snapshots, timeframe);
      
      res.json({
        symbol: symbol,
        expiry: expiry,
        date: date,
        timeframe: timeframe,
        candles: candles,
        total_snapshots: snapshots.length
      });
      
    } catch (error) {
      res.status(500).json({ error: "Failed to get candles", message: error.message });
    }
  });

  // ── Candles from _chart_spot.json (fast — no file scanning) ──────────────────
  // Helper: aggregate [{time,spot}] into OHLC candles at given minute interval
  function buildCandlesFromSpotData(spotData, intervalMin) {
    if (!spotData?.length) return [];
    const buckets = {};
    for (const { time, spot } of spotData) {
      if (!time || !spot) continue;
      const [h, m] = time.split(':').map(Number);
      if (isNaN(h) || isNaN(m)) continue;
      const bucket = h * 60 + Math.floor(m / intervalMin) * intervalMin;
      const bh = String(Math.floor(bucket / 60)).padStart(2, '0');
      const bm = String(bucket % 60).padStart(2, '0');
      const key = `${bh}:${bm}`;
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(Number(spot));
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, prices]) => ({
        time,
        open:  prices[0],
        high:  Math.max(...prices),
        low:   Math.min(...prices),
        close: prices[prices.length - 1],
      }));
  }

  // Historical: read _chart_spot.json and return candles
  app.get('/api/splitchart/:symbol/:expiry/:date', (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const intervalMin = parseInt(req.query.tf) || 5;
      const safeSymbol  = resolveSymbol(symbol);
      const filePath    = path.join(PATHS.MARKET, safeSymbol, expiry, date, '_chart_spot.json');
      if (!fs.existsSync(filePath))
        return res.status(404).json({ error: 'No chart data for this date' });
      const json    = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const candles = buildCandlesFromSpotData(json.data || [], intervalMin);
      res.json({ symbol, expiry, date, candles });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Live: build candles from _chart_spot.json of the latest date folder
  app.get('/api/splitchart/live/:symbol', (req, res) => {
    try {
      const symbol      = req.params.symbol;
      const intervalMin = parseInt(req.query.tf) || 5;
      const safeSymbol  = resolveSymbol(symbol);
      const dataRoot    = path.join(PATHS.MARKET, safeSymbol);

      if (!fs.existsSync(dataRoot))
        return res.status(404).json({ error: 'Symbol not found' });

      // Find latest expiry → latest date folder
      const expiryFolders = folders(dataRoot).sort();
      if (!expiryFolders.length) return res.status(404).json({ error: 'No expiry data' });
      const latestExpiry = expiryFolders.at(-1);

      const expiryPath  = path.join(dataRoot, latestExpiry);
      const dateFolders = folders(expiryPath).sort();
      if (!dateFolders.length) return res.status(404).json({ error: 'No date data' });
      const latestDate  = dateFolders.at(-1);
      const datePath    = path.join(expiryPath, latestDate);

      // 1. Try _chart_spot.json first (pre-generated, fast)
      const chartSpotFile = path.join(datePath, '_chart_spot.json');
      if (fs.existsSync(chartSpotFile)) {
        const json    = JSON.parse(fs.readFileSync(chartSpotFile, 'utf8'));
        const candles = buildCandlesFromSpotData(json.data || [], intervalMin);
        return res.json({ symbol, expiry: latestExpiry, date: latestDate, candles });
      }

      // 2. Fallback: read spot prices from individual snapshot files
      const snapshots = [];
      for (const file of files(datePath).sort()) {
        try {
          const data = readOptionChainFile(path.join(datePath, file));
          const spot = data.option_chain?.[0]?.underlying_spot_price || 0;
          if (spot <= 0) continue;
          const timeStr = data.metadata?.time_hhmmss || parseTimeFromFilename(file);
          snapshots.push({ time: timeStr.substring(0, 5), spot });
        } catch (_) {}
      }
      const candles = buildCandlesFromSpotData(snapshots, intervalMin);
      res.json({ symbol, expiry: latestExpiry, date: latestDate, candles });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ============ NEW: ALL SNAPSHOTS IN ONE CALL - For INSTANT Graph Loading ============
  // This endpoint returns all snapshots for a day in ONE request (much faster than multiple API calls)
  app.get("/api/historical/all-snapshots/:symbol/:expiry/:date", (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const datePath = path.join(PATHS.MARKET, safeSymbol, expiry, date);
      
      if (!fs.existsSync(datePath)) {
        return res.status(404).json({ error: "Date folder not found" });
      }
      
      // Get all JSON files
      const jsonFiles = files(datePath).sort();
      if (jsonFiles.length === 0) {
        return res.status(404).json({ error: "No snapshot files found" });
      }
      
      
      const allSnapshots = [];
      
      // Read ALL files and extract data
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(datePath, file);
          const data = readOptionChainFile(filePath);
          
          if (!data.option_chain || data.option_chain.length === 0) continue;
          
          // Get spot price
          let spotPrice = data.option_chain[0].underlying_spot_price || 0;
          
          // Get time from metadata or filename
          let timeStr = "00:00:00";
          if (data.metadata && data.metadata.time_hhmmss) {
            timeStr = data.metadata.time_hhmmss;
          } else {
            timeStr = parseTimeFromFilename(file);
          }
          
          // Transform chain data to frontend format
          const chain = data.option_chain.map(row => {
            const cc = row.call_options?.market_data || {};
            const pc = row.put_options?.market_data || {};
            const cg = row.call_options?.option_greeks || {};
            const pg = row.put_options?.option_greeks || {};
            
            return {
              strike: row.strike_price,
              call: {
                oi: cc.oi || 0,
                oi_change: (cc.oi || 0) - (cc.prev_oi || 0),
                volume: cc.volume || 0,
                ltp: cc.ltp || 0,
                iv: cg?.iv || 0
              },
              put: {
                oi: pc.oi || 0,
                oi_change: (pc.oi || 0) - (pc.prev_oi || 0),
                volume: pc.volume || 0,
                ltp: pc.ltp || 0,
                iv: pg?.iv || 0
              }
            };
          });
          
          allSnapshots.push({
            time: timeStr,
            spot_price: spotPrice,
            chain: chain
          });
          
        } catch (e) {
          // Skip failed files silently
        }
      }
      
      // Sort by time
      allSnapshots.sort((a, b) => a.time.localeCompare(b.time));
      
      
      res.json({
        symbol: symbol,
        expiry: expiry,
        date: date,
        total_snapshots: allSnapshots.length,
        snapshots: allSnapshots
      });
      
    } catch (error) {
      res.status(500).json({ error: "Failed to load snapshots", message: error.message });
    }
  });

  // ============ NEW: AI ANALYSIS ENDPOINT - Smart Market Analysis ============
  app.get("/api/ai/analysis/:symbol/:expiry/:date", (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const datePath = path.join(PATHS.MARKET, safeSymbol, expiry, date);
      
      if (!fs.existsSync(datePath)) {
        return res.status(404).json({ error: "Data not found" });
      }
      
      // Get latest file
      const jsonFiles = files(datePath).sort();
      if (jsonFiles.length === 0) {
        return res.status(404).json({ error: "No data files" });
      }
      
      const latestFile = jsonFiles.at(-1);
      const filePath = path.join(datePath, latestFile);
      const data = readOptionChainFile(filePath);
      
      if (!data.option_chain || data.option_chain.length === 0) {
        return res.status(404).json({ error: "No chain data" });
      }
      
      // Calculate analysis
      const chain = data.option_chain;
      const spotPrice = chain[0].underlying_spot_price || 0;
      
      let totalCallOI = 0, totalPutOI = 0;
      let totalCallVol = 0, totalPutVol = 0;
      let totalCallOIChg = 0, totalPutOIChg = 0;
      let maxCallOI = 0, maxPutOI = 0;
      let maxCallOIStrike = 0, maxPutOIStrike = 0;
      let secondCallOI = 0, secondPutOI = 0;
      let secondCallOIStrike = 0, secondPutOIStrike = 0;
      
      chain.forEach(row => {
        const cc = row.call_options?.market_data || {};
        const pc = row.put_options?.market_data || {};
        
        const callOI = cc.oi || 0;
        const putOI = pc.oi || 0;
        const callOIChg = callOI - (cc.prev_oi || 0);
        const putOIChg = putOI - (pc.prev_oi || 0);
        
        totalCallOI += callOI;
        totalPutOI += putOI;
        totalCallVol += cc.volume || 0;
        totalPutVol += pc.volume || 0;
        totalCallOIChg += callOIChg;
        totalPutOIChg += putOIChg;
        
        // Track highest OI strikes (resistance/support)
        if (callOI > maxCallOI) {
          secondCallOI = maxCallOI;
          secondCallOIStrike = maxCallOIStrike;
          maxCallOI = callOI;
          maxCallOIStrike = row.strike_price;
        } else if (callOI > secondCallOI) {
          secondCallOI = callOI;
          secondCallOIStrike = row.strike_price;
        }
        
        if (putOI > maxPutOI) {
          secondPutOI = maxPutOI;
          secondPutOIStrike = maxPutOIStrike;
          maxPutOI = putOI;
          maxPutOIStrike = row.strike_price;
        } else if (putOI > secondPutOI) {
          secondPutOI = putOI;
          secondPutOIStrike = row.strike_price;
        }
      });
      
      // Calculate PCR
      const pcrOI = totalCallOI > 0 ? (totalPutOI / totalCallOI).toFixed(2) : 0;
      const pcrVol = totalCallVol > 0 ? (totalPutVol / totalCallVol).toFixed(2) : 0;
      
      // Determine sentiment
      let sentiment = 'NEUTRAL';
      if (pcrOI > 1.2) sentiment = 'BEARISH';
      else if (pcrOI < 0.8) sentiment = 'BULLISH';
      
      // Find ATM
      let atmStrike = 0;
      let minDiff = Infinity;
      chain.forEach(row => {
        const diff = Math.abs(row.strike_price - spotPrice);
        if (diff < minDiff) {
          minDiff = diff;
          atmStrike = row.strike_price;
        }
      });
      
      // Calculate Max Pain (simplified)
      let maxPain = 0;
      let minPainValue = Infinity;
      chain.forEach(targetRow => {
        let totalPain = 0;
        chain.forEach(row => {
          const cc = row.call_options?.market_data || {};
          const pc = row.put_options?.market_data || {};
          
          if (targetRow.strike_price < row.strike_price) {
            totalPain += (cc.oi || 0) * (row.strike_price - targetRow.strike_price);
          }
          if (targetRow.strike_price > row.strike_price) {
            totalPain += (pc.oi || 0) * (targetRow.strike_price - row.strike_price);
          }
        });
        
        if (totalPain < minPainValue) {
          minPainValue = totalPain;
          maxPain = targetRow.strike_price;
        }
      });
      
      res.json({
        symbol: symbol,
        expiry: expiry,
        date: date,
        spot_price: spotPrice,
        atm_strike: atmStrike,
        pcr: {
          oi: parseFloat(pcrOI),
          volume: parseFloat(pcrVol),
          sentiment: sentiment
        },
        resistance: {
          primary: { strike: maxCallOIStrike, oi: maxCallOI },
          secondary: { strike: secondCallOIStrike, oi: secondCallOI }
        },
        support: {
          primary: { strike: maxPutOIStrike, oi: maxPutOI },
          secondary: { strike: secondPutOIStrike, oi: secondPutOI }
        },
        max_pain: maxPain,
        totals: {
          call_oi: totalCallOI,
          put_oi: totalPutOI,
          call_volume: totalCallVol,
          put_volume: totalPutVol,
          call_oi_change: totalCallOIChg,
          put_oi_change: totalPutOIChg
        }
      });
      
    } catch (error) {
      res.status(500).json({ error: "Failed to analyze", message: error.message });
    }
  });

  // ============ PRE-COMPUTED CHART DATA APIs (NEW) ============

  // API: Get pre-computed OI chart data
  app.get("/api/chart/oi/:symbol/:expiry/:date", (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const datePath = path.join(PATHS.MARKET, safeSymbol, expiry, date);
      const chartFile = path.join(datePath, "_chart_oi.json");
      
      if (!fs.existsSync(chartFile) && fs.existsSync(datePath)) {
        generateOIChartData(datePath, symbol, expiry, date);
      }
      
      if (fs.existsSync(chartFile)) {
        res.json(JSON.parse(fs.readFileSync(chartFile, 'utf8')));
      } else {
        res.status(404).json({ error: "Chart data not available" });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Get pre-computed OI Change chart data
  app.get("/api/chart/oichng/:symbol/:expiry/:date", (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const datePath = path.join(PATHS.MARKET, safeSymbol, expiry, date);
      const chartFile = path.join(datePath, "_chart_oichng.json");
      
      if (!fs.existsSync(chartFile) && fs.existsSync(datePath)) {
        generateOIChngChartData(datePath, symbol, expiry, date);
      }
      
      if (fs.existsSync(chartFile)) {
        res.json(JSON.parse(fs.readFileSync(chartFile, 'utf8')));
      } else {
        res.status(404).json({ error: "Chart data not available" });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Get pre-computed Spot chart data
  app.get("/api/chart/spot/:symbol/:expiry/:date", (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const datePath = path.join(PATHS.MARKET, safeSymbol, expiry, date);
      const chartFile = path.join(datePath, "_chart_spot.json");
      
      if (!fs.existsSync(chartFile) && fs.existsSync(datePath)) {
        generateSpotChartData(datePath, symbol, expiry, date);
      }
      
      if (fs.existsSync(chartFile)) {
        res.json(JSON.parse(fs.readFileSync(chartFile, 'utf8')));
      } else {
        res.status(404).json({ error: "Chart data not available" });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Get pre-computed Strategy 4.0 data
  app.get("/api/chart/strategy40/:symbol/:expiry/:date", (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const expPath = path.join(PATHS.MARKET, safeSymbol, expiry);

      // ?prev=1 → return previous date's strategy40 (for Bromos header on date D, show D-1's values)
      let targetDate = date;
      if (req.query.prev === '1') {
        const allDates = folders(expPath).sort();
        const idx = allDates.indexOf(date);
        if (idx > 0) targetDate = allDates[idx - 1];
      }

      const datePath  = path.join(expPath, targetDate);
      const chartFile = path.join(datePath, "_chart_strategy40.json");

      if (!fs.existsSync(chartFile) && fs.existsSync(datePath)) {
        generateStrategy40Data(datePath, symbol, expiry, targetDate);
      }

      if (!fs.existsSync(chartFile)) {
        return res.status(404).json({ error: "Chart data not available" });
      }

      const eod = safeReadJson(chartFile);
      res.json(eod);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Trigger chart generation for all missing
  app.get("/api/chart/generate-all", (req, res) => {
    try {
      autoGenerateMissingChartData();
      res.json({ success: true, message: "Chart generation triggered" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============ SHIFTING DATA APIs ============

  // API: Get shifting data for a specific date
  // API: Get MCTR data
  // Force regenerate all MCTR data (call this once after deploy)
  app.get("/api/mctr/regenerate-all", (req, res) => {
    try {
      backfillMCTRData(true);
      res.json({ success: true, message: "MCTR regeneration triggered for all dates" });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/mctr/:symbol/:expiry/:date", (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const datePath = path.join(PATHS.MARKET, safeSymbol, expiry, date);
      const mctrFile = path.join(datePath, "_mctr.json");

      if (!fs.existsSync(mctrFile) && fs.existsSync(datePath)) {
        generateMCTRData(datePath, symbol, expiry, date);
      }
      if (fs.existsSync(mctrFile)) {
        res.json(JSON.parse(fs.readFileSync(mctrFile, 'utf8')));
      } else {
        res.json({ mctr_support: null, mctr_resistance: null });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/shifting/:symbol/:expiry/:date", (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const datePath = path.join(PATHS.MARKET, safeSymbol, expiry, date);
      const shiftingFile = path.join(datePath, "_shifting.json");
      
      // Generate if doesn't exist
      if (!fs.existsSync(shiftingFile) && fs.existsSync(datePath)) {
        generateShiftingData(datePath, symbol, expiry, date);
      }
      
      if (fs.existsSync(shiftingFile)) {
        res.json(JSON.parse(fs.readFileSync(shiftingFile, 'utf8')));
      } else {
        res.status(404).json({ error: "Shifting data not available" });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Get live shifting data (today's latest)
  app.get("/api/shifting/live/:symbol", (req, res) => {
    try {
      const symbol = req.params.symbol;
      const safeSymbol = resolveSymbol(symbol);
      const symbolPath = path.join(PATHS.MARKET, safeSymbol);
      
      if (!fs.existsSync(symbolPath)) {
        return res.status(404).json({ error: "Symbol not found" });
      }
      
      // Get latest expiry
      const expiryFolders = folders(symbolPath).sort();
      if (expiryFolders.length === 0) {
        return res.status(404).json({ error: "No expiry data" });
      }
      const latestExpiry = expiryFolders.at(-1);
      
      // Get latest date
      const expiryPath = path.join(symbolPath, latestExpiry);
      const dateFolders = folders(expiryPath).sort();
      if (dateFolders.length === 0) {
        return res.status(404).json({ error: "No date data" });
      }
      const latestDate = dateFolders.at(-1);
      
      const datePath = path.join(expiryPath, latestDate);
      const shiftingFile = path.join(datePath, "_shifting.json");
      
      // Always regenerate for live data (to get latest)
      generateShiftingData(datePath, symbol, latestExpiry, latestDate);
      
      if (fs.existsSync(shiftingFile)) {
        const data = JSON.parse(fs.readFileSync(shiftingFile, 'utf8'));
        data.expiry = latestExpiry;
        data.date = latestDate;
        res.json(data);
      } else {
        res.status(404).json({ error: "Shifting data not available" });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // API: Regenerate shifting data
  app.post("/api/shifting/regenerate/:symbol/:expiry/:date", (req, res) => {
    try {
      const { symbol, expiry, date } = req.params;
      const safeSymbol = resolveSymbol(symbol);
      const datePath = path.join(PATHS.MARKET, safeSymbol, expiry, date);
      
      if (!fs.existsSync(datePath)) {
        return res.status(404).json({ error: "Data path not found" });
      }
      
      const result = generateShiftingData(datePath, symbol, expiry, date);
      
      if (result) {
        res.json({ success: true, data: result });
      } else {
        res.status(500).json({ error: "Failed to generate shifting data" });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

};

// ============ CHART GENERATORS (Outside module.exports) ============

function getDataFiles(p) {
  try {
    return fs.readdirSync(p).filter(x => x.endsWith(".json.gz") && !x.startsWith("_"));
  } catch (e) {
    return [];
  }
}

function generateOIChartData(datePath, symbol, expiry, date) {
  try {
    const jsonFiles = getDataFiles(datePath).sort();
    if (jsonFiles.length === 0) return null;

    const chartData = { symbol, expiry, date, generated_at: new Date().toISOString(), strikes: {} };
    const snapshots = [];

    for (const file of jsonFiles) {
      try {
        const filePath = path.join(datePath, file);
        const data = readOptionChainFile(filePath);
        if (!data.option_chain || data.option_chain.length === 0) continue;
        const spotPrice = data.option_chain[0].underlying_spot_price || 0;
        let timeStr = data.metadata?.time_hhmmss || parseTimeFromFilename(file);
        snapshots.push({ time: timeStr, spot: spotPrice, chain: data.option_chain });
      } catch (e) {}
    }

    if (snapshots.length === 0) return null;
    snapshots.sort((a, b) => a.time.localeCompare(b.time));

    snapshots.forEach(snap => {
      const sorted = [...snap.chain].sort((a, b) => a.strike_price - b.strike_price);
      let atmIdx = 0, minDiff = Infinity;
      sorted.forEach((row, idx) => {
        const diff = Math.abs(row.strike_price - snap.spot);
        if (diff < minDiff) { minDiff = diff; atmIdx = idx; }
      });

      const startIdx = Math.max(0, atmIdx - 12);
      const endIdx = Math.min(sorted.length, atmIdx + 13);
      const displayChain = sorted.slice(startIdx, endIdx);

      let maxCallOI = 1, maxPutOI = 1, maxCallVol = 1, maxPutVol = 1, maxCallOIChg = 1, maxPutOIChg = 1;

      displayChain.forEach(row => {
        const cc = row.call_options?.market_data || {};
        const pc = row.put_options?.market_data || {};
        if ((cc.oi || 0) > maxCallOI) maxCallOI = cc.oi;
        if ((pc.oi || 0) > maxPutOI) maxPutOI = pc.oi;
        if ((cc.volume || 0) > maxCallVol) maxCallVol = cc.volume;
        if ((pc.volume || 0) > maxPutVol) maxPutVol = pc.volume;
        const callOIChg = Math.abs((cc.oi || 0) - (cc.prev_oi || 0));
        const putOIChg = Math.abs((pc.oi || 0) - (pc.prev_oi || 0));
        if (callOIChg > maxCallOIChg) maxCallOIChg = callOIChg;
        if (putOIChg > maxPutOIChg) maxPutOIChg = putOIChg;
      });

      displayChain.forEach(row => {
        const strike = row.strike_price;
        const cc = row.call_options?.market_data || {};
        const pc = row.put_options?.market_data || {};
        if (!chartData.strikes[strike]) chartData.strikes[strike] = { call: [], put: [] };

        chartData.strikes[strike].call.push({
          time: snap.time.substring(0, 5),
          vol_pct: ((cc.volume || 0) / maxCallVol * 100).toFixed(1),
          oi_pct: ((cc.oi || 0) / maxCallOI * 100).toFixed(1),
          oichng_pct: (Math.abs((cc.oi || 0) - (cc.prev_oi || 0)) / maxCallOIChg * 100).toFixed(1)
        });

        chartData.strikes[strike].put.push({
          time: snap.time.substring(0, 5),
          vol_pct: ((pc.volume || 0) / maxPutVol * 100).toFixed(1),
          oi_pct: ((pc.oi || 0) / maxPutOI * 100).toFixed(1),
          oichng_pct: (Math.abs((pc.oi || 0) - (pc.prev_oi || 0)) / maxPutOIChg * 100).toFixed(1)
        });
      });
    });

    fs.writeFileSync(path.join(datePath, "_chart_oi.json"), JSON.stringify(chartData));
    return chartData;
  } catch (error) {
    return null;
  }
}

function generateOIChngChartData(datePath, symbol, expiry, date) {
  try {
    const jsonFiles = getDataFiles(datePath).sort();
    if (jsonFiles.length === 0) return null;

    const chartData = { symbol, expiry, date, generated_at: new Date().toISOString(), strikes: {} };

    for (const file of jsonFiles) {
      try {
        const filePath = path.join(datePath, file);
        const data = readOptionChainFile(filePath);
        if (!data.option_chain || data.option_chain.length === 0) continue;
        let timeStr = data.metadata?.time_hhmmss || parseTimeFromFilename(file);

        data.option_chain.forEach(row => {
          const strike = row.strike_price;
          const cc = row.call_options?.market_data || {};
          const pc = row.put_options?.market_data || {};
          if (!chartData.strikes[strike]) chartData.strikes[strike] = { call: [], put: [] };

          chartData.strikes[strike].call.push({
            time: timeStr.substring(0, 5),
            vol: cc.volume || 0,
            oi: cc.oi || 0,
            oichng: (cc.oi || 0) - (cc.prev_oi || 0)
          });

          chartData.strikes[strike].put.push({
            time: timeStr.substring(0, 5),
            vol: pc.volume || 0,
            oi: pc.oi || 0,
            oichng: (pc.oi || 0) - (pc.prev_oi || 0)
          });
        });
      } catch (e) {}
    }

    fs.writeFileSync(path.join(datePath, "_chart_oichng.json"), JSON.stringify(chartData));
    return chartData;
  } catch (error) {
    return null;
  }
}

function generateSpotChartData(datePath, symbol, expiry, date) {
  try {
    const jsonFiles = getDataFiles(datePath).sort();
    if (jsonFiles.length === 0) return null;

    const chartData = { symbol, expiry, date, generated_at: new Date().toISOString(), data: [] };

    for (const file of jsonFiles) {
      try {
        const filePath = path.join(datePath, file);
        const data = readOptionChainFile(filePath);
        if (!data.option_chain || data.option_chain.length === 0) continue;
        const spotPrice = data.option_chain[0].underlying_spot_price || 0;
        let timeStr = data.metadata?.time_hhmmss || parseTimeFromFilename(file);
        if (spotPrice > 0) chartData.data.push({ time: timeStr.substring(0, 5), spot: spotPrice });
      } catch (e) {}
    }

    chartData.data.sort((a, b) => a.time.localeCompare(b.time));
    fs.writeFileSync(path.join(datePath, "_chart_spot.json"), JSON.stringify(chartData));
    return chartData;
  } catch (error) {
    return null;
  }
}

function generateStrategy40Data(datePath, symbol, expiry, date) {
  try {
    const jsonFiles = getDataFiles(datePath).sort();
    if (jsonFiles.length === 0) return null;

    // Always use the LATEST snapshot available (no time restriction)
    const targetFile = jsonFiles[jsonFiles.length - 1];

    const data = readOptionChainFile(path.join(datePath, targetFile));
    if (!data.option_chain || data.option_chain.length === 0) return null;

    const chain = data.option_chain;
    const spotPrice = chain[0].underlying_spot_price || 0;
    if (!spotPrice) return null;

    // Sort ascending by strike
    const sorted = [...chain].sort((a, b) => a.strike_price - b.strike_price);

    // Strike gap near ATM
    const atmIdx = sorted.findIndex(r => r.strike_price >= spotPrice);
    let strikeGap = 50;
    if (atmIdx > 0) {
      strikeGap = sorted[atmIdx].strike_price - sorted[atmIdx - 1].strike_price;
    } else if (sorted.length > 1) {
      const gc = {};
      for (let i = 1; i < sorted.length; i++) {
        const g = sorted[i].strike_price - sorted[i-1].strike_price;
        if (g > 0) gc[g] = (gc[g] || 0) + 1;
      }
      strikeGap = Number(Object.entries(gc).sort((a,b) => b[1]-a[1])[0]?.[0] || 50);
    }

    // Delta-based reversal: Formula = spot - (CE_ltp - PE_ltp) / (CE_delta - PE_delta)
    // Support at strike i: CE[i] (same) vs PE[i-1] (one below)
    const calcSupRevIdx = (i) => {
      if (i <= 0 || i >= sorted.length) return null;
      const ceLtp = parseFloat(sorted[i].call_options?.market_data?.ltp || 0);
      const ceDel = parseFloat(sorted[i].call_options?.option_greeks?.delta || 0);
      const peLtp = parseFloat(sorted[i-1].put_options?.market_data?.ltp || 0);
      const peDel = parseFloat(sorted[i-1].put_options?.option_greeks?.delta || 0);
      const den = ceDel - peDel;
      if (Math.abs(den) < 0.001) return null;
      const rev = spotPrice - (ceLtp - peLtp) / den;
      return isNaN(rev) ? null : Math.round(rev);
    };
    // Resistance at strike i: CE[i+1] (one above) vs PE[i] (same)
    const calcResRevIdx = (i) => {
      if (i < 0 || i >= sorted.length - 1) return null;
      const ceLtp = parseFloat(sorted[i+1].call_options?.market_data?.ltp || 0);
      const ceDel = parseFloat(sorted[i+1].call_options?.option_greeks?.delta || 0);
      const peLtp = parseFloat(sorted[i].put_options?.market_data?.ltp || 0);
      const peDel = parseFloat(sorted[i].put_options?.option_greeks?.delta || 0);
      const den = ceDel - peDel;
      if (Math.abs(den) < 0.001) return null;
      const rev = spotPrice - (ceLtp - peLtp) / den;
      return isNaN(rev) ? null : Math.round(rev);
    };

    // Support: scan TOP → DOWN, first strike where putOI > callOI
    let supIdx = -1, maxPutOI = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const c = sorted[i].call_options?.market_data?.oi || 0;
      const p = sorted[i].put_options?.market_data?.oi  || 0;
      if (p > c) { supIdx = i; maxPutOI = p; break; }
    }
    if (supIdx === -1) {
      for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i].put_options?.market_data?.oi || 0;
        if (p > maxPutOI) { maxPutOI = p; supIdx = i; }
      }
    }

    // Resistance: scan BOTTOM → UP, first strike where callOI > putOI
    let resIdx = -1, maxCallOI = 0;
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i].call_options?.market_data?.oi || 0;
      const p = sorted[i].put_options?.market_data?.oi  || 0;
      if (c > p) { resIdx = i; maxCallOI = c; break; }
    }
    if (resIdx === -1) {
      for (let i = 0; i < sorted.length; i++) {
        const c = sorted[i].call_options?.market_data?.oi || 0;
        if (c > maxCallOI) { maxCallOI = c; resIdx = i; }
      }
    }

    const support            = supIdx >= 0 ? sorted[supIdx].strike_price : 0;
    const resistance         = resIdx >= 0 ? sorted[resIdx].strike_price : 0;
    const supportReversal    = (supIdx >= 0 ? calcSupRevIdx(supIdx) : null) ?? support;
    const resistanceReversal = (resIdx >= 0 ? calcResRevIdx(resIdx) : null) ?? resistance;

    // Save ALL reversal values for every strike — used for gap-open correction next day
    // without needing to recalculate from option chain data
    const all_reversals = [];
    for (let i = 0; i < sorted.length; i++) {
      const strike  = sorted[i].strike_price;
      const sup_rev = calcSupRevIdx(i);   // CE[i], PE[i-1]
      const res_rev = calcResRevIdx(i);   // CE[i+1], PE[i]
      if (sup_rev !== null || res_rev !== null) {
        all_reversals.push({ strike, sup_rev, res_rev });
      }
    }

    const strategy40Data = {
      symbol, expiry, date, generated_at: new Date().toISOString(),
      time: parseTimeFromFilename(targetFile), spot_price: spotPrice, strike_gap: strikeGap,
      support, support_oi: maxPutOI, support_reversal: supportReversal,
      resistance, resistance_oi: maxCallOI, resistance_reversal: resistanceReversal,
      all_reversals,
    };

    fs.writeFileSync(path.join(datePath, "_chart_strategy40.json"), JSON.stringify(strategy40Data));

    // Always update _bromos_latest.json — always has the freshest data
    const safeSymbol = resolveSymbol(symbol);
    const symbolPath = path.join(PATHS.MARKET, safeSymbol);
    if (fs.existsSync(symbolPath)) {
      fs.writeFileSync(path.join(symbolPath, '_bromos_latest.json'), JSON.stringify(strategy40Data));
    }

    return strategy40Data;
  } catch (error) {
    return null;
  }
}

// ── Pure gap-correction helper (no side effects, usable for historical dates) ──
// prevBromos : saved bromos object — must contain all_reversals array
// openSpot   : today's opening spot price
// Returns a new bromos object with gap-corrected S/R (or the original if no gap).
function applyGapCorrection(prevBromos, openSpot) {
  const result = Object.assign({}, prevBromos);
  if (!result.support || !result.resistance || !openSpot) return result;

  const isGapDown = openSpot < result.support;
  const isGapUp   = openSpot > result.resistance;
  if (!isGapDown && !isGapUp) return result;

  const allRev = Array.isArray(result.all_reversals) ? result.all_reversals : [];

  if (isGapDown) {
    // Find the highest sup_rev that is still below today's open — no recalculation needed
    const candidates = allRev
      .filter(r => r.sup_rev != null && r.sup_rev < openSpot)
      .sort((a, b) => b.sup_rev - a.sup_rev); // descending → closest below openSpot first
    if (candidates.length) {
      result.gap_cut_support  = prevBromos.support_reversal; // old value for display
      result.support          = candidates[0].strike;
      result.support_reversal = candidates[0].sup_rev;
      result.gap_updated_at   = new Date().toISOString();
    }
    // R unchanged
  }

  if (isGapUp) {
    // Find the lowest res_rev that is still above today's open — no recalculation needed
    const candidates = allRev
      .filter(r => r.res_rev != null && r.res_rev > openSpot)
      .sort((a, b) => a.res_rev - b.res_rev); // ascending → closest above openSpot first
    if (candidates.length) {
      result.gap_cut_resistance  = prevBromos.resistance_reversal; // old value for display
      result.resistance          = candidates[0].strike;
      result.resistance_reversal = candidates[0].res_rev;
      result.gap_updated_at      = new Date().toISOString();
    }
    // S unchanged
  }

  return result;
}

// ── Gap-Open Bromos Update ────────────────────────────────────────────────────
// Called at 9:09 AM IST and at server startup.
// If today's spot has gapped above yesterday's resistance strike, or below
// yesterday's support strike, scan the chain for new S/R and update
// _bromos_latest.json.  Works even when liveCache is empty (reads disk).
function updateBromosForGapOpen(symbol) {
  try {
    const safeSymbol = resolveSymbol(symbol);
    const symbolPath = path.join(PATHS.MARKET, safeSymbol);

    // ── Find the most recent _chart_strategy40.json (last saved day) ─────────
    // generateAllChartData runs on every data fetch, so the last file of each
    // day is naturally the post-3:35 PM snapshot — no time filter needed.
    let prevBromos = null;
    let prevDp     = null;
    const expiries = folders(symbolPath).filter(f => !f.startsWith('_')).sort();
    outerFind: for (const exp of expiries.slice().reverse()) {
      const dates = folders(path.join(symbolPath, exp)).sort();
      for (const dt of dates.slice().reverse()) {
        const dp  = path.join(symbolPath, exp, dt);
        const s40 = safeReadJson(path.join(dp, '_chart_strategy40.json'));
        if (s40?.support && s40?.resistance) {
          prevBromos = s40;
          prevDp     = dp;
          break outerFind;
        }
      }
    }
    if (!prevBromos || !prevDp) return;

    // ── Get today's opening spot ──────────────────────────────────────────────
    let spot = 0;
    const live = liveCache.get(safeSymbol);
    if (live?.spot_price) {
      spot = live.spot_price;
    } else {
      // Fallback: read latest snapshot from disk
      outerSpot: for (const exp of expiries.slice().reverse()) {
        const dates = folders(path.join(symbolPath, exp)).sort();
        for (const dt of dates.slice().reverse()) {
          const dp    = path.join(symbolPath, exp, dt);
          const files = getDataFiles(dp).sort();
          if (!files.length) continue;
          const d = readOptionChainFile(path.join(dp, files[files.length - 1]));
          if (d?.option_chain?.length) {
            spot = d.option_chain[0]?.underlying_spot_price || 0;
            if (spot) break outerSpot;
          }
        }
      }
    }
    if (!spot) return;

    // Apply gap correction using pre-saved all_reversals (no chain reload needed)
    const updated = applyGapCorrection(prevBromos, spot);
    if (updated.gap_updated_at !== prevBromos.gap_updated_at) {
      // Write back to D-1's _chart_strategy40.json
      fs.writeFileSync(path.join(prevDp, '_chart_strategy40.json'), JSON.stringify(updated));
      // Also update _bromos_latest.json so live signals API sees corrected values
      fs.writeFileSync(path.join(symbolPath, '_bromos_latest.json'), JSON.stringify(updated));
      _sigCache.delete(safeSymbol);
      const rInfo = updated.gap_cut_resistance ? ` R: ${updated.gap_cut_resistance}→${updated.resistance_reversal}` : '';
      const sInfo = updated.gap_cut_support    ? ` S: ${updated.gap_cut_support}→${updated.support_reversal}` : '';
      console.log(`📊 Bromos gap-open update [${safeSymbol}]:${rInfo}${sInfo}`);
    } else {
      console.log(`📊 Bromos gap-open [${safeSymbol}]: no gap vs S=${prevBromos.support}/R=${prevBromos.resistance} (spot=${spot})`);
    }
  } catch (e) {
    console.error(`❌ updateBromosForGapOpen error (${symbol}):`, e.message);
  }
}

module.exports.updateBromosForGapOpen = updateBromosForGapOpen;

// ============ SHIFTING DETECTION SYSTEM ============

/**
 * Shifting Detection Logic:
 * - For PUT (Support): Look from spot price, 2 strikes UP then DOWN
 *   - Find first 100% in Vol, OI, or OI Change
 *   - If 100% moves from LOWER strike to HIGHER strike = SFBTT (Shifted From Bottom To Top) ⬆️
 *   - If 100% moves from HIGHER strike to LOWER strike = SFTB (Shifted From Top To Bottom) ⬇️
 * 
 * - For CALL (Resistance): Look from spot price, 2 strikes DOWN then UP
 *   - Same logic applies
 * 
 * Strength Types:
 * - "Strong": Vol+OI both at 100%
 * - "V+OC": Vol+OI Change both at 100%
 * - "O+OC": OI+OI Change both at 100%
 * - Single metric names if only one at 100%
 */

function analyzeShiftingForSnapshot(chain, spotPrice, strikeGap) {
  // Sort chain by strike price
  const sorted = [...chain].sort((a, b) => a.strike_price - b.strike_price);
  
  // Find ATM index
  let atmIdx = 0;
  let minDiff = Infinity;
  sorted.forEach((row, idx) => {
    const diff = Math.abs(row.strike_price - spotPrice);
    if (diff < minDiff) {
      minDiff = diff;
      atmIdx = idx;
    }
  });
  
  // Calculate max values for percentages (within ±12 strikes of ATM)
  const startIdx = Math.max(0, atmIdx - 12);
  const endIdx = Math.min(sorted.length, atmIdx + 13);
  const displayChain = sorted.slice(startIdx, endIdx);
  
  let maxCallVol = 1, maxCallOI = 1, maxCallOIChg = 1;
  let maxPutVol = 1, maxPutOI = 1, maxPutOIChg = 1;
  
  displayChain.forEach(row => {
    const cc = row.call_options?.market_data || {};
    const pc = row.put_options?.market_data || {};
    
    if ((cc.volume || 0) > maxCallVol) maxCallVol = cc.volume;
    if ((cc.oi || 0) > maxCallOI) maxCallOI = cc.oi;
    const callOIChg = Math.abs((cc.oi || 0) - (cc.prev_oi || 0));
    if (callOIChg > maxCallOIChg) maxCallOIChg = callOIChg;
    
    if ((pc.volume || 0) > maxPutVol) maxPutVol = pc.volume;
    if ((pc.oi || 0) > maxPutOI) maxPutOI = pc.oi;
    const putOIChg = Math.abs((pc.oi || 0) - (pc.prev_oi || 0));
    if (putOIChg > maxPutOIChg) maxPutOIChg = putOIChg;
  });
  
  // Calculate percentages for each strike
  const strikeData = {};
  displayChain.forEach(row => {
    const strike = row.strike_price;
    const cc = row.call_options?.market_data || {};
    const pc = row.put_options?.market_data || {};
    
    const callVolPct = Math.round((cc.volume || 0) / maxCallVol * 100);
    const callOIPct = Math.round((cc.oi || 0) / maxCallOI * 100);
    const callOIChgPct = Math.round(Math.abs((cc.oi || 0) - (cc.prev_oi || 0)) / maxCallOIChg * 100);
    
    const putVolPct = Math.round((pc.volume || 0) / maxPutVol * 100);
    const putOIPct = Math.round((pc.oi || 0) / maxPutOI * 100);
    const putOIChgPct = Math.round(Math.abs((pc.oi || 0) - (pc.prev_oi || 0)) / maxPutOIChg * 100);
    
    strikeData[strike] = {
      call: { vol: callVolPct, oi: callOIPct, oiChg: callOIChgPct },
      put: { vol: putVolPct, oi: putOIPct, oiChg: putOIChgPct }
    };
  });
  
  // Find strongest strikes for CALL (Resistance) and PUT (Support)
  function findStrongestStrike(data, side, direction, startStrike) {
    const strikes = Object.keys(data).map(Number).sort((a, b) => a - b);
    let searchStrikes = [];
    
    if (side === 'call') {
      // For CALL: Start from spot - 2 strikes, go UP
      const startIdx = strikes.findIndex(s => s >= startStrike - (strikeGap * 2));
      if (startIdx >= 0) {
        searchStrikes = strikes.slice(startIdx);
      }
    } else {
      // For PUT: Start from spot + 2 strikes, go DOWN
      const endIdx = strikes.findIndex(s => s > startStrike + (strikeGap * 2));
      if (endIdx > 0) {
        searchStrikes = strikes.slice(0, endIdx).reverse();
      } else {
        searchStrikes = [...strikes].reverse();
      }
    }
    
    // Find first strike with 100% in any metric
    for (const strike of searchStrikes) {
      const d = data[strike][side];
      const has100Vol = d.vol >= 95;
      const has100OI = d.oi >= 95;
      const has100OIChg = d.oiChg >= 95;
      
      if (has100Vol || has100OI || has100OIChg) {
        // Determine strength type
        let strength = [];
        if (has100Vol && has100OI) strength.push("Strong");
        else if (has100Vol && has100OIChg) strength.push("V+OC");
        else if (has100OI && has100OIChg) strength.push("O+OC");
        else {
          if (has100Vol) strength.push("Vol");
          if (has100OI) strength.push("OI");
          if (has100OIChg) strength.push("OIChg");
        }
        
        return {
          strike: strike,
          strength: strength.join("+") || "Strong",
          vol: d.vol,
          oi: d.oi,
          oiChg: d.oiChg
        };
      }
    }
    
    return null;
  }
  
  const atmStrike = sorted[atmIdx]?.strike_price || spotPrice;
  
  return {
    spotPrice: spotPrice,
    atmStrike: atmStrike,
    strikeGap: strikeGap,
    resistance: findStrongestStrike(strikeData, 'call', 'up', atmStrike),
    support: findStrongestStrike(strikeData, 'put', 'down', atmStrike),
    strikeData: strikeData
  };
}

function generateShiftingData(datePath, symbol, expiry, date) {
  try {
    const jsonFiles = getDataFiles(datePath).sort();
    if (jsonFiles.length === 0) return null;
    
    const shiftingData = {
      symbol,
      expiry,
      date,
      generated_at: new Date().toISOString(),
      timeline: [],
      shifts: {
        resistance: [],
        support: []
      }
    };
    
    let prevResistance = null;
    let prevSupport = null;
    let startedFrom915 = false;
    
    for (const file of jsonFiles) {
      try {
        const filePath = path.join(datePath, file);
        const data = readOptionChainFile(filePath);
        
        if (!data.option_chain || data.option_chain.length === 0) continue;
        
        const spotPrice = data.option_chain[0].underlying_spot_price || 0;
        let timeStr = data.metadata?.time_hhmmss || parseTimeFromFilename(file);
        const timeShort = timeStr.substring(0, 5);
        
        // Skip data before 9:15 AM
        if (timeStr < "09:15:00" && !startedFrom915) {
          continue;
        }
        startedFrom915 = true;
        
        // Calculate strike gap
        const sorted = [...data.option_chain].sort((a, b) => a.strike_price - b.strike_price);
        const strikeGap = sorted.length > 1 ? Math.abs(sorted[1].strike_price - sorted[0].strike_price) : 50;
        
        // Analyze this snapshot
        const analysis = analyzeShiftingForSnapshot(data.option_chain, spotPrice, strikeGap);
        
        // Detect shifts
        let resistanceShift = null;
        let supportShift = null;
        
        if (analysis.resistance && prevResistance) {
          if (analysis.resistance.strike !== prevResistance.strike) {
            // Shift detected!
            if (analysis.resistance.strike > prevResistance.strike) {
              resistanceShift = {
                type: "SFBTT", // Shifted From Bottom To Top
                from: prevResistance.strike,
                to: analysis.resistance.strike,
                time: timeShort,
                fromStrength: prevResistance.strength,
                toStrength: analysis.resistance.strength
              };
            } else {
              resistanceShift = {
                type: "SFTB", // Shifted From Top To Bottom
                from: prevResistance.strike,
                to: analysis.resistance.strike,
                time: timeShort,
                fromStrength: prevResistance.strength,
                toStrength: analysis.resistance.strength
              };
            }
            shiftingData.shifts.resistance.push(resistanceShift);
          }
        }
        
        if (analysis.support && prevSupport) {
          if (analysis.support.strike !== prevSupport.strike) {
            // Shift detected!
            if (analysis.support.strike > prevSupport.strike) {
              supportShift = {
                type: "SFBTT", // Shifted From Bottom To Top
                from: prevSupport.strike,
                to: analysis.support.strike,
                time: timeShort,
                fromStrength: prevSupport.strength,
                toStrength: analysis.support.strength
              };
            } else {
              supportShift = {
                type: "SFTB", // Shifted From Top To Bottom
                from: prevSupport.strike,
                to: analysis.support.strike,
                time: timeShort,
                fromStrength: prevSupport.strength,
                toStrength: analysis.support.strength
              };
            }
            shiftingData.shifts.support.push(supportShift);
          }
        }
        
        // Add to timeline
        shiftingData.timeline.push({
          time: timeShort,
          spot: spotPrice,
          resistance: analysis.resistance ? {
            strike: analysis.resistance.strike,
            strength: analysis.resistance.strength,
            shift: resistanceShift ? resistanceShift.type : null,
            shiftFrom: resistanceShift ? resistanceShift.from : null
          } : null,
          support: analysis.support ? {
            strike: analysis.support.strike,
            strength: analysis.support.strength,
            shift: supportShift ? supportShift.type : null,
            shiftFrom: supportShift ? supportShift.from : null
          } : null
        });
        
        prevResistance = analysis.resistance;
        prevSupport = analysis.support;
        
      } catch (e) {
     }
    }
    
    // Save shifting data
    const shiftingFile = path.join(datePath, "_shifting.json");
    fs.writeFileSync(shiftingFile, JSON.stringify(shiftingData, null, 2));
    
    return shiftingData;
    
  } catch (error) {
    return null;
  }
}


// ══════════════════════════════════════════════════════════
// MCTR — Max Controlled Trade Range
// PUT 100% (vol+oi+oiChg) since 9:15, no support shift → MCTR Support
// CALL 100% (vol+oi+oiChg) since 9:15, no resistance shift → MCTR Resistance
// CALL at same PUT strike must NOT be strong (and vice versa)
// ══════════════════════════════════════════════════════════
function generateMCTRData(datePath, symbol, expiry, date) {
  try {
    const jsonFiles = getDataFiles(datePath).sort();
    if (jsonFiles.length === 0) return null;

    const mctrFile = path.join(datePath, '_mctr.json');

    // LOCK: signal pehle se hai to sirf touched update karo
    if (fs.existsSync(mctrFile)) {
      try {
        const ex = JSON.parse(fs.readFileSync(mctrFile, 'utf8'));
        if (ex.mctr_support !== null && ex.mctr_resistance !== null) {
          const ld = readOptionChainFile(path.join(datePath, jsonFiles[jsonFiles.length - 1]));
          const liveSpot = ld.option_chain?.[0]?.underlying_spot_price || ex.last_spot;
          if (ex.mctr_support)    ex.mctr_support.reversal_touched    = liveSpot <= ex.mctr_support.reversal;
          if (ex.mctr_resistance) ex.mctr_resistance.reversal_touched = liveSpot >= ex.mctr_resistance.reversal;
          ex.last_spot = liveSpot;
          fs.writeFileSync(mctrFile, JSON.stringify(ex, null, 2));
          return ex;
        }
      } catch(e) {}
    }

    // 9:15 se file by file scan — pehla strong strike = MCTR, band
    let supStrike = null, supTime = null, supSorted = null, supSpot = 0;
    let resStrike = null, resTime = null, resSorted = null, resSpot = 0;

    for (const file of jsonFiles) {
      if (supStrike && resStrike) break;
      const t = parseTimeFromFilename(file);
      if (t < '09:15:00') continue;

      let data;
      try {
        data = readOptionChainFile(path.join(datePath, file));
        if (!data.option_chain || data.option_chain.length === 0) continue;
      } catch(e) { continue; }

      const chain  = data.option_chain;
      const spot   = chain[0].underlying_spot_price || 0;
      const time   = (data.metadata?.time_hhmmss || t).substring(0, 5);
      const sorted = [...chain].sort((a,b) => a.strike_price - b.strike_price);
      const gap    = sorted.length > 1 ? Math.abs(sorted[1].strike_price - sorted[0].strike_price) : 50;

      // ATM ± 10 window (same as screen — 10 strikes above and 10 below spot)
      let atmIdx = 0, minDiff = Infinity;
      sorted.forEach((r,i) => { const d=Math.abs(r.strike_price-spot); if(d<minDiff){minDiff=d;atmIdx=i;} });
      const win = sorted.slice(Math.max(0,atmIdx-10), Math.min(sorted.length,atmIdx+11));

      // Max sirf is window ke andar se
      let mCV=1,mCO=1,mPV=1,mPO=1;
      win.forEach(r => {
        const cc=r.call_options?.market_data||{}, pc=r.put_options?.market_data||{};
        if((cc.volume||0)>mCV) mCV=cc.volume;
        if((cc.oi||0)>mCO)     mCO=cc.oi;
        if((pc.volume||0)>mPV) mPV=pc.volume;
        if((pc.oi||0)>mPO)     mPO=pc.oi;
      });

      // Har window strike ka percentage
      const sd = {};
      win.forEach(r => {
        const s=r.strike_price, cc=r.call_options?.market_data||{}, pc=r.put_options?.market_data||{};
        sd[s] = {
          c: { v: Math.round((cc.volume||0)/mCV*100), o: Math.round((cc.oi||0)/mCO*100) },
          p: { v: Math.round((pc.volume||0)/mPV*100), o: Math.round((pc.oi||0)/mPO*100) }
        };
      });

      const strong  = (d) => d && d.v >= 95 && d.o >= 95;
      const allWeak = (d) => !d || (d.v < 95 && d.o < 95);

      // PUT strong + CALL weak = Support
      // Scan from highest strike downward (nearest to spot first)
      if (!supStrike) {
        const cands = Object.keys(sd).map(Number).sort((a, b) => b - a);
        for (const s of cands) {
          if (strong(sd[s]?.p) && allWeak(sd[s]?.c)) {
            supStrike=s; supTime=time; supSorted=sorted; supSpot=spot; break;
          }
        }
      }

      // CALL strong + PUT weak = Resistance
      // Scan from lowest strike upward (nearest to spot first)
      if (!resStrike) {
        const cands = Object.keys(sd).map(Number).sort((a, b) => a - b);
        for (const s of cands) {
          if (strong(sd[s]?.c) && allWeak(sd[s]?.p)) {
            resStrike=s; resTime=time; resSorted=sorted; resSpot=spot; break;
          }
        }
      }
    }

    // Reversal: delta formula — CE.ltp/delta and PE.ltp/delta from option_greeks
    // Support: CE at strike i, PE at strike i-1 (below)
    const calcSupRev = (strike, sortedChain, spot) => {
      const i=sortedChain.findIndex(r=>r.strike_price===strike);
      if(i<=0) return strike;
      const ceLtp=parseFloat(sortedChain[i].call_options?.market_data?.ltp||0);
      const ceDel=parseFloat(sortedChain[i].call_options?.option_greeks?.delta||0);
      const peLtp=parseFloat(sortedChain[i-1].put_options?.market_data?.ltp||0);
      const peDel=parseFloat(sortedChain[i-1].put_options?.option_greeks?.delta||0);
      const den=ceDel-peDel;
      if(den===0||isNaN(den)) return strike;
      const rev=spot-(ceLtp-peLtp)/den;
      return isNaN(rev)?strike:Math.round(rev);
    };
    // Resistance: PE at strike i, CE at strike i+1 (above)
    const calcResRev = (strike, sortedChain, spot) => {
      const i=sortedChain.findIndex(r=>r.strike_price===strike);
      if(i<0||i>=sortedChain.length-1) return strike;
      const ceLtp=parseFloat(sortedChain[i+1].call_options?.market_data?.ltp||0);
      const ceDel=parseFloat(sortedChain[i+1].call_options?.option_greeks?.delta||0);
      const peLtp=parseFloat(sortedChain[i].put_options?.market_data?.ltp||0);
      const peDel=parseFloat(sortedChain[i].put_options?.option_greeks?.delta||0);
      const den=ceDel-peDel;
      if(den===0||isNaN(den)) return strike;
      const rev=spot-(ceLtp-peLtp)/den;
      return isNaN(rev)?strike:Math.round(rev);
    };

    // Last file se current spot
    let currentSpot=0, lastTime='15:30';
    try {
      const ld = readOptionChainFile(path.join(datePath, jsonFiles[jsonFiles.length-1]));
      if(ld.option_chain?.length>0) {
        currentSpot=ld.option_chain[0].underlying_spot_price||0;
        lastTime=(ld.metadata?.time_hhmmss||parseTimeFromFilename(jsonFiles[jsonFiles.length-1])).substring(0,5);
      }
    } catch(e) {}

    const supRev = supStrike ? calcSupRev(supStrike, supSorted, supSpot) : null;
    const resRev = resStrike ? calcResRev(resStrike, resSorted, resSpot) : null;

    const result = {
      symbol, expiry, date,
      generated_at:   new Date().toISOString(),
      last_spot:      currentSpot,
      last_time:      lastTime,
      snapshot_count: jsonFiles.length,
      mctr_support: supStrike ? {
        strike: supStrike, found_at: supTime,
        reversal: supRev, reversal_touched: currentSpot <= supRev
      } : null,
      mctr_resistance: resStrike ? {
        strike: resStrike, found_at: resTime,
        reversal: resRev, reversal_touched: currentSpot >= resRev
      } : null
    };

    fs.writeFileSync(mctrFile, JSON.stringify(result, null, 2));
    return result;

  } catch(err) { return null; }
}


// Throttle map: key = "symbol|expiry|date", value = last generation timestamp
const _chartGenThrottle = {};

function generateAllChartData(symbol, expiry, date) {
  const safeSymbol = resolveSymbol(symbol);
  const datePath = path.join(PATHS.MARKET, safeSymbol, expiry, date);
  if (!fs.existsSync(datePath)) return;

  // Throttle: auto-generate every 120 seconds per symbol/expiry/date
  const throttleKey = `${safeSymbol}|${expiry}|${date}`;
  const now = Date.now();
  const last = _chartGenThrottle[throttleKey] || 0;
  if (now - last < 120000) return;
  _chartGenThrottle[throttleKey] = now;

  generateOIChartData(datePath, symbol, expiry, date);
  generateOIChngChartData(datePath, symbol, expiry, date);
  generateSpotChartData(datePath, symbol, expiry, date);
  generateShiftingData(datePath, symbol, expiry, date);
  generateMCTRData(datePath, symbol, expiry, date);

  // Strategy 4.0: generate at 3:30–3:35 PM (after-market close), or if file missing.
  // This locks end-of-day OI positioning for next day's Bromos R/S reference.
  const s40File = path.join(datePath, "_chart_strategy40.json");
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const h = nowIST.getUTCHours(), m = nowIST.getUTCMinutes();
  const inClosingWindow = (h === 15 && m >= 30 && m <= 35);
  if (!fs.existsSync(s40File) || inClosingWindow) {
    generateStrategy40Data(datePath, symbol, expiry, date);
  }
}

function autoGenerateMissingChartData() {
  const dataDir = PATHS.MARKET;
  if (!fs.existsSync(dataDir)) return;

  // Silent scan for missing chart data
  folders(dataDir).forEach(symbol => {
    folders(path.join(dataDir, symbol)).forEach(expiry => {
      folders(path.join(dataDir, symbol, expiry)).forEach(date => {
        const datePath = path.join(dataDir, symbol, expiry, date);
        if (getDataFiles(datePath).length === 0) return;

        const missing = [
          !fs.existsSync(path.join(datePath, "_chart_oi.json")),
          !fs.existsSync(path.join(datePath, "_chart_oichng.json")),
          !fs.existsSync(path.join(datePath, "_chart_spot.json")),
          !fs.existsSync(path.join(datePath, "_chart_strategy40.json")),
          !fs.existsSync(path.join(datePath, "_shifting.json")),
          !fs.existsSync(path.join(datePath, "_mctr.json"))
        ].some(x => x);

        if (missing) {
          generateAllChartData(symbol, expiry, date);
        }
      });
    });
  });
}

module.exports.generateAllChartData = generateAllChartData;
module.exports.autoGenerateMissingChartData = autoGenerateMissingChartData;

// Force-regenerate ALL _chart_strategy40.json and _bromos_latest.json from scratch.
// Called on every server restart so reversal values are always up-to-date.
function regenerateAllStrategy40() {
  const dataDir = PATHS.MARKET;
  if (!fs.existsSync(dataDir)) return;

  // Delete only _chart_strategy40.json files (force fresh calc with correct formula).
  // Do NOT delete _bromos_latest.json — it holds yesterday's EOD levels used for
  // gap-open detection; deleting it would erase the base for updateBromosForGapOpen.
  folders(dataDir).forEach(sym => {
    const symPath = path.join(dataDir, sym);
    folders(symPath).forEach(exp => {
      folders(path.join(symPath, exp)).forEach(dt => {
        const s40 = path.join(symPath, exp, dt, '_chart_strategy40.json');
        if (fs.existsSync(s40)) try { fs.unlinkSync(s40); } catch(e) {}
      });
    });
  });

  // Regenerate and track newest EOD date per symbol
  // symLatestEOD only updates when the snapshot is >= 15:00 (real EOD data).
  // Today's pre-market date must never become _bromos_latest.json.
  let generated = 0, failed = 0;
  const symLatestEOD = {};    // sym → { data, date }

  folders(dataDir).forEach(sym => {
    const symPath = path.join(dataDir, sym);
    folders(symPath).forEach(exp => {
      folders(path.join(symPath, exp)).forEach(dt => {
        const dp = path.join(symPath, exp, dt);
        if (getDataFiles(dp).length === 0) return;
        const result = generateStrategy40Data(dp, sym, exp, dt);
        if (result) {
          generated++;
          // Only track as "latest" if the snapshot was taken after 15:00 (EOD)
          const isEOD = (result.time || '') >= '15:00:00';
          if (isEOD && (!symLatestEOD[sym] || dt > symLatestEOD[sym].date)) {
            symLatestEOD[sym] = { data: result, date: dt };
          }
        } else { failed++; }
      });
    });
  });

  // Write _bromos_latest.json only from EOD snapshots
  let bromosUpdated = 0;
  Object.entries(symLatestEOD).forEach(([sym, { data }]) => {
    try {
      fs.writeFileSync(path.join(dataDir, sym, '_bromos_latest.json'), JSON.stringify(data, null, 2));
      bromosUpdated++;
    } catch(e) {}
  });

  console.log(`  ✅ Strategy40/Bromos regenerated — generated:${generated} failed:${failed} bromos:${bromosUpdated}`);

  // After all _chart_strategy40.json files are written, apply gap corrections
  generateBromosOpenForAllDates();

  // Re-read each symbol's latest EOD _chart_strategy40.json (now gap-corrected)
  // and overwrite _bromos_latest.json so the live UI sees the correct values
  folders(dataDir).forEach(sym => {
    const symPath = path.join(dataDir, sym);
    let latestEOD = null, latestDate = '';
    folders(symPath).filter(f => !f.startsWith('_')).forEach(exp => {
      folders(path.join(symPath, exp)).sort().forEach(dt => {
        const s40 = safeReadJson(path.join(symPath, exp, dt, '_chart_strategy40.json'));
        if (s40?.support && s40?.resistance && (s40.time || '') >= '15:00:00' && dt > latestDate) {
          latestDate = dt;
          latestEOD  = s40;
        }
      });
    });
    if (latestEOD) {
      try {
        fs.writeFileSync(path.join(symPath, '_bromos_latest.json'), JSON.stringify(latestEOD));
      } catch(e) {}
    }
  });
  console.log('  ✅ _bromos_latest.json updated with gap-corrected values');
}
module.exports.regenerateAllStrategy40 = regenerateAllStrategy40;

// ── Gap-correct all historical _chart_strategy40.json files ───────────────────
// For each date D: gets opening spot from D's first snapshot.
// Loads D-1's EOD chain data, applies gap correction, and if a gap occurred,
// overwrites D-1's _chart_strategy40.json with corrected S/R values.
// D's header reads the corrected D-1 file directly — no separate file needed.
function generateBromosOpenForAllDates() {
  const dataDir = PATHS.MARKET;
  if (!fs.existsSync(dataDir)) return;

  let generated = 0;

  folders(dataDir).forEach(sym => {
    const symPath = path.join(dataDir, sym);
    folders(symPath).forEach(exp => {
      const expPath  = path.join(symPath, exp);
      const allDates = folders(expPath).sort(); // chronological

      for (let di = 1; di < allDates.length; di++) {  // start at 1 — need D-1
        try {
          const dt     = allDates[di];       // today (D)
          const prevDt = allDates[di - 1];   // previous day (D-1)
          const dp     = path.join(expPath, dt);
          const prevDp = path.join(expPath, prevDt);

          // D-1's EOD strategy40 (base levels)
          const prevBromos = safeReadJson(path.join(prevDp, '_chart_strategy40.json'));
          if (!prevBromos?.support || !prevBromos?.resistance) continue;

          // D's opening spot — use first snapshot at or after 09:09 AM (post-open),
          // fallback to first snapshot of the day if none found
          const files = getDataFiles(dp).sort();
          if (!files.length) continue;
          const openFile = files.find(f => parseTimeFromFilename(f) >= '09:09:00') || files[0];
          const openData = readOptionChainFile(path.join(dp, openFile));
          if (!openData?.option_chain?.length) continue;
          const spot = openData.option_chain[0]?.underlying_spot_price || 0;
          if (!spot) continue;

          // Apply gap correction using pre-saved all_reversals (no chain reload needed)
          const corrected = applyGapCorrection(prevBromos, spot);
          if (corrected.gap_updated_at) {
            // Overwrite D-1's _chart_strategy40.json with gap-corrected values
            fs.writeFileSync(path.join(prevDp, '_chart_strategy40.json'), JSON.stringify(corrected));
            generated++;
          }
        } catch (_) {}
      }
    });
  });

  console.log(`  ✅ Bromos gap-corrected and written back to prev date for ${generated} dates`);
}
module.exports.generateBromosOpenForAllDates = generateBromosOpenForAllDates;
// ── Backfill ALL existing date folders that are missing _mctr.json ──────────
function backfillMCTRData(forceAll) {
  const dataDir = PATHS.MARKET;
  if (!fs.existsSync(dataDir)) return;
  folders(dataDir).forEach(sym => {
    folders(path.join(dataDir, sym)).forEach(exp => {
      folders(path.join(dataDir, sym, exp)).forEach(dt => {
        const dp = path.join(dataDir, sym, exp, dt);
        if (getDataFiles(dp).length === 0) return;
        const mf = path.join(dp, '_mctr.json');
        if (forceAll && fs.existsSync(mf)) { try { fs.unlinkSync(mf); } catch(e) {} }
        if (!forceAll && fs.existsSync(mf)) return;
        generateMCTRData(dp, sym, exp, dt);
      });
    });
  });
}
setTimeout(() => backfillMCTRData(false), 3000);
// Generate missing _chart_strategy40.json (and all other chart files) for all date folders
setTimeout(() => autoGenerateMissingChartData(), 6000);

// ── Backfill _bromos_latest.json at symbol level from newest _chart_strategy40.json ──
function backfillBromosLatest() {
  const dataDir = PATHS.MARKET;
  if (!fs.existsSync(dataDir)) return;
  folders(dataDir).forEach(sym => {
    const symPath = path.join(dataDir, sym);
    const bromosFile = path.join(symPath, '_bromos_latest.json');
    // Already exists — skip
    if (fs.existsSync(bromosFile)) return;
    // Find the newest _chart_strategy40.json across all expiry/date folders
    let latestDate = '';
    let latestData = null;
    folders(symPath).forEach(exp => {
      folders(path.join(symPath, exp)).forEach(dt => {
        const s40 = path.join(symPath, exp, dt, '_chart_strategy40.json');
        if (fs.existsSync(s40) && dt > latestDate) {
          const parsed = safeReadJson(s40);
          if (parsed && parsed.support_reversal != null && parsed.resistance_reversal != null) {
            latestDate = dt;
            latestData = parsed;
          }
        }
      });
    });
    if (latestData) {
      try { fs.writeFileSync(bromosFile, JSON.stringify(latestData)); } catch (e) {}
    }
  });
}
setTimeout(() => backfillBromosLatest(), 20000);


module.exports.generateShiftingData = generateShiftingData;
module.exports.backfillMCTRData = backfillMCTRData;

// ── VOL/OI Change Tracker ─────────────────────────────────────────────────────
// ── VOL/OI CHANGE TRACKER ────────────────────────────────────────────────────
// voloichng.json is written inside every Data/{sym}/{exp}/{date}/ folder.
// Strategy: always read directly from the saved .gz files on disk — no in-memory
// buffer. This means:
//   • Backfill on restart  → generate for every folder that is missing the file
//   • Live regen (5-min)   → re-read today's .gz files, rewrite voloichng.json
//   • After market close   → file stays as-is with last computed data

// ── Helper: parse timestamp from filename only (no file read needed) ─────────
function _tsFromFilename(filename, dateStr) {
  const timeStr = parseTimeFromFilename(filename);
  if (!timeStr || timeStr === '00:00:00') return NaN;
  const [hh, mm, ss] = timeStr.split(':').map(Number);
  return new Date(
    `${dateStr}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}+05:30`
  ).getTime();
}

// ── Helper: read one file into a strikes snapshot ────────────────────────────
function _readStrikesFromFile(filePath, ts) {
  const data = readOptionChainFile(filePath);
  const strikes = {};
  for (const row of (data.option_chain || [])) {
    const cc = row.call_options?.market_data || {};
    const pc = row.put_options?.market_data || {};
    strikes[row.strike_price] = { cv: cc.volume||0, co: cc.oi||0, pv: pc.volume||0, po: pc.oi||0 };
  }
  return { ts, strikes };
}

// ── Helper: build ONLY the required snapshots (latest + one per window) ───────
// Reads at most 4 files per folder instead of all 1000+.
// Uses filename-based timestamps to locate reference files without reading them.
function _buildSnapsFromFolder(datePath, dateStr) {
  const snapFiles = getDataFiles(datePath).sort();
  if (snapFiles.length === 0) return [];

  // Map filename → timestamp using filename parsing only (no disk reads)
  const tsMap = [];
  for (const f of snapFiles) {
    const ts = _tsFromFilename(f, dateStr);
    if (!isNaN(ts)) tsMap.push({ f, ts });
  }
  if (tsMap.length === 0) return [];

  // Always read the last file (current state)
  const last = tsMap[tsMap.length - 1];
  const WINDOWS = [5, 15, 30];

  // For each window, find the file whose timestamp is closest to (lastTs - window)
  const neededFiles = new Set([last.f]);
  for (const win of WINDOWS) {
    const targetTs = last.ts - win * 60 * 1000;
    let best = tsMap[0];
    for (const entry of tsMap) {
      if (Math.abs(entry.ts - targetTs) < Math.abs(best.ts - targetTs)) best = entry;
    }
    if (best.f !== last.f) neededFiles.add(best.f);
  }

  // Read only the needed files
  const snaps = [];
  for (const f of snapFiles) {
    if (!neededFiles.has(f)) continue;
    try {
      const entry = tsMap.find(e => e.f === f);
      if (!entry) continue;
      snaps.push(_readStrikesFromFile(path.join(datePath, f), entry.ts));
    } catch (_) {}
  }
  return snaps.sort((a, b) => a.ts - b.ts);
}

// ── Helper: compute deltas for one time window ────────────────────────────────
function _computeVolOiChanges(snaps, windowMinutes) {
  if (snaps.length < 2) return {};
  const current  = snaps[snaps.length - 1];
  const targetTs = current.ts - windowMinutes * 60 * 1000;
  let ref = snaps[0];
  for (const s of snaps) {
    if (Math.abs(s.ts - targetTs) < Math.abs(ref.ts - targetTs)) ref = s;
  }
  if (ref === current) return {};
  const out = {};
  for (const [strike, cur] of Object.entries(current.strikes)) {
    const old = ref.strikes[strike];
    if (!old) continue;
    out[strike] = { callVol: cur.cv-old.cv, callOI: cur.co-old.co, putVol: cur.pv-old.pv, putOI: cur.po-old.po };
  }
  return out;
}

// ── Helper: build voloichng.json from disk snapshots and write it ─────────────
function _writeVolOiFile(datePath, snaps) {
  const result = { updated: new Date().toISOString(), 5: {}, 15: {}, 30: {} };
  for (const win of [5, 15, 30]) result[win] = _computeVolOiChanges(snaps, win);
  fs.writeFileSync(path.join(datePath, '_voloichng.json'), JSON.stringify(result));
  return result;
}

// ── Regenerate voloichng.json for a single date folder from its saved files ───
function regenVolOiForFolder(datePath, dateStr) {
  try {
    if (!fs.existsSync(datePath)) return;
    const snaps = _buildSnapsFromFolder(datePath, dateStr);
    _writeVolOiFile(datePath, snaps);
  } catch (_) {}
}

// ── Backfill on server start ──────────────────────────────────────────────────
// Scans EVERY Data/{sym}/{exp}/{date} folder that has at least 1 data file.
// ALWAYS generates voloichng.json from the saved .gz files — even if the file
// already exists. This ensures every folder is up to date on every restart.
// Logs every generated/failed file and a summary at the end.
function backfillVolOiCng() {
  const dataDir = PATHS.MARKET;
  if (!fs.existsSync(dataDir)) return;

  // Collect all folders first, then process one-per-tick so the event loop stays free
  const queue = [];
  folders(dataDir).forEach(sym => {
    const symPath = path.join(dataDir, sym);
    folders(symPath).forEach(exp => {
      folders(path.join(symPath, exp)).forEach(dt => {
        const datePath = path.join(symPath, exp, dt);
        if (getDataFiles(datePath).length > 0) queue.push({ sym, exp, dt, datePath });
      });
    });
  });

  let totalGenerated = 0, totalFailed = 0;
  console.log(`[VOL/OI] Starting backfill — ${queue.length} folders to process...`);

  let i = 0;
  function next() {
    if (i >= queue.length) {
      console.log(`[VOL/OI] Backfill done — checked:${queue.length}  generated:${totalGenerated}  failed:${totalFailed}`);
      return;
    }
    const { sym, exp, dt, datePath } = queue[i++];
    try {
      const snaps = _buildSnapsFromFolder(datePath, dt);
      _writeVolOiFile(datePath, snaps);
      totalGenerated++;
      console.log(`[VOL/OI] ✓ GEN  ${sym}/${exp}/${dt} (${snaps.length} snapshots)`);
    } catch (err) {
      totalFailed++;
      console.log(`[VOL/OI] ✗ ERR  ${sym}/${exp}/${dt} — ${err.message}`);
    }
    setImmediate(next); // yield to event loop between each folder
  }
  setImmediate(next);
}

// ── Live 5-minute regen — reads ALL date folders from saved .gz files ──────────
// Every 5 minutes, re-reads saved .gz files in every date folder and rewrites
// voloichng.json. After 3:30 PM no new files are saved, so data stays at last value.
function _startVolOiLiveRegen() {
  setInterval(() => {
    try {
      const dataDir = PATHS.MARKET;
      folders(dataDir).forEach(sym => {
        const symPath = path.join(dataDir, sym);
        folders(symPath).forEach(exp => {
          folders(path.join(symPath, exp)).forEach(dt => {
            regenVolOiForFolder(path.join(symPath, exp, dt), dt);
          });
        });
      });
    } catch (_) {}
  }, 5 * 60 * 1000);
}

// ── API endpoint ──────────────────────────────────────────────────────────────
// Reads voloichng.json from the live date folder (via liveCache).
function registerVolOiCngRoute(app) {
  app.get('/api/voloichng/:symbol', (req, res) => {
    const sym = resolveSymbol(req.params.symbol);
    try {
      // Prefer explicit expiry+date query params (historical view), fallback to liveCache
      const expiry = req.query.expiry;
      const date   = req.query.date;
      if (expiry && date) {
        const fp = path.join(PATHS.MARKET, sym, expiry, date, '_voloichng.json');
        if (fs.existsSync(fp)) return res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
      }
      // Fallback: live session
      const live = liveCache.has(sym) ? liveCache.get(sym) : null;
      if (live?.expiry && live?.date) {
        const fp = path.join(PATHS.MARKET, sym, live.expiry, live.date, '_voloichng.json');
        if (fs.existsSync(fp)) return res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
      }
      res.json({});
    } catch (_) {
      res.json({});
    }
  });
}

// Run 12 s after startup — backfill all missing files, then start live regen
setTimeout(() => { backfillVolOiCng(); _startVolOiLiveRegen(); }, 12000);

module.exports.registerVolOiCngRoute = registerVolOiCngRoute;
module.exports.backfillVolOiCng      = backfillVolOiCng;