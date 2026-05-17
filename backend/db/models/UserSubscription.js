'use strict';
const { atlasConn, mongoose } = require('../atlasMongoose');

const subSchema = new mongoose.Schema({
  userId:            { type: String, required: true, index: true },
  userName:          { type: String, default: '' },
  userEmail:         { type: String, default: '' },
  userMobile:        { type: String, default: '' },
  planId:            { type: mongoose.Schema.Types.ObjectId },
  planName:          { type: String, default: '' },
  durationDays:      { type: Number, default: 30 },
  startDate:         { type: Date, required: true },
  endDate:           { type: Date, required: true },
  status:            { type: String, enum: ['active', 'expired', 'cancelled', 'pending'], default: 'pending' },
  razorpayOrderId:   { type: String, default: '' },
  razorpayPaymentId: { type: String, default: '' },
  razorpaySignature: { type: String, default: '' },
  originalAmount:    { type: Number, default: 0 },
  discountAmount:    { type: Number, default: 0 },
  amountPaid:        { type: Number, default: 0 },
  couponCode:        { type: String, default: '' },
  currency:          { type: String, default: 'INR' },
}, { timestamps: true });

subSchema.index({ userId: 1, status: 1 });
subSchema.index({ endDate: 1 });

let _UserSubscription = null;

module.exports = {
  get UserSubscription() {
    if (_UserSubscription) return _UserSubscription;
    if (!atlasConn) throw new Error('[Atlas] MONGODB_ATLAS_URI not set');
    _UserSubscription = atlasConn.models.UserSubscription || atlasConn.model('UserSubscription', subSchema);
    return _UserSubscription;
  },
};
