'use strict';
const { mongoose } = require('../mongoose');

const notificationSchema = new mongoose.Schema({
  id:        { type: Number, required: true, unique: true },
  title:     { type: String, required: true },
  message:   { type: String, required: true },
  hasFile:   { type: Boolean, default: false },
  fileType:  { type: String, default: null },
  fileName:  { type: String, default: null },
  fileData:  { type: Buffer, default: null },   // binary file stored in-document
  seenBy:    { type: [String], default: [] },   // array of userIds who have seen it
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.index({ createdAt: -1 });

const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
module.exports = { Notification };
