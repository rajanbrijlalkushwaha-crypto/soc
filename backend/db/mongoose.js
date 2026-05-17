'use strict';

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/socupstock';

let _connected = false;

async function connectDB() {
  if (_connected) return;
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    _connected = true;
    console.log(`[MongoDB] Connected → ${MONGO_URI.replace(/\/\/.*@/, '//***@')}`);
  } catch (err) {
    console.error('[MongoDB] Connection failed:', err.message);
    throw err;
  }
}

mongoose.connection.on('disconnected', () => {
  _connected = false;
  console.warn('[MongoDB] Disconnected — will reconnect on next operation');
});

mongoose.connection.on('reconnected', () => {
  _connected = true;
  console.log('[MongoDB] Reconnected');
});

module.exports = { connectDB, mongoose };
