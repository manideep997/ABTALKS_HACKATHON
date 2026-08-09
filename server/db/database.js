'use strict';

const path = require('path');
const fs   = require('fs');

// DB path: prefer DATABASE_PATH env var (set when using a Railway Volume mount,
// e.g. /data/sable.db). Falls back to project root for local dev.
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'sable.db');
const DB_DIR  = path.dirname(DB_PATH);

let db;

// ---------------------------------------------------------------------------
// Unified DB wrapper — abstracts over two drivers:
//   • better-sqlite3  — npm package, works on Node 18+, required on Railway
//   • node:sqlite     — built-in, available on Node 22.5+, used locally
//
// Both are synchronous. We prefer better-sqlite3 if available, because it has
// prebuilt binaries on Linux (Railway) and a stable API.
// ---------------------------------------------------------------------------

function openDatabase() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  // Try better-sqlite3 first (works on Railway Node 18 Linux)
  try {
    const BetterSQLite = require('better-sqlite3');
    const d = new BetterSQLite(DB_PATH);
    d.pragma('journal_mode = WAL');
    d.pragma('foreign_keys = ON');
    console.log(`[DB] SQLite ready (better-sqlite3) at: ${DB_PATH}`);
    // Wrap to match the exec() interface used elsewhere
    return {
      exec: (sql) => d.exec(sql),
      prepare: (sql) => d.prepare(sql),
      _raw: d,
    };
  } catch (e1) {
    if (e1.code !== 'MODULE_NOT_FOUND') throw e1;
  }

  // Fallback: node:sqlite built-in (Node 22.5+, used in local dev)
  try {
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(DB_PATH);
    try { d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;'); } catch (_) {}
    console.log(`[DB] SQLite ready (node:sqlite) at: ${DB_PATH}`);
    return d;
  } catch (e2) {
    throw new Error(
      `No SQLite driver available. Install better-sqlite3 (npm i better-sqlite3) ` +
      `or upgrade to Node 22.5+. Details: ${e2.message}`
    );
  }
}

function getDb() {
  if (!db) {
    db = openDatabase();
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      domain      TEXT NOT NULL,
      voice_notes TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id              TEXT PRIMARY KEY,
      agent_id        TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      text            TEXT NOT NULL,
      rationale       TEXT NOT NULL,
      sources_json    TEXT NOT NULL,
      topic_tags_json TEXT NOT NULL,
      is_mock         INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS seen_topics (
      id            TEXT PRIMARY KEY,
      agent_id      TEXT NOT NULL,
      url           TEXT NOT NULL,
      title         TEXT NOT NULL,
      fingerprint   TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      UNIQUE (agent_id, fingerprint)
    );

    CREATE TABLE IF NOT EXISTS rejected_topics (
      id         TEXT PRIMARY KEY,
      agent_id   TEXT NOT NULL,
      title      TEXT NOT NULL,
      url        TEXT NOT NULL,
      reason     TEXT NOT NULL,
      score      INTEGER NOT NULL,
      scored_at  TEXT NOT NULL
    );

    INSERT OR IGNORE INTO agents (id, name, domain, voice_notes, created_at)
    VALUES ('sable', 'Sable', 'AI & LLM Security Research', 'Skeptical, precise, and technically authoritative.', '2026-08-08T00:00:00.000Z');
  `);
}

module.exports = { getDb };
