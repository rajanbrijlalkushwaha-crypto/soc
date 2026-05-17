'use strict';
// websockettickdata collection — compressed WS tick history in socupstock DB.
// One document per tick per symbol (throttled to every 5s).
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  symbol:   { type: String, index: true },
  expiry:   String,
  ts:       { type: Date,   index: true },
  spot:     Number,
  spot_chg: Number,
  fut_ltp:  Number,
  chainGz:  Buffer,   // gzip-compressed JSON of the chain array
}, { timestamps: false, versionKey: false });

schema.index({ symbol: 1, ts: -1 });

let _model = null;
function getModel() {
  if (_model) return _model;
  const db = mongoose.connection.useDb('socupstock', { useCache: true });
  _model = db.models.websockettickdata || db.model('websockettickdata', schema);
  return _model;
}

module.exports = { get WebSocketTickData() { return getModel(); } };
