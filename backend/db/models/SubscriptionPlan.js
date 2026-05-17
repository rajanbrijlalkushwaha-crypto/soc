'use strict';
const { atlasConn, mongoose } = require('../atlasMongoose');

const planSchema = new mongoose.Schema({
  name:           { type: String, required: true },
  price:          { type: Number, required: true },
  communityPrice: { type: Number, default: null },
  durationDays:   { type: Number, required: true },
  category:       { type: String, default: 'Regular', enum: ['Regular', 'Advance', 'Courses'] },
  description:    { type: String, default: '' },
  features:       [{ type: String }],
  isActive:       { type: Boolean, default: true },
  badge:          { type: String, default: '' },
  sortOrder:      { type: Number, default: 0 },
}, { timestamps: true });

let _SubscriptionPlan = null;

module.exports = {
  get SubscriptionPlan() {
    if (_SubscriptionPlan) return _SubscriptionPlan;
    if (!atlasConn) throw new Error('[Atlas] MONGODB_ATLAS_URI not set');
    _SubscriptionPlan = atlasConn.models.SubscriptionPlan || atlasConn.model('SubscriptionPlan', planSchema);
    return _SubscriptionPlan;
  },
};
