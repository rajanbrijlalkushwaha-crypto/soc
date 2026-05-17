import { useEffect, useState, useCallback } from 'react';
import './FIIDIIPage.css';

const API_BASE = process.env.REACT_APP_API_URL || '';

function fmt(val) {
  if (val === null || val === undefined) return '--';
  return Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function NetCell({ val }) {
  const n = Number(val);
  if (!val && val !== 0) return <td className="fiidii-net">--</td>;
  const cls = n >= 0 ? 'fiidii-net pos' : 'fiidii-net neg';
  return <td className={cls}>{n >= 0 ? '+' : ''}{fmt(n)}</td>;
}

function formatDate(raw) {
  if (!raw) return '--';
  const d = new Date(raw + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const PAGE_SIZE = 10;

export default function FIIDIIPage() {
  const [data, setData]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage]         = useState(1);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/fiidii`, { credentials: 'include' });
      const json = await res.json();
      if (json.success && json.data?.length) {
        setData(json.data);
        setLastUpdate(new Date());
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`${API_BASE}/api/fiidii/refresh`, { method: 'POST', credentials: 'include' });
      await fetchData();
    } catch (_) {}
    finally { setRefreshing(false); }
  };

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = Math.ceil(data.length / PAGE_SIZE);
  const pageData   = data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="fiidii-page">
      <div className="fiidii-header">
        <div className="fiidii-title-row">
          <div>
            <h1 className="fiidii-title">FII / DII Activity</h1>
            <p className="fiidii-subtitle">Foreign & Domestic Institutional Investor cash market data · ₹ Crore</p>
          </div>
          <div className="fiidii-actions">
            {lastUpdate && (
              <span className="fiidii-update">
                Updated {lastUpdate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button className="fiidii-refresh-btn" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? '⟳ Fetching...' : '⟳ Refresh'}
            </button>
          </div>
        </div>
      </div>

      <div className="fiidii-body">
        {loading ? (
          <div className="fiidii-loading">Loading FII/DII data...</div>
        ) : data.length === 0 ? (
          <div className="fiidii-empty">
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <div>No data yet. Click Refresh to fetch from Upstox.</div>
          </div>
        ) : (
          <>
            <div className="fiidii-table-wrap">
              <table className="fiidii-table">
                <thead>
                  <tr>
                    <th rowSpan={2} className="fiidii-th-date">Date</th>
                    <th colSpan={3} className="fiidii-th-group fii-group">FII Activity</th>
                    <th colSpan={3} className="fiidii-th-group dii-group">DII Activity</th>
                  </tr>
                  <tr>
                    <th className="fiidii-th-sub">Gross Buy (₹ Cr)</th>
                    <th className="fiidii-th-sub">Gross Sell (₹ Cr)</th>
                    <th className="fiidii-th-sub">Net Buy/Sell (₹ Cr)</th>
                    <th className="fiidii-th-sub">Gross Buy (₹ Cr)</th>
                    <th className="fiidii-th-sub">Gross Sell (₹ Cr)</th>
                    <th className="fiidii-th-sub">Net Buy/Sell (₹ Cr)</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.map((row, i) => (
                    <tr key={row.date} className={i % 2 === 0 ? '' : 'fiidii-row-alt'}>
                      <td className="fiidii-date">{formatDate(row.date)}</td>
                      <td className="fiidii-num">{fmt(row.fii_buy)}</td>
                      <td className="fiidii-num">{fmt(row.fii_sell)}</td>
                      <NetCell val={row.fii_net} />
                      <td className="fiidii-num">{fmt(row.dii_buy)}</td>
                      <td className="fiidii-num">{fmt(row.dii_sell)}</td>
                      <NetCell val={row.dii_net} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="fiidii-pagination">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    className={`fiidii-page-btn${p === page ? ' active' : ''}`}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
