'use strict';
const { socuptickConn } = require('../socuptickMongoose');

const fiiDiiSchema = new socuptickConn.base.Schema({
  date:      { type: String, required: true, unique: true }, // 'YYYY-MM-DD'
  fii_buy:   { type: Number, default: 0 },  // ₹ Crore (NSE_EQ|CASH)
  fii_sell:  { type: Number, default: 0 },
  fii_net:   { type: Number, default: 0 },
  dii_buy:   { type: Number, default: 0 },
  dii_sell:  { type: Number, default: 0 },
  dii_net:   { type: Number, default: 0 },
  fetchedAt: { type: Date, default: Date.now },
});

fiiDiiSchema.index({ date: -1 });

// Use socuptick connection — saves to "socuptick" database, "fiidiis" collection
const FIIDII = socuptickConn.models.FIIDII || socuptickConn.model('FIIDII', fiiDiiSchema);
module.exports = { FIIDII };
