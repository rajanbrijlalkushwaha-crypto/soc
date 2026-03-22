import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || '';

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 15000,
  headers: { 'X-Requested-By': 'soc-app' },
});


// ─── LIVE DATA ───
export const fetchLiveData = (symbol) =>
  api.get(`/api/live/${symbol}`).then(r => r.data);

// Combined signals (shifting + MCTR + strategy40) in one call, served from RAM
export const fetchLiveSignals = (symbol) =>
  api.get(`/api/signals/live/${symbol}`).then(r => r.data);

export const fetchSymbols = () =>
  api.get('/api/symbols').then(r => r.data);

// ─── HISTORICAL DATA ───
export const fetchHistoricalSymbols = () =>
  api.get('/api/historical/symbols').then(r => r.data);

export const fetchHistoricalExpiries = (symbol) =>
  api.get(`/api/historical/expiries/${symbol}`).then(r => r.data);

export const fetchHistoricalDates = (symbol, expiry) =>
  api.get(`/api/historical/dates/${symbol}/${expiry}`).then(r => r.data);

export const fetchHistoricalTimes = (symbol, expiry, date) =>
  api.get(`/api/historical/times/${symbol}/${expiry}/${date}`).then(r => r.data);

export const fetchHistoricalSnapshot = (symbol, expiry, date, time) =>
  api.get(`/api/historical/snapshot/${symbol}/${expiry}/${date}/${time}`).then(r => r.data);

// ─── 4.0 STRATEGY / BROMS ───
export const fetchPreviousDayData = (symbol, expiry, date) =>
  api.get(`/api/historical/previous/${symbol}/${expiry}/${date}`).then(r => r.data);

export const fetchStrategy40Data = (symbol, expiry, date) =>
  api.get(`/api/chart/strategy40/${symbol}/${expiry}/${date}?prev=1`).then(r => r.data);

// ─── SHIFTING DATA ───
export const fetchShiftingData = (symbol, expiry, date) =>
  api.get(`/api/shifting/${symbol}/${expiry}/${date}`).then(r => r.data);

export const fetchLiveShiftingData = (symbol) =>
  api.get(`/api/shifting/live/${symbol}`).then(r => r.data);

// ─── MCTR DATA ───
export const fetchMCTRData = (symbol, expiry, date) =>
  api.get(`/api/mctr/${symbol}/${expiry}/${date}`).then(r => r.data);

// ─── CANDLE DATA ───
export const fetchLiveCandles = (symbol, timeframe) =>
  api.get(`/api/candles/live/${symbol}?timeframe=${timeframe}`).then(r => r.data);

export const fetchHistoricalCandles = (symbol, expiry, date, timeframe) =>
  api.get(`/api/candles/${symbol}/${expiry}/${date}?timeframe=${timeframe}`).then(r => r.data);

// ─── OI SNAPSHOTS ───
export const fetchOISnapshots = (symbol, expiry, date, strike, type) =>
  api.get(`/api/oi-snapshots/${symbol}/${expiry}/${date}/${strike}/${type}`).then(r => r.data);

// ─── AI STOCK / SWING DATA ───
export const fetchAIStockDates = (type) =>
  api.get(`/api/ai/${type}/dates`).then(r => r.data);

export const fetchAIStockData = (type, date) =>
  api.get(`/api/ai/${type}/${date}`).then(r => r.data);

// ─── MARKET HOLIDAYS & TIMINGS ───
export const fetchMarketHolidays = () =>
  api.get('/api/market/holidays').then(r => r.data);

export const fetchMarketTimings = () =>
  api.get('/api/market/timings').then(r => r.data);

// ─── AUTH ───
export const loginUser = (data) =>
  api.post('/api/auth/login', data).then(r => r.data);

export const logoutUser = () =>
  api.post('/api/auth/logout').then(r => r.data);

export const checkAuth = () =>
  api.get('/api/auth/check').then(r => r.data);

export default api;