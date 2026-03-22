/**
 * backend/config/paths.js
 *
 * Single source of truth for ALL file system paths.
 * Backend code must import from here — never hardcode paths.
 *
 * Usage:
 *   const { PATHS } = require('./config/paths');
 *   const file = path.join(PATHS.USERS, 'userdb.json');
 */

'use strict';

const path = require('path');

// ── Root anchors ──────────────────────────────────────────────────────────────
// DATA_ROOT is read from .env so the same code works locally and on production.
//   Local:       DATA_ROOT=/Users/admin/Desktop/socforubunut/data
//   Production:  DATA_ROOT=/home/ubuntu/soc/data
const PROJECT_ROOT = path.resolve(__dirname, '../../');          // socforubunut/
const DATA_ROOT    = process.env.DATA_ROOT
                       ? path.resolve(process.env.DATA_ROOT)
                       : path.join(PROJECT_ROOT, 'data');        // fallback

// ── Path map ──────────────────────────────────────────────────────────────────
const PATHS = {
  // ── Project roots ──
  PROJECT:    PROJECT_ROOT,
  DATA:       DATA_ROOT,
  BACKEND:    path.join(PROJECT_ROOT, 'backend'),
  FRONTEND:   path.join(PROJECT_ROOT, 'frontend'),

  // ── Data sub-folders ──
  MARKET:     path.join(DATA_ROOT, 'market'),       // option chain snapshots, .json.gz
  USERS:      path.join(DATA_ROOT, 'users'),         // userdb.json, profile JSONs, photos
  PENDING:    path.join(DATA_ROOT, 'users', 'pending'),
  TEAM:       path.join(DATA_ROOT, 'team'),          // teammember cards + photos
  SESSIONS:   path.join(DATA_ROOT, 'sessions'),      // express-session files
  LOGS:       path.join(DATA_ROOT, 'logs'),
  CONFIG:     path.join(DATA_ROOT, 'config'),        // runtime JSON configs

  NOTIFICATIONS: path.join(DATA_ROOT, 'notifications'),

  // ── Runtime config files ──
  ENV_FILE:         path.join(DATA_ROOT, '.env'),
  SCHEDULE:         path.join(DATA_ROOT, 'config', 'schedule.json'),
  MARKET_HOLIDAY:   path.join(DATA_ROOT, 'config', 'marketholiday.json'),
  MARKET_TIMING:    path.join(DATA_ROOT, 'config', 'markettiming.json'),
  UPSTOX_APPS:      path.join(DATA_ROOT, 'config', 'upstox_apps.json'),
  INDICATOR_ACCESS: path.join(DATA_ROOT, 'config', 'indicator_access.json'),
};

// ── Auto-create all directories on first require ──────────────────────────────
const fs = require('fs');
const dirsToEnsure = [
  PATHS.MARKET, PATHS.USERS, PATHS.PENDING, PATHS.TEAM,
  PATHS.SESSIONS, PATHS.LOGS, PATHS.CONFIG,
];
for (const dir of dirsToEnsure) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[paths] created: ${dir}`);
  }
}

module.exports = { PATHS, DATA_ROOT, PROJECT_ROOT };
