/**
 * ws/socketio.js
 *
 * Socket.IO server for live option chain push.
 * - Full snapshot on first 'subscribe' from a client (read from OC_STATE:<SYMBOL> in Dragonfly)
 * - Diff-only on subsequent ticks (publishes only changed fields)
 * - Handles DragonflyDB (psubscribe OC:*) reconnect transparently
 * - Client reconnect: Socket.IO handles it; server stores last-sent per socket+symbol for diff
 */

'use strict';

const { Server } = require('socket.io');
const Redis = require('ioredis');
const { pub } = require('./redis');

// Dedicated subscriber client for socketio — keeps it isolated from websocket.js subscriber
const REDIS_URL = process.env.DRAGONFLY_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const sub = new Redis(REDIS_URL, {
  connectTimeout:     3000,
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
  retryStrategy: (times) => times <= 3 ? times * 200 : 30000,
});
sub.on('connect', () => console.log('[Redis socketio-sub] connected'));
sub.on('error',   () => {});

let _io = null;

// last full state sent per socket per symbol, for computing diffs
// _lastSent[socketId][symbol] = { spot, spot_chg, fut_ltp, chain: Map<strike, {ce,pe}> }
const _lastSent = {};

// ── Diff helpers ─────────────────────────────────────────────────────────────
function diffChain(prevChain, nextChain) {
  const changed = [];
  const prevMap = new Map((prevChain || []).map(r => [r.strike, r]));

  for (const row of nextChain || []) {
    const prev = prevMap.get(row.strike);
    if (!prev) { changed.push(row); continue; }

    const ceChanged = legChanged(prev.ce, row.ce);
    const peChanged = legChanged(prev.pe, row.pe);
    if (ceChanged || peChanged) {
      changed.push({
        strike: row.strike,
        ce: ceChanged ? row.ce : undefined,
        pe: peChanged ? row.pe : undefined,
      });
    }
  }
  return changed;
}

function legChanged(prev, next) {
  if (!prev && !next) return false;
  if (!prev || !next) return true;
  return prev.ltp !== next.ltp || prev.oi !== next.oi || prev.oi_chg !== next.oi_chg ||
    prev.vol !== next.vol || prev.iv !== next.iv || prev.bid !== next.bid || prev.ask !== next.ask;
}

// ── Socket.IO attach ─────────────────────────────────────────────────────────
function attach(httpServer) {
  _io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  _io.on('connection', (socket) => {
    _lastSent[socket.id] = {};

    socket.on('subscribe', async (symbol) => {
      if (typeof symbol !== 'string') return;
      symbol = symbol.toUpperCase().trim();
      socket.join(`room:${symbol}`);

      // Send full snapshot from Dragonfly cache
      try {
        const raw = await pub.get(`OC_STATE:${symbol}`);
        if (raw) {
          const snap = JSON.parse(raw);
          _lastSent[socket.id][symbol] = snap;
          socket.emit('oc:snapshot', { symbol, data: snap });
        } else {
          socket.emit('oc:snapshot', { symbol, data: null, msg: 'No data yet' });
        }
      } catch (_) {
        socket.emit('oc:snapshot', { symbol, data: null, msg: 'Cache unavailable' });
      }
    });

    socket.on('unsubscribe', (symbol) => {
      if (typeof symbol !== 'string') return;
      symbol = symbol.toUpperCase().trim();
      socket.leave(`room:${symbol}`);
      delete _lastSent[socket.id]?.[symbol];
    });

    socket.on('disconnect', () => {
      delete _lastSent[socket.id];
    });
  });

  // Subscribe to DragonflyDB pattern — receive all OC:* channels
  _setupDragonflySubscription();
}

// ── DragonflyDB subscription with reconnect ───────────────────────────────────
let _subReady = false;

function _setupDragonflySubscription() {
  sub.on('pmessage', (_pattern, channel, message) => {
    if (!_io) return;
    const symbol = channel.replace('OC:', '').toUpperCase();

    let nextSnap;
    try { nextSnap = JSON.parse(message); } catch { return; }

    const room = _io.sockets.adapter.rooms.get(`room:${symbol}`);
    if (!room || room.size === 0) return; // no subscribers

    for (const socketId of room) {
      const socket = _io.sockets.sockets.get(socketId);
      if (!socket) continue;

      const prevSnap = _lastSent[socketId]?.[symbol];

      if (!prevSnap) {
        // First push after reconnect — send full snapshot
        socket.emit('oc:snapshot', { symbol, data: nextSnap });
        if (!_lastSent[socketId]) _lastSent[socketId] = {};
        _lastSent[socketId][symbol] = nextSnap;
        continue;
      }

      // Compute diff
      const diff = {
        symbol,
        ts: nextSnap.ts,
        spot:     nextSnap.spot     !== prevSnap.spot     ? nextSnap.spot     : undefined,
        spot_chg: nextSnap.spot_chg !== prevSnap.spot_chg ? nextSnap.spot_chg : undefined,
        fut_ltp:  nextSnap.fut_ltp  !== prevSnap.fut_ltp  ? nextSnap.fut_ltp  : undefined,
        chain:    diffChain(prevSnap.chain, nextSnap.chain),
      };

      // Only emit if something actually changed
      if (diff.spot !== undefined || diff.spot_chg !== undefined ||
          diff.fut_ltp !== undefined || diff.chain.length > 0) {
        socket.emit('oc:diff', diff);
      }

      _lastSent[socketId][symbol] = nextSnap;
    }
  });

  sub.on('connect', () => {
    if (!_subReady) {
      sub.psubscribe('OC:*');
      _subReady = true;
    }
  });

  sub.on('error', () => {
    _subReady = false; // will re-psubscribe on next connect event
  });

  // If already connected, subscribe immediately
  if (sub.status === 'ready') {
    sub.psubscribe('OC:*');
    _subReady = true;
  }
}

function getIO() { return _io; }

module.exports = { attach, getIO };
