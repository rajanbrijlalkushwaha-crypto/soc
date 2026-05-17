'use strict';
// One-time migration: local MongoDB → Atlas
// Collections: users, pendingusers, usersubscriptions, subscriptionplans, coupons, sessions
//
// Usage:  node backend/db/migrateToAtlas.js
//         (run from repo root, data/.env must have both MONGODB_URI and MONGODB_ATLAS_URI)

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'data', '.env') });
const mongoose = require('mongoose');

const LOCAL_URI = process.env.MONGODB_URI       || 'mongodb://localhost:27017/socupstock';
const ATLAS_URI = process.env.MONGODB_ATLAS_URI;

if (!ATLAS_URI) {
  console.error('MONGODB_ATLAS_URI not set in data/.env');
  process.exit(1);
}

const COLLECTIONS = [
  'users',
  'pendingusers',
  'usersubscriptions',
  'subscriptionplans',
  'coupons',
  'sessions',
];

// Unique key per collection used for upsert (avoids duplicates on re-run)
const UPSERT_KEY = {
  users:             'userId',
  pendingusers:      'email',
  usersubscriptions: '_id',
  subscriptionplans: '_id',
  coupons:           'code',
  sessions:          '_id',
};

async function migrate() {
  console.log('\n=== SOC — Local → Atlas Migration ===\n');

  console.log('Connecting to local MongoDB...');
  const local = await mongoose.createConnection(LOCAL_URI, { serverSelectionTimeoutMS: 8000 }).asPromise();
  const localDb = local.useDb('socupstock', { useCache: true });
  console.log('Local connected.\n');

  console.log('Connecting to Atlas...');
  const atlas = await mongoose.createConnection(ATLAS_URI, { serverSelectionTimeoutMS: 10000 }).asPromise();
  const atlasDb = atlas.useDb('socupstock', { useCache: true });
  console.log('Atlas connected.\n');

  let totalMigrated = 0;

  for (const col of COLLECTIONS) {
    try {
      const localCol = localDb.collection(col);
      const atlasCol = atlasDb.collection(col);

      const docs = await localCol.find({}).toArray();
      if (docs.length === 0) {
        console.log(`  ${col}: 0 docs — skipped`);
        continue;
      }

      const upsertField = UPSERT_KEY[col];
      let inserted = 0, updated = 0, errors = 0;

      for (const doc of docs) {
        try {
          const filter = upsertField === '_id'
            ? { _id: doc._id }
            : { [upsertField]: doc[upsertField] };

          const result = await atlasCol.replaceOne(filter, doc, { upsert: true });
          if (result.upsertedCount > 0) inserted++;
          else updated++;
        } catch (err) {
          errors++;
          console.warn(`    [${col}] doc error: ${err.message}`);
        }
      }

      console.log(`  ${col}: ${docs.length} docs → inserted ${inserted}, updated ${updated}${errors ? `, errors ${errors}` : ''}`);
      totalMigrated += inserted + updated;
    } catch (err) {
      console.error(`  ${col}: FAILED — ${err.message}`);
    }
  }

  console.log(`\n=== Done — ${totalMigrated} documents migrated ===\n`);

  await local.close();
  await atlas.close();
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
