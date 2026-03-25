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

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const redisOpts = {
  connectTimeout:       3000,
  maxRetriesPerRequest: 1,
  enableOfflineQueue:   false,
  retryStrategy: (times) => Math.min(times * 200, 5000), // exponential back-off, max 5 s
};

const pub = new Redis(REDIS_URL, redisOpts);
const sub = new Redis(REDIS_URL, redisOpts);

pub.on('connect', () => console.log('[Redis pub] connected'));
pub.on('error',   (e) => console.error('[Redis pub] error:', e.message));

sub.on('connect', () => console.log('[Redis sub] connected'));
sub.on('error',   (e) => console.error('[Redis sub] error:', e.message));

module.exports = { pub, sub };
