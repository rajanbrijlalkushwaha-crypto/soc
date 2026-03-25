import { useEffect, useCallback, useRef } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import IndexPage from './components/Index/IndexPage';
import SideNav from './components/sidenav/sidenav';
import Topbar from './components/Topbar/topbar';
import UISettings from './components/UISetting/UISettings';
import OptionChainTable from './components/OptionChain/OptionChainTable';
import LTPCalculator from './components/Calculator/LTPCalculator';
import ShiftingModal from './components/Shifting/ShiftingModal';
import SpotChartModal from './components/Chart/SpotChartModal';
import OIChartModal from './components/Chart/OIChartModal';
import OIChngModal from './components/Chart/OIChngModal';
import Footer from './components/Footer/Footer';
import SOCAIPanel from './components/SOCAI/SOCAIPanel';
import PowerAIStockPanel from './components/PowerAI/PowerAIStockPanel';
import HolidayListPanel from './components/Info/HolidayListPanel';
import SupportPanel from './components/Info/SupportPanel';
import ProfilePage from './components/Profile/ProfilePage';
import AdminPanel from './components/admin/AdminPanel';
import SubscriptionPage from './components/Subscription/SubscriptionPage';
import TradingJournal from './components/Journal/TradingJournal';
import TeamPage from './components/Team/TeamPage';
import NotificationPanel from './components/Notifications/NotificationPanel';
import NotifPopup from './components/Notifications/NotifPopup';
import AITrainPanel from './components/AITrain/AITrainPanel';
import AIStockPanel from './components/AIStock/AIStockPanel';
import JoinMeetPage from './components/JoinMeet/JoinMeetPage';
import SplitChart from './components/Chart/SplitChart';
import SplitPane from './components/Layout/SplitPane';
import { fetchSymbols, fetchLiveData, fetchLiveSignals, fetchShiftingData, fetchMCTRData, fetchStrategy40Data } from './services/api';

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
    } else if (path === '/optionchain') {
      dispatch({ type: 'SET_INDEX_PAGE', payload: false });
      dispatch({ type: 'SET_HISTORICAL_MODE', payload: false });
    }
    // default (/dashboard or /) stays as indexPageActive:true
  }, [dispatch]);

  // Fetch user info + UI settings + notifications + indicators on mount
  useEffect(() => {
    // Fetch indicators immediately (no auth needed)
    fetch(`${API_BASE}/api/indicators`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d?.success && d.indicators) dispatch({ type: 'SET_INDICATORS', payload: d.indicators }); })
      .catch(() => {});

    fetch(`${API_BASE}/api/auth/check-session`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.authenticated && data.user) {
          dispatch({ type: 'SET_USER', payload: data.user });
          // Fire all three in parallel
          Promise.all([
            fetch(`${API_BASE}/api/auth/ui-settings`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/notifications/popup`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/api/notifications`, { credentials: 'include' }).then(r => r.json()).catch(() => null),
          ]).then(([ui, popup, notifs]) => {
            if (ui?.success && ui.settings && Object.keys(ui.settings).length > 0)
              dispatch({ type: 'SET_UI_SETTINGS', payload: ui.settings });
            if (popup?.notifications?.length > 0)
              dispatch({ type: 'SET_NOTIF_POPUP', payload: popup.notifications });
            if (notifs) {
              const unread = (notifs.notifications || []).filter(n => !n.seen).length;
              dispatch({ type: 'SET_NOTIF_UNREAD', payload: unread });
            }
          });
        }
      })
      .catch(() => {});
  }, [dispatch]);

  // Load symbols on mount — serve from localStorage instantly, then refresh from server
  useEffect(() => {
    const init = async () => {
      try {
        // Show cached symbols immediately (zero-wait on return visits)
        const cached = localStorage.getItem('soc_symbols');
        if (cached) {
          const cachedSymbols = JSON.parse(cached);
          if (cachedSymbols.length > 0) {
            dispatch({ type: 'SET_SYMBOLS', payload: cachedSymbols });
            dispatch({ type: 'SET_CURRENT_SYMBOL', payload: cachedSymbols[0] });
          }
        }
        // Then fetch fresh from server and update
        const symbols = await fetchSymbols();
        if (symbols.length > 0) {
          localStorage.setItem('soc_symbols', JSON.stringify(symbols));
          dispatch({ type: 'SET_SYMBOLS', payload: symbols });
          dispatch({ type: 'SET_CURRENT_SYMBOL', payload: symbols[0] });
        }
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

  // Load live data when symbol changes
  const loadLive = useCallback(async () => {
    if (!state.currentSymbol || state.historicalMode) return;
    try {
      const data = await fetchLiveData(state.currentSymbol);
      dispatch({ type: 'SET_LIVE_DATA', payload: data });
    } catch (err) {
      console.error('Error loading live data:', err);
    }
  }, [state.currentSymbol, state.historicalMode, dispatch]);

  // Initial load + interval
  useEffect(() => {
    if (!state.currentSymbol) return;
    if (state.historicalMode) {
      clearInterval(liveIntervalRef.current);
      return;
    }

    loadLive();
    liveIntervalRef.current = setInterval(loadLive, 5000);

    return () => clearInterval(liveIntervalRef.current);
  }, [state.currentSymbol, state.historicalMode, loadLive, liveIntervalRef]);

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
    else if (state.indexPageActive) page = 'Dashboard';
    else if (state.historicalMode) page = 'Historical';
    else page = 'Live Option Chain';
    document.title = `${base} | ${page}`;
  }, [
    state.holidayListActive, state.supportActive, state.profileActive,
    state.adminPanelActive, state.subscriptionActive, state.journalActive,
    state.teamPageActive, state.aiTrainActive, state.aiStockActive, state.aiPageActive,
    state.aiPageType, state.indexPageActive, state.historicalMode,
  ]);

  const renderMain = () => {
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
          <ShiftingModal />
          <SpotChartModal />
          <OIChartModal />
          <OIChngModal />
          <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            <Topbar />
            <UISettings />
            <div id="mainContent" style={{ flex: 1, minHeight: 0, height: 'unset', padding: 0, overflow: 'hidden' }}>
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
    <>
      <SideNav />
      {renderMain()}
      <NotificationPanel />
      <NotifPopup />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
