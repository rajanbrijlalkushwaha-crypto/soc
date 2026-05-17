'use strict';
// Dedicated connection to the "socuptick" database (market activity: FII/DII, etc.)
const mongoose = require('mongoose');

// Derive socuptick URI from existing MONGODB_URI — swap only the DB name
const base = process.env.MONGODB_URI || 'mongodb://localhost:27017/socupstock';
const SOCUPTICK_URI = process.env.SOCUPTICK_URI || base.replace(/\/([^/?]+)(\?|$)/, '/socuptick$2');

const socuptickConn = mongoose.createConnection(SOCUPTICK_URI, {
  serverSelectionTimeoutMS: 10000,
});

socuptickConn.on('connected',    () => console.log(`[socuptick] Connected → ${SOCUPTICK_URI}`));
socuptickConn.on('disconnected', () => console.warn('[socuptick] Disconnected'));
socuptickConn.on('reconnected',  () => console.log('[socuptick] Reconnected'));
socuptickConn.on('error',        (e) => console.error('[socuptick] Error:', e.message));

async function connectSocuptick() {
  await socuptickConn.asPromise();
}

module.exports = { socuptickConn, connectSocuptick };
