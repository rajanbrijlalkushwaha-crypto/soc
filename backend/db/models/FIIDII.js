'use strict';
const { mongoose } = require('../mongoose');

const fiiDiiSchema = new mongoose.Schema({
  date:          { type: String, required: true, unique: true }, // 'YYYY-MM-DD'
  fii_buy:       { type: Number, default: 0 },
  fii_sell:      { type: Number, default: 0 },
  fii_net:       { type: Number, default: 0 },
  dii_buy:       { type: Number, default: 0 },
  dii_sell:      { type: Number, default: 0 },
  dii_net:       { type: Number, default: 0 },
  fetchedAt:     { type: Date, default: Date.now },
});

fiiDiiSchema.index({ date: -1 });

const FIIDII = mongoose.models.FIIDII || mongoose.model('FIIDII', fiiDiiSchema);
module.exports = { FIIDII };
