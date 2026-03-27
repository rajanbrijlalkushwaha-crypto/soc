/**
 * hooks/useOptionChainWS.js
 *
 * React hook — subscribes to a symbol via WebSocket and returns live option chain data.
 *
 * Usage:
 *   const { data, connected, error } = useOptionChainWS('NIFTY_50');
 *
 * Behaviour:
 *   - Connects once on mount, reuses the connection across symbol changes.
 *   - On symbol change: sends unsubscribe for the old symbol, subscribe for the new.
 *   - On FULL message: replaces entire chain state.
 *   - On DIFF message: merges only changed strikes/fields — no full re-render.
 *   - Auto-reconnects with exponential back-off on disconnect.
 *   - Sends a ping every 30 s to keep the connection alive through proxies.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// ── Config ────────────────────────────────────────────────────────────────────
const WS_URL = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
})();

const PING_INTERVAL_MS  = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useOptionChainWS(symbol) {
  const [data,      setData]      = useState(null);   // full chain snapshot
  const [connected, setConnected] = useState(false);
  const [error,     setError]     = useState(null);

  const wsRef         = useRef(null);
  const symbolRef     = useRef(symbol);   // always current symbol (for onopen callback)
  const prevSymbolRef = useRef(null);     // last symbol we sent subscribe for
  const retryCountRef = useRef(0);
  const pingRef       = useRef(null);
  const retryRef      = useRef(null);

  // Keep symbolRef current so the onopen callback subscribes to the right symbol
  useEffect(() => { symbolRef.current = symbol; }, [symbol]);

  // ── Merge DIFF into current state ─────────────────────────────────────────
  const applyDiff = useCallback((diff) => {
    setData(prev => {
      if (!prev) return prev; // no baseline yet — wait for FULL

      const next = { ...prev };

      // Merge top-level scalar fields
      if (diff.spot_price !== undefined) next.spot_price = diff.spot_price;
      if (diff.time       !== undefined) next.time       = diff.time;
      if (diff.expiry     !== undefined) next.expiry     = diff.expiry;
      if (diff.date       !== undefined) next.date       = diff.date;

      // Merge chain changes by strike
      if (diff.chain) {
        const chainMap = {};
        for (const row of (prev.chain || [])) chainMap[row.strike] = row;

        for (const [strike, changes] of Object.entries(diff.chain)) {
          const s = Number(strike);
          if (!chainMap[s]) {
            // New strike (rare)
            chainMap[s] = changes;
          } else {
            chainMap[s] = {
              ...chainMap[s],
              call: changes.call ? { ...chainMap[s].call, ...changes.call } : chainMap[s].call,
              put:  changes.put  ? { ...chainMap[s].put,  ...changes.put  } : chainMap[s].put,
            };
          }
        }

        next.chain = Object.values(chainMap).sort((a, b) => a.strike - b.strike);
      }

      return next;
    });
  }, []);

  // ── Connect & message handler ─────────────────────────────────────────────
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
      retryCountRef.current = 0;

      // Subscribe to current symbol and record it as the active subscription
      const sym = symbolRef.current;
      ws.send(JSON.stringify({ action: 'subscribe', symbol: sym }));
      prevSymbolRef.current = sym;

      // Heartbeat
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'ping' }));
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'full') {
        setData(msg.data);
      } else if (msg.type === 'diff') {
        applyDiff(msg.data);
      } else if (msg.type === 'error') {
        setError(msg.message);
      }
      // 'pong' — ignore
    };

    ws.onclose = () => {
      setConnected(false);
      clearInterval(pingRef.current);

      // Exponential back-off reconnect
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** retryCountRef.current, RECONNECT_MAX_MS);
      retryCountRef.current++;
      retryRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      setError('WebSocket connection error');
    };
  }, [applyDiff]);

  // ── Mount / unmount — only connect when symbol is provided ──────────────
  useEffect(() => {
    if (!symbol) return; // historical mode — don't connect
    connect();
    return () => {
      clearInterval(pingRef.current);
      clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect, symbol]);

  // ── Symbol change: unsubscribe old, subscribe new, clear stale data ───────
  // prevSymbolRef tracks the last symbol we actually subscribed to so we can
  // correctly unsubscribe it — symbolRef.current is already updated to `symbol`
  // by the time this effect runs, so we cannot use it as "previous".
  useEffect(() => {
    if (!symbol) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    if (prevSymbolRef.current && prevSymbolRef.current !== symbol) {
      ws.send(JSON.stringify({ action: 'unsubscribe', symbol: prevSymbolRef.current }));
    }

    setData(null);
    ws.send(JSON.stringify({ action: 'subscribe', symbol }));
    prevSymbolRef.current = symbol;
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, connected, error };
}
