'use strict';
const zlib     = require('zlib');
const { mongoose } = require('../mongoose');

// Each document = one option chain snapshot.
// Payload (m / a / oc) is stored gzip-compressed in the `gz` Buffer field.
// Old documents (before compression was added) still carry raw m/a/oc fields —
// unpackDoc() handles both transparently.

const optionChainSchema = new mongoose.Schema({
  symbol: { type: String, required: true },  // e.g. "NIFTY_50"
  expiry: { type: String, required: true },  // "2026-05-29"
  date:   { type: String, required: true },  // "2026-05-14" (IST)
  time:   { type: String, required: true },  // "09:15:30"
  ts:     { type: Date,   required: true },  // combined IST datetime for range queries
  gz:     { type: Buffer },                  // gzipSync(JSON({m,a,oc}))
}, { strict: true });

optionChainSchema.index({ symbol: 1, ts: -1 });
optionChainSchema.index({ symbol: 1, expiry: 1, date: 1, ts: 1 });

const OptionChain = mongoose.models.OptionChain || mongoose.model('OptionChain', optionChainSchema);

/**
 * Decompress the gz field back into doc.m / doc.a / doc.oc.
 * Falls back gracefully for old documents that stored m/a/oc as raw Mixed fields.
 */
function unpackDoc(doc) {
  if (!doc) return null;
  if (doc.gz) {
    try {
      const buf = Buffer.isBuffer(doc.gz) ? doc.gz : Buffer.from(doc.gz.buffer || doc.gz);
      const { m, a, oc } = JSON.parse(zlib.gunzipSync(buf));
      doc.m = m; doc.a = a; doc.oc = oc;
    } catch (_) {}
  }
  return doc;
}

module.exports = { OptionChain, unpackDoc };
