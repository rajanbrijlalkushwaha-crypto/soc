'use strict';
// liveserver1 DB — uncompressed REST API live snapshots.
// One document per symbol. Old data replaced on every fetch cycle.
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  symbol:             { type: String, required: true, unique: true },
  expiry:             String,
  date:               String,
  time:               String,
  spot_price:         { type: Number, default: 0 },
  spot_prev_close:    { type: Number, default: 0 },
  spot_change:        { type: Number, default: 0 },
  spot_pct_change:    { type: Number, default: 0 },
  futures_ltp:        { type: Number, default: 0 },
  futures_prev_close: { type: Number, default: 0 },
  futures_change:     { type: Number, default: 0 },
  futures_pct_change: { type: Number, default: 0 },
  lot_size:           { type: Number, default: 1 },
  chain:              { type: Array,  default: [] },
  chains:             { type: Object, default: {} },
  availableExpiries:  { type: Array,  default: [] },
  currentExpiry:      String,
  nextExpiry:         String,
  isExpiryDay:        { type: Boolean, default: false },
  updatedAt:          { type: Date,   default: Date.now },
}, { timestamps: false, versionKey: false });

schema.index({ symbol: 1 }, { unique: true });

let _model = null;
function getModel() {
  if (_model) return _model;
  const db = mongoose.connection.useDb('liveserver1', { useCache: true });
  _model = db.models.livedata || db.model('livedata', schema);
  return _model;
}

module.exports = { get LiveServer1() { return getModel(); } };
