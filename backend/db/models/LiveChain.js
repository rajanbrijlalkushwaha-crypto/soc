const mongoose = require('mongoose');

// Uncompressed latest snapshot per symbol.
// One document per symbol — upserted (replaced) on every data cycle.
// Old data is wiped when new data arrives. Used for live market serving.
const liveChainSchema = new mongoose.Schema({
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
  updatedAt:          { type: Date, default: Date.now },
}, { timestamps: false, versionKey: false });

liveChainSchema.index({ symbol: 1 }, { unique: true });

let _LiveChain = null;
function getModel() {
  if (_LiveChain) return _LiveChain;
  const db = mongoose.connection.useDb('socupstock', { useCache: true });
  _LiveChain = db.models.livechain || db.model('livechain', liveChainSchema);
  return _LiveChain;
}

module.exports = { get LiveChain() { return getModel(); } };
