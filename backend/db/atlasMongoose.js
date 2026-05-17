'use strict';
// Dedicated Atlas connection — users, subscriptions, sessions only.
// All option-chain/live data stays on local MongoDB (MONGODB_URI).
//
// atlasConn is created synchronously at require-time so models can be
// registered immediately. Mongoose queues DB operations until connected.
const mongoose = require('mongoose');

const ATLAS_URI = process.env.MONGODB_ATLAS_URI;

const atlasConn = ATLAS_URI
  ? mongoose.createConnection(ATLAS_URI, { serverSelectionTimeoutMS: 10000 })
  : null;

if (atlasConn) {
  atlasConn.on('connected',    () => console.log('[Atlas] Connected → socupstock'));
  atlasConn.on('disconnected', () => console.warn('[Atlas] Disconnected'));
  atlasConn.on('reconnected',  () => console.log('[Atlas] Reconnected'));
  atlasConn.on('error',        (e) => console.error('[Atlas] Error:', e.message));
}

// Call on startup to surface any connection errors early
async function connectAtlas() {
  if (!atlasConn) {
    console.warn('[Atlas] MONGODB_ATLAS_URI not set — user data on local MongoDB');
    return;
  }
  await atlasConn.asPromise();
}

module.exports = { connectAtlas, atlasConn, mongoose };
