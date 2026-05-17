'use strict';
const { mongoose } = require('../mongoose');

// Generic key-value config store.
// key examples: 'instruments', 'schedule', 'upstox_apps',
//               'indicator_access', 'marketholiday', 'markettiming'
const configSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true, index: true },
  value:     { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now },
});

// Helper statics so callers don't have to know the schema
configSchema.statics.get = async function(key) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : null;
};

configSchema.statics.set = async function(key, value) {
  return this.findOneAndUpdate(
    { key },
    { value, updatedAt: new Date() },
    { upsert: true, returnDocument: 'after' }
  );
};

const Config = mongoose.models.Config || mongoose.model('Config', configSchema);
module.exports = { Config };
