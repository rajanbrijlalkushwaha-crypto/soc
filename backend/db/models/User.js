'use strict';
const { atlasConn, mongoose } = require('../atlasMongoose');

const preferencesSchema = new mongoose.Schema({
  ltpDisplay:    { type: Boolean, default: true },
  volumeDisplay: { type: Boolean, default: true },
  oiDisplay:     { type: Boolean, default: true },
  greeksDisplay: { type: Boolean, default: false },
  mmiDisplay:    { type: Boolean, default: false },
  theme:         { type: String, default: 'white' },
}, { _id: false, strict: false });

const userSchema = new mongoose.Schema({
  userId:     { type: String, required: true, unique: true, index: true },
  name:       { type: String, required: true },
  firstName:  { type: String, default: '' },
  lastName:   { type: String, default: '' },
  mobile:     { type: String, default: '' },
  city:       { type: String, default: '' },
  email:      { type: String, required: true, unique: true, lowercase: true, index: true },
  password:   { type: String, required: true },
  verified:   { type: Boolean, default: false },
  role:       { type: String, enum: ['admin', 'member', 'user'], default: 'user' },
  verifiedAt: { type: Date, default: null },
  createdAt:  { type: Date, default: Date.now },
  preferences:{ type: preferencesSchema, default: () => ({}) },
  hasPhoto:   { type: Boolean, default: false },
  otp:        { type: String, default: null },
  otpExpiry:  { type: Date, default: null },
  resetToken: { type: String, default: null },
  resetTokenExpiry: { type: Date, default: null },
  activeSessionId: { type: String, default: null },
}, { strict: false });

const pendingUserSchema = new mongoose.Schema({
  email:     { type: String, required: true, unique: true, index: true },
  emailHash: { type: String, required: true, unique: true },
  name:      { type: String },
  password:  { type: String },
  otp:       { type: String },
  otpExpiry: { type: Date },
  createdAt: { type: Date, default: Date.now },
}, { strict: false });

pendingUserSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

let _User = null;
let _PendingUser = null;

module.exports = {
  get User() {
    if (_User) return _User;
    if (!atlasConn) throw new Error('[Atlas] MONGODB_ATLAS_URI not set');
    _User = atlasConn.models.User || atlasConn.model('User', userSchema);
    return _User;
  },
  get PendingUser() {
    if (_PendingUser) return _PendingUser;
    if (!atlasConn) throw new Error('[Atlas] MONGODB_ATLAS_URI not set');
    _PendingUser = atlasConn.models.PendingUser || atlasConn.model('PendingUser', pendingUserSchema);
    return _PendingUser;
  },
};
