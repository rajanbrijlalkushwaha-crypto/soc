import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchLiveData, fetchMarketHolidays, fetchMarketTimings } from '../../services/api';
import './IndexPage.css';

function useBodyScroll() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'auto';
    return () => { document.body.style.overflow = prev || ''; };
  }, []);
}

// Priority order for known indices
const INDEX_PRIORITY = [
  (s) => s === 'NIFTY' || s === 'NIFTY_50' || s === 'NIFTY50',
  (s) => s === 'BANKNIFTY' || s === 'BANK_NIFTY',
  (s) => s.startsWith('MIDCAP') || s === 'MIDCAPNIFTY' || s === 'MIDCAP_NIFTY',
  (s) => s === 'FINNIFTY' || s === 'FIN_NIFTY',
  (s) => s.includes('SENSEX'),
  (s) => s.includes('BANKEX'),
];

function getIndexRank(symbol) {
  const s = symbol.toUpperCase();
  for (let i = 0; i < INDEX_PRIORITY.length; i++) {
    if (INDEX_PRIORITY[i](s)) return i;
  }
  return INDEX_PRIORITY.length;
}

function isIndex(symbol) {
  return getIndexRank(symbol) < INDEX_PRIORITY.length;
}

function sortSymbols(symbols) {
  return [...symbols].sort((a, b) => getIndexRank(a) - getIndexRank(b));
}

function getExchange(symbol) {
  const s = symbol.toUpperCase();
  if (s.includes('SENSEX') || s.includes('BANKEX') || s.includes('BSE')) return 'BSE';
  return 'NSE';
}

function isMarketOpen() {
  const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
  const ist   = new Date(utcMs + 5.5 * 3600000);
  const day   = ist.getDay();
  if (day === 0 || day === 6) return false;
  const t = ist.getHours() * 100 + ist.getMinutes();
  return t >= 859 && t <= 1532;
}

// Convert epoch ms (UTC) → IST 24-hr "HH:MM"
function msToIST(ms) {
  if (!ms) return '--';
  const ist = new Date(Number(ms) + 5.5 * 3600000);
  const h   = ist.getUTCHours();
  const m   = ist.getUTCMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "YYYY-MM-DD" → "DD-MM-YYYY"
function fmtDate(d) {
  if (!d) return '--';
  const [y, mo, day] = d.split('-');
  return `${day}-${mo}-${y}`;
}

// Display order for timing table
const EXCH_ORDER = ['NSE', 'BSE', 'NFO', 'BFO', 'CDS', 'BCD', 'MCX'];

// Human-readable segment names for each exchange code
const SEGMENT_NAMES = {
  NSE: 'NSE — Equity',
  BSE: 'BSE — Equity',
  NFO: 'NSE — F&O',
  BFO: 'BSE — F&O',
  CDS: 'NSE — Currency',
  BCD: 'BSE — Currency',
  MCX: 'MCX — Commodity',
};

function exchRank(ex) {
  const i = EXCH_ORDER.indexOf(ex);
  return i === -1 ? 999 : i;
}

// Check if a specific exchange is currently open based on its timing ms timestamps
function isExchangeOpen(startMs, endMs) {
  const ist = new Date(Date.now() + 5.5 * 3600000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false; // weekend

  const nowMins   = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const startIST  = new Date(Number(startMs) + 5.5 * 3600000);
  const endIST    = new Date(Number(endMs)   + 5.5 * 3600000);
  const startMins = startIST.getUTCHours() * 60 + startIST.getUTCMinutes();
  const endMins   = endIST.getUTCHours()   * 60 + endIST.getUTCMinutes();
  return nowMins >= startMins && nowMins <= endMins;
}

export default function IndexPage() {
  useBodyScroll();
  const { state, dispatch } = useApp();
  const [prices,      setPrices]      = useState({});
  const [lastRefresh, setLastRefresh] = useState(null);
  const [marketOpen,  setMarketOpen]  = useState(isMarketOpen());
  const [timings,     setTimings]     = useState({ date: null, rows: [] });
  const [holidays,    setHolidays]    = useState([]);
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [istClock,    setIstClock]    = useState({ time: '', date: '' });
  const [aiSignals,   setAiSignals]   = useState(null);

  const isAdminOrMember = state.user?.role === 'admin' || state.user?.role === 'member';

  // Live IST clock — ticks every second
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const ist = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 5.5 * 3600000);
      setIstClock({
        time: ist.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
        date: ist.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Re-check market status every minute (also forces exchange badge re-render)
  useEffect(() => {
    const id = setInterval(() => setMarketOpen(isMarketOpen()), 60000);
    return () => clearInterval(id);
  }, []);

  // Load AI stock signals (admin/member only)
  useEffect(() => {
    if (!isAdminOrMember) return;
    fetch('/api/trainai/stock-signals/live', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.success) setAiSignals(d); })
      .catch(() => {});
  }, [isAdminOrMember]);

  // Load market timings & holidays once
  useEffect(() => {
    fetchMarketTimings()
      .then(res => {
        if (res.success) {
          const sorted = [...(res.data || [])].sort(
            (a, b) => exchRank(a.exchange) - exchRank(b.exchange)
          );
          setTimings({ date: res.date || null, rows: sorted });
        }
      })
      .catch(() => {});
    fetchMarketHolidays()
      .then(res => { if (res.success) setHolidays(res.data || []); })
      .catch(() => {});
  }, []);

  const refreshPrices = useCallback(async () => {
    if (!state.symbols.length) return;
    const results = await Promise.allSettled(
      state.symbols.map(sym => fetchLiveData(sym))
    );
    const updated = {};
    state.symbols.forEach((sym, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') {
        updated[sym] = { spot: r.value.spot_price ?? null, time: r.value.time ?? '--', error: false };
      } else {
        updated[sym] = { spot: null, time: '--', error: true };
      }
    });
    setPrices(updated);
    setLastRefresh(new Date().toLocaleTimeString('en-IN'));
  }, [state.symbols]);

  useEffect(() => {
    refreshPrices();
    const id = setInterval(refreshPrices, 15000);
    return () => clearInterval(id);
  }, [refreshPrices]);

  const openChain = (symbol) => {
    dispatch({ type: 'SET_CURRENT_SYMBOL', payload: symbol });
    dispatch({ type: 'SET_INDEX_PAGE', payload: false });
  };

  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
    window.location.replace('/');
  };

  const fmt = (val) =>
    val != null
      ? Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '---';

  const sorted   = sortSymbols(state.symbols);
  const userName = state.user?.name || state.user?.email || null;

  // Upcoming holidays (today or future)
  const todayStr    = new Date().toISOString().split('T')[0];
  const upcomingHol = holidays
    .filter(h => (h.date || h.trading_date || '') >= todayStr)
    .sort((a, b) => (a.date || a.trading_date || '').localeCompare(b.date || b.trading_date || ''));

  return (
    <div className="idx-page">
      {/* ── White Top Bar ── */}
      <div className="idx-topbar">
        <div className="idx-topbar-left">
          <span className="idx-brand">SOC<span>.AI.IN</span></span>
          <span className="idx-page-title">Market Dashboard</span>
        </div>
        <div className="idx-topbar-right">
          {!marketOpen && (
            <span className="idx-market-closed-badge">&#x25CF; Market Closed</span>
          )}
          {istClock.time && (
            <span className="idx-ist-clock">
              <span className="idx-live-dot" />
              {istClock.date} &nbsp;{istClock.time} IST
            </span>
          )}
          {lastRefresh && (
            <span className="idx-refresh-time">
              Updated {lastRefresh}
            </span>
          )}
          {userName && (
            <span className="idx-welcome">
              Welcome, <strong>{userName}</strong>
            </span>
          )}
          <button className="idx-logout-btn" onClick={handleLogout}>⏻ Logout</button>
        </div>
      </div>

      <div className="idx-content">

        {/* ── Market Timings Table (above cards) ── */}
        {timings.rows.length > 0 && (
          <div className="idx-timing-section">
            <div className="idx-timing-header">
              <span className="idx-section-title" style={{ marginBottom: 0 }}>Market Timings</span>
              {timings.date && (
                <span className="idx-timing-date">{fmtDate(timings.date)}</span>
              )}
            </div>
            <div className="idx-timing-table-wrap">
              <table className="idx-timing-table idx-timing-pivot">
                <thead>
                  <tr>
                    <th className="idx-timing-label-col"></th>
                    {timings.rows.map((row, i) => (
                      <th key={i}>
                        <span className="idx-exch-tag">{row.exchange || '--'}</span>
                        <div className="idx-exch-segment">{SEGMENT_NAMES[row.exchange] || row.exchange}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="idx-timing-row-label">Start Time</td>
                    {timings.rows.map((row, i) => (
                      <td key={i}>{msToIST(row.start_time)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="idx-timing-row-label">End Time</td>
                    {timings.rows.map((row, i) => (
                      <td key={i}>{msToIST(row.end_time)}</td>
                    ))}
                  </tr>
                  <tr>
                    <td className="idx-timing-row-label">Status</td>
                    {timings.rows.map((row, i) => {
                      const open = isExchangeOpen(row.start_time, row.end_time);
                      return (
                        <td key={i}>
                          <span className={`idx-status-badge ${open ? 'open' : 'closed'}`}>
                            <span className="idx-status-dot" />
                            {open ? 'OPEN' : 'CLOSED'}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Cards Grid ── */}
        <div className="idx-section-title">Live Market Prices</div>
        <div className="idx-grid">
          {sorted.map(symbol => {
            const p        = prices[symbol];
            const loading  = !p;
            const err      = p?.error;
            const exchange = getExchange(symbol);
            const idx      = isIndex(symbol);

            return (
              <div
                key={symbol}
                className={`idx-card${idx ? ' idx-card-index' : ''}`}
                onClick={() => openChain(symbol)}
              >
                <div className="idx-card-top">
                  <span className={`idx-exchange-badge ${exchange === 'BSE' ? 'bse' : 'nse'}`}>
                    {exchange}
                  </span>
                  <div className="idx-card-pills">
                    {!marketOpen
                      ? <span className="idx-closed-pill">CLOSED</span>
                      : (!loading && !err && <span className="idx-live-pill">LIVE</span>)
                    }
                  </div>
                </div>

                <div className={`idx-card-name${idx ? ' idx-card-name-index' : ''}`}>
                  {symbol.replace(/_/g, ' ')}
                </div>

                <div className={`idx-card-price ${loading ? 'loading' : ''} ${err ? 'error' : ''}`}>
                  {loading ? '···' : err ? 'N/A' : fmt(p.spot)}
                </div>

                {!loading && !err && p.time && (
                  <div className="idx-card-time">as of {p.time} IST</div>
                )}

                <div className="idx-card-footer">
                  <button className="idx-cta-btn">
                    View Option Chain <span className="idx-cta-arrow">→</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── AI Stock Signals (admin/member only) ── */}
        {isAdminOrMember && aiSignals && (aiSignals.resistance?.length > 0 || aiSignals.support?.length > 0) && (
          <div className="idx-ai-section">
            <div className="idx-ai-header">
              <div className="idx-ai-header-left">
                <span className="idx-ai-icon">🧠</span>
                <span className="idx-section-title" style={{ marginBottom: 0 }}>AI Stock Signals</span>
                {aiSignals.date && <span className="idx-ai-date">{aiSignals.date}</span>}
              </div>
              <button
                className="idx-ai-viewall"
                onClick={() => {
                  window.history.pushState(null, '', '/ai-stock');
                  dispatch({ type: 'SET_AI_STOCK', payload: true });
                }}
              >
                View All →
              </button>
            </div>
            <div className="idx-ai-cols">
              <div className="idx-ai-col idx-ai-col-res">
                <div className="idx-ai-col-title">⬇ Resistance ({aiSignals.resistance?.length ?? 0})</div>
                <div className="idx-ai-pills">
                  {(aiSignals.resistance || []).slice(0, 8).map((s, i) => (
                    <div key={i} className="idx-ai-pill idx-ai-pill-res">
                      <span className="idx-ai-pill-sym">{s.symbol}</span>
                      <span className="idx-ai-pill-score">{s.trade_score ?? 0}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="idx-ai-col idx-ai-col-sup">
                <div className="idx-ai-col-title">⬆ Support ({aiSignals.support?.length ?? 0})</div>
                <div className="idx-ai-pills">
                  {(aiSignals.support || []).slice(0, 8).map((s, i) => (
                    <div key={i} className="idx-ai-pill idx-ai-pill-sup">
                      <span className="idx-ai-pill-sym">{s.symbol}</span>
                      <span className="idx-ai-pill-score">{s.trade_score ?? 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Market Holidays Accordion (below cards) ── */}
        <div className="idx-holidays-section">
          <button
            className="idx-holidays-toggle"
            onClick={() => setHolidaysOpen(o => !o)}
          >
            <span className="idx-holidays-icon">📅</span>
            <span>Market Holidays</span>
            {upcomingHol.length > 0 && (
              <span className="idx-holidays-count">{upcomingHol.length} upcoming</span>
            )}
            <span className={`idx-holidays-chevron${holidaysOpen ? ' open' : ''}`}>▼</span>
          </button>

          {holidaysOpen && (
            <div className="idx-holidays-body">
              {upcomingHol.length === 0 ? (
                <div className="idx-holidays-empty">No upcoming holidays found.</div>
              ) : (
                <table className="idx-holidays-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Holiday</th>
                      <th>Closed Exchanges</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingHol.map((h, i) => {
                      const date    = h.date || h.trading_date || '--';
                      const name    = h.description || h.holiday_name || h.name || '--';
                      const exch    = Array.isArray(h.closed_exchanges)
                        ? h.closed_exchanges.join(', ')
                        : (h.exchange || '--');
                      const isToday = date === todayStr;
                      return (
                        <tr key={i} className={isToday ? 'idx-holiday-today' : ''}>
                          <td>
                            {date}
                            {isToday && <span className="idx-today-badge">Today</span>}
                          </td>
                          <td>{name}</td>
                          <td>{exch}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
