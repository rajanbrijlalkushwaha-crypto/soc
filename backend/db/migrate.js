#!/usr/bin/env node
// backend/db/migrate.js
// One-time migration: imports existing JSON files into MongoDB.
// Run once: node backend/db/migrate.js
// Safe to re-run — uses upsert so duplicates are skipped.

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../data/.env') });

const fs   = require('fs');
const path = require('path');
const { connectDB, mongoose } = require('./mongoose');
const { User }         = require('./models/User');
const { Notification } = require('./models/Notification');
const { Team }         = require('./models/Team');

const { PATHS } = require('../config/paths');

async function migrateUsers() {
  const USERS_DIR = PATHS.USERS;
  const files = fs.existsSync(USERS_DIR)
    ? fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'))
    : [];

  let imported = 0, skipped = 0;
  for (const file of files) {
    try {
      const u = JSON.parse(fs.readFileSync(path.join(USERS_DIR, file), 'utf8'));
      if (!u.userId || !u.email) { skipped++; continue; }

      // Check photo on disk
      const photoPath = path.join(USERS_DIR, 'photo', `${u.userId}.jpg`);
      if (fs.existsSync(photoPath)) u.hasPhoto = true;

      await User.findOneAndUpdate(
        { userId: u.userId },
        { $set: u },
        { upsert: true, returnDocument: 'after' }
      );
      imported++;
    } catch (e) {
      console.error(`  ✗ user ${file}: ${e.message}`);
      skipped++;
    }
  }
  console.log(`Users:         ${imported} imported, ${skipped} skipped`);
}

async function migrateNotifications() {
  const NOTIF_DIR      = PATHS.NOTIFICATIONS;
  const NOTIF_SEEN_DIR = path.join(NOTIF_DIR, 'seen');

  if (!fs.existsSync(NOTIF_DIR)) {
    console.log('Notifications: directory not found, skipped');
    return;
  }

  // Build a map of userId → { notifId: seenCount }
  const seenMap = {};
  if (fs.existsSync(NOTIF_SEEN_DIR)) {
    for (const f of fs.readdirSync(NOTIF_SEEN_DIR).filter(f => f.endsWith('.json'))) {
      const uid = f.replace('.json', '');
      try {
        seenMap[uid] = JSON.parse(fs.readFileSync(path.join(NOTIF_SEEN_DIR, f), 'utf8'));
      } catch {}
    }
  }

  const files = fs.readdirSync(NOTIF_DIR).filter(f => /^notif\d+\.json$/.test(f));
  let imported = 0, skipped = 0;

  for (const file of files) {
    try {
      const n = JSON.parse(fs.readFileSync(path.join(NOTIF_DIR, file), 'utf8'));
      if (!n.id) { skipped++; continue; }

      // Build seenBy list — users who have seen this notification at least once
      const seenBy = Object.entries(seenMap)
        .filter(([, counts]) => (counts[String(n.id)] || 0) > 0)
        .map(([uid]) => uid);

      // Read file attachment if present
      const filePath = path.join(NOTIF_DIR, `notif${n.id}file`);
      const fileData = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;

      await Notification.findOneAndUpdate(
        { id: n.id },
        {
          $set: {
            id:        n.id,
            title:     n.title   || '',
            message:   n.message || '',
            hasFile:   !!fileData,
            fileType:  n.fileType  || null,
            fileName:  n.fileName  || null,
            fileData:  fileData    || null,
            seenBy,
            createdAt: n.createdAt ? new Date(n.createdAt) : new Date(),
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
      imported++;
    } catch (e) {
      console.error(`  ✗ notif ${file}: ${e.message}`);
      skipped++;
    }
  }
  console.log(`Notifications: ${imported} imported, ${skipped} skipped`);
}

async function migrateTeam() {
  const TEAM_DIR = PATHS.TEAM;
  if (!fs.existsSync(TEAM_DIR)) {
    console.log('Team:          directory not found, skipped');
    return;
  }

  const files = fs.readdirSync(TEAM_DIR).filter(f => /^card\d+\.json$/.test(f));
  let imported = 0, skipped = 0;

  for (const file of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(TEAM_DIR, file), 'utf8'));
      if (!m.id) { skipped++; continue; }

      const photoPath = path.join(TEAM_DIR, `card${m.id}photo`);
      const photoData = fs.existsSync(photoPath) ? fs.readFileSync(photoPath) : null;

      await Team.findOneAndUpdate(
        { id: m.id },
        {
          $set: {
            id:          m.id,
            name:        m.name        || '',
            designation: m.designation || '',
            experience:  m.experience  || '',
            hasPhoto:    !!photoData,
            photoData:   photoData || null,
            photoMime:   photoData ? 'image/jpeg' : null,
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
      imported++;
    } catch (e) {
      console.error(`  ✗ team ${file}: ${e.message}`);
      skipped++;
    }
  }
  console.log(`Team:          ${imported} imported, ${skipped} skipped`);
}

async function main() {
  console.log('=== SOC MongoDB Migration ===');
  console.log(`Target: ${process.env.MONGODB_URI || 'mongodb://localhost:27017/socupstock'}`);
  console.log('');

  await connectDB();

  await migrateUsers();
  await migrateNotifications();
  await migrateTeam();

  console.log('');
  console.log('Migration complete.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
