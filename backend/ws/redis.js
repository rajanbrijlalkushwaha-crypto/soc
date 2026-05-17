/**
 * ws/redis.js
 *
 * Exports two ioredis clients:
 *   pub  — used for SET, SETEX, PUBLISH (and general reads)
 *   sub  — dedicated subscriber (ioredis blocks a connection once SUBSCRIBE is called)
 *
 * Both clients share the same config and reconnect strategy.
 * All errors are caught and logged — they never crash the server.
 */

const Redis = require('ioredis');

const REDIS_URL = process.env.DRAGONFLY_URL || process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const pubOpts = {
  connectTimeout:       3000,
  maxRetriesPerRequest: 1,
  enableOfflineQueue:   false,  // pub: drop stale writes, never queue
  retryStrategy: (times) => times <= 3 ? times * 200 : 30000,
};

// sub MUST have enableOfflineQueue:true so ioredis can replay SUBSCRIBE
// commands after reconnect without hitting the "subscriber mode" error.
const subOpts = {
  connectTimeout:       3000,
  maxRetriesPerRequest: null,   // unlimited retries for subscriber
  enableOfflineQueue:   true,
  retryStrategy: (times) => times <= 3 ? times * 200 : 30000,
};

const pub = new Redis(REDIS_URL, pubOpts);
const sub = new Redis(REDIS_URL, subOpts);

// Log connection events once — suppress repeated ECONNREFUSED spam
let _pubLogged = false, _subLogged = false;
pub.on('connect', () => { _pubLogged = false; console.log('[Redis pub] connected'); });
pub.on('error',   (e) => { if (!_pubLogged) { console.error('[Redis pub] unavailable — retrying silently:', e.message); _pubLogged = true; } });

sub.on('connect', () => { _subLogged = false; console.log('[Redis sub] connected'); });
sub.on('error',   (e) => { if (!_subLogged) { console.error('[Redis sub] unavailable — retrying silently:', e.message); _subLogged = true; } });

module.exports = { pub, sub };
