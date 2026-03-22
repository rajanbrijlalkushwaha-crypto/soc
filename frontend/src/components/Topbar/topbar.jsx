import { useApp } from '../../context/AppContext';
import HistoricalControls from '../Historical/HistoricalControls';
import SymbolSelect from './SymbolSelect';

export default function Topbar() {
  const { state, dispatch } = useApp();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.error('Logout error:', err);
    }
    // replace() removes the app from history so back button can't return to it
    window.location.replace('/');
  };

  return (
    <div className="topbar" id="mainTopbar">
      {state.historicalMode ? (
        <HistoricalControls />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            SYMBOL: <SymbolSelect />
          </div>
          <div>EXPIRY: {state.loading && state.currentExpiry === '--'
            ? <span className="skeleton skeleton-topbar" />
            : <span style={{ color: '#1976d2' }}>{state.currentExpiry}</span>}
          </div>
          <div>DATA DATE: {state.loading && state.currentDataDate === '--'
            ? <span className="skeleton skeleton-topbar wide" />
            : <span>{state.currentDataDate}</span>}
          </div>
          <div>TIME: {state.loading && state.currentTime === '--'
            ? <span className="skeleton skeleton-topbar" />
            : <span>{state.currentTime}</span>}
          </div>
          <div>LOT: <span style={{ color: '#ff6f00', fontWeight: 700 }}>{state.lotSize}</span></div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginLeft: 'auto' }}>
        <button
          onClick={() => dispatch({ type: 'TOGGLE_SPLIT_SCREEN' })}
          title="Cycle: Chain+Chart → Chart → Chain → Off"
          style={{
            padding: '5px 12px', cursor: 'pointer',
            background: state.splitScreenActive ? '#1976d2' : 'rgba(25,118,210,0.12)',
            color: state.splitScreenActive ? '#fff' : '#1976d2',
            border: '1.5px solid #1976d2', borderRadius: '6px',
            fontSize: '13px', fontWeight: 700,
          }}
        >
          {state.splitScreenMode === 'chart' ? '📈 Chart' : '⊞ Chain+Chart'}
        </button>
        {state.user && (
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#ff6f00' }}>
            Welcome! <span style={{ color: '#ff6f00' }}>{state.user?.name || '--'}</span>
          </span>
        )}
        <button
          onClick={() => dispatch({ type: 'TOGGLE_UI_MENU' })}
          title="Settings & Toggles"
          style={{
            padding: '5px 14px', cursor: 'pointer',
            background: 'rgba(33,150,243,0.15)', color: '#2196f3',
            border: '1.5px solid #2196f3', borderRadius: '6px',
            fontSize: '13px', fontWeight: 700,
          }}
        >
          ⚙ UI
        </button>
        <button
          onClick={() => dispatch({ type: 'SET_NOTIF_PANEL', payload: true })}
          title="Notifications"
          style={{
            position: 'relative', padding: '5px 12px', cursor: 'pointer',
            background: 'rgba(255,111,0,0.1)', color: '#ff6f00',
            border: '1.5px solid #ff6f00', borderRadius: '6px',
            fontSize: '16px', fontWeight: 700, lineHeight: 1,
          }}
        >
          🔔
          {state.notifUnread > 0 && (
            <span style={{
              position: 'absolute', top: '-6px', right: '-6px',
              background: '#e53935', color: '#fff',
              borderRadius: '10px', fontSize: '10px', fontWeight: 900,
              padding: '1px 5px', lineHeight: '14px', minWidth: '16px',
              textAlign: 'center', pointerEvents: 'none',
            }}>
              {state.notifUnread > 99 ? '99+' : state.notifUnread}
            </span>
          )}
        </button>
        <button
          onClick={handleLogout}
          title="Logout"
          style={{
            padding: '5px 14px', cursor: 'pointer',
            background: 'rgba(255,111,0,0.15)', color: '#ff6f00',
            border: '1.5px solid #ff6f00', borderRadius: '6px',
            fontSize: '13px', fontWeight: 700,
          }}
        >
          ⏻ Logout
        </button>
      </div>
    </div>
  );
}