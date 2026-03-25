// option-chain-server.js - OPTIMIZED FOR SPEED WITH AUTHENTICATION
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const express = require("express");
const zlib = require('zlib');
const cors = require("cors");
const compression = require("compression");
const session = require("express-session");
const FileStore = require('session-file-store')(session);



// Load environment variables from data/.env
require('dotenv').config({ path: path.join(__dirname, '..', 'data', '.env') });

// ── Centralized path config ───────────────────────────────────────────────────
const { PATHS } = require('./config/paths');

// In-memory live data cache
const liveCache = require('./liveCache');

// ✅ REACT INTEGRATION
const reactBuildPath = path.join(PATHS.FRONTEND, 'build');
let adminState = { isRunning: false, lastUpdate: new Date(), dataCount: 0 };

// Schedule file path
const SCHEDULE_FILE = PATHS.SCHEDULE;

// Market data file paths
const MARKET_HOLIDAY_FILE = PATHS.MARKET_HOLIDAY;
const MARKET_TIMING_FILE  = PATHS.MARKET_TIMING;

// Configuration
const CONFIG = {
  // Access tokens loaded below with slot credentials
  
  // Admin credentials (from .env)
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || "sysadmin",
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "sysadmin",
  
  // ============ COMPLETE INSTRUMENT MASTER LIST ============
  // Organized by: NSE Indices, BSE Indices, NSE F&O Stocks, MCX Commodities
  // NOTE: MCX Option Chain is NOT supported by Upstox Put/Call API
  // NOTE: Individual stocks use NSE_EQ segment for option chain (underlying_key)
  
  // Managed via Admin Panel > System > Instruments — do not edit manually
  // All stocks from INSTRUMENT_MASTER are available to activate/deactivate in admin
  // Default: only indices active. Use admin panel to activate stocks.
  INSTRUMENTS: [
    // NSE Indices
    "NSE_INDEX|Nifty 50",
    "NSE_INDEX|Nifty Bank",
    "NSE_INDEX|NIFTY MID SELECT",
    "NSE_INDEX|Nifty Next 50",
    "NSE_INDEX|Nifty Financial Services",
    // BSE Indices
    "BSE_INDEX|SENSEX",
    "BSE_INDEX|BANKEX",
    "BSE_INDEX|SENSEX 50",
    // NSE F&O Stocks — all available, activate from Admin Panel
    "NSE_EQ|INE040A01034",   // HDFCBANK
    "NSE_EQ|INE090A01021",   // ICICIBANK
    "NSE_EQ|INE062A01020",   // SBIN
    "NSE_EQ|INE114A01011",   // AXISBANK
    "NSE_EQ|INE476A01014",   // CANBK
    "NSE_EQ|INE084A01016",   // BANKBARODA
    "NSE_EQ|INE238A01034",   // PNB
    "NSE_EQ|INE860A01027",   // HDFCLIFE
    "NSE_EQ|INE795G01014",   // BAJFINANCE
    "NSE_EQ|INE917I01010",   // BAJAJFINSV
    "NSE_EQ|INE296A01024",   // SHRIRAMFIN
    "NSE_EQ|INE774D01024",   // KOTAKBANK
    "NSE_EQ|INE019A01038",   // INDUSINDBK
    "NSE_EQ|INE092T01019",   // IDFCFIRSTB
    "NSE_EQ|INE726G01019",   // SBILIFE
    "NSE_EQ|INE417T01026",   // SBICARD
    "NSE_EQ|INE009A01021",   // INFY
    "NSE_EQ|INE467B01029",   // TCS
    "NSE_EQ|INE075A01022",   // WIPRO
    "NSE_EQ|INE261F01014",   // TECHM
    "NSE_EQ|INE121J01017",   // PERSISTENT
    "NSE_EQ|INE03WK01018",   // COFORGE
    "NSE_EQ|INE136Y01011",   // LTIM
    "NSE_EQ|INE002A01018",   // RELIANCE
    "NSE_EQ|INE213A01029",   // ONGC
    "NSE_EQ|INE242A01010",   // IOC
    "NSE_EQ|INE001A01036",   // BPCL
    "NSE_EQ|INE101A01026",   // NTPC
    "NSE_EQ|INE752E01010",   // POWERGRID
    "NSE_EQ|INE848E01016",   // TATAPOWER
    "NSE_EQ|INE731A01020",   // NHPC
    "NSE_EQ|INE020B01018",   // ADANIPOWER
    "NSE_EQ|INE364U01010",   // ADANIGREEN
    "NSE_EQ|INE155A01022",   // TATAMTRS
    "NSE_EQ|INE585B01010",   // MARUTI
    "NSE_EQ|INE758T01015",   // BAJAJ-AUTO
    "NSE_EQ|INE066A01021",   // EICHERMOT
    "NSE_EQ|INE201A01024",   // HEROMOTOCO
    "NSE_EQ|INE216A01030",   // ASHOKLEY
    "NSE_EQ|INE775A01035",   // MOTHERSON
    "NSE_EQ|INE160A01022",   // SUNPHARMA
    "NSE_EQ|INE059A01026",   // CIPLA
    "NSE_EQ|INE326A01037",   // DRREDDY
    "NSE_EQ|INE475A01022",   // LUPIN
    "NSE_EQ|INE358A01014",   // BIOCON
    "NSE_EQ|INE089A01023",   // APOLLOHOSP
    "NSE_EQ|INE860H01022",   // DIVISLAB
    "NSE_EQ|INE081A01020",   // TATASTEEL
    "NSE_EQ|INE205A01025",   // JSWSTEEL
    "NSE_EQ|INE159A01016",   // HINDALCO
    "NSE_EQ|INE226A01021",   // NMDC
    "NSE_EQ|INE176A01028",   // COALINDIA
    "NSE_EQ|INE092A01019",   // SAIL
    "NSE_EQ|INE067A01029",   // VEDL
    "NSE_EQ|INE102D01028",   // HINDCOPPER
    "NSE_EQ|INE154A01025",   // ITC
    "NSE_EQ|INE030A01027",   // HINDUNILVR
    "NSE_EQ|INE192A01025",   // BRITANNIA
    "NSE_EQ|INE012A01025",   // DABUR
    "NSE_EQ|INE222E01019",   // TATACONSUM
    "NSE_EQ|INE259A01022",   // GODREJCP
    "NSE_EQ|INE239A01016",   // NESTLEIND
    "NSE_EQ|INE018A01030",   // LT
    "NSE_EQ|INE481G01011",   // ULTRACEMCO
    "NSE_EQ|INE473A01011",   // AMBUJACEM
    "NSE_EQ|INE038A01020",   // DLF
    "NSE_EQ|INE417A01024",   // GODREJPROP
    "NSE_EQ|INE423A01024",   // IRCTC
    "NSE_EQ|INE669E01016",   // IDEA
    "NSE_EQ|INE397D01024",   // BHARTIARTL
    "NSE_EQ|INE053F01010",   // HAL
    "NSE_EQ|INE274J01014",   // IRFC
    "NSE_EQ|INE134E01011",   // PFC
    "NSE_EQ|INE121A01024",   // ADANIENT
    "NSE_EQ|INE752H01013",   // ADANIPORTS
    "NSE_EQ|INE443B01011",   // BSE
    "NSE_EQ|INE733E01010",   // LICI
  ],

  // ============ FULL INSTRUMENT REFERENCE (for admin UI / search) ============
  // This is the complete known list - used for lookup & admin panel
  INSTRUMENT_MASTER: {
    // ---- NSE INDICES ----
    NSE_INDICES: [
      { key: "NSE_INDEX|Nifty 50",                  name: "Nifty 50",                  symbol: "NIFTY",       hasOptionChain: true,  lot_size: 65  },
      { key: "NSE_INDEX|Nifty Bank",                 name: "Bank Nifty",                symbol: "BANKNIFTY",   hasOptionChain: true,  lot_size: 35  },
      { key: "NSE_INDEX|Nifty Financial Services",   name: "Nifty Financial Services",   symbol: "FINNIFTY",    hasOptionChain: true,  lot_size: 65  },
      { key: "NSE_INDEX|NIFTY MID SELECT",           name: "Nifty MidCap Select",        symbol: "MIDCPNIFTY",  hasOptionChain: true,  lot_size: 120 },
      { key: "NSE_INDEX|Nifty Next 50",              name: "Nifty Next 50",              symbol: "NIFTYNXT50",  hasOptionChain: true,  lot_size: 25  },
      { key: "NSE_INDEX|Nifty 100",                  name: "Nifty 100",                  symbol: "NIFTY100",    hasOptionChain: false },
      { key: "NSE_INDEX|Nifty 200",                  name: "Nifty 200",                  symbol: "NIFTY200",    hasOptionChain: false },
      { key: "NSE_INDEX|Nifty 500",                  name: "Nifty 500",                  symbol: "NIFTY500",    hasOptionChain: false },
      { key: "NSE_INDEX|Nifty Midcap 100",           name: "Nifty Midcap 100",           symbol: "NIFTYMID100", hasOptionChain: false },
      { key: "NSE_INDEX|Nifty Smallcap 100",         name: "Nifty Smallcap 100",         symbol: "NIFTYSC100",  hasOptionChain: false },
      { key: "NSE_INDEX|Nifty IT",                   name: "Nifty IT",                   symbol: "NIFTYIT",     hasOptionChain: false },
      { key: "NSE_INDEX|Nifty Auto",                 name: "Nifty Auto",                 symbol: "NIFTYAUTO",   hasOptionChain: false },
      { key: "NSE_INDEX|Nifty Pharma",               name: "Nifty Pharma",               symbol: "NIFTYPHARMA", hasOptionChain: false },
      { key: "NSE_INDEX|Nifty Metal",                name: "Nifty Metal",                symbol: "NIFTYMETAL",  hasOptionChain: false },
      { key: "NSE_INDEX|Nifty Energy",               name: "Nifty Energy",               symbol: "NIFTYENERGY", hasOptionChain: false },
      { key: "NSE_INDEX|Nifty FMCG",                 name: "Nifty FMCG",                 symbol: "NIFTYFMCG",   hasOptionChain: false },
      { key: "NSE_INDEX|Nifty PSU Bank",             name: "Nifty PSU Bank",             symbol: "NIFTYPSUBNK", hasOptionChain: false },
      { key: "NSE_INDEX|Nifty Realty",               name: "Nifty Realty",               symbol: "NIFTYREALTY", hasOptionChain: false },
      { key: "NSE_INDEX|Nifty Private Bank",         name: "Nifty Private Bank",         symbol: "NIFTYPVTBNK", hasOptionChain: false },
      { key: "NSE_INDEX|Nifty Media",                name: "Nifty Media",                symbol: "NIFTYMEDIA",  hasOptionChain: false },
      { key: "NSE_INDEX|India VIX",                  name: "India VIX",                  symbol: "INDIAVIX",    hasOptionChain: false },
    ],

    // ---- BSE INDICES ----
    BSE_INDICES: [
      { key: "BSE_INDEX|SENSEX",        name: "SENSEX",        symbol: "SENSEX",    hasOptionChain: true, lot_size: 20 },
      { key: "BSE_INDEX|BANKEX",        name: "BANKEX",        symbol: "BANKEX",    hasOptionChain: true, lot_size: 30 },
      { key: "BSE_INDEX|SENSEX 50",     name: "SENSEX 50",     symbol: "SENSEX50",  hasOptionChain: true, lot_size: 25 },
      { key: "BSE_INDEX|BSE 100",       name: "BSE 100",       symbol: "BSE100",    hasOptionChain: false },
      { key: "BSE_INDEX|BSE 200",       name: "BSE 200",       symbol: "BSE200",    hasOptionChain: false },
      { key: "BSE_INDEX|BSE 500",       name: "BSE 500",       symbol: "BSE500",    hasOptionChain: false },
      { key: "BSE_INDEX|AUTO",          name: "BSE Auto",      symbol: "AUTO",      hasOptionChain: false },
      { key: "BSE_INDEX|METAL",         name: "BSE Metal",     symbol: "METAL",     hasOptionChain: false },
      { key: "BSE_INDEX|IT",            name: "BSE IT",        symbol: "BSEIT",     hasOptionChain: false },
      { key: "BSE_INDEX|HEALTHCARE",    name: "BSE Healthcare",symbol: "HEALTHCARE",hasOptionChain: false },
      { key: "BSE_INDEX|REALTY",        name: "BSE Realty",    symbol: "BSEREALTY",  hasOptionChain: false },
    ],

    // ---- NSE F&O STOCKS (Top ~200 by liquidity) ----
    // instrument_key uses ISIN: "NSE_EQ|<ISIN>"
    NSE_FO_STOCKS: [
      // ---- Banking & Financial ----
      { key: "NSE_EQ|INE040A01034",  name: "HDFC Bank",              symbol: "HDFCBANK",     sector: "Banking" },
      { key: "NSE_EQ|INE090A01021",  name: "ICICI Bank",             symbol: "ICICIBANK",    sector: "Banking" },
      { key: "NSE_EQ|INE062A01020",  name: "State Bank of India",    symbol: "SBIN",         sector: "Banking" },
      { key: "NSE_EQ|INE114A01011",  name: "Axis Bank",              symbol: "AXISBANK",     sector: "Banking" },
      { key: "NSE_EQ|INE476A01014",  name: "Canara Bank",            symbol: "CANBK",        sector: "Banking" },
      { key: "NSE_EQ|INE084A01016",  name: "Bank of Baroda",         symbol: "BANKBARODA",   sector: "Banking" },
      { key: "NSE_EQ|INE238A01034",  name: "Punjab National Bank",   symbol: "PNB",          sector: "Banking" },
      { key: "NSE_EQ|INE860A01027",  name: "HDFC Life Insurance",    symbol: "HDFCLIFE",     sector: "Insurance" },
      { key: "NSE_EQ|INE795G01014",  name: "Bajaj Finance",          symbol: "BAJFINANCE",   sector: "NBFC" },
      { key: "NSE_EQ|INE917I01010",  name: "Bajaj Finserv",          symbol: "BAJAJFINSV",   sector: "NBFC" },
      { key: "NSE_EQ|INE296A01024",  name: "Shriram Finance",        symbol: "SHRIRAMFIN",   sector: "NBFC" },
      { key: "NSE_EQ|INE774D01024",  name: "Kotak Mahindra Bank",    symbol: "KOTAKBANK",    sector: "Banking" },
      { key: "NSE_EQ|INE019A01038",  name: "IndusInd Bank",          symbol: "INDUSINDBK",   sector: "Banking" },
      { key: "NSE_EQ|INE092T01019",  name: "IDFC First Bank",        symbol: "IDFCFIRSTB",   sector: "Banking" },
      { key: "NSE_EQ|INE726G01019",  name: "SBI Life Insurance",     symbol: "SBILIFE",      sector: "Insurance" },
      { key: "NSE_EQ|INE417T01026",  name: "SBI Cards",              symbol: "SBICARD",      sector: "NBFC" },

      // ---- IT & Tech ----
      { key: "NSE_EQ|INE009A01021",  name: "Infosys",                symbol: "INFY",         sector: "IT" },
      { key: "NSE_EQ|INE467B01029",  name: "TCS",                    symbol: "TCS",          sector: "IT" },
      { key: "NSE_EQ|INE860A01027",  name: "HCL Technologies",       symbol: "HCLTECH",      sector: "IT" },
      { key: "NSE_EQ|INE075A01022",  name: "Wipro",                  symbol: "WIPRO",        sector: "IT" },
      { key: "NSE_EQ|INE261F01014",  name: "Tech Mahindra",          symbol: "TECHM",        sector: "IT" },
      { key: "NSE_EQ|INE121J01017",  name: "Persistent Systems",     symbol: "PERSISTENT",   sector: "IT" },
      { key: "NSE_EQ|INE03WK01018",  name: "Coforge",                symbol: "COFORGE",      sector: "IT" },
      { key: "NSE_EQ|INE136Y01011",  name: "LTIMindtree",            symbol: "LTIM",         sector: "IT" },

      // ---- Oil & Energy ----
      { key: "NSE_EQ|INE002A01018",  name: "Reliance Industries",    symbol: "RELIANCE",     sector: "Oil & Gas" },
      { key: "NSE_EQ|INE213A01029",  name: "ONGC",                   symbol: "ONGC",         sector: "Oil & Gas" },
      { key: "NSE_EQ|INE242A01010",  name: "Indian Oil Corporation", symbol: "IOC",          sector: "Oil & Gas" },
      { key: "NSE_EQ|INE001A01036",  name: "BPCL",                   symbol: "BPCL",         sector: "Oil & Gas" },
      { key: "NSE_EQ|INE101A01026",  name: "NTPC",                   symbol: "NTPC",         sector: "Power" },
      { key: "NSE_EQ|INE752E01010",  name: "Power Grid Corp",        symbol: "POWERGRID",    sector: "Power" },
      { key: "NSE_EQ|INE848E01016",  name: "Tata Power",             symbol: "TATAPOWER",    sector: "Power" },
      { key: "NSE_EQ|INE731A01020",  name: "NHPC",                   symbol: "NHPC",         sector: "Power" },
      { key: "NSE_EQ|INE020B01018",  name: "Adani Power",            symbol: "ADANIPOWER",   sector: "Power" },
      { key: "NSE_EQ|INE364U01010",  name: "Adani Green Energy",     symbol: "ADANIGREEN",   sector: "Power" },

      // ---- Auto ----
      { key: "NSE_EQ|INE155A01022",  name: "Tata Motors",            symbol: "TATAMTRS",     sector: "Auto" },
      { key: "NSE_EQ|INE585B01010",  name: "Maruti Suzuki",          symbol: "MARUTI",       sector: "Auto" },
      { key: "NSE_EQ|INE101A01026",  name: "Mahindra & Mahindra",    symbol: "M&M",          sector: "Auto" },
      { key: "NSE_EQ|INE758T01015",  name: "Bajaj Auto",             symbol: "BAJAJ-AUTO",   sector: "Auto" },
      { key: "NSE_EQ|INE066A01021",  name: "Eicher Motors",          symbol: "EICHERMOT",    sector: "Auto" },
      { key: "NSE_EQ|INE201A01024",  name: "Hero MotoCorp",          symbol: "HEROMOTOCO",   sector: "Auto" },
      { key: "NSE_EQ|INE216A01030",  name: "Ashok Leyland",          symbol: "ASHOKLEY",     sector: "Auto" },
      { key: "NSE_EQ|INE775A01035",  name: "Motherson Sumi",         symbol: "MOTHERSON",    sector: "Auto" },

      // ---- Pharma & Healthcare ----
      { key: "NSE_EQ|INE160A01022",  name: "Sun Pharma",             symbol: "SUNPHARMA",    sector: "Pharma" },
      { key: "NSE_EQ|INE059A01026",  name: "Cipla",                  symbol: "CIPLA",        sector: "Pharma" },
      { key: "NSE_EQ|INE326A01037",  name: "Dr Reddys Labs",         symbol: "DRREDDY",      sector: "Pharma" },
      { key: "NSE_EQ|INE475A01022",  name: "Lupin",                  symbol: "LUPIN",        sector: "Pharma" },
      { key: "NSE_EQ|INE358A01014",  name: "Biocon",                 symbol: "BIOCON",       sector: "Pharma" },
      { key: "NSE_EQ|INE089A01023",  name: "Apollo Hospitals",       symbol: "APOLLOHOSP",   sector: "Healthcare" },
      { key: "NSE_EQ|INE860H01022",  name: "Divi's Laboratories",    symbol: "DIVISLAB",     sector: "Pharma" },

      // ---- Metals & Mining ----
      { key: "NSE_EQ|INE081A01020",  name: "Tata Steel",             symbol: "TATASTEEL",    sector: "Metal" },
      { key: "NSE_EQ|INE205A01025",  name: "JSW Steel",              symbol: "JSWSTEEL",     sector: "Metal" },
      { key: "NSE_EQ|INE159A01016",  name: "Hindalco Industries",    symbol: "HINDALCO",     sector: "Metal" },
      { key: "NSE_EQ|INE226A01021",  name: "NMDC",                   symbol: "NMDC",         sector: "Mining" },
      { key: "NSE_EQ|INE176A01028",  name: "Coal India",             symbol: "COALINDIA",    sector: "Mining" },
      { key: "NSE_EQ|INE092A01019",  name: "SAIL",                   symbol: "SAIL",         sector: "Metal" },
      { key: "NSE_EQ|INE067A01029",  name: "Vedanta",                symbol: "VEDL",         sector: "Metal" },
      { key: "NSE_EQ|INE102D01028",  name: "Hindustan Copper",       symbol: "HINDCOPPER",   sector: "Metal" },

      // ---- FMCG ----
      { key: "NSE_EQ|INE154A01025",  name: "ITC",                    symbol: "ITC",          sector: "FMCG" },
      { key: "NSE_EQ|INE030A01027",  name: "Hindustan Unilever",     symbol: "HINDUNILVR",   sector: "FMCG" },
      { key: "NSE_EQ|INE192A01025",  name: "Britannia Industries",   symbol: "BRITANNIA",    sector: "FMCG" },
      { key: "NSE_EQ|INE012A01025",  name: "Dabur India",            symbol: "DABUR",        sector: "FMCG" },
      { key: "NSE_EQ|INE222E01019",  name: "Tata Consumer",          symbol: "TATACONSUM",   sector: "FMCG" },
      { key: "NSE_EQ|INE259A01022",  name: "Godrej Consumer",        symbol: "GODREJCP",     sector: "FMCG" },
      { key: "NSE_EQ|INE239A01016",  name: "Nestle India",           symbol: "NESTLEIND",    sector: "FMCG" },

      // ---- Infra & Construction ----
      { key: "NSE_EQ|INE018A01030",  name: "Larsen & Toubro",        symbol: "LT",           sector: "Infra" },
      { key: "NSE_EQ|INE481G01011",  name: "UltraTech Cement",       symbol: "ULTRACEMCO",   sector: "Cement" },
      { key: "NSE_EQ|INE012A01025",  name: "ACC",                    symbol: "ACC",          sector: "Cement" },
      { key: "NSE_EQ|INE473A01011",  name: "Ambuja Cements",         symbol: "AMBUJACEM",    sector: "Cement" },
      { key: "NSE_EQ|INE038A01020",  name: "DLF",                    symbol: "DLF",          sector: "Realty" },
      { key: "NSE_EQ|INE417A01024",  name: "Godrej Properties",      symbol: "GODREJPROP",   sector: "Realty" },
      { key: "NSE_EQ|INE423A01024",  name: "IRCTC",                  symbol: "IRCTC",        sector: "Infra" },

      // ---- Telecom ----
      { key: "NSE_EQ|INE669E01016",  name: "Vodafone Idea",          symbol: "IDEA",         sector: "Telecom" },
      { key: "NSE_EQ|INE397D01024",  name: "Bharti Airtel",          symbol: "BHARTIARTL",   sector: "Telecom" },

      // ---- Defence & PSU ----
      { key: "NSE_EQ|INE397D01024",  name: "Bharat Electronics",     symbol: "BEL",          sector: "Defence" },
      { key: "NSE_EQ|INE053F01010",  name: "HAL",                    symbol: "HAL",          sector: "Defence" },
      { key: "NSE_EQ|INE274J01014",  name: "IRFC",                   symbol: "IRFC",         sector: "PSU" },
      { key: "NSE_EQ|INE775A01035",  name: "HUDCO",                  symbol: "HUDCO",        sector: "PSU" },
      { key: "NSE_EQ|INE296A01024",  name: "REC Ltd",                symbol: "RECLTD",       sector: "PSU" },
      { key: "NSE_EQ|INE134E01011",  name: "PFC",                    symbol: "PFC",          sector: "PSU" },

      // ---- Adani Group ----
      { key: "NSE_EQ|INE121A01024",  name: "Adani Enterprises",      symbol: "ADANIENT",     sector: "Conglomerate" },
      { key: "NSE_EQ|INE752H01013",  name: "Adani Ports",            symbol: "ADANIPORTS",   sector: "Infra" },

      // ---- Others ----
      { key: "NSE_EQ|INE860A01027",  name: "Zomato (Eternal)",       symbol: "ZOMATO",       sector: "Internet" },
      { key: "NSE_EQ|INE669E01016",  name: "Paytm",                  symbol: "PAYTM",        sector: "Internet" },
      { key: "NSE_EQ|INE443B01011",  name: "BSE Ltd",                symbol: "BSE",          sector: "Exchange" },
      { key: "NSE_EQ|INE733E01010",  name: "LIC",                    symbol: "LICI",         sector: "Insurance" },
    ],

    // ---- MCX COMMODITIES (Option Chain NOT supported via Upstox API) ----
    // These work for market quote/websocket but NOT for /v2/option/chain
    MCX_COMMODITIES: [
      { key: "MCX_FO|GOLD",        name: "Gold",           symbol: "GOLD",        hasOptionChain: false },
      { key: "MCX_FO|SILVER",      name: "Silver",         symbol: "SILVER",      hasOptionChain: false },
      { key: "MCX_FO|CRUDEOIL",    name: "Crude Oil",      symbol: "CRUDEOIL",    hasOptionChain: false },
      { key: "MCX_FO|NATURALGAS",  name: "Natural Gas",    symbol: "NATURALGAS",  hasOptionChain: false },
      { key: "MCX_FO|COPPER",      name: "Copper",         symbol: "COPPER",      hasOptionChain: false },
      { key: "MCX_FO|ZINC",        name: "Zinc",           symbol: "ZINC",        hasOptionChain: false },
      { key: "MCX_FO|ALUMINIUM",   name: "Aluminium",      symbol: "ALUMINIUM",   hasOptionChain: false },
      { key: "MCX_FO|LEAD",        name: "Lead",           symbol: "LEAD",        hasOptionChain: false },
      { key: "MCX_FO|NICKEL",      name: "Nickel",         symbol: "NICKEL",      hasOptionChain: false },
      { key: "MCX_FO|GOLDM",       name: "Gold Mini",      symbol: "GOLDM",       hasOptionChain: false },
      { key: "MCX_FO|SILVERM",     name: "Silver Mini",    symbol: "SILVERM",     hasOptionChain: false },
    ],
  },
  
  // Backward compatibility - default instrument
  INSTRUMENT_KEY: "NSE_INDEX|Nifty 50",
  
  // Server settings
  PORT: 3000,
  REFRESH_INTERVAL: 3000, // 3 seconds
  LOG_FILE: "server.log",
  
  // API endpoints
  UPSTOX_BASE_URL: "https://api.upstox.com/v2",

  // Upstox OAuth credentials — 3 app slots (from .env)
  UPSTOX_APP_NAME_1:   process.env.UPSTOX_APP_NAME_1   || 'Slot 1',
  UPSTOX_API_KEY:      process.env.UPSTOX_API_KEY       || '',
  UPSTOX_API_SECRET:   process.env.UPSTOX_API_SECRET    || '',
  UPSTOX_APP_NAME_2:   process.env.UPSTOX_APP_NAME_2   || 'Slot 2',
  UPSTOX_API_KEY_2:    process.env.UPSTOX_API_KEY_2     || '',
  UPSTOX_API_SECRET_2: process.env.UPSTOX_API_SECRET_2  || '',
  UPSTOX_APP_NAME_3:   process.env.UPSTOX_APP_NAME_3   || 'Slot 3',
  UPSTOX_API_KEY_3:    process.env.UPSTOX_API_KEY_3     || '',
  UPSTOX_API_SECRET_3: process.env.UPSTOX_API_SECRET_3  || '',
  UPSTOX_REDIRECT_URI: process.env.UPSTOX_REDIRECT_URI  || '',

  // Access tokens for each slot
  ACCESS_TOKEN:   process.env.ACCESS_TOKEN   || '',
  ACCESS_TOKEN_2: process.env.ACCESS_TOKEN_2 || '',
  ACCESS_TOKEN_3: process.env.ACCESS_TOKEN_3 || '',

  // Admin email
  ADMIN_EMAIL:        process.env.ADMIN_EMAIL        || '',
  UPSTOX_EMAIL_TIME:  process.env.UPSTOX_EMAIL_TIME  || '08:00'
};

// Initialize Express app
const app = express();

// Trust Cloudflare / Nginx proxy — required for correct IP, protocol, and session cookies
app.set('trust proxy', 1);

// Gzip compress all responses
app.use(compression({ level: 6, threshold: 1024 }));

// ✅ Serve React static files
// Static assets (JS/CSS) have content hashes in filenames — cache 1 year
app.use('/static', express.static(path.join(reactBuildPath, 'static'), {
  maxAge: '1y',
  immutable: true,
  etag: false,
  lastModified: false,
}));
// index.html and other root files — never cache (always fresh)
app.use(express.static(reactBuildPath, {
  maxAge: 0,
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// ================================
// CORS Configuration — allow all origins
// ================================
app.use(cors({
  origin: true,
  credentials: true,
}));

// ================================
// Body Parsers
// ================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================================
// Session Configuration with File Store
// ================================we
app.use(session({
  name: "soc_session",
  secret: process.env.SESSION_SECRET || "simplify-option-chain-secret-key-2025",
  store: new FileStore({
    path: PATHS.SESSIONS,
    ttl: 86400,        // 24 hours
    retries: 2,
    retryDelay: 100,
    reapInterval: 3600,
    fileExtension: '.json',
  }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  },
  rolling: true // Reset expiry on activity
}));

// ================================
// Auth Middleware Functions (open — no blocking)
// ================================
const requireAuth = (_req, _res, next) => next();
const checkAuth   = (_req, _res, next) => next();

// ================================
// Import Authentication Routes
// ================================
const authRoutes = require('./emailService/authRoutes');
app.use("/api/auth", authRoutes);
const { sendUpstoxAuthEmail } = require('./emailService/emailService');




// Original imports
require("./api/chain")(app);

// Import chart generators + VOL/OI tracker
const { generateAllChartData, autoGenerateMissingChartData, registerVolOiCngRoute, updateBromosForGapOpen, regenerateAllStrategy40, generateBromosOpenForAllDates } = require("./api/chain");
registerVolOiCngRoute(app);

// Power AI Stock filter
require("./api/powerAiStock")(app);

// AI Train — pattern analysis engine
const trainaiModule = require("./api/trainai");
trainaiModule(app);
const { runAllAnalysis: runTrainAIAll } = trainaiModule;



//const aiAPI = require("./API/ai");
//app.use(aiAPI);




// Serve static files
app.use(express.static("public"));
app.use(express.static(__dirname));

// State management
let serverState = {
  currentExpiry: null,
  lastUpdate: null,
  lastUpdateIST: null,
  isUpdating: false,
  nextRefresh: null,
  totalUpdates: 0,
  errors: [],
  latestFile: null,
  isManualRunning: false,
  isScheduledRunning: false,
  scheduleEnabled: false,
  autoRefreshInterval: null,
  schedule: {
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    start_time: '09:00',
    stop_time: '15:32'
  }
};

// ============ SCHEDULE PERSISTENCE ============

function loadScheduleFromFile() {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
      serverState.schedule = data.schedule || serverState.schedule;
      serverState.scheduleEnabled = data.enabled || false;
      return true;
    }
  } catch (error) {
    console.error('Error loading schedule:', error.message);
  }
  return false;
}

function saveScheduleToFile() {
  try {
    const data = {
      schedule: serverState.schedule,
      enabled: serverState.scheduleEnabled,
      saved_at: new Date().toISOString()
    };
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving schedule:', error.message);
    return false;
  }
}

// ============ MARKET HOLIDAYS & TIMINGS ============

async function fetchAndSaveMarketHolidays() {
  try {
    console.log('📅 Fetching market holidays from Upstox...');
    const response = await axios.get(`${CONFIG.UPSTOX_BASE_URL}/market/holidays`, {
      headers: {
        'Authorization': `Bearer ${CONFIG.ACCESS_TOKEN}`,
        'Accept': 'application/json'
      }
    });
    const payload = {
      fetched_at: new Date().toISOString(),
      data: response.data?.data || []
    };
    fs.writeFileSync(MARKET_HOLIDAY_FILE, JSON.stringify(payload, null, 2));
    console.log('✅ Market holidays saved to marketholiday.json');
    return true;
  } catch (error) {
    console.error('❌ Error fetching market holidays:', error.message);
    return false;
  }
}

async function fetchAndSaveMarketTimings() {
  try {
    // IST today
    const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
    const ist   = new Date(utcMs + 5.5 * 3600000);
    const today = ist.toISOString().split('T')[0]; // YYYY-MM-DD
    console.log(`🕐 Fetching market timings for ${today} from Upstox...`);
    const response = await axios.get(`${CONFIG.UPSTOX_BASE_URL}/market/timings/${today}`, {
      headers: {
        'Authorization': `Bearer ${CONFIG.ACCESS_TOKEN}`,
        'Accept': 'application/json'
      }
    });
    const payload = {
      fetched_at: new Date().toISOString(),
      date: today,
      data: response.data?.data || []
    };
    fs.writeFileSync(MARKET_TIMING_FILE, JSON.stringify(payload, null, 2));
    console.log('✅ Market timings saved to markettiming.json');
    return true;
  } catch (error) {
    console.error('❌ Error fetching market timings:', error.message);
    return false;
  }
}

// Runs every 30 min; refreshes timings daily at 9 AM IST, holidays on 1st of month
function startMarketDataScheduler() {
  let lastTimingDate   = '';
  let lastHolidayMonth = -1;

  setInterval(async () => {
    const utcMs   = Date.now() + new Date().getTimezoneOffset() * 60000;
    const ist     = new Date(utcMs + 5.5 * 3600000);
    const today   = ist.toISOString().split('T')[0];
    const isNineAM = ist.getHours() === 9 && ist.getMinutes() < 30;
    const isFirst  = ist.getDate() === 1;
    const month    = ist.getMonth();

    if (isNineAM && today !== lastTimingDate) {
      console.log('📅 Daily market timings refresh triggered...');
      lastTimingDate = today;
      await fetchAndSaveMarketTimings();
    }

    if (isFirst && isNineAM && month !== lastHolidayMonth) {
      console.log('📅 Monthly market holidays refresh triggered...');
      lastHolidayMonth = month;
      await fetchAndSaveMarketHolidays();
    }
  }, 30 * 60 * 1000); // every 30 minutes

  console.log('📅 Market data scheduler started (daily timings + monthly holidays)');
}

function getISTToday() {
  const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
  return new Date(utcMs + 5.5 * 3600000).toISOString().split('T')[0];
}

async function initMarketData() {
  if (!fs.existsSync(MARKET_HOLIDAY_FILE)) await fetchAndSaveMarketHolidays();

  // Refresh timings if missing or not today's date
  const todayIST = getISTToday();
  let needsTimingRefresh = !fs.existsSync(MARKET_TIMING_FILE);
  if (!needsTimingRefresh) {
    try {
      const stored = JSON.parse(fs.readFileSync(MARKET_TIMING_FILE, 'utf8'));
      if (stored.date !== todayIST) needsTimingRefresh = true;
    } catch { needsTimingRefresh = true; }
  }
  if (needsTimingRefresh) await fetchAndSaveMarketTimings();

  startMarketDataScheduler();
}

// Helper: Convert UTC to IST
function convertUTCtoIST(utcDate) {
  const date = new Date(utcDate);
  const istTime = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
  
  const year = istTime.getUTCFullYear();
  const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istTime.getUTCDate()).padStart(2, '0');
  const hours = String(istTime.getUTCHours()).padStart(2, '0');
  const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(istTime.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(istTime.getUTCMilliseconds()).padStart(3, '0');
  
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}:${seconds}`,
    datetime: `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`,
    iso: `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}+05:30`,
    timestamp: `${year}${month}${day}_${hours}${minutes}${seconds}`,
    forFilename: `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`
  };
}

function getCurrentIST() {
  return convertUTCtoIST(new Date().toISOString());
}

// MINIMAL LOGGING - Only essential messages
function log(message, type = "INFO") {
  const ist = getCurrentIST();
  const logMessage = `[${ist.time}] ${message}`;
  console.log(logMessage);
  // Skip file logging for speed
}

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Get all expiry dates
// Cache expiry dates per instrument per day — refreshed only once per IST day.
// This prevents hammering Upstox /option/contract every 5 s × N instruments.
const _contractCache = {}; // instrumentKey → { dates: [], day: 'YYYY-MM-DD' }

async function getAllExpiryDates(instrumentKey = CONFIG.INSTRUMENT_KEY) {
  // Return cached result if it's still today's date
  const todayIST = getISTToday();
  const hit = _contractCache[instrumentKey];
  if (hit && hit.day === todayIST) return hit.dates;

  try {
    const response = await axios.get(`${CONFIG.UPSTOX_BASE_URL}/option/contract`, {
      params: { instrument_key: instrumentKey },
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${CONFIG.ACCESS_TOKEN}`
      }
    });

    if (!response.data.data || response.data.data.length === 0) {
      throw new Error("No contracts found");
    }

    const contracts = response.data.data;

    // Read real lot_size from the API response (first contract that has it)
    const apiLot = contracts.find(c => c.lot_size > 0)?.lot_size;
    if (apiLot) _apiLotSizeCache[instrumentKey] = apiLot;

    const allExpiryDates = [...new Set(
      contracts
        .map(contract => contract.expiry)
        .filter(date => date && date.trim() !== "")
    )].sort();
    
    // Get current date in IST
    const currentIST = getCurrentIST();
    const today = currentIST.date; // Format: YYYY-MM-DD
    
    // Find current expiry (first date >= today)
    const currentExpiry = allExpiryDates.find(date => date >= today);
    
    if (!currentExpiry) {
      log(`⚠️ No valid expiry found for ${instrumentKey}`, "WARNING");
      return [];
    }
    
    // Check if today is the last day of current expiry
    const isLastDay = currentExpiry === today;
    
    let result;
    if (isLastDay) {
      const currentIndex = allExpiryDates.indexOf(currentExpiry);
      const nextExpiry = allExpiryDates[currentIndex + 1];
      if (nextExpiry) {
        log(`📅 LAST DAY OF EXPIRY! Fetching current (${currentExpiry}) AND next (${nextExpiry})`, "INFO");
        result = [currentExpiry, nextExpiry];
      } else {
        log(`📅 Last day of expiry but no next expiry available`, "WARNING");
        result = [currentExpiry];
      }
    } else {
      result = [currentExpiry];
    }

    // Cache for the rest of today — no more API calls until tomorrow
    _contractCache[instrumentKey] = { dates: result, day: todayIST };
    return result;

  } catch (error) {
    if (error.response && error.response.status === 401) {
      log(`❌ TOKEN EXPIRED! Update ACCESS_TOKEN in .env file`, "ERROR");
    } else {
      log(`❌ Expiry fetch failed: ${error.message}`, "ERROR");
    }
    serverState.errors.push({
      timestamp: new Date().toISOString(),
      timestamp_ist: getCurrentIST().datetime,
      operation: "getAllExpiryDates",
      instrument: instrumentKey,
      error: error.message
    });
    throw error;
  }
}

function findLatestExpiry(expiryDates) {
  if (!expiryDates || expiryDates.length === 0) {
    throw new Error("No expiry dates provided");
  }
  
  const today = new Date().toISOString().split('T')[0];
  const futureDates = expiryDates.filter(date => date >= today).sort();
  return futureDates.length > 0 ? futureDates[0] : expiryDates[expiryDates.length - 1];
}

function getExpiriesToFetch(expiryDates) {
  if (!expiryDates || expiryDates.length === 0) {
    throw new Error("No expiry dates provided");
  }
  
  const today = new Date().toISOString().split('T')[0];
  const futureDates = expiryDates.filter(date => date >= today).sort();
  
  if (futureDates.length === 0) {
    return { current: expiryDates[expiryDates.length - 1], next: null, isExpiryDay: false, expiriesToFetch: [expiryDates[expiryDates.length - 1]] };
  }
  
  const currentExpiry = futureDates[0];
  const isExpiryDay = currentExpiry === today;
  const nextExpiry = futureDates.length > 1 ? futureDates[1] : null;
  
  return {
    current: currentExpiry,
    next: isExpiryDay ? nextExpiry : null,
    isExpiryDay: isExpiryDay,
    allExpiries: futureDates.slice(0, 5),
    expiriesToFetch: [currentExpiry]  // Only nearest expiry
  };
}

// Detect expiry types (weekly/monthly) and return the nearest of each type
// Fetch option chain
// ── Multi-key round-robin rotation ───────────────────────────────────────────
// Reads ALL tokens from upstox_apps.json. Advances every 3 seconds automatically.
// Still falls back to next key on 429, and skips expired (401) keys.
const _getTokens = () => {
  try {
    return JSON.parse(fs.readFileSync(PATHS.UPSTOX_APPS, 'utf8'))
      .filter(a => a.access_token)
      .map(a => ({ id: a.id, name: a.name, token: a.access_token }));
  } catch { return []; }
};
let _activeTokenIdx = 0;
const _tokenRateLimitUntil = {}; // { tokenId: timestamp }

// Advance to next token every 3 seconds
setInterval(() => {
  const tokens = _getTokens();
  if (tokens.length > 1) {
    _activeTokenIdx = (_activeTokenIdx + 1) % tokens.length;
  }
}, 3000);

function getActiveToken() {
  const tokens = _getTokens();
  if (tokens.length === 0) return '';
  const now = Date.now();
  // Starting from current index, find first non-rate-limited token
  for (let i = 0; i < tokens.length; i++) {
    const idx = (_activeTokenIdx + i) % tokens.length;
    const id  = tokens[idx].id;
    if (now >= (_tokenRateLimitUntil[id] || 0)) {
      if (i > 0) {
        _activeTokenIdx = idx;
        log(`🔄 Skipped to key ${idx + 1} (${tokens[idx].name}) — earlier keys rate-limited`);
      }
      return tokens[idx].token;
    }
  }
  return null; // all keys rate-limited
}

async function fetchOptionChain(expiryDate, instrumentKey = CONFIG.INSTRUMENT_KEY) {
  const token = getActiveToken();
  if (!token) return null; // both keys rate-limited — skip silently

  try {
    const response = await axios.get(`${CONFIG.UPSTOX_BASE_URL}/option/chain`, {
      params: { instrument_key: instrumentKey, expiry_date: expiryDate },
      headers: { "Accept": "application/json", "Authorization": `Bearer ${token}` }
    });

    if (!response.data || !response.data.data) throw new Error("Invalid option chain response");
    return response.data;

  } catch (error) {
    if (error.response?.status === 429) {
      const tokens = _getTokens();
      const idx = _activeTokenIdx % Math.max(tokens.length, 1);
      const id  = tokens[idx]?.id;
      if (id) _tokenRateLimitUntil[id] = Date.now() + 120000; // cool this key for 2 min
      const next = (idx + 1) % tokens.length;
      if (tokens.length > 1) {
        _activeTokenIdx = next;
        log(`⚠️ Key ${idx + 1} (${tokens[idx]?.name}) rate limited — switched to key ${next + 1}`);
      } else {
        log(`⚠️ Rate limited — pausing 2 min (add more API keys for failover)`);
      }
    } else if (error.response?.status === 401) {
      log(`❌ TOKEN EXPIRED for key ${_activeTokenIdx + 1} — regenerate via admin panel`, "ERROR");
    }
    serverState.errors.push({
      timestamp: new Date().toISOString(),
      timestamp_ist: getCurrentIST().datetime,
      operation: "fetchOptionChain",
      expiry: expiryDate,
      instrument: instrumentKey,
      error: error.message
    });
    throw error;
  }
}

// Analyze option chain
function analyzeOptionChain(chainData) {
  if (!chainData.data || !Array.isArray(chainData.data)) {
    return null;
  }
  
  const strikes = chainData.data;
  let totalOI = 0, totalVolume = 0;
  let totalCallOI = 0, totalPutOI = 0;
  let totalCallVolume = 0, totalPutVolume = 0;
  let atmStrike = null, maxOI = -1;
  
  strikes.forEach(strike => {
    const callOI = strike.call_options?.market_data?.oi || 0;
    const putOI = strike.put_options?.market_data?.oi || 0;
    const callVol = strike.call_options?.market_data?.volume || 0;
    const putVol = strike.put_options?.market_data?.volume || 0;
    
    totalOI += callOI + putOI;
    totalVolume += callVol + putVol;
    totalCallOI += callOI;
    totalPutOI += putOI;
    totalCallVolume += callVol;
    totalPutVolume += putVol;
    
    const totalStrikeOI = callOI + putOI;
    if (totalStrikeOI > maxOI) {
      maxOI = totalStrikeOI;
      atmStrike = strike.strike_price;
    }
  });
  
  return {
    total_strikes: strikes.length,
    total_oi: totalOI,
    total_volume: totalVolume,
    atm_strike: atmStrike,
    pcr_oi: parseFloat((totalPutOI / (totalCallOI || 1)).toFixed(2)),
    pcr_volume: parseFloat((totalPutVolume / (totalCallVolume || 1)).toFixed(2)),
    call_oi: totalCallOI,
    put_oi: totalPutOI,
    call_volume: totalCallVolume,
    put_volume: totalPutVolume,
    strike_range: {
      min: strikes[0]?.strike_price || 0,
      max: strikes[strikes.length - 1]?.strike_price || 0
    }
  };
}

function getInstrumentName(instrumentKey) {
  const parts = instrumentKey.split('|');
  
  // For NSE_EQ stocks (ISIN codes), lookup the actual stock name
  if (parts[0] === 'NSE_EQ' && CONFIG.INSTRUMENT_MASTER && CONFIG.INSTRUMENT_MASTER.NSE_FO_STOCKS) {
    const stock = CONFIG.INSTRUMENT_MASTER.NSE_FO_STOCKS.find(s => s.key === instrumentKey);
    if (stock) {
      return stock.symbol; // Return the symbol (e.g., "RELIANCE", "INFY")
    }
  }
  
  // For NSE_INDEX instruments, lookup the actual symbol
  if (parts[0] === 'NSE_INDEX' && CONFIG.INSTRUMENT_MASTER && CONFIG.INSTRUMENT_MASTER.NSE_INDICES) {
    const index = CONFIG.INSTRUMENT_MASTER.NSE_INDICES.find(i => i.key === instrumentKey);
    if (index) {
      return index.symbol; // Return the symbol (e.g., "NIFTY", "BANKNIFTY")
    }
  }
  
  // For BSE_INDEX instruments, lookup the actual symbol
  if (parts[0] === 'BSE_INDEX' && CONFIG.INSTRUMENT_MASTER && CONFIG.INSTRUMENT_MASTER.BSE_INDICES) {
    const index = CONFIG.INSTRUMENT_MASTER.BSE_INDICES.find(i => i.key === instrumentKey);
    if (index) {
      return index.symbol; // Return the symbol (e.g., "SENSEX", "BANKEX")
    }
  }
  
  // For MCX instruments
  if (parts[0] === 'MCX_FO') {
    return parts[1]; // Return commodity name (e.g., "GOLD")
  }
  
  // For other instruments, return the second part after |
  return parts.length > 1 ? parts[1] : instrumentKey;
}

// Lot sizes for NSE F&O stocks (update as NSE revises them)
const STOCK_LOT_SIZES = {
  HDFCBANK: 550,   ICICIBANK: 700,  SBIN: 1500,    AXISBANK: 1200,
  CANBK: 3000,     BANKBARODA: 3000, PNB: 5000,    HDFCLIFE: 1000,
  BAJFINANCE: 125, BAJAJFINSV: 500, SHRIRAMFIN: 600, KOTAKBANK: 400,
  INDUSINDBK: 400, IDFCFIRSTB: 2800, SBILIFE: 375, SBICARD: 500,
  INFY: 400,       TCS: 175,        HCLTECH: 700,  WIPRO: 1500,
  TECHM: 600,      PERSISTENT: 75,  COFORGE: 100,  LTIM: 75,
  RELIANCE: 250,   ONGC: 1900,      IOC: 2500,     BPCL: 1800,
  NTPC: 2250,      POWERGRID: 2700, TATAPOWER: 2700,
  TATASTEEL: 5500, JSWSTEEL: 700,   HINDALCO: 1075, SAIL: 5000,
  LT: 175,         SIEMENS: 75,     ABB: 75,       BHEL: 5500,
  ADANIENT: 625,   ADANIPORTS: 625, ADANIPOWER: 2300,
  SUNPHARMA: 350,  DRREDDY: 125,    CIPLA: 650,    DIVISLAB: 100,
  APOLLOHOSP: 125, MANKIND: 375,    MAXHEALTH: 500,
  MARUTI: 100,     TATAMOTORS: 2850, BAJAJ_AUTO: 75, EICHERMOT: 75,
  M_M: 700,        HEROMOTOCO: 300,
  ASIANPAINT: 200, NESTLEIND: 50,   HINDUNILVR: 300, BRITANNIA: 100,
  TITAN: 375,      TATACONSUM: 1125,
  PIDILITIND: 250, BERGEPAINT: 1100,
  ITC: 3200,       COALINDIA: 4200, VEDL: 2000,    GRASIM: 250,
  ULTRACEMCO: 100, AMBUJACEM: 1500, ACC: 250,
  WIPRO: 1500,     MPHASIS: 200,    OFSS: 100,
  ZOMATO: 4500,    PAYTM: 825,      NYKAA: 1500,   POLICYBZR: 1800,
  IRCTC: 875,      HAL: 300,        BEL: 7400,     GRSE: 1000,
  IRFC: 5000,      RVNL: 5000,
};

// Cache of lot sizes read directly from Upstox /option/contract API response.
// Populated in getAllExpiryDates() — always takes priority over hardcoded values.
const _apiLotSizeCache = {};

function getLotSize(instrumentKey) {
  // API-sourced lot size takes top priority (always accurate)
  if (_apiLotSizeCache[instrumentKey]) return _apiLotSizeCache[instrumentKey];
  // Fallback: hardcoded master config
  const master = CONFIG.INSTRUMENT_MASTER;
  const nseIdx = master.NSE_INDICES?.find(i => i.key === instrumentKey);
  if (nseIdx?.lot_size) return nseIdx.lot_size;
  const bseIdx = master.BSE_INDICES?.find(i => i.key === instrumentKey);
  if (bseIdx?.lot_size) return bseIdx.lot_size;
  const stock = master.NSE_FO_STOCKS?.find(s => s.key === instrumentKey);
  if (stock?.symbol && STOCK_LOT_SIZES[stock.symbol]) return STOCK_LOT_SIZES[stock.symbol];
  return 1;
}

function createSafeFolderName(name) {
  return name.replace(/[\/\\:*?"<>|]/g, '_').replace(/\s+/g, '_');
}

// Compress chain data
function compressChainData(chainData) {
  if (!chainData || !Array.isArray(chainData)) return [];
  
  return chainData.map(strike => {
    const call = strike.call_options?.market_data || {};
    const put = strike.put_options?.market_data || {};
    const cg = strike.call_options?.option_greeks || {};
    const pg = strike.put_options?.option_greeks || {};
    
    return {
      s: strike.strike_price,
      u: strike.underlying_spot_price || 0,
      c: {
        po: cg?.pop || 0,
        th: cg?.theta || 0,
        ga: cg?.gamma || 0,
        ve: cg?.vega || 0,
        de: cg?.delta || 0,
        iv: cg?.iv || 0,
        oc: (call.oi || 0) - (call.prev_oi || 0),
        oi: call.oi || 0,
        v: call.volume || 0,
        lp: call.ltp || 0,
        lc: (call.ltp || 0) - (call.close_price || 0)
      },
      p: {
        po: pg?.pop || 0,
        th: pg?.theta || 0,
        ga: pg?.gamma || 0,
        ve: pg?.vega || 0,
        de: pg?.delta || 0,
        iv: pg?.iv || 0,
        oc: (put.oi || 0) - (put.prev_oi || 0),
        oi: put.oi || 0,
        v: put.volume || 0,
        lp: put.ltp || 0,
        lc: (put.ltp || 0) - (put.close_price || 0)
      }
    };
  });
}

// Cache for availableExpiries per instrument — refreshed every 5 minutes
const _expiryCache = {};

// Save option chain data (COMPRESSED)
function saveOptionChainData(expiryDate, chainData, analysis, instrumentKey = CONFIG.INSTRUMENT_KEY) {
  try {
    const currentIST = getCurrentIST();
    
    const dataToSave = {
      m: {
        i: instrumentKey,
        in: getInstrumentName(instrumentKey),
        e: expiryDate,
        fu: new Date().toISOString(),
        fi: currentIST.datetime,
        fi_iso: currentIST.iso,
        sc: chainData.data?.length || 0,
        s: "upstox",
        tz: "IST",
        lot_size: getLotSize(instrumentKey),
        time_hhmmss: currentIST.time,
        time_hh: currentIST.time.split(':')[0],
        time_mm: currentIST.time.split(':')[1],
        time_ss: currentIST.time.split(':')[2]
      },
      a: analysis,
      oc: compressChainData(chainData.data || [])
    };
    
    const instrumentName = getInstrumentName(instrumentKey);
    const safeInstrumentName = createSafeFolderName(instrumentName);
    const istDateFolder = currentIST.date;
    
    const baseDataDir = PATHS.MARKET;
    const instrumentDir = path.join(baseDataDir, safeInstrumentName);
    const expiryDir = path.join(instrumentDir, expiryDate);
    const dateDir = path.join(expiryDir, istDateFolder);

    ensureDirectoryExists(baseDataDir);
    ensureDirectoryExists(instrumentDir);
    ensureDirectoryExists(expiryDir);
    ensureDirectoryExists(dateDir);
    
    const fileName = `${safeInstrumentName}_${expiryDate}_${currentIST.forFilename}.json.gz`;
    const filePath = path.join(dateDir, fileName);
    
    const compressedData = zlib.gzipSync(JSON.stringify(dataToSave));
    fs.writeFileSync(filePath, compressedData);

    const fileSizeKB = (compressedData.length / 1024).toFixed(2);
    log(`💾 Saved ${safeInstrumentName} | expiry:${expiryDate} | ${fileSizeKB} KB → ${fileName}`);

    // ── RAM CACHE ────────────────────────────────────────────────────────────
    // Transform raw chain data to the frontend format and store in memory.
    // /api/live/:symbol will serve this directly — zero disk I/O per request.
    try {
      const rawRows = chainData.data || [];
      const spotPrice = rawRows[0]?.underlying_spot_price || 0;

      const cacheChain = rawRows.map(row => {
        const cc = row.call_options?.market_data || {};
        const pc = row.put_options?.market_data || {};
        const cg = row.call_options?.option_greeks || {};
        const pg = row.put_options?.option_greeks || {};
        return {
          strike: row.strike_price,
          call: {
            pop: cg.pop || 0, theta: cg.theta || 0, gamma: cg.gamma || 0,
            vega: cg.vega || 0, delta: cg.delta || 0, iv: cg.iv || 0,
            oi_change: (cc.oi || 0) - (cc.prev_oi || 0),
            oi: cc.oi || 0, volume: cc.volume || 0,
            ltp: cc.ltp || 0, ltp_change: (cc.ltp || 0) - (cc.close_price || 0)
          },
          put: {
            pop: pg.pop || 0, theta: pg.theta || 0, gamma: pg.gamma || 0,
            vega: pg.vega || 0, delta: pg.delta || 0, iv: pg.iv || 0,
            oi_change: (pc.oi || 0) - (pc.prev_oi || 0),
            oi: pc.oi || 0, volume: pc.volume || 0,
            ltp: pc.ltp || 0, ltp_change: (pc.ltp || 0) - (pc.close_price || 0)
          }
        };
      });

      // Compute expiry info (quick dir scan — once per 5s, not per request)
      const today = new Date().toISOString().split('T')[0];
      let isExpiryDay = false, currentExpiry = expiryDate, nextExpiry = null;
      let availableExpiries = [];
      try {
        const symDir = path.join('Data', safeInstrumentName);
        const cacheKey = `${safeInstrumentName}|${istDateFolder}`;
        // Scan once per instrument per date — never re-scan during the same session/day
        if (!_expiryCache[cacheKey]) {
          const allExpiries = fs.readdirSync(symDir)
            .filter(e => fs.statSync(path.join(symDir, e)).isDirectory()).sort();
          const futureExp = allExpiries.filter(e => e >= today);
          const avail = allExpiries.filter(e => {
            const expPath = path.join(symDir, e);
            const dFolders = fs.readdirSync(expPath)
              .filter(d => fs.statSync(path.join(expPath, d)).isDirectory()).sort();
            return dFolders.at(-1) === istDateFolder;
          });
          _expiryCache[cacheKey] = { allExpiries, futureExp, avail };
        }
        const ec = _expiryCache[cacheKey];
        isExpiryDay      = ec.futureExp[0] === today;
        currentExpiry    = ec.futureExp[0] || expiryDate;
        nextExpiry       = ec.futureExp[1] || null;
        availableExpiries = ec.avail;
      } catch (_) {}

      // Store with UPPERCASE key to match resolveSymbol() in chain.js
      const cacheKey = safeInstrumentName.toUpperCase();
      const newSnapshot = {
        symbol: safeInstrumentName,
        expiry: expiryDate,
        date: istDateFolder,
        time: currentIST.time,
        spot_price: spotPrice,
        lot_size: getLotSize(instrumentKey),
        chain: cacheChain,
        isExpiryDay,
        currentExpiry,
        nextExpiry,
        availableExpiries
      };

      // Compute diff vs previous snapshot (for WebSocket diff delivery)
      const prevSnapshot = liveCache.get(cacheKey);
      const { diffSnapshot } = require('./ws/diff');
      const diff = diffSnapshot(prevSnapshot, newSnapshot);

      liveCache.set(cacheKey, newSnapshot);

      // Publish full + diff to WebSocket clients via Redis Pub/Sub (fire-and-forget)
      try {
        const { publishUpdate } = require('./ws/websocket');
        publishUpdate(cacheKey, newSnapshot, diff).catch(() => {});
      } catch (_) {}

      // ── Feed spot price to chart candle builder (no extra API call) ────────
      // Reuses the spot price already fetched with option chain data
      if (spotPrice > 0) {
        try { require('./api/upstoxFeed').processTick(safeInstrumentName, spotPrice); } catch (_) {}
      }
    } catch (cacheErr) {
      log(`⚠️ Cache update failed: ${cacheErr.message}`, 'WARNING');
    }
    // ── END RAM CACHE ─────────────────────────────────────────────────────────

    // Generate chart data (silent)
    try {
      if (generateAllChartData) generateAllChartData(safeInstrumentName, expiryDate, istDateFolder);
    } catch (e) {}

    serverState.latestFile = {
      path: filePath,
      instrument: safeInstrumentName,
      expiry: expiryDate,
      date: istDateFolder,
      filename: fileName,
      fetched_at_ist: currentIST.datetime,
      size_kb: fileSizeKB,
      time_hhmmss: currentIST.time
    };
    
    return {
      ...dataToSave,
      saved_path: filePath,
      size_kb: fileSizeKB,
      time_hhmmss: currentIST.time
    };
    
  } catch (error) {
    log(`❌ Save failed: ${error.message}`, "ERROR");
    throw error;
  }
}

function getAvailableInstruments() {
  try {
    const dataDir = PATHS.MARKET;
    if (!fs.existsSync(dataDir)) return [];
    
    return fs.readdirSync(dataDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  } catch (error) {
    return [];
  }
}

// Fetch + save one instrument. Returns { name, size_kb } on success, null on skip/fail.
async function updateOptionChain(instrumentKey = CONFIG.INSTRUMENT_KEY) {
  const cached = _contractCache[instrumentKey];
  if (!cached?.dates?.length) return null;

  const expiryInfo = getExpiriesToFetch(cached.dates);
  serverState.currentExpiry    = expiryInfo.current;
  serverState.isExpiryDay      = expiryInfo.isExpiryDay;
  serverState.nextExpiry       = expiryInfo.next;
  serverState.availableExpiries = expiryInfo.allExpiries;
  serverState.expiriesToFetch  = expiryInfo.expiriesToFetch;

  const expiry = expiryInfo.expiriesToFetch[0];
  // If both tokens are rate-limited, skip silently
  if (!getActiveToken()) return null;

  try {
    const chainData = await fetchOptionChain(expiry, instrumentKey);
    const analysis  = analyzeOptionChain(chainData);
    const saved     = saveOptionChainData(expiry, chainData, analysis, instrumentKey);
    serverState.lastUpdate    = new Date().toISOString();
    serverState.lastUpdateIST = getCurrentIST().datetime;
    serverState.totalUpdates++;
    return { name: getInstrumentName(instrumentKey), size_kb: saved.size_kb };
  } catch (_) {
    return null; // 429 already logged in fetchOptionChain; other errors silenced here
  }
}

// UPDATE ALL INSTRUMENTS — all in parallel, one clean summary log per cycle
async function updateAllInstruments() {
  if (serverState.isUpdating) return [];
  serverState.isUpdating = true;
  try {
    const instruments = CONFIG.INSTRUMENTS || [CONFIG.INSTRUMENT_KEY];
    const settled = await Promise.allSettled(instruments.map(inst => updateOptionChain(inst)));
    const saved = settled
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter(Boolean);
    if (saved.length > 0) {
      const time = getCurrentIST().time;
      const parts = saved.map(s => `${s.name}(${s.size_kb}KB)`).join(' ');
      log(`✅ ${time} | Saved: ${parts}`);
    }
    return settled.map((r, i) => ({ instrument: instruments[i], success: r.status === 'fulfilled' && !!r.value }));
  } finally {
    serverState.isUpdating = false;
  }
}

function listSavedFiles() {
  try {
    const dataDir = PATHS.MARKET;
    if (!fs.existsSync(dataDir)) return [];
    
    const files = [];
    
    function scanDirectory(dir, relativePath = '') {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      items.forEach(item => {
        const itemPath = path.join(dir, item.name);
        const relPath = path.join(relativePath, item.name);
        
        if (item.isDirectory()) {
          scanDirectory(itemPath, relPath);
        } else if (item.isFile() && (item.name.endsWith('.json') || item.name.endsWith('.json.gz'))) {
          const stats = fs.statSync(itemPath);
          files.push({
            path: relPath,
            full_path: itemPath,
            filename: item.name,
            size: stats.size,
            size_kb: (stats.size / 1024).toFixed(2),
            compressed: item.name.endsWith('.gz'),
            modified: stats.mtime,
            modified_ist: convertUTCtoIST(stats.mtime.toISOString()).datetime
          });
        }
      });
    }
    
    scanDirectory(dataDir);
    return files.sort((a, b) => b.modified - a.modified);
    
  } catch (error) {
    return [];
  }
}

function findLatestSavedFile() {
  const files = listSavedFiles();
  return files.length > 0 ? files[0] : null;
}

// Read expiry dates from existing disk data — zero API calls, instant.
// Falls back to Upstox /option/contract only if no data folder exists yet.
function getExpiriesFromDisk(instrumentKey) {
  try {
    const symbol  = createSafeFolderName(getInstrumentName(instrumentKey));
    const symDir  = path.join('Data', symbol);
    if (!fs.existsSync(symDir)) return null;
    const today   = getISTToday();
    // Find expiry folders that are still valid (>= today), sorted ascending
    const expiries = fs.readdirSync(symDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name >= today)
      .map(d => d.name)
      .sort();
    return expiries.length > 0 ? expiries : null;
  } catch (_) { return null; }
}

// Warm the expiry cache:
//   1. Use disk data folders — instant, no API call (works on every restart)
//   2. Only call Upstox API if no data exists yet (first-ever run)
async function warmExpiryCache() {
  const instruments = CONFIG.INSTRUMENTS || [CONFIG.INSTRUMENT_KEY];
  const today       = getISTToday();
  let apiNeeded     = [];

  for (const inst of instruments) {
    const fromDisk = getExpiriesFromDisk(inst);
    if (fromDisk?.length) {
      // Use disk — no API call needed
      _contractCache[inst] = { dates: fromDisk, day: today };
      log(`📅 Expiry from disk: ${getInstrumentName(inst)} → ${fromDisk[0]}`);
    } else {
      apiNeeded.push(inst); // no data on disk yet
    }
  }

  // Only hit Upstox API for instruments with no existing data (rare: first run)
  if (apiNeeded.length > 0) {
    log(`📅 Fetching expiry from API for ${apiNeeded.length} new instrument(s)...`);
    for (let i = 0; i < apiNeeded.length; i++) {
      try {
        await getAllExpiryDates(apiNeeded[i]);
      } catch (e) {
        log(`⚠️  Expiry API fetch failed for ${getInstrumentName(apiNeeded[i])}: ${e.message}`);
      }
      if (i < apiNeeded.length - 1) await new Promise(r => setTimeout(r, 600));
    }
  }

  log(`📅 Expiry cache ready — data fetch starting.`);
}

// AUTO REFRESH - GUARANTEED 5 SECONDS - ALL INSTRUMENTS
function startAutoRefresh() {
  if (serverState.autoRefreshInterval) {
    return;
  }
  
  const instruments = CONFIG.INSTRUMENTS || [CONFIG.INSTRUMENT_KEY];
  log(`🔁 Auto-refresh started: Every ${CONFIG.REFRESH_INTERVAL / 1000}s for ${instruments.length} instruments`);

  // Cache already warmed by caller (startServer/warmExpiryCache) — start interval immediately
  updateAllInstruments();
  serverState.autoRefreshInterval = setInterval(() => {
    updateAllInstruments();
  }, CONFIG.REFRESH_INTERVAL);
}

function startFetching(isScheduled = false) {
  if (serverState.autoRefreshInterval) {
    return false;
  }
  
  if (!isScheduled) {
    serverState.isManualRunning = true;
  } else {
    serverState.isScheduledRunning = true;
  }
  
  const instruments = CONFIG.INSTRUMENTS || [CONFIG.INSTRUMENT_KEY];
  log(`▶️ Starting data fetching for ${instruments.length} instruments (${isScheduled ? 'SCHEDULED' : 'MANUAL'})`);

  // Warm expiry cache first (sequential, rate-limit safe), then start interval
  warmExpiryCache().then(() => {
    updateAllInstruments();
    serverState.autoRefreshInterval = setInterval(() => {
      updateAllInstruments();
    }, CONFIG.REFRESH_INTERVAL);
  });

  return true;
}

function stopFetching() {
  if (!serverState.autoRefreshInterval) {
    return false;
  }
  
  log("⏹️ Stopping data fetching");
  clearInterval(serverState.autoRefreshInterval);
  serverState.autoRefreshInterval = null;
  serverState.isManualRunning = false;
  serverState.isScheduledRunning = false;
  
  return true;
}

// Check schedule (MINIMAL LOGGING)
function checkSchedule() {
  if (!serverState.scheduleEnabled) return;
  
  const istTime = getCurrentIST();
  const currentTime = istTime.time.substring(0, 5);
  
  const istDate = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const currentDayNum = istDate.getUTCDay();
  const currentDay = days[currentDayNum];

  // Support both string ('mon') and numeric (1) day formats in schedule.json
  const isDayScheduled = serverState.schedule.days.some(d => d === currentDay || d === currentDayNum);
  const isWithinTime = currentTime >= serverState.schedule.start_time && 
                       currentTime <= serverState.schedule.stop_time;
  
  const isRunning = serverState.autoRefreshInterval !== null;
  
  if (isDayScheduled && isWithinTime && !isRunning) {
    log(`📅 Schedule START: ${currentDay} ${currentTime}`);
    startFetching(true);
  } 
  else if ((!isDayScheduled || !isWithinTime) && isRunning && !serverState.isManualRunning) {
    log(`📅 Schedule STOP: ${currentDay} ${currentTime}`);
    stopFetching();
  }
}

setInterval(checkSchedule, 60000);

// Re-warm expiry cache daily at 09:01 IST (after market opens, fresh contracts available)
setInterval(() => {
  const ist = getCurrentIST();
  const hhmm = ist.time.substring(0, 5);
  if (hhmm === '09:01') warmExpiryCache().catch(() => {});
}, 60000);

// ── 9:10 AM Bromos gap-open check ─────────────────────────────────────────────
// Pre-market closes at 9:09. At 9:10 we read the first live snapshot and check
// whether the market opened above resistance_reversal or below support_reversal.
// If so, we find the new reversal level and update _bromos_latest.json.
let _bromosGapCheckDone = '';   // tracks date so it runs only once per day
setInterval(() => {
  try {
    const ist  = getCurrentIST();
    const hhmm = ist.time.substring(0, 5);
    const date = ist.date;                       // "YYYY-MM-DD"
    if (hhmm !== '09:10') return;
    if (_bromosGapCheckDone === date) return;     // already ran today
    _bromosGapCheckDone = date;

    const instruments = CONFIG.INSTRUMENTS || [];
    const symbols = instruments.map(k => createSafeFolderName(getInstrumentName(k)));
    console.log(`📊 9:10 AM gap-open check for: ${symbols.join(', ')}`);
    symbols.forEach(sym => {
      try { if (updateBromosForGapOpen) updateBromosForGapOpen(sym); }
      catch (e) { console.error(`  ❌ Bromos gap-open error (${sym}):`, e.message); }
    });
  } catch (e) {}
}, 60000);

// ADMIN AUTHENTICATION
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  
  const token = authHeader.substring(7);
  
  if (token === Buffer.from(`${CONFIG.ADMIN_USERNAME}:${CONFIG.ADMIN_PASSWORD}`).toString('base64')) {
    next();
  } else {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// ── TEAM MEMBERS ─────────────────────────────────────────────────────────────
const multer = require('multer');
const TEAM_DIR  = PATHS.TEAM;
const USERS_DIR = PATHS.USERS;

// Read role directly from user file (session may not have userRole)
const getUserRole = (userId) => {
  try {
    const u = JSON.parse(fs.readFileSync(path.join(USERS_DIR, `${userId}.json`), 'utf8'));
    return u.role || 'user';
  } catch { return 'user'; }
};
if (!fs.existsSync(TEAM_DIR)) fs.mkdirSync(TEAM_DIR, { recursive: true });

const teamUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

// GET /api/team — public
// ── Meet Links ───────────────────────────────────────────────────────────────
const MEET_LINKS_FILE = path.join(PATHS.CONFIG, '_meet_links.json');

app.get('/api/meet-links', (req, res) => {
  try {
    const links = fs.existsSync(MEET_LINKS_FILE)
      ? JSON.parse(fs.readFileSync(MEET_LINKS_FILE, 'utf8'))
      : { public_meet: '', community_meet: '' };
    res.json({ success: true, links });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/admin/meet-links', requireAuth, (req, res) => {
  if (req.session?.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'Admin only' });
  try {
    const { public_meet, community_meet } = req.body;
    const links = { public_meet: public_meet || '', community_meet: community_meet || '' };
    fs.writeFileSync(MEET_LINKS_FILE, JSON.stringify(links));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/team', (req, res) => {
  try {
    const files = fs.readdirSync(TEAM_DIR).filter(f => /^card\d+\.json$/.test(f));
    const members = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(TEAM_DIR, f), 'utf8'));
        data.hasPhoto = fs.existsSync(path.join(TEAM_DIR, `card${data.id}photo`));
        return data;
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => a.id - b.id);
    res.json({ success: true, members });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// GET /api/team/photo/:id — serve photo
app.get('/api/team/photo/:id', (req, res) => {
  const photoPath = path.join(TEAM_DIR, `card${req.params.id}photo`);
  if (!fs.existsSync(photoPath)) return res.status(404).json({ error: 'No photo' });
  res.sendFile(photoPath);
});

// POST /api/admin/team — add member (admin only)
app.post('/api/admin/team', requireAuth, teamUpload.single('photo'), (req, res) => {
  if (getUserRole(req.session.userId) !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { name, designation, experience } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const files = fs.readdirSync(TEAM_DIR).filter(f => /^card\d+\.json$/.test(f));
  const ids = files.map(f => parseInt(f.match(/^card(\d+)\.json$/)[1]));
  const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
  const member = { id: nextId, name: name.trim(), designation: (designation || '').trim(), experience: (experience || '').trim() };
  fs.writeFileSync(path.join(TEAM_DIR, `card${nextId}.json`), JSON.stringify(member, null, 2));
  if (req.file) fs.writeFileSync(path.join(TEAM_DIR, `card${nextId}photo`), req.file.buffer);
  res.json({ success: true, member: { ...member, hasPhoto: !!req.file } });
});

// PUT /api/admin/team/:id — update member (admin only)
app.put('/api/admin/team/:id', requireAuth, teamUpload.single('photo'), (req, res) => {
  if (getUserRole(req.session.userId) !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const id = parseInt(req.params.id);
  const jsonPath = path.join(TEAM_DIR, `card${id}.json`);
  if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: 'Not found' });
  const existing = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const { name, designation, experience } = req.body;
  const updated = { ...existing, name: (name || existing.name).trim(), designation: (designation ?? existing.designation).trim(), experience: (experience ?? existing.experience).trim() };
  fs.writeFileSync(jsonPath, JSON.stringify(updated, null, 2));
  if (req.file) fs.writeFileSync(path.join(TEAM_DIR, `card${id}photo`), req.file.buffer);
  res.json({ success: true, member: { ...updated, hasPhoto: fs.existsSync(path.join(TEAM_DIR, `card${id}photo`)) } });
});

// DELETE /api/admin/team/:id — delete member (admin only)
app.delete('/api/admin/team/:id', requireAuth, (req, res) => {
  if (getUserRole(req.session.userId) !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const id = parseInt(req.params.id);
  const jsonPath = path.join(TEAM_DIR, `card${id}.json`);
  if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(jsonPath);
  const photoPath = path.join(TEAM_DIR, `card${id}photo`);
  if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
  res.json({ success: true });
});

// POST /api/admin/bromos-gap-update — manually trigger gap-open Bromos recalc
// (admin only; useful for testing or when 9:09 AM scheduler was missed)
app.post('/api/admin/bromos-gap-update', requireAuth, (req, res) => {
  if (getUserRole(req.session.userId) !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    // Gap-correct all historical _chart_strategy40.json files
    if (generateBromosOpenForAllDates) generateBromosOpenForAllDates();
    // Update live _bromos_latest.json for today's header
    const syms = getAvailableInstruments();
    const results = [];
    for (const sym of syms) {
      try { updateBromosForGapOpen(sym); results.push({ sym, ok: true }); }
      catch (e) { results.push({ sym, ok: false, error: e.message }); }
    }
    res.json({ success: true, results });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
const NOTIF_DIR      = PATHS.NOTIFICATIONS;
const NOTIF_SEEN_DIR = path.join(NOTIF_DIR, 'seen');
[NOTIF_DIR, NOTIF_SEEN_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const notifUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg','image/png','image/webp','application/pdf'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images and PDFs allowed'));
  },
});

const readNotifSeen  = (uid) => { try { const p = path.join(NOTIF_SEEN_DIR, `${uid}.json`); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,'utf8')) : {}; } catch { return {}; } };
const writeNotifSeen = (uid, data) => fs.writeFileSync(path.join(NOTIF_SEEN_DIR, `${uid}.json`), JSON.stringify(data));
const allNotifs      = () => { try { return fs.readdirSync(NOTIF_DIR).filter(f => /^notif\d+\.json$/.test(f)).map(f => { try { const d = JSON.parse(fs.readFileSync(path.join(NOTIF_DIR,f),'utf8')); d.hasFile = fs.existsSync(path.join(NOTIF_DIR,`notif${d.id}file`)); return d; } catch { return null; } }).filter(Boolean).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)); } catch { return []; } };

// GET /api/notifications
app.get('/api/notifications', requireAuth, (req, res) => {
  const seen = readNotifSeen(req.session.userId);
  const notifs = allNotifs().map(n => ({ ...n, seenCount: seen[n.id] || 0, seen: (seen[n.id] || 0) > 0 }));
  res.json({ success: true, notifications: notifs });
});

// GET /api/notifications/popup — unseen (shown < 5 times)
app.get('/api/notifications/popup', requireAuth, (req, res) => {
  const seen = readNotifSeen(req.session.userId);
  const popup = allNotifs().filter(n => (seen[n.id] || 0) < 5);
  res.json({ success: true, notifications: popup });
});

// POST /api/notifications/:id/seen — increment seen count
app.post('/api/notifications/:id/seen', requireAuth, (req, res) => {
  const id = String(parseInt(req.params.id));
  const seen = readNotifSeen(req.session.userId);
  seen[id] = (seen[id] || 0) + 1;
  writeNotifSeen(req.session.userId, seen);
  res.json({ success: true });
});

// POST /api/notifications/seen-all
app.post('/api/notifications/seen-all', requireAuth, (req, res) => {
  const seen = readNotifSeen(req.session.userId);
  allNotifs().forEach(n => { seen[String(n.id)] = Math.max(5, seen[String(n.id)] || 0); });
  writeNotifSeen(req.session.userId, seen);
  res.json({ success: true });
});

// GET /api/notifications/file/:id
app.get('/api/notifications/file/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const filePath = path.join(NOTIF_DIR, `notif${id}file`);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'No file' });
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(NOTIF_DIR, `notif${id}.json`), 'utf8'));
    if (meta.fileType) res.setHeader('Content-Type', meta.fileType);
    if (meta.fileName) res.setHeader('Content-Disposition', `inline; filename="${meta.fileName}"`);
  } catch {}
  res.sendFile(filePath);
});

// POST /api/admin/notifications — create (admin only)
app.post('/api/admin/notifications', requireAuth, notifUpload.single('file'), (req, res) => {
  if (getUserRole(req.session.userId) !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { title, message } = req.body;
  if (!title?.trim() && !message?.trim()) return res.status(400).json({ error: 'Title or message required' });
  const files = fs.readdirSync(NOTIF_DIR).filter(f => /^notif\d+\.json$/.test(f));
  const ids = files.map(f => parseInt(f.match(/^notif(\d+)\.json$/)[1]));
  const nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
  const notif = { id: nextId, title: (title||'').trim(), message: (message||'').trim(), createdAt: new Date().toISOString(), hasFile: !!req.file, fileType: req.file?.mimetype||null, fileName: req.file?.originalname||null };
  fs.writeFileSync(path.join(NOTIF_DIR, `notif${nextId}.json`), JSON.stringify(notif, null, 2));
  if (req.file) fs.writeFileSync(path.join(NOTIF_DIR, `notif${nextId}file`), req.file.buffer);
  res.json({ success: true, notification: { ...notif, hasFile: !!req.file } });
});

// DELETE /api/admin/notifications/:id
app.delete('/api/admin/notifications/:id', requireAuth, (req, res) => {
  if (getUserRole(req.session.userId) !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const id = parseInt(req.params.id);
  const jsonPath = path.join(NOTIF_DIR, `notif${id}.json`);
  if (!fs.existsSync(jsonPath)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(jsonPath);
  const fp = path.join(NOTIF_DIR, `notif${id}file`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ success: true });
});

// ADMIN API ENDPOINTS

app.post("/api/admin/login", (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (username === CONFIG.ADMIN_USERNAME && password === CONFIG.ADMIN_PASSWORD) {
      const token = Buffer.from(`${username}:${password}`).toString('base64');
      
      res.json({
        success: true,
        message: 'Login successful',
        token: token
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Login error',
      error: error.message
    });
  }
});

app.get("/api/admin/status", authenticateAdmin, (req, res) => {
  try {
    res.json({
      success: true,
      status: {
        is_running: !!serverState.autoRefreshInterval,
        is_manual: serverState.isManualRunning,
        schedule_enabled: serverState.scheduleEnabled,
        last_update: serverState.lastUpdateIST,
        total_updates: serverState.totalUpdates,
        current_expiry: serverState.currentExpiry
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error getting status',
      error: error.message
    });
  }
});

app.post("/api/admin/start", authenticateAdmin, (req, res) => {
  try {
    const result = startFetching();
    
    if (result) {
      res.json({
        success: true,
        message: 'Data fetching started'
      });
    } else {
      res.json({
        success: false,
        message: 'Fetching is already running'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error starting fetching',
      error: error.message
    });
  }
});

app.post("/api/admin/stop", authenticateAdmin, (req, res) => {
  try {
    const result = stopFetching();
    
    if (result) {
      res.json({
        success: true,
        message: 'Data fetching stopped'
      });
    } else {
      res.json({
        success: false,
        message: 'Fetching is not running'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error stopping fetching',
      error: error.message
    });
  }
});

app.get("/api/admin/schedule", authenticateAdmin, (req, res) => {
  try {
    res.json({
      success: true,
      schedule: serverState.schedule,
      enabled: serverState.scheduleEnabled
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error getting schedule',
      error: error.message
    });
  }
});

app.post("/api/admin/schedule", authenticateAdmin, (req, res) => {
  try {
    const { schedule, enabled } = req.body;
    
    if (schedule) {
      serverState.schedule = {
        days: schedule.days || serverState.schedule.days,
        start_time: schedule.start_time || serverState.schedule.start_time,
        stop_time: schedule.stop_time || serverState.schedule.stop_time
      };
    }
    
    if (typeof enabled === 'boolean') {
      serverState.scheduleEnabled = enabled;
    }
    
    saveScheduleToFile();
    
    res.json({
      success: true,
      message: 'Schedule updated',
      schedule: serverState.schedule,
      enabled: serverState.scheduleEnabled
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating schedule',
      error: error.message
    });
  }
});

// Update access token 2 (failover key)
app.post("/api/admin/token2", authenticateAdmin, (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) return res.status(400).json({ success: false, message: 'Token required' });

    CONFIG.ACCESS_TOKEN_2 = access_token;
    _tokenRateLimitUntil[1] = 0; // clear any cooldown on this slot

    try {
      const envPath = path.join(PATHS.DATA, '.env');
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      if (envContent.includes('ACCESS_TOKEN_2=')) {
        envContent = envContent.replace(/ACCESS_TOKEN_2=.*/g, `ACCESS_TOKEN_2=${access_token}`);
      } else {
        envContent += `\nACCESS_TOKEN_2=${access_token}\n`;
      }
      fs.writeFileSync(envPath, envContent);
      log(`✅ Access token 2 updated`);
      res.json({ success: true, message: 'API Key 2 updated (memory + .env)' });
    } catch (envError) {
      res.json({ success: true, message: 'API Key 2 updated in memory only', warning: envError.message });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating token 2', error: error.message });
  }
});

// Update access token
app.post("/api/admin/token", authenticateAdmin, (req, res) => {
  try {
    const { access_token } = req.body;
    
    if (!access_token) {
      return res.status(400).json({
        success: false,
        message: 'Access token is required'
      });
    }
    
    // Update in memory
    CONFIG.ACCESS_TOKEN = access_token;
    
    // Update .env file
    try {
      const envPath = path.join(PATHS.DATA, '.env');
      let envContent = '';
      
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }
      
      // Update or add ACCESS_TOKEN
      if (envContent.includes('ACCESS_TOKEN=')) {
        envContent = envContent.replace(/ACCESS_TOKEN=.*/g, `ACCESS_TOKEN=${access_token}`);
      } else {
        envContent += `\nACCESS_TOKEN=${access_token}\n`;
      }
      
      fs.writeFileSync(envPath, envContent);
      log(`✅ Access token updated in .env file`);
      
      res.json({
        success: true,
        message: 'Access token updated successfully (both in memory and .env file)'
      });
    } catch (envError) {
      log(`⚠️ Token updated in memory but failed to update .env: ${envError.message}`, "WARNING");
      res.json({
        success: true,
        message: 'Access token updated in memory only (restart server to lose changes)',
        warning: 'Failed to update .env file: ' + envError.message
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating token',
      error: error.message
    });
  }
});

// ── Helper: upsert a key=value line in .env ───────────────────────────────────
function updateEnvKey(key, value) {
  const envPath = path.join(PATHS.DATA, '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const commentedRe = new RegExp(`^#\\s*${key}=.*`, 'gm');
  const activeRe    = new RegExp(`^${key}=.*`,       'gm');
  if (activeRe.test(content))    content = content.replace(activeRe, `${key}=${value}`);
  else if (commentedRe.test(content)) content = content.replace(commentedRe, `${key}=${value}`);
  else content += `\n${key}=${value}\n`;
  fs.writeFileSync(envPath, content);
}

// ── Upstox apps — stored in data/config/upstox_apps.json ─────────────────────
const UPSTOX_APPS_FILE = PATHS.UPSTOX_APPS;
function loadApps() {
  try { return JSON.parse(fs.readFileSync(UPSTOX_APPS_FILE, 'utf8')); } catch { return []; }
}
function saveApps(apps) {
  fs.writeFileSync(UPSTOX_APPS_FILE, JSON.stringify(apps, null, 2));
}
function nextAppId(apps) { return apps.length ? Math.max(...apps.map(a => a.id)) + 1 : 1; }
function buildAppAuthUrl(app) {
  if (!app.api_key || !app.redirect_uri) return null;
  return `https://api.upstox.com/v2/login/authorization/dialog?client_id=${encodeURIComponent(app.api_key)}&redirect_uri=${encodeURIComponent(app.redirect_uri)}&response_type=code&state=${app.id}`;
}

// ── GET /api/admin/upstox-apps ───────────────────────────────────────────────
app.get('/api/admin/upstox-apps', authenticateAdmin, (req, res) => {
  const apps = loadApps().map(a => ({
    id: a.id, name: a.name, api_key: a.api_key,
    has_secret: !!a.api_secret, has_token: !!a.access_token,
    redirect_uri: a.redirect_uri || '',
  }));
  res.json({
    success: true, apps,
    admin_email: process.env.ADMIN_EMAIL || '',
    email_time:  CONFIG.UPSTOX_EMAIL_TIME || '08:00',
  });
});

// ── POST /api/admin/upstox-apps (add new app) ────────────────────────────────
app.post('/api/admin/upstox-apps', authenticateAdmin, (req, res) => {
  const { name, api_key, api_secret, redirect_uri } = req.body;
  if (!name || !api_key) return res.status(400).json({ success: false, message: 'name and api_key required' });
  const apps = loadApps();
  const app2 = { id: nextAppId(apps), name, api_key, api_secret: api_secret || '', access_token: '', redirect_uri: redirect_uri || CONFIG.UPSTOX_REDIRECT_URI || '' };
  apps.push(app2);
  saveApps(apps);
  log(`✅ Upstox app added: ${name} (id=${app2.id})`);
  res.json({ success: true, message: 'App added', id: app2.id });
});

// ── PUT /api/admin/upstox-apps/:id (update app) ──────────────────────────────
app.put('/api/admin/upstox-apps/:id', authenticateAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, api_key, api_secret, redirect_uri } = req.body;
  const apps = loadApps();
  const idx  = apps.findIndex(a => a.id === id);
  if (idx < 0) return res.status(404).json({ success: false, message: 'App not found' });
  if (name)         apps[idx].name         = name;
  if (api_key)      apps[idx].api_key      = api_key;
  if (api_secret)   apps[idx].api_secret   = api_secret;
  if (redirect_uri) apps[idx].redirect_uri = redirect_uri;
  saveApps(apps);
  // sync primary tokens to CONFIG/.env for backward compat
  const sorted = apps.filter(a => a.access_token);
  if (sorted[0]) { CONFIG.ACCESS_TOKEN   = sorted[0].access_token; updateEnvKey('ACCESS_TOKEN',   sorted[0].access_token); }
  if (sorted[1]) { CONFIG.ACCESS_TOKEN_2 = sorted[1].access_token; updateEnvKey('ACCESS_TOKEN_2', sorted[1].access_token); }
  log(`✅ Upstox app updated: ${apps[idx].name} (id=${id})`);
  res.json({ success: true, message: 'Saved' });
});

// ── PATCH /api/admin/upstox-apps/:id/token (manually set access token) ───────
app.patch('/api/admin/upstox-apps/:id/token', authenticateAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { access_token } = req.body;
  if (access_token === undefined) return res.status(400).json({ success: false, message: 'access_token required' });
  const apps = loadApps();
  const idx  = apps.findIndex(a => a.id === id);
  if (idx < 0) return res.status(404).json({ success: false, message: 'App not found' });
  apps[idx].access_token = access_token || '';
  saveApps(apps);
  // sync primary tokens
  const active = apps.filter(a => a.access_token);
  if (active[0]) { CONFIG.ACCESS_TOKEN   = active[0].access_token; updateEnvKey('ACCESS_TOKEN',   active[0].access_token); }
  if (active[1]) { CONFIG.ACCESS_TOKEN_2 = active[1].access_token; updateEnvKey('ACCESS_TOKEN_2', active[1].access_token); }
  log(`✅ Token manually set for app: ${apps[idx].name} (id=${id}) — token ${access_token ? 'saved' : 'cleared'}`);
  res.json({ success: true, message: access_token ? 'Token saved!' : 'Token cleared' });
});

// ── DELETE /api/admin/upstox-apps/:id ────────────────────────────────────────
app.delete('/api/admin/upstox-apps/:id', authenticateAdmin, (req, res) => {
  const id  = Number(req.params.id);
  const apps = loadApps().filter(a => a.id !== id);
  saveApps(apps);
  log(`✅ Upstox app deleted id=${id}`);
  res.json({ success: true, message: 'Deleted' });
});

// ── POST /api/admin/upstox-settings (admin email + daily time) ───────────────
app.post('/api/admin/upstox-settings', authenticateAdmin, (req, res) => {
  const { admin_email, email_time } = req.body;
  if (admin_email) { process.env.ADMIN_EMAIL = admin_email; updateEnvKey('ADMIN_EMAIL', admin_email); }
  if (email_time)  { CONFIG.UPSTOX_EMAIL_TIME = email_time; updateEnvKey('UPSTOX_EMAIL_TIME', email_time); }
  res.json({ success: true, message: 'Settings saved' });
});

// ── POST /api/admin/upstox-auth/send-all-email ───────────────────────────────
async function sendAllUpstoxAuthEmail() {
  const adminEmail = process.env.ADMIN_EMAIL || '';
  if (!adminEmail) { log('⚠️ ADMIN_EMAIL not set — skipping Upstox auth email'); return; }
  const apps = loadApps();
  if (!apps.length) { log('⚠️ No Upstox apps configured — skipping auth email'); return; }
  // Build the start-all URL from the first app's redirect_uri base (same host)
  const firstApp = apps.find(a => a.redirect_uri) || apps[0];
  const baseUrl = firstApp?.redirect_uri
    ? firstApp.redirect_uri.replace(/\/api\/.*$/, '')
    : `http://localhost:${process.env.PORT || 3000}`;
  const startAllUrl = `${baseUrl}/api/admin/upstox-auth/start-all`;
  const entries = apps.map(a => ({ slot: a.id, name: a.name, url: buildAppAuthUrl(a) })).filter(e => e.url);
  if (!entries.length) { log('⚠️ No valid Upstox apps — skipping auth email'); return; }
  const { sendConsolidatedAuthEmail } = require('./emailService/emailService');
  await sendConsolidatedAuthEmail(adminEmail, entries, startAllUrl);
  log(`✅ Consolidated Upstox auth email sent to ${adminEmail} with start-all link (${entries.length} apps)`);
}

app.post('/api/admin/upstox-auth/send-all-email', authenticateAdmin, async (req, res) => {
  try { await sendAllUpstoxAuthEmail(); res.json({ success: true, message: 'Consolidated auth email sent' }); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── Daily scheduler ───────────────────────────────────────────────────────────
let _lastEmailDate = '';
setInterval(async () => {
  try {
    const ist    = new Date(Date.now() + 5.5 * 3600000);
    const hhmm   = `${String(ist.getUTCHours()).padStart(2,'0')}:${String(ist.getUTCMinutes()).padStart(2,'0')}`;
    const date   = ist.toISOString().slice(0,10);
    const target = CONFIG.UPSTOX_EMAIL_TIME || '08:00';
    if (hhmm === target && date !== _lastEmailDate) { _lastEmailDate = date; await sendAllUpstoxAuthEmail(); }
  } catch (e) { log(`❌ Daily auth email error: ${e.message}`, 'ERROR'); }
}, 60_000);

// ── GET /api/admin/upstox-auth/start-all ─────────────────────────────────────
// Entry point: email links here → chains through all apps one by one
app.get('/api/admin/upstox-auth/start-all', (req, res) => {
  const apps = loadApps();
  const next = apps.find(a => !a.access_token && a.api_key && a.api_secret && a.redirect_uri);
  if (!next) {
    return res.send(`<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px;background:#f0fff8">
      <h2 style="color:#26a69a">✅ All Apps Already Authorized</h2>
      <p style="color:#555">All ${apps.length} app(s) already have active tokens.</p>
      <p style="color:#aaa;font-size:12px">You can close this window.</p>
    </body></html>`);
  }
  res.redirect(buildAppAuthUrl(next));
});

// ── GET /api/admin/upstox-auth/callback ──────────────────────────────────────
app.get('/api/admin/upstox-auth/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const appId = Number(state);
  const fail  = (msg) => res.send(`<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px;background:#fff8f8"><h2 style="color:#c00">❌ Authorization Failed</h2><p style="color:#555">${msg}</p></body></html>`);
  if (error || !code) return fail(error || 'No code received from Upstox.');
  const apps  = loadApps();
  const found = apps.find(a => a.id === appId);
  if (!found || !found.api_secret) return fail(`App id=${appId} not found or missing secret.`);
  try {
    const resp = await axios.post(
      'https://api.upstox.com/v2/login/authorization/token',
      new URLSearchParams({ code, client_id: found.api_key, client_secret: found.api_secret, redirect_uri: found.redirect_uri, grant_type: 'authorization_code' }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' } }
    );
    const data = resp.data;
    if (data?.access_token) {
      found.access_token = data.access_token;
      saveApps(apps);
      // sync first 2 active tokens to CONFIG + .env for backward compat
      const active = apps.filter(a => a.access_token);
      if (active[0]) { CONFIG.ACCESS_TOKEN   = active[0].access_token; updateEnvKey('ACCESS_TOKEN',   active[0].access_token); }
      if (active[1]) { CONFIG.ACCESS_TOKEN_2 = active[1].access_token; updateEnvKey('ACCESS_TOKEN_2', active[1].access_token); }
      log(`✅ Token generated for "${found.name}" (id=${appId}) and saved`);
      // Chain to next app that still needs a token
      const nextApp = apps.find(a => !a.access_token && a.api_key && a.api_secret && a.redirect_uri);
      if (nextApp) {
        const nextUrl = buildAppAuthUrl(nextApp);
        return res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="2;url=${nextUrl}"></head>
          <body style="font-family:Arial,sans-serif;text-align:center;padding:60px;background:#f0fff8">
          <h2 style="color:#26a69a">✅ ${found.name} — Done!</h2>
          <p style="color:#555">Token saved. Redirecting to <b>${nextApp.name}</b>...</p>
          <p><a href="${nextUrl}" style="color:#26a69a">Click here if not redirected</a></p>
          </body></html>`);
      }
      // All apps done
      const allApps = loadApps();
      const doneList = allApps.map(a => `<li style="margin:6px 0">${a.access_token ? '✅' : '❌'} <b>${a.name}</b></li>`).join('');
      return res.send(`<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;text-align:center;padding:60px;background:#f0fff8">
        <h2 style="color:#26a69a">🎉 All Apps Authorized!</h2>
        <ul style="list-style:none;padding:0;display:inline-block;text-align:left;margin:20px 0">${doneList}</ul>
        <p style="color:#aaa;font-size:12px">You can close this window.</p>
        </body></html>`);
    }
    log(`❌ Token exchange failed for ${found.name}: ${JSON.stringify(data)}`, 'ERROR');
    return fail(`Token exchange failed: ${JSON.stringify(data)}`);
  } catch (e) {
    const errMsg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    log(`❌ OAuth callback error for ${found?.name}: ${errMsg}`, 'ERROR');
    return fail(errMsg);
  }
});

app.get("/api/status", (req, res) => {
  try {
    const latestFile = findLatestSavedFile();
    
    res.json({
      success: true,
      server: {
        is_running: !!serverState.autoRefreshInterval,
        instrument: CONFIG.INSTRUMENT_KEY,
        instrument_name: getInstrumentName(CONFIG.INSTRUMENT_KEY),
        refresh_interval_seconds: CONFIG.REFRESH_INTERVAL / 1000
      },
      data: {
        current_expiry: serverState.currentExpiry,
        next_expiry: serverState.nextExpiry,
        is_expiry_day: serverState.isExpiryDay,
        last_update: serverState.lastUpdateIST,
        total_updates: serverState.totalUpdates,
        latest_file: latestFile,
        next_refresh_in_seconds: serverState.autoRefreshInterval ? 
          Math.ceil((Date.now() - new Date(serverState.lastUpdate).getTime()) / 1000) : null
      },
      errors: serverState.errors.slice(-5)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error getting status",
      error: error.message
    });
  }
});

app.get("/api/files", (req, res) => {
  try {
    const files = listSavedFiles();
    const limit = parseInt(req.query.limit) || 100;
    
    res.json({
      success: true,
      files: files.slice(0, limit),
      total_files: files.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error listing files",
      error: error.message
    });
  }
});

app.get("/api/file/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const files = listSavedFiles();
    const file = files.find(f => f.filename === filename);
    
    if (!file) {
      return res.status(404).json({
        success: false,
        message: "File not found"
      });
    }
    
    let data;
    
    if (file.compressed) {
      const compressedData = fs.readFileSync(file.full_path);
      const decompressedData = zlib.gunzipSync(compressedData);
      data = JSON.parse(decompressedData.toString());
    } else {
      const fileContent = fs.readFileSync(file.full_path, "utf8");
      data = JSON.parse(fileContent);
    }
    
    const stats = fs.statSync(file.full_path);
    
    res.json({
      success: true,
      file: {
        filename: file.filename,
        path: file.path,
        size_kb: (stats.size / 1024).toFixed(2),
        compressed: file.compressed,
        modified: stats.mtime,
        modified_ist: convertUTCtoIST(stats.mtime.toISOString()).datetime
      },
      ...data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error reading file",
      error: error.message
    });
  }
});

app.get("/api/instruments", (req, res) => {
  try {
    const instruments = getAvailableInstruments();
    res.json({
      success: true,
      instruments: instruments,
      total_instruments: instruments.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error getting instruments",
      error: error.message
    });
  }
});

// ============ INSTRUMENT MASTER LIST API ============

// GET /api/instruments/master - Full categorized instrument list
app.get("/api/instruments/master", (req, res) => {
  try {
    const { segment, search, option_chain_only, sector } = req.query;
    const master = CONFIG.INSTRUMENT_MASTER;
    
    let result = {};
    
    // Build flat list from all categories
    const allInstruments = [
      ...master.NSE_INDICES.map(i => ({ ...i, segment: "NSE_INDEX", category: "Index" })),
      ...master.BSE_INDICES.map(i => ({ ...i, segment: "BSE_INDEX", category: "Index" })),
      ...master.NSE_FO_STOCKS.map(i => ({ ...i, segment: "NSE_EQ", category: "Stock", hasOptionChain: true })),
      ...master.MCX_COMMODITIES.map(i => ({ ...i, segment: "MCX_FO", category: "Commodity" })),
    ];
    
    let filtered = allInstruments;
    
    // Filter by segment
    if (segment) {
      const seg = segment.toUpperCase();
      filtered = filtered.filter(i => i.segment === seg || i.segment.startsWith(seg));
    }
    
    // Filter by option chain support
    if (option_chain_only === 'true') {
      filtered = filtered.filter(i => i.hasOptionChain !== false);
    }
    
    // Filter by sector (for stocks)
    if (sector) {
      filtered = filtered.filter(i => i.sector && i.sector.toLowerCase().includes(sector.toLowerCase()));
    }
    
    // Search by name or symbol
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(i => 
        i.name.toLowerCase().includes(s) || 
        i.symbol.toLowerCase().includes(s) ||
        i.key.toLowerCase().includes(s)
      );
    }
    
    // Group by category
    const grouped = {};
    filtered.forEach(i => {
      const cat = i.category || 'Other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(i);
    });
    
    res.json({
      success: true,
      total: filtered.length,
      active_instruments: CONFIG.INSTRUMENTS,
      active_count: CONFIG.INSTRUMENTS.length,
      filters_applied: { segment, search, option_chain_only, sector },
      grouped: grouped,
      all: filtered
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error getting instrument master",
      error: error.message
    });
  }
});

// GET /api/instruments/master/indices - Only indices
app.get("/api/instruments/master/indices", (req, res) => {
  try {
    const master = CONFIG.INSTRUMENT_MASTER;
    res.json({
      success: true,
      nse_indices: master.NSE_INDICES,
      bse_indices: master.BSE_INDICES,
      total: master.NSE_INDICES.length + master.BSE_INDICES.length,
      option_chain_supported: [
        ...master.NSE_INDICES.filter(i => i.hasOptionChain),
        ...master.BSE_INDICES.filter(i => i.hasOptionChain),
      ]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/instruments/master/stocks - Only F&O stocks with optional sector filter
app.get("/api/instruments/master/stocks", (req, res) => {
  try {
    const { sector, search } = req.query;
    let stocks = CONFIG.INSTRUMENT_MASTER.NSE_FO_STOCKS;
    
    if (sector) {
      stocks = stocks.filter(s => s.sector.toLowerCase().includes(sector.toLowerCase()));
    }
    if (search) {
      const s = search.toLowerCase();
      stocks = stocks.filter(st => st.name.toLowerCase().includes(s) || st.symbol.toLowerCase().includes(s));
    }
    
    // Get unique sectors
    const sectors = [...new Set(CONFIG.INSTRUMENT_MASTER.NSE_FO_STOCKS.map(s => s.sector))].sort();
    
    res.json({
      success: true,
      stocks: stocks,
      total: stocks.length,
      sectors: sectors,
      filters: { sector, search }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/instruments/master/mcx - MCX commodities (no option chain)
app.get("/api/instruments/master/mcx", (req, res) => {
  try {
    res.json({
      success: true,
      commodities: CONFIG.INSTRUMENT_MASTER.MCX_COMMODITIES,
      total: CONFIG.INSTRUMENT_MASTER.MCX_COMMODITIES.length,
      note: "MCX Put/Call Option Chain is NOT supported by Upstox API"
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/instruments/active - Get current active instruments
app.get("/api/instruments/active", authenticateAdmin, (_req, res) => {
  res.json({ success: true, instruments: CONFIG.INSTRUMENTS });
});

// POST /api/instruments/active - Update active instruments list (persists to disk)
app.post("/api/instruments/active", authenticateAdmin, (req, res) => {
  try {
    const { instruments } = req.body;

    if (!instruments || !Array.isArray(instruments) || instruments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide an array of instrument keys"
      });
    }

    CONFIG.INSTRUMENTS = instruments;

    // Persist so selection survives server restart
    fs.writeFileSync(PATHS.INSTRUMENTS_CFG, JSON.stringify({ instruments }, null, 2));

    // Restart fetching if running
    const wasRunning = !!serverState.autoRefreshInterval;
    if (wasRunning) {
      stopFetching();
      startFetching(serverState.isScheduledRunning);
    }

    res.json({
      success: true,
      message: `Active instruments updated to ${instruments.length} instruments`,
      instruments: CONFIG.INSTRUMENTS,
      fetching_restarted: wasRunning
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/time/ist", (req, res) => {
  try {
    const currentIST = getCurrentIST();
    res.json({
      success: true,
      utc: new Date().toISOString(),
      ist: currentIST,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error getting IST time",
      error: error.message
    });
  }
});

app.post("/api/update", async (req, res) => {
  try {
    const instrument = req.body.instrument || CONFIG.INSTRUMENT_KEY;
    const result = await updateOptionChain(instrument);
    
    if (result) {
      res.json({
        success: true,
        message: "Option chain updated successfully",
        instrument: instrument,
        expiry: serverState.currentExpiry,
        timestamp: serverState.lastUpdate,
        timestamp_ist: serverState.lastUpdateIST,
        saved_path: result.saved_path,
        size_kb: result.size_kb,
        time_hhmmss: result.time_hhmmss,
        data: {
          strikes: result.m?.sc || 0,
          analysis: result.a
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Update failed"
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message
    });
  }
});

app.get("/api/config", (req, res) => {
  const safeConfig = {
    instrument_key: CONFIG.INSTRUMENT_KEY,
    instrument_name: getInstrumentName(CONFIG.INSTRUMENT_KEY),
    port: CONFIG.PORT,
    refresh_interval_seconds: CONFIG.REFRESH_INTERVAL / 1000,
    log_file: CONFIG.LOG_FILE,
    api_base_url: CONFIG.UPSTOX_BASE_URL,
    storage_structure: "Data/Instrument/Expiry/YYYY-MM-DD/Instrument_Expiry_YYYY-MM-DD_HH-MM-SS.json.gz",
    compression: "gzip",
    timezone: "IST (UTC+5:30)",
    has_access_token: !!CONFIG.ACCESS_TOKEN
  };
  
  res.json({
    success: true,
    config: safeConfig
  });
});

app.post("/api/config", (req, res) => {
  try {
    const { instrument_key, refresh_interval, access_token } = req.body;
    
    if (instrument_key) {
      CONFIG.INSTRUMENT_KEY = instrument_key;
      log(`Instrument updated: ${instrument_key}`);
    }
    
    if (refresh_interval) {
      CONFIG.REFRESH_INTERVAL = refresh_interval * 1000;
      log(`Refresh interval updated: ${refresh_interval}s`);
    }
    
    if (access_token) {
      CONFIG.ACCESS_TOKEN = access_token;
      
      // Update .env file
      try {
        const envPath = path.join(PATHS.DATA, '.env');
        let envContent = '';
        
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, 'utf8');
        }
        
        // Update or add ACCESS_TOKEN
        if (envContent.includes('ACCESS_TOKEN=')) {
          envContent = envContent.replace(/ACCESS_TOKEN=.*/g, `ACCESS_TOKEN=${access_token}`);
        } else {
          envContent += `\nACCESS_TOKEN=${access_token}\n`;
        }
        
        fs.writeFileSync(envPath, envContent);
        log(`✅ Access token updated successfully`);
      } catch (envError) {
        log(`⚠️ Token updated in memory but failed to update .env: ${envError.message}`, "WARNING");
      }
    }
    
    res.json({
      success: true,
      message: "Configuration updated",
      config: {
        instrument_key: CONFIG.INSTRUMENT_KEY,
        instrument_name: getInstrumentName(CONFIG.INSTRUMENT_KEY),
        refresh_interval_seconds: CONFIG.REFRESH_INTERVAL / 1000,
        token_updated: !!access_token
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating configuration",
      error: error.message
    });
  }
});

// ================================
// PROTECTED PAGES (require authentication)
// ================================
// ✅ REMOVED HTML ROUTE - Using React instead

app.get("/admin", (req, res) => {
  res.sendFile(path.join(reactBuildPath, "index.html"));
});

// ✅ REMOVED HTML ROUTE - Using React instead

// ================================
// PUBLIC ROUTES
// ================================
// ✅ REMOVED HTML ROUTE - Using React instead

// ✅ REMOVED HTML ROUTE - Using React instead

// ============ UPSTOX AUTO TOKEN — Email OAuth ============

// Reuse the existing OTP email transporter (simplifyoptionchain@gmail.com)
const { transporter: _otpTransporter } = (() => {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'simplifyoptionchain@gmail.com', pass: 'othahwvhporvufci' }
  });
  return { transporter };
})();

async function sendEmail(subject, htmlBody) {
  if (!CONFIG.ADMIN_EMAIL) {
    console.log('📧 ADMIN_EMAIL not set — would have sent:', subject);
    return false;
  }
  try {
    await _otpTransporter.sendMail({
      from:    '"SOC.AI.IN" <simplifyoptionchain@gmail.com>',
      to:      CONFIG.ADMIN_EMAIL,
      subject,
      html:    htmlBody
    });
    console.log('✅ Email sent to', CONFIG.ADMIN_EMAIL);
    return true;
  } catch (err) {
    console.error('❌ Email send error:', err.message);
    return false;
  }
}

// Step 1 — Generate Upstox auth URL and send via WhatsApp
async function sendUpstoxAuthLink() {
  if (!CONFIG.UPSTOX_API_KEY) {
    console.error('❌ UPSTOX_API_KEY not set in .env');
    return;
  }
  console.log('🔑 client_id     :', CONFIG.UPSTOX_API_KEY);
  console.log('🔗 redirect_uri  :', CONFIG.UPSTOX_REDIRECT_URI);
  const authUrl =
    `https://api.upstox.com/v2/login/authorization/dialog` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(CONFIG.UPSTOX_API_KEY)}` +
    `&redirect_uri=${encodeURIComponent(CONFIG.UPSTOX_REDIRECT_URI)}`;

  const istStr = new Date(Date.now() + new Date().getTimezoneOffset()*60000 + 5.5*3600000)
    .toLocaleTimeString('en-IN');

  const html =
    `<h2>🔐 SOC.AI.IN — Upstox Token Renewal</h2>` +
    `<p>Requested at <strong>${istStr} IST</strong></p>` +
    `<p><a href="${authUrl}" style="background:#ff6f00;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Click here to approve Upstox access</a></p>` +
    `<p style="color:#888;font-size:12px;">Token will auto-save after approval. You can close the tab once done.</p>` +
    `<hr><p style="font-size:11px;color:#aaa;">Redirect URI registered in this server:<br><code>${CONFIG.UPSTOX_REDIRECT_URI}</code><br>Make sure this <strong>exactly matches</strong> the Redirect URL in your Upstox developer app.</p>`;

  console.log('🔗 Upstox auth URL:\n', authUrl);
  await sendEmail('🔐 SOC.AI.IN — Upstox Token Renewal', html);
}

// Step 2 — Exchange auth code for access token
async function exchangeCodeForToken(code) {
  console.log('📤 Token exchange params:');
  console.log('   code        :', code);
  console.log('   client_id   :', CONFIG.UPSTOX_API_KEY);
  console.log('   redirect_uri:', CONFIG.UPSTOX_REDIRECT_URI);
  console.log('   grant_type  : authorization_code');

  const resp = await axios.post(
    'https://api.upstox.com/v2/login/authorization/token',
    new URLSearchParams({
      code,
      client_id:     CONFIG.UPSTOX_API_KEY,
      client_secret: CONFIG.UPSTOX_API_SECRET,
      redirect_uri:  CONFIG.UPSTOX_REDIRECT_URI,
      grant_type:    'authorization_code'
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' } }
  );
  return resp.data?.access_token;
}

// Step 3 — Save token to .env file and live CONFIG
async function saveAccessToken(token) {
  CONFIG.ACCESS_TOKEN = token;
  const envPath = path.join(PATHS.DATA, '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  if (content.includes('ACCESS_TOKEN=')) {
    content = content.replace(/ACCESS_TOKEN=.*/g, `ACCESS_TOKEN=${token}`);
  } else {
    content += `\nACCESS_TOKEN=${token}\n`;
  }
  fs.writeFileSync(envPath, content);
  console.log('✅ Access token saved to .env and CONFIG');

  const istStr = new Date(Date.now() + new Date().getTimezoneOffset()*60000 + 5.5*3600000)
    .toLocaleTimeString('en-IN');
  await sendEmail(
    '✅ SOC.AI.IN — Upstox Token Saved',
    `<h2>✅ Upstox token approved & saved!</h2><p>Time: <strong>${istStr} IST</strong></p><p>Server is ready for today's market.</p>`
  );
}

// Daily scheduler — sends WhatsApp auth link at 8:00 AM IST every trading day
// Also triggers gap-open Bromos recalculation at 9:09 AM IST
function clearAllAccessTokens() {
  try {
    const apps = loadApps();
    apps.forEach(a => { a.access_token = ''; });
    saveApps(apps);
    CONFIG.ACCESS_TOKEN   = '';
    CONFIG.ACCESS_TOKEN_2 = '';
    CONFIG.ACCESS_TOKEN_3 = '';
    updateEnvKey('ACCESS_TOKEN',   '');
    updateEnvKey('ACCESS_TOKEN_2', '');
    updateEnvKey('ACCESS_TOKEN_3', '');
    console.log('🧹 3 AM IST — all Upstox access tokens cleared (daily expiry)');
  } catch (e) {
    console.error('❌ Failed to clear tokens at 3 AM:', e.message);
  }
}

function startTokenScheduler() {
  let lastSentDate       = '';
  let lastBromosGapDate  = '';
  let lastTokenClearDate = '';

  setInterval(async () => {
    const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
    const ist   = new Date(utcMs + 5.5 * 3600000);
    const day   = ist.getDay(); // 0=Sun, 6=Sat

    const hh  = ist.getHours();
    const mm  = ist.getMinutes();
    const ymd = ist.toISOString().split('T')[0];

    // ── 3:00 AM IST every day — clear all expired tokens ──────────────────
    if (hh === 3 && mm < 5 && ymd !== lastTokenClearDate) {
      lastTokenClearDate = ymd;
      clearAllAccessTokens();
    }

    if (day === 0 || day === 6) return; // skip weekends for the rest

    // Fire once at 8:00–8:04 AM IST on trading days
    if (hh === 8 && mm < 5 && ymd !== lastSentDate) {
      lastSentDate = ymd;
      console.log(`📅 [${ymd}] 8 AM IST — requesting Upstox token via email...`);
      await sendUpstoxAuthLink();
    }

    // Fire once at 9:09 AM IST — update Bromos reversals for gap-open
    if (hh === 9 && mm === 9 && ymd !== lastBromosGapDate) {
      lastBromosGapDate = ymd;
      console.log(`📊 [${ymd}] 9:09 AM IST — updating Bromos gap-open reversals...`);
      const symbols = getAvailableInstruments();
      for (const sym of symbols) {
        try { updateBromosForGapOpen(sym); } catch (e) {}
      }
    }
  }, 60 * 1000); // check every minute

  console.log('⏰ Token scheduler started — clears at 3 AM IST daily, sends auth email at 8 AM on trading days');
}

// ================================
// UPSTOX OAUTH ENDPOINTS
// ================================

// Callback — Upstox redirects here after user approves
app.get('/api/upstox/callback', async (req, res) => {
  const { code, error } = req.query;
  console.log('📥 Upstox callback received. Query params:', JSON.stringify(req.query));
  if (error || !code) {
    console.error('❌ Upstox OAuth denied. error=', error, ' code=', code);
    await sendEmail('❌ SOC.AI.IN — Upstox Auth Failed', `<h2>❌ Upstox auth was denied or failed.</h2><p>Reason: ${error || 'no code received'}</p>`);
    return res.send(`<h2>❌ Authorisation denied.</h2><p>Reason: <b>${error || 'no code received'}</b></p><p>Check server terminal for details.</p>`);
  }
  try {
    const token = await exchangeCodeForToken(code);
    if (!token) throw new Error('No access_token in response');
    await saveAccessToken(token);
    res.send('<h2>✅ Token approved & saved! Server is ready. You can close this tab.</h2>');
  } catch (err) {
    console.error('❌ Token exchange error:', err.message);
    await sendEmail('❌ SOC.AI.IN — Token Exchange Failed', `<h2>❌ Token exchange failed.</h2><p>${err.message}</p>`);
    res.status(500).send('<h2>❌ Token exchange failed. Check server logs.</h2>');
  }
});

// Manual trigger — admin can call this to resend the WhatsApp auth link immediately
app.post('/api/upstox/request-token', authenticateAdmin, async (_req, res) => {
  try {
    await sendUpstoxAuthLink();
    res.json({ success: true, message: 'Auth link sent via WhatsApp' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================================
// MARKET HOLIDAYS & TIMINGS APIs
// ================================

app.get('/api/market/holidays', (_req, res) => {
  try {
    if (fs.existsSync(MARKET_HOLIDAY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MARKET_HOLIDAY_FILE, 'utf8'));
      return res.json({ success: true, fetched_at: raw.fetched_at, data: raw.data || [] });
    }
    res.json({ success: false, message: 'Holiday data not yet loaded', data: [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, data: [] });
  }
});

app.get('/api/market/timings', (_req, res) => {
  try {
    if (fs.existsSync(MARKET_TIMING_FILE)) {
      const raw = JSON.parse(fs.readFileSync(MARKET_TIMING_FILE, 'utf8'));
      return res.json({ success: true, fetched_at: raw.fetched_at, date: raw.date, data: raw.data || [] });
    }
    res.json({ success: false, message: 'Timing data not yet loaded', data: [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, data: [] });
  }
});

// ================================
// SESSION & AUTH APIs
// ================================
app.get("/api/auth/check-session", (req, res) => {
  if (req.session.userId && req.session.userVerified) {
    return res.json({
      authenticated: true,
      user: {
        id: req.session.userId,
        email: req.session.userEmail,
        name: req.session.userName
      }
    });
  }
  res.json({ authenticated: false });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("soc_session");
    res.redirect("/");
  });
});

// ================================
// ROOT HANDLER
// ================================
app.get("/", (req, res) => {
  if (req.session.userId && req.session.userVerified) {
    res.redirect("/");
  } else {
    res.redirect("/");
  }
});

function getServerIPs() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const addresses = [];
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  
  return addresses;
}

// START SERVER
async function startServer() {
  try {
    const baseDataDir = PATHS.MARKET;
    ensureDirectoryExists(baseDataDir);
    
    loadScheduleFromFile();

    // Load saved instruments selection (if admin changed it via UI)
    try {
      if (fs.existsSync(PATHS.INSTRUMENTS_CFG)) {
        const saved = JSON.parse(fs.readFileSync(PATHS.INSTRUMENTS_CFG, 'utf8'));
        if (Array.isArray(saved.instruments) && saved.instruments.length > 0) {
          CONFIG.INSTRUMENTS = saved.instruments;
          log(`📊 Loaded ${CONFIG.INSTRUMENTS.length} instruments from saved config`);
        }
      }
    } catch (e) {
      log(`⚠️ Could not load instruments config: ${e.message}`);
    }

    await initMarketData();
    startTokenScheduler();

    const serverIPs = getServerIPs();

    // Auto-detect redirect URI: check if this machine IS simplifyoptionchain.in
    if (!CONFIG.UPSTOX_REDIRECT_URI) {
      try {
        const dns  = require('dns').promises;
        const http = require('http');

        // Get this machine's public IP
        const publicIP = await new Promise((resolve) => {
          http.get('http://api.ipify.org', (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => resolve(data.trim()));
          }).on('error', () => resolve(null));
        });

        // Resolve simplifyoptionchain.in → IP
        const domainIPs = await dns.resolve4('simplifyoptionchain.in').catch(() => []);
        const isOnDomain = publicIP && domainIPs.includes(publicIP);

        if (isOnDomain) {
          CONFIG.UPSTOX_REDIRECT_URI = `https://simplifyoptionchain.in/api/upstox/callback`;
        } else if (publicIP) {
          CONFIG.UPSTOX_REDIRECT_URI = `http://${publicIP}:${CONFIG.PORT}/api/upstox/callback`;
        } else if (serverIPs.length > 0) {
          CONFIG.UPSTOX_REDIRECT_URI = `http://${serverIPs[0]}:${CONFIG.PORT}/api/upstox/callback`;
        } else {
          CONFIG.UPSTOX_REDIRECT_URI = `http://localhost:${CONFIG.PORT}/api/upstox/callback`;
        }
      } catch (_) {
        CONFIG.UPSTOX_REDIRECT_URI = `http://localhost:${CONFIG.PORT}/api/upstox/callback`;
      }
    }

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  UPSTOX REDIRECT URL — register this in your app:       ║');
    console.log(`║  ${CONFIG.UPSTOX_REDIRECT_URI.padEnd(56)}║`);
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');

    // If no access token, immediately send auth link via email
    if (!CONFIG.ACCESS_TOKEN) {
      console.log('⚠️  No ACCESS_TOKEN found — sending Upstox auth link via email immediately...');
      sendUpstoxAuthLink().catch(e => console.error('Auto token request error:', e.message));
    }

    console.log("=".repeat(60));
    console.log("🚀 OPTIMIZED Option Chain Server - Multi-Instrument");
    console.log("🔐 Authentication: ENABLED (OTP + Email Verification)");
    
    const instruments = CONFIG.INSTRUMENTS || [CONFIG.INSTRUMENT_KEY];
    console.log(`📊 Instruments (${instruments.length}):`);
    instruments.forEach(inst => {
      const name = getInstrumentName(inst);
      console.log(`   • ${name} (${inst})`);
    });
    
    console.log(`🔁 Auto-refresh: Every ${CONFIG.REFRESH_INTERVAL / 1000} seconds`);
    console.log(`📅 Schedule: ${serverState.scheduleEnabled ? 'ENABLED' : 'DISABLED'}`);
    console.log(`🌐 Port: ${CONFIG.PORT}`);
    console.log("=".repeat(60));

    // Only auto-start fetching if schedule is not controlling it.
    // When schedule is enabled, checkSchedule() (runs 1s after start, then every 60s)
    // will start/stop fetching based on the saved time window.
    if (!serverState.scheduleEnabled) {
      await warmExpiryCache();
      startAutoRefresh();
    }
    // u2500u2500 Upstox real-time feed u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500u2500
    // Must be before catch-all frontend route
    const httpServer2 = require('http').createServer(app);
    const upstoxFeed = require('./api/upstoxFeed');
    upstoxFeed(app, httpServer2, CONFIG);

    // ── WebSocket server (real-time diff delivery via Redis Pub/Sub) ──────────
    const { setupWebSocket } = require('./ws/websocket');
    setupWebSocket(httpServer2);

    // Serve built React frontend (catch-all u2014 must come after API routes)
    const frontendBuild = path.join(PATHS.FRONTEND, 'build');
    app.use(express.static(frontendBuild));
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(frontendBuild, 'index.html'));
    });

    httpServer2.listen(CONFIG.PORT, '0.0.0.0', () => {
      console.log(`✅ Server running on port ${CONFIG.PORT}`);
      console.log(`🔐 Session-based authentication enabled`);
      console.log(`📧 OTP & Email verification enabled`);
      console.log(`💾 Session persistence enabled`);
      console.log(`👤 User preferences storage enabled`);
      
      if (serverIPs.length > 0) {
        serverIPs.forEach(ip => {
          console.log(`   http://${ip}:${CONFIG.PORT}`);
        });
      }
      
      console.log("=".repeat(60));
      
      setTimeout(() => {
        checkSchedule();
      }, 1000);

      // ── Startup data check: generate missing files for all date folders ──
      setTimeout(async () => {
        console.log('\n🔍 Startup check: scanning for missing data files...');

        // 1. Strategy 4.0 / Bromos — always force-regenerate with latest formula
        try {
          if (regenerateAllStrategy40) {
            console.log('  📊 Strategy40/Bromos: regenerating all with correct formula...');
            regenerateAllStrategy40();
          }
        } catch (e) { console.error('  ❌ Strategy40 regeneration error:', e.message); }

        // 1b. Re-apply gap correction to ALL historical dates with fixed if/else if logic
        try {
          if (generateBromosOpenForAllDates) {
            console.log('  📊 Bromos: re-applying gap correction to all historical dates...');
            generateBromosOpenForAllDates();
          }
        } catch (e) { console.error('  ❌ Bromos gap correction error:', e.message); }

        // 1c. Live gap-open correction for _bromos_latest.json (today's header)
        try {
          if (updateBromosForGapOpen) {
            const instruments = CONFIG?.INSTRUMENTS || [];
            const syms = instruments.map(k => createSafeFolderName(getInstrumentName(k)));
            console.log('  📊 Bromos gap-open check on startup...');
            for (const sym of syms) {
              try { updateBromosForGapOpen(sym); } catch (_) {}
            }
          }
        } catch (e) { console.error('  ❌ Bromos gap-open startup error:', e.message); }

        // 2. Chart data, MCTR, OI charts (chain.js) — generate missing only
        try {
          if (autoGenerateMissingChartData) {
            autoGenerateMissingChartData();
            console.log('  ✅ Chart / MCTR / OI data generation triggered');
          }
        } catch (e) { console.error('  ❌ Chart data generation error:', e.message); }

        // 2. TrainAI — run for any date missing _trainai.json
        try {
          if (runTrainAIAll) {
            console.log('  🤖 TrainAI: analyzing missing dates...');
            const r = runTrainAIAll(false);          // false = skip already-analyzed dates
            console.log(`  ✅ TrainAI done — analyzed:${r.analyzed} skipped:${r.skipped} errors:${r.errors}`);
          }
        } catch (e) { console.error('  ❌ TrainAI startup error:', e.message); }

        console.log('🔍 Startup check complete.\n');
      }, 4000);
    });
    
  } catch (error) {
    console.error(`❌ Server start failed: ${error.message}`);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  console.log("\n🛑 Server shutting down...");
  stopFetching();
  process.exit(0);
});

startServer();

module.exports = {
  getAllExpiryDates,
  findLatestExpiry,
  fetchOptionChain,
  updateOptionChain,
  saveOptionChainData,
  listSavedFiles,
  findLatestSavedFile,
  getAvailableInstruments,
  getCurrentIST,
  convertUTCtoIST,
  serverState,
  CONFIG,
  getInstrumentName,
  createSafeFolderName
};