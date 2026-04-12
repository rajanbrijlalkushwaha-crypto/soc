import { useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useOptionChainWS } from './hooks/useOptionChainWS';
import { AppProvider, useApp } from './context/AppContext';
import { fetchSymbols, fetchLiveData, fetchLiveSignals, fetchShiftingData, fetchMCTRData, fetchStrategy40Data } from './services/api';
import IndexPage from './components/Index/IndexPage';
import SideNav from './components/sidenav/sidenav';
import Topbar from './components/Topbar/topbar';
import UISettings from './components/UISetting/UISettings';
import OptionChainTable from './components/OptionChain/OptionChainTable';
import Footer from './components/Footer/Footer';
import NotifPopup from './components/Notifications/NotifPopup';
import SplitPane from './components/Layout/SplitPane';

// Lazy-loaded heavy components — only downloaded when first opened
const LTPCalculator      = lazy(() => import('./components/Calculator/LTPCalculator'));
const LTPPopup           = lazy(() => import('./components/Calculator/LTPPopup'));
const ShiftingModal      = lazy(() => import('./components/Shifting/ShiftingModal'));
const SpotChartModal     = lazy(() => import('./components/Chart/SpotChartModal'));
const OIChartModal       = lazy(() => import('./components/Chart/OIChartModal'));
const OIChngModal        = lazy(() => import('./components/Chart/OIChngModal'));
const SplitChart         = lazy(() => import('./components/Chart/SplitChart'));
const SOCAIPanel         = lazy(() => import('./components/SOCAI/SOCAIPanel'));
const PowerAIStockPanel  = lazy(() => import('./components/PowerAI/PowerAIStockPanel'));
const HolidayListPanel   = lazy(() => import('./components/Info/HolidayListPanel'));
const SupportPanel       = lazy(() => import('./components/Info/SupportPanel'));
const ProfilePage        = lazy(() => import('./components/Profile/ProfilePage'));
const AdminPanel         = lazy(() => import('./components/admin/AdminPanel'));
const SubscriptionPage   = lazy(() => import('./components/Subscription/SubscriptionPage'));
const TradingJournal     = lazy(() => import('./components/Journal/TradingJournal'));
const TeamPage           = lazy(() => import('./components/Team/TeamPage'));
const NotificationPanel  = lazy(() => import('./components/Notifications/NotificationPanel'));
const AITrainPanel       = lazy(() => import('./components/AITrain/AITrainPanel'));
const AIStockPanel       = lazy(() => import('./components/AIStock/AIStockPanel'));
const JoinMeetPage       = lazy(() => import('./components/JoinMeet/JoinMeetPage'));
const CryptoOptionChain    = lazy(() => import('./components/Crypto/CryptoOptionChain'));
const CryptoOIChartModal   = lazy(() => import('./components/Crypto/CryptoOIChartModal'));

const API_BASE = process.env.REACT_APP_API_URL || '';

function AppContent() {
  const { state, dispatch, liveIntervalRef } = useApp();
  const favAppliedRef = useRef(false);

  // URL-based navigation on initial load
  useEffect(() => {
    const path = window.location.pathname;
    if (path === '/historical') {
      dispatch({ type: 'SET_HISTORICAL_MODE', payload: true });
      dispatch({ type: 'SET_INDEX_PAGE', payload: false });
    } else if (path === '/poweraistock') {
      dispatch({ type: 'SET_AI_PAGE', payload: { active: true, type: 'stock' } });
      dispatch({ type: 'SET_INDEX_PAGE', payload: false });
    } else if (path === '/holiday-list') {
      dispatch({ type: 'SET_HOLIDAY_LIST', payload: true });
    } else if (path === '/support') {
      dispatch({ type: 'SET_SUPPORT', payload: true });
    } else if (path === '/profile') {
      dispatch({ type: 'SET_PROFILE', payload: true });
    } else if (path === '/admin-panel') {
      dispatch({ type: 'SET_ADMIN_PANEL', payload: true });
    } else if (path === '/subscription') {
      dispatch({ type: 'SET_SUBSCRIPTION', payload: true });
    } else if (path === '/journal') {
      dispatch({ type: 'SET_JOURNAL', payload: true });
    } else if (path === '/team') {
      dispatch({ type: 'SET_TEAM_PAGE', payload: true });
    } else if (path === '/ai-train') {
      dispatch({ type: 'SET_AI_TRAIN', payload: true });
    } else if (path === '/ai-stock') {
      dispatch({ type: 'SET_AI_STOCK', payload: true });
    } else if (path === '/join-meet') {
      dispatch({ type: 'SET_JOIN_MEET', payload: true });
    } else if (path === '/crypto') {
      dispatch({ type: 'SET_CRYPTO_PAGE', payload: true });
    } else if (path === '/optionchain') {
      dispatch({ type: 'SET_INDEX_PAGE', payload: false });
      dispatch({ type: 'SET_HISTORICAL_MODE', payload: false });
    }
    // default (/dashboard or /) stays as indexPageActive:true
  }, [dispatch]);

  // Bootstrap — load from localStorage instantly, then refresh from server
  useEffect(() => {
    // 1. Show cached bootstrap immediately (zero network wait)
    try {
      const cached = localStorage.getItem('soc_bootstrap');
      if (cached) {
        const { user, settings, indicators } = JSON.parse(cached);
        if (user)       dispatch({ type: 'SET_USER',        payload: user });
        if (settings && Object.keys(settings).length > 0)
                        dispatch({ type: 'SET_UI_SETTINGS', payload: settings });
        if (indicators) dispatch({ type: 'SET_INDICATORS',  payload: indicators });
      }
    } catch (_) {}

    // 2. Fetch fresh in background and update + re-cache
    Promise.all([
      fetch(`${API_BASE}/api/auth/bootstrap`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/indicators`,     { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ]).then(([boot, indData]) => {
      const toCache = {};

      if (indData?.success && indData.indicators) {
        dispatch({ type: 'SET_INDICATORS', payload: indData.indicators });
        toCache.indicators = indData.indicators;
      }

      if (boot?.authenticated && boot.user) {
        dispatch({ type: 'SET_USER', payload: boot.user });
        toCache.user = boot.user;
        if (boot.settings && Object.keys(boot.settings).length > 0) {
          dispatch({ type: 'SET_UI_SETTINGS', payload: boot.settings });
          toCache.settings = boot.settings;
        }
        if (boot.popup?.length > 0)
          dispatch({ type: 'SET_NOTIF_POPUP', payload: boot.popup });
        if (boot.unread > 0)
          dispatch({ type: 'SET_NOTIF_UNREAD', payload: boot.unread });
      }

      try { localStorage.setItem('soc_bootstrap', JSON.stringify(toCache)); } catch (_) {}
    });
  }, [dispatch]);

  // Load symbols on mount — serve from localStorage instantly, then refresh from server
  useEffect(() => {
    const init = async () => {
      try {
        // Fetch live symbols (active instruments only) for live option chain
        const symbols = await fetchSymbols('live');
        if (symbols.length > 0) {
          localStorage.setItem('soc_symbols', JSON.stringify(symbols));
          dispatch({ type: 'SET_SYMBOLS', payload: symbols });
          dispatch({ type: 'SET_CURRENT_SYMBOL', payload: symbols[0] });
        }
        // Fetch all disk symbols for historical dropdown (includes deactivated instruments)
        fetchSymbols('historical').then(all => {
          if (all.length > 0) dispatch({ type: 'SET_AVAILABLE_SYMBOLS', payload: all });
        }).catch(() => {});
      } catch (err) {
        console.error('Error loading symbols:', err);
        dispatch({ type: 'SET_ERROR', payload: err.message });
      }
    };
    init();
  }, [dispatch]);

  // Once user + symbols are both ready, auto-select first favourite symbol
  useEffect(() => {
    if (favAppliedRef.current) return;
    if (!state.user || !state.symbols.length) return;
    try {
      const key  = `sym_favs_${state.user.id || state.user.email || 'guest'}`;
      const favs = JSON.parse(localStorage.getItem(key) || '[]');
      const first = favs.find(f => state.symbols.includes(f));
      if (first) {
        dispatch({ type: 'SET_CURRENT_SYMBOL', payload: first });
        favAppliedRef.current = true;
      }
    } catch (_) {}
  }, [state.user, state.symbols, dispatch]);

  // ── WebSocket live data — primary delivery ────────────────────────────────
  const wsSymbol = state.historicalMode ? null : state.currentSymbol;
  const { data: wsData, connected: wsConnected } = useOptionChainWS(wsSymbol);
  const wsFallbackRef = useRef(null);
  const wsDataReceivedRef = useRef(false);

  // Push WS data into app state the moment it arrives + cache it locally
  useEffect(() => {
    if (!wsData) return;
    wsDataReceivedRef.current = true;
    dispatch({ type: 'SET_LIVE_DATA', payload: wsData });
    // Cache snapshot so next visit / symbol switch is instant
    if (wsData.symbol) {
      try { localStorage.setItem(`soc_live_${wsData.symbol}`, JSON.stringify(wsData)); } catch (_) {}
    }
  }, [wsData, dispatch]);

  // On symbol change: show cached snapshot INSTANTLY (0ms), then WS/API takes over
  useEffect(() => {
    if (!state.currentSymbol || state.historicalMode) return;
    wsDataReceivedRef.current = false;
    clearInterval(wsFallbackRef.current);

    // Show last known snapshot immediately — user sees data before network round-trip
    try {
      const cached = localStorage.getItem(`soc_live_${state.currentSymbol}`);
      if (cached) dispatch({ type: 'SET_LIVE_DATA', payload: JSON.parse(cached) });
    } catch (_) {}

    const loadOnce = async () => {
      if (wsDataReceivedRef.current) return; // WS was faster — skip
      try {
        const data = await fetchLiveData(state.currentSymbol);
        if (!wsDataReceivedRef.current) dispatch({ type: 'SET_LIVE_DATA', payload: data });
      } catch (_) {}
    };

    // Fire immediately — race with WS FULL (whichever arrives first wins)
    loadOnce();

    // If WS stays disconnected, keep polling every 8s
    if (!wsConnected) {
      wsFallbackRef.current = setInterval(async () => {
        try {
          const data = await fetchLiveData(state.currentSymbol);
          dispatch({ type: 'SET_LIVE_DATA', payload: data });
        } catch (_) {}
      }, 8000);
    }

    return () => clearInterval(wsFallbackRef.current);
  }, [state.currentSymbol, state.historicalMode, wsConnected, dispatch]);

  // Historical shifting data — only in historical mode (reads from disk, no polling needed)
  useEffect(() => {
    if (!state.currentSymbol || !state.historicalMode) return;
    const { currentExpiry, currentDataDate } = state;
    if (!currentExpiry || !currentDataDate || currentExpiry === '--' || currentDataDate === '--') return;
    fetchShiftingData(state.currentSymbol, currentExpiry, currentDataDate)
      .then(data => {
        const timeline = data?.timeline?.filter(e => e.time >= '09:15') || [];
        const resEntry = [...timeline].reverse().find(e => e.resistance?.shift) || timeline.at(-1);
        const supEntry = [...timeline].reverse().find(e => e.support?.shift) || timeline.at(-1);
        dispatch({ type: 'SET_SHIFTING_LEVELS', payload: {
          resistance: resEntry?.resistance ? { strike: resEntry.resistance.strike, shift: resEntry.resistance.shift || null, shiftFrom: resEntry.resistance.shiftFrom || null, time: resEntry.time || null, strength: resEntry.resistance.strength || null } : null,
          support: supEntry?.support ? { strike: supEntry.support.strike, shift: supEntry.support.shift || null, shiftFrom: supEntry.support.shiftFrom || null, time: supEntry.time || null, strength: supEntry.support.strength || null } : null,
          timeline,
        }});
        // Also load MCTR + strategy40 for historical
        fetchMCTRData(state.currentSymbol, currentExpiry, currentDataDate).then(d => {
          dispatch({ type: 'SET_MCTR', payload: {
            mctrSupport: d.mctr_support?.strike || null,
            mctrSupportRev: d.mctr_support?.reversal || null,
            mctrSupportTouched: d.mctr_support?.reversal_touched || false,
            mctrSupportFoundAt: d.mctr_support?.found_at || null,
            mctrResistance: d.mctr_resistance?.strike || null,
            mctrResistanceRev: d.mctr_resistance?.reversal || null,
            mctrResistanceTouched: d.mctr_resistance?.reversal_touched || false,
            mctrResistanceFoundAt: d.mctr_resistance?.found_at || null,
          }});
        }).catch(() => {});
        fetchStrategy40Data(state.currentSymbol, currentExpiry, currentDataDate).then(d => {
          dispatch({ type: 'SET_STRATEGY40', payload: {
            strategy40Support: d.support || null,
            strategy40SupportReversal: d.support_reversal || null,
            strategy40Resistance: d.resistance || null,
            strategy40ResistanceReversal: d.resistance_reversal || null,
            strategy40GapCutSupport: d.gap_cut_support || null,
            strategy40GapCutResistance: d.gap_cut_resistance || null,
          }});
        }).catch(() => {});
        dispatch({ type: 'SET_SIGNALS_LOADING', payload: false });
      })
      .catch(() => { dispatch({ type: 'SET_SIGNALS_LOADING', payload: false }); });
  }, [state.currentSymbol, state.historicalMode, state.currentExpiry, state.currentDataDate, dispatch]);

  // Live signals (shifting + MCTR + strategy40) — served from server RAM cache.
  // Option chain loads instantly. Signals follow after a 3 s head-start delay so
  // the table is visible immediately, then signals appear in the header.
  useEffect(() => {
    if (!state.currentSymbol || state.historicalMode) return;

    dispatch({ type: 'SET_SIGNALS_LOADING', payload: true });

    const loadSignals = async () => {
      try {
        const data = await fetchLiveSignals(state.currentSymbol);

        // Shifting levels
        const timeline = data.shifting?.timeline?.filter(e => e.time >= '09:15') || [];
        const resEntry = [...timeline].reverse().find(e => e.resistance?.shift) || timeline.at(-1);
        const supEntry = [...timeline].reverse().find(e => e.support?.shift) || timeline.at(-1);
        dispatch({ type: 'SET_SHIFTING_LEVELS', payload: {
          resistance: resEntry?.resistance ? { strike: resEntry.resistance.strike, shift: resEntry.resistance.shift || null, shiftFrom: resEntry.resistance.shiftFrom || null, time: resEntry.time || null, strength: resEntry.resistance.strength || null } : null,
          support: supEntry?.support ? { strike: supEntry.support.strike, shift: supEntry.support.shift || null, shiftFrom: supEntry.support.shiftFrom || null, time: supEntry.time || null, strength: supEntry.support.strength || null } : null,
          timeline,
        }});

        // MCTR
        if (data.mctr) {
          dispatch({ type: 'SET_MCTR', payload: {
            mctrSupport: data.mctr.mctr_support?.strike || null,
            mctrSupportRev: data.mctr.mctr_support?.reversal || null,
            mctrSupportTouched: data.mctr.mctr_support?.reversal_touched || false,
            mctrSupportFoundAt: data.mctr.mctr_support?.found_at || null,
            mctrResistance: data.mctr.mctr_resistance?.strike || null,
            mctrResistanceRev: data.mctr.mctr_resistance?.reversal || null,
            mctrResistanceTouched: data.mctr.mctr_resistance?.reversal_touched || false,
            mctrResistanceFoundAt: data.mctr.mctr_resistance?.found_at || null,
          }});
        }

        // Strategy 4.0 — show previous day's locked data (bromosYesterday), fallback to today's
        const bromos = data.bromosYesterday || data.strategy40;
        if (bromos) {
          // After 3:20 PM IST — today's strategy40 levels become tomorrow's Bromos preview
          const ist = new Date(Date.now() + 5.5 * 3600000);
          const istMins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
          const isAfter320 = istMins >= 15 * 60 + 20;
          const nextDay = isAfter320 && data.bromosYesterday && data.strategy40 ? data.strategy40 : null;

          dispatch({ type: 'SET_STRATEGY40', payload: {
            strategy40Support: bromos.support || null,
            strategy40SupportReversal: bromos.support_reversal || null,
            strategy40Resistance: bromos.resistance || null,
            strategy40ResistanceReversal: bromos.resistance_reversal || null,
            strategy40GapCutSupport: bromos.gap_cut_support || null,
            strategy40GapCutResistance: bromos.gap_cut_resistance || null,
            nextDayBromosR: nextDay?.resistance_reversal || null,
            nextDayBromosS: nextDay?.support_reversal || null,
          }});
        }

        dispatch({ type: 'SET_SIGNALS_LOADING', payload: false });
      } catch (_) {
        dispatch({ type: 'SET_SIGNALS_LOADING', payload: false });
      }
    };

    // Load signals immediately on symbol change
    const first = setTimeout(loadSignals, 0);
    const poll  = setInterval(loadSignals, 15000);

    return () => { clearTimeout(first); clearInterval(poll); };
  }, [state.currentSymbol, state.historicalMode, dispatch]);

  // Apply theme class to body
  useEffect(() => {
    document.body.className = '';
    if (state.theme === 'black') document.body.classList.add('black-theme');
    else if (state.theme === 'blue') document.body.classList.add('blue-theme');
    if (state.historicalMode) document.body.classList.add('historical-mode');
    if (state.splitScreenActive) document.body.classList.add('split-active');
  }, [state.theme, state.historicalMode, state.splitScreenActive]);

  // Update browser tab title based on active page
  useEffect(() => {
    const base = 'Soc.ai.in';
    let page = '';
    if (state.holidayListActive)   page = 'Holiday List';
    else if (state.supportActive)  page = 'Support';
    else if (state.profileActive)  page = 'Profile';
    else if (state.adminPanelActive) page = 'Admin Panel';
    else if (state.subscriptionActive) page = 'Subscription';
    else if (state.journalActive)  page = 'Journal';
    else if (state.teamPageActive) page = 'Team';
    else if (state.aiTrainActive)  page = 'AI Train';
    else if (state.aiStockActive)  page = 'AI Stock';
    else if (state.aiPageActive && state.aiPageType === 'stock') page = 'Power AI Stock';
    else if (state.aiPageActive && state.aiPageType === 'swing') page = 'AI Swing Trade';
    else if (state.cryptoPageActive) page = 'Crypto Options';
    else if (state.indexPageActive) page = 'Dashboard';
    else if (state.historicalMode) page = 'Historical';
    else page = 'Live Option Chain';
    document.title = `${base} | ${page}`;
  }, [
    state.holidayListActive, state.supportActive, state.profileActive,
    state.adminPanelActive, state.subscriptionActive, state.journalActive,
    state.teamPageActive, state.aiTrainActive, state.aiStockActive, state.aiPageActive,
    state.aiPageType, state.indexPageActive, state.historicalMode, state.cryptoPageActive,
  ]);

  const renderMain = () => {
    if (state.cryptoPageActive)  return (
      <>
        <div className="watermark">SOC.AI.IN</div>
        <CryptoOIChartModal />
        <CryptoOptionChain />
        <UISettings />
        <Footer />
        <SOCAIPanel />
      </>
    );
    if (state.joinMeetActive)    return <JoinMeetPage />;
    if (state.holidayListActive) return <HolidayListPanel />;
    if (state.supportActive)     return <SupportPanel />;
    if (state.profileActive)     return <ProfilePage />;
    if (state.adminPanelActive)  return <AdminPanel />;
    if (state.subscriptionActive) return <SubscriptionPage />;
    if (state.journalActive)     return <TradingJournal />;
    if (state.teamPageActive)    return <TeamPage />;
    if (state.aiTrainActive)     return <AITrainPanel />;
    if (state.aiStockActive)     return <AIStockPanel />;
    if (state.aiPageActive && state.aiPageType === 'stock') return <PowerAIStockPanel />;
    if (state.indexPageActive)   return <IndexPage />;

    if (state.splitScreenActive) {
      const mode = state.splitScreenMode;
      return (
        <>
          <div className="watermark">SOC.AI.IN</div>
          <LTPCalculator />
          <LTPPopup />
          <ShiftingModal />
          <SpotChartModal />
          <OIChartModal />
          <OIChngModal />
          <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            <Topbar />
            <UISettings />
            <div id="mainContent" style={{ flex: 1, minHeight: 0, height: 'unset', padding: 0, overflow: 'hidden' }}>
              {mode === 'chain' && <OptionChainTable />}
              {mode === 'split' && (
                <SplitPane
                  defaultSplit={65}
                  left={<OptionChainTable />}
                  right={<SplitChart />}
                />
              )}
              {mode === 'chart' && <SplitChart />}
            </div>
          </div>
          <Footer />
          <SOCAIPanel />
        </>
      );
    }

    return (
      <>
        <div className="watermark">SOC.AI.IN</div>
        <Topbar />
        <UISettings />
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
      </>
    );
  };

  return (
    <Suspense fallback={null}>
      <SideNav />
      {renderMain()}
      <NotificationPanel />
      <NotifPopup />
    </Suspense>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
