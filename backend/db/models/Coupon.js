'use strict';
const { atlasConn, mongoose } = require('../atlasMongoose');

const couponSchema = new mongoose.Schema({
  code:          { type: String, required: true, unique: true, uppercase: true, trim: true },
  type:          { type: String, enum: ['percent', 'flat'], required: true },
  value:         { type: Number, required: true },
  maxUses:       { type: Number, default: 0 },
  usedCount:     { type: Number, default: 0 },
  validFrom:     { type: Date, default: Date.now },
  validUntil:    { type: Date, default: null },
  isActive:      { type: Boolean, default: true },
  description:   { type: String, default: '' },
  createdBy:     { type: String, default: 'admin' },
}, { timestamps: true });

let _Coupon = null;

module.exports = {
  get Coupon() {
    if (_Coupon) return _Coupon;
    if (!atlasConn) throw new Error('[Atlas] MONGODB_ATLAS_URI not set');
    _Coupon = atlasConn.models.Coupon || atlasConn.model('Coupon', couponSchema);
    return _Coupon;
  },
};
