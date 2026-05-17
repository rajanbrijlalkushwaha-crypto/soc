'use strict';
const express = require('express');
const router  = express.Router();

// Nifty 50 stocks — symbol, name, sector, market cap weight, Upstox instrument key
const NIFTY50 = [
  { sym:'HDFCBANK',   name:'HDFC Bank',      sector:'Finance',    mcap:11000, key:'NSE_EQ|INE040A01034' },
  { sym:'ICICIBANK',  name:'ICICI Bank',      sector:'Finance',    mcap:8000,  key:'NSE_EQ|INE090A01021' },
  { sym:'SBIN',       name:'SBIN',            sector:'Finance',    mcap:7000,  key:'NSE_EQ|INE062A01020' },
  { sym:'BAJFINANCE', name:'Bajaj Finance',   sector:'Finance',    mcap:5000,  key:'NSE_EQ|INE296A01024' },
  { sym:'ITC',        name:'ITC',             sector:'Finance',    mcap:5500,  key:'NSE_EQ|INE154A01025' },
  { sym:'KOTAKBANK',  name:'Kotak Bank',      sector:'Finance',    mcap:4000,  key:'NSE_EQ|INE237A01028' },
  { sym:'AXISBANK',   name:'Axis Bank',       sector:'Finance',    mcap:3500,  key:'NSE_EQ|INE238A01034' },
  { sym:'BAJAJFINSV', name:'Bajaj Finserv',   sector:'Finance',    mcap:2000,  key:'NSE_EQ|INE918I01026' },
  { sym:'SBILIFE',    name:'SBI Life',        sector:'Finance',    mcap:1500,  key:'NSE_EQ|INE123W01016' },
  { sym:'HDFCLIFE',   name:'HDFC Life',       sector:'Finance',    mcap:1300,  key:'NSE_EQ|INE795G01014' },
  { sym:'SHRIRAMFIN', name:'Shriram Fin',     sector:'Finance',    mcap:1000,  key:'NSE_EQ|INE721A01047' },

  { sym:'RELIANCE',   name:'Reliance',        sector:'Energy',     mcap:17000, key:'NSE_EQ|INE002A01018' },
  { sym:'ONGC',       name:'ONGC',            sector:'Energy',     mcap:3500,  key:'NSE_EQ|INE213A01029' },
  { sym:'COALINDIA',  name:'Coal India',      sector:'Energy',     mcap:2500,  key:'NSE_EQ|INE522F01014' },

  { sym:'TCS',        name:'TCS',             sector:'Technology', mcap:14000, key:'NSE_EQ|INE467B01029' },
  { sym:'INFY',       name:'Infosys',         sector:'Technology', mcap:7000,  key:'NSE_EQ|INE009A01021' },
  { sym:'HCLTECH',    name:'HCL Tech',        sector:'Technology', mcap:4500,  key:'NSE_EQ|INE860A01027' },
  { sym:'WIPRO',      name:'Wipro',           sector:'Technology', mcap:3000,  key:'NSE_EQ|INE075A01022' },
  { sym:'TECHM',      name:'Tech Mahindra',   sector:'Technology', mcap:1200,  key:'NSE_EQ|INE669C01036' },
  { sym:'ETERNAL',    name:'Eternal (Zomato)','sector':'Technology',mcap:1500, key:'NSE_EQ|INE758T01015' },

  { sym:'MARUTI',     name:'Maruti Suzuki',   sector:'Auto',       mcap:4000,  key:'NSE_EQ|INE585B01010' },
  { sym:'M&M',        name:'M&M',             sector:'Auto',       mcap:3500,  key:'NSE_EQ|INE101A01026' },
  { sym:'BAJAJ-AUTO', name:'Bajaj Auto',      sector:'Auto',       mcap:2000,  key:'NSE_EQ|INE917I01010' },
  { sym:'EICHERMOT',  name:'Eicher Motors',   sector:'Auto',       mcap:1500,  key:'NSE_EQ|INE066A01021' },
  { sym:'TATAMOTORS', name:'Tata Motors',     sector:'Auto',       mcap:3000,  key:'NSE_EQ|INE155A01022' },

  { sym:'TITAN',      name:'Titan',           sector:'Consumer',   mcap:3000,  key:'NSE_EQ|INE280A01028' },
  { sym:'TATACONSUM', name:'Tata Consumer',   sector:'Consumer',   mcap:1200,  key:'NSE_EQ|INE192A01025' },
  { sym:'HINDUNILVR', name:'HUL',             sector:'Consumer',   mcap:5000,  key:'NSE_EQ|INE030A01027' },
  { sym:'NESTLEIND',  name:'Nestle',          sector:'Consumer',   mcap:2500,  key:'NSE_EQ|INE239A01024' },

  { sym:'SUNPHARMA',  name:'Sun Pharma',      sector:'Healthcare', mcap:3500,  key:'NSE_EQ|INE044A01036' },
  { sym:'DRDREDDY',   name:"Dr Reddy's",      sector:'Healthcare', mcap:1500,  key:'NSE_EQ|INE089A01023' },
  { sym:'CIPLA',      name:'Cipla',           sector:'Healthcare', mcap:1500,  key:'NSE_EQ|INE059A01026' },
  { sym:'APOLLOHOSP', name:'Apollo Hosp',     sector:'Healthcare', mcap:1000,  key:'NSE_EQ|INE437A01024' },
  { sym:'MAXHEALTH',  name:'Max Healthcare',  sector:'Healthcare', mcap:900,   key:'NSE_EQ|INE027H01010' },

  { sym:'JSWSTEEL',   name:'JSW Steel',       sector:'Metals',     mcap:2000,  key:'NSE_EQ|INE019A01038' },
  { sym:'TATASTEEL',  name:'Tata Steel',      sector:'Metals',     mcap:1800,  key:'NSE_EQ|INE081A01012' },
  { sym:'HINDALCO',   name:'Hindalco',        sector:'Metals',     mcap:1500,  key:'NSE_EQ|INE038A01020' },
  { sym:'ULTRACEMCO', name:'UltraTech Cem',   sector:'Metals',     mcap:2000,  key:'NSE_EQ|INE481G01011' },
  { sym:'GRASIM',     name:'Grasim',          sector:'Metals',     mcap:1800,  key:'NSE_EQ|INE047A01021' },

  { sym:'LT',         name:'L&T',             sector:'Industrial', mcap:4000,  key:'NSE_EQ|INE018A01030' },
  { sym:'ADANIPORTS', name:'Adani Ports',     sector:'Industrial', mcap:2500,  key:'NSE_EQ|INE742F01042' },
  { sym:'ADANIENT',   name:'Adani Ent',       sector:'Industrial', mcap:3000,  key:'NSE_EQ|INE423A01024' },
  { sym:'BEL',        name:'BEL',             sector:'Industrial', mcap:1000,  key:'NSE_EQ|INE263A01024' },

  { sym:'NTPC',       name:'NTPC',            sector:'Utilities',  mcap:3500,  key:'NSE_EQ|INE733E01010' },
  { sym:'POWERGRID',  name:'Power Grid',      sector:'Utilities',  mcap:2500,  key:'NSE_EQ|INE752E01010' },

  { sym:'BHARTIARTL', name:'Airtel',          sector:'Telecom',    mcap:8000,  key:'NSE_EQ|INE397D01024' },
  { sym:'INDIGO',     name:'IndiGo',          sector:'Aviation',   mcap:900,   key:'NSE_EQ|INE646L01027' },
  { sym:'ASIANPAINT', name:'Asian Paints',    sector:'Chemicals',  mcap:2000,  key:'NSE_EQ|INE021A01026' },
];

// Last successful data cache (5 min TTL)
let _cache = null;
let _cacheTs = 0;

async function fetchUpstoxLTP(accessToken, keys) {
  const url = `https://api.upstox.com/v2/market-quote/ltp?instrument_key=${encodeURIComponent(keys.join(','))}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Upstox LTP ${res.status}`);
  return res.json();
}

function getAccessToken(req) {
  try {
    const appsList = require('../db/models/Config.js');
    // Try to get from req.app (stored by server.js) or from config
    return req.app?.locals?.upstoxToken || null;
  } catch { return null; }
}

router.get('/nifty50', async (req, res) => {
  try {
    // Serve cache if fresh (< 30s)
    if (_cache && Date.now() - _cacheTs < 30_000) {
      return res.json({ success: true, stocks: _cache, cached: true });
    }

    // Try Upstox LTP
    let priceMap = {};
    try {
      const token = req.app?.locals?.upstoxToken;
      if (token) {
        const keys = NIFTY50.map(s => s.key);
        const chunk = keys.slice(0, 50); // API limit
        const data  = await fetchUpstoxLTP(token, chunk);
        if (data?.data) {
          for (const [k, v] of Object.entries(data.data)) {
            const sym = k.split(':')[1]; // "NSE_EQ:RELIANCE" → "RELIANCE"
            priceMap[sym] = v.last_price;
          }
        }
      }
    } catch (_) {}

    const stocks = NIFTY50.map(s => {
      const ltp = priceMap[s.sym] || null;
      return {
        sym:    s.sym,
        name:   s.name,
        sector: s.sector,
        mcap:   s.mcap,
        ltp,
        pct:    null, // will be null if no live data
      };
    });

    _cache  = stocks;
    _cacheTs = Date.now();

    res.json({ success: true, stocks });
  } catch (err) {
    res.json({ success: true, stocks: NIFTY50.map(s => ({ ...s, ltp: null, pct: null })) });
  }
});

module.exports = router;
