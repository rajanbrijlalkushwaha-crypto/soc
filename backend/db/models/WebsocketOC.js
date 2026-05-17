const mongoose = require('mongoose');

const websocketOCSchema = new mongoose.Schema({
  symbol:    { type: String, required: true, index: true },
  expiry:    { type: String, required: true },
  ts:        { type: Date,   required: true, default: Date.now },
  spot:      { type: Number, default: 0 },
  spot_chg:  { type: Number, default: 0 },
  fut_ltp:   { type: Number, default: 0 },
  chain: [{
    strike: Number,
    ce: {
      ltp:     Number,
      ltp_chg: Number,
      oi:      Number,
      oi_chg:  Number,
      vol:     Number,
      iv:      Number,
      delta:   Number,
      bid:     Number,
      ask:     Number,
    },
    pe: {
      ltp:     Number,
      ltp_chg: Number,
      oi:      Number,
      oi_chg:  Number,
      vol:     Number,
      iv:      Number,
      delta:   Number,
      bid:     Number,
      ask:     Number,
    },
  }],
}, { timestamps: false, versionKey: false });

websocketOCSchema.index({ ts: 1 }, { expireAfterSeconds: 86400 });
websocketOCSchema.index({ symbol: 1, ts: -1 });

// Lazily get (or create) the model so we don't call useDb at require-time
// before mongoose.connect() has been called.
let _WebsocketOC = null;
function getModel() {
  if (_WebsocketOC) return _WebsocketOC;
  const db = mongoose.connection.useDb('socupstock', { useCache: true });
  _WebsocketOC = db.models.websocketoc || db.model('websocketoc', websocketOCSchema);
  return _WebsocketOC;
}

module.exports = { get WebsocketOC() { return getModel(); } };
