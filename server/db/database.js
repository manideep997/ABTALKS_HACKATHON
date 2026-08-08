'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// DB file lives at the project root so it survives server restarts on
// Railway/Render persistent disk. NOT committed to source control (.gitignore).
const DB_DIR = path.join(__dirname, '..', '..');
const DB_PATH = path.join(DB_DIR, 'sable.db');

let db;

function getDb() {
  if (!db) {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    db = new DatabaseSync(DB_PATH);
    // WAL mode optimization if supported by runtime pragmas
    try {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA foreign_keys = ON;');
    } catch (_e) {
      // Ignored if pragmas differ on embedded sqlite engine
    }
    initSchema();
    console.log(`[DB] SQLite database ready (via node:sqlite) at: ${DB_PATH}`);
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- Agent identity row (one per persona)
    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      domain      TEXT NOT NULL,
      voice_notes TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    -- Published posts
    CREATE TABLE IF NOT EXISTS posts (
      id              TEXT PRIMARY KEY,
      agent_id        TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      text            TEXT NOT NULL,
      rationale       TEXT NOT NULL,
      sources_json    TEXT NOT NULL,   -- JSON array of { title, url }
      topic_tags_json TEXT NOT NULL,  -- JSON array of strings
      is_mock         INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    -- Deduplication: topics already ingested (by URL fingerprint)
    CREATE TABLE IF NOT EXISTS seen_topics (
      id            TEXT PRIMARY KEY,
      agent_id      TEXT NOT NULL,
      url           TEXT NOT NULL,
      title         TEXT NOT NULL,
      fingerprint   TEXT NOT NULL,   -- normalized lowercased title hash for fuzzy dedup
      first_seen_at TEXT NOT NULL,
      UNIQUE (agent_id, fingerprint)
    );

    -- Editorial rejection log: topics judged but declined
    CREATE TABLE IF NOT EXISTS rejected_topics (
      id         TEXT PRIMARY KEY,
      agent_id   TEXT NOT NULL,
      title      TEXT NOT NULL,
      url        TEXT NOT NULL,
      reason     TEXT NOT NULL,
      score      INTEGER NOT NULL,
      scored_at  TEXT NOT NULL
    );
  `);
}

module.exports = { getDb };
