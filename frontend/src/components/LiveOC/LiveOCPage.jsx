/**
 * LiveOCPage — Live OC Tick view.
 * Identical layout to the main option chain (Topbar, OptionChainTable, Footer,
 * all modals). Data comes from the native WebSocket (WS:SYMBOL) — same channel
 * as Way 1, but updated every tick when Upstox WS is active.
 */
import { lazy, Suspense } from 'react';
import Topbar from '../Topbar/topbar';
import UISettings from '../UISetting/UISettings';
import OptionChainTable from '../OptionChain/OptionChainTable';
import Footer from '../Footer/Footer';
import { useOptionChainWS } from '../../hooks/useOptionChainWS';
import { useApp } from '../../context/AppContext';

const LTPCalculator  = lazy(() => import('../Calculator/LTPCalculator'));
const LTPPopup       = lazy(() => import('../Calculator/LTPPopup'));
const ShiftingModal  = lazy(() => import('../Shifting/ShiftingModal'));
const SpotChartModal = lazy(() => import('../Chart/SpotChartModal'));
const OIChartModal   = lazy(() => import('../Chart/OIChartModal'));
const OIChngModal    = lazy(() => import('../Chart/OIChngModal'));
const SOCAIPanel     = lazy(() => import('../SOCAI/SOCAIPanel'));

export default function LiveOCPage() {
  const { state } = useApp();
  const symbol = state.historicalMode ? null : state.currentSymbol;
  const { connected } = useOptionChainWS(symbol);

  return (
    <Suspense fallback={null}>
      {/* WS connection status badge — top-right corner */}
      <div style={{
        position: 'fixed', top: 8, right: 160, zIndex: 9999,
        display: 'flex', alignItems: 'center', gap: 5,
        background: 'rgba(13,33,55,0.85)', borderRadius: 20,
        padding: '3px 10px', fontSize: 11, color: '#94a3b8',
        pointerEvents: 'none',
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: connected ? '#22c55e' : '#ef4444',
          display: 'inline-block',
          boxShadow: connected ? '0 0 5px #22c55e' : 'none',
        }} />
        <span style={{ letterSpacing: 1, fontWeight: 700 }}>
          {connected ? 'TICK LIVE' : 'RECONNECTING'}
        </span>
      </div>

      <div className="watermark">SOC.AI.IN</div>

      {/* Full Topbar — has symbol search/select, expiry, date, time, lot, logout */}
      <Topbar />
      <UISettings />

      {/* Modals — same as main chain view */}
      <div id="mainContent">
        <LTPCalculator />
        <LTPPopup />
        <ShiftingModal />
        <SpotChartModal />
        <OIChartModal />
        <OIChngModal />
        <OptionChainTable />
      </div>

      <Footer />
      <SOCAIPanel />
    </Suspense>
  );
}
