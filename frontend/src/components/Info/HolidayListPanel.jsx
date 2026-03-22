import { useState, useEffect } from 'react';
import './InfoPanel.css';

const API_BASE = process.env.REACT_APP_API_URL || '';

function useBodyScroll() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'auto';
    return () => { document.body.style.overflow = prev || ''; };
  }, []);
}

export default function HolidayListPanel() {
  useBodyScroll();
  const [holidays, setHolidays] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/market/holidays`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setHolidays(d.data || []);
        setFetchedAt(d.fetched_at || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="info-panel">
      <div className="info-panel-header">
        <span className="info-panel-icon">🗓️</span>
        <div>
          <div className="info-panel-title">Market Holiday List</div>
          {fetchedAt && (
            <div className="info-panel-sub">
              Updated: {new Date(fetchedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
          )}
        </div>
        <span className="info-panel-count">{holidays.length} holidays</span>
      </div>

      <div className="info-panel-body">
        {loading && <div className="info-state">Loading holidays...</div>}

        {!loading && holidays.length === 0 && (
          <div className="info-state">No holiday data available.</div>
        )}

        {!loading && holidays.length > 0 && (
          <table className="info-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Day</th>
                <th>Holiday</th>
                <th>Closed Exchanges</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h, i) => {
                const d      = new Date(h.date);
                const isPast = h.date < today;
                const isToday = h.date === today;
                return (
                  <tr
                    key={i}
                    className={isToday ? 'row-today' : isPast ? 'row-past' : ''}
                  >
                    <td>{i + 1}</td>
                    <td className="td-date">
                      {d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      {isToday && <span className="badge-today">TODAY</span>}
                    </td>
                    <td>{d.toLocaleDateString('en-IN', { weekday: 'short' })}</td>
                    <td className="td-name">{h.description}</td>
                    <td className="td-exchanges">
                      {(h.closed_exchanges || []).map((ex, j) => (
                        <span key={j} className="exchange-chip">{ex}</span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
