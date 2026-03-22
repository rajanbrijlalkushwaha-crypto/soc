import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';

function getFavKey(user) {
  return `sym_favs_${user?.id || user?.email || 'guest'}`;
}

export default function SymbolSelect() {
  const { state, dispatch } = useApp();
  const [open, setOpen]     = useState(false);
  const [favs, setFavs]     = useState([]);
  const ref                 = useRef();

  // Load favorites from localStorage when user is known
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(getFavKey(state.user)) || '[]');
      setFavs(Array.isArray(saved) ? saved : []);
    } catch (_) { setFavs([]); }
  }, [state.user]);

  // Save favorites to localStorage
  const saveFavs = (next) => {
    setFavs(next);
    try { localStorage.setItem(getFavKey(state.user), JSON.stringify(next)); } catch (_) {}
  };

  const toggleFav = (e, sym) => {
    e.stopPropagation();
    saveFavs(favs.includes(sym) ? favs.filter(f => f !== sym) : [...favs, sym]);
  };

  const selectSymbol = (sym) => {
    dispatch({ type: 'SET_CURRENT_SYMBOL', payload: sym });
    setOpen(false);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Sort: favorites first, then alphabetical
  const sorted = [...state.symbols].sort((a, b) => {
    const af = favs.includes(a), bf = favs.includes(b);
    if (af && !bf) return -1;
    if (!af && bf) return 1;
    return a.localeCompare(b);
  });

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          fontSize: '15px', fontWeight: 'bold', padding: '4px 10px',
          background: 'white', color: 'black', border: '1px solid #ccc',
          borderRadius: '5px', cursor: 'pointer', display: 'flex',
          alignItems: 'center', gap: '6px', minWidth: '120px',
        }}
      >
        {favs.includes(state.currentSymbol) && <span style={{ color: '#e53935' }}>♥</span>}
        {state.currentSymbol?.replace(/_/g, ' ') || 'Select…'}
        <span style={{ fontSize: '10px', marginLeft: 'auto' }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 9999,
          background: '#fff', border: '1px solid #ccc', borderRadius: '6px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: '180px',
          maxHeight: '320px', overflowY: 'auto', marginTop: '2px',
        }}>
          {sorted.length === 0 && (
            <div style={{ padding: '10px', color: '#888', fontSize: '13px' }}>Loading…</div>
          )}
          {sorted.map(sym => {
            const isFav = favs.includes(sym);
            const isActive = sym === state.currentSymbol;
            return (
              <div
                key={sym}
                onClick={() => selectSymbol(sym)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '7px 12px', cursor: 'pointer',
                  background: isActive ? '#fff3e0' : 'white',
                  fontWeight: isActive ? 700 : 400,
                  fontSize: '14px',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f5f5f5'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isActive ? '#fff3e0' : 'white'; }}
              >
                <button
                  onClick={(e) => toggleFav(e, sym)}
                  title={isFav ? 'Remove from favourites' : 'Add to favourites'}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '16px', padding: '0', lineHeight: 1,
                    color: isFav ? '#e53935' : '#bbb',
                    flexShrink: 0,
                  }}
                >
                  {isFav ? '♥' : '♡'}
                </button>
                <span style={{ flex: 1 }}>{sym.replace(/_/g, ' ')}</span>
                {isFav && <span style={{ fontSize: '10px', color: '#e53935', fontWeight: 700 }}>★</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
