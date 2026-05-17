'use strict';
const { mongoose } = require('../mongoose');

const teamSchema = new mongoose.Schema({
  id:          { type: Number, required: true, unique: true },
  name:        { type: String, required: true },
  designation: { type: String, default: '' },
  experience:  { type: String, default: '' },
  hasPhoto:    { type: Boolean, default: false },
  photoData:   { type: Buffer, default: null },  // binary photo stored in-document
  photoMime:   { type: String, default: null },  // e.g. 'image/jpeg'
  createdAt:   { type: Date, default: Date.now },
});

const Team = mongoose.models.Team || mongoose.model('Team', teamSchema);
module.exports = { Team };
