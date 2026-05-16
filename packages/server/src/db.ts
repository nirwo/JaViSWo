import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let db: Database.Database | null = null;

export function openDb(path: string): Database.Database {
  if (db) return db;
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function applyMigrations(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id            TEXT PRIMARY KEY,
      projectPath   TEXT NOT NULL,
      createdAt     INTEGER NOT NULL,
      firstPrompt   TEXT NOT NULL DEFAULT '',
      turn          INTEGER NOT NULL DEFAULT 1,
      sessionId     TEXT,
      seqCounter    INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'idle'
    );
    CREATE TABLE IF NOT EXISTS envelopes (
      agentId         TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      seq             INTEGER NOT NULL,
      ts              INTEGER NOT NULL,
      kind            TEXT NOT NULL,
      parentToolUseId TEXT,
      sessionId       TEXT,
      payload         TEXT NOT NULL,
      PRIMARY KEY (agentId, seq)
    );
    CREATE INDEX IF NOT EXISTS envelopes_agent_seq ON envelopes(agentId, seq);
    CREATE TABLE IF NOT EXISTS recents (
      path TEXT PRIMARY KEY,
      ts   INTEGER NOT NULL,
      seq  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS jarvis_sessions (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      last_active INTEGER NOT NULL
    );
  `);

  // Additive migrations: safe to re-run (ALTER TABLE IF NOT EXISTS col is not
  // supported by sqlite, so we try/catch each one individually).
  const addColumnIfMissing = (table: string, col: string, def: string): void => {
    try {
      d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch {
      // Column already exists — ignore.
    }
  };
  addColumnIfMissing('recents', 'seq', 'INTEGER NOT NULL DEFAULT 0');
  // M3.5: tag agents JARVIS spawned so the UI can badge them.
  addColumnIfMissing('agents', 'spawned_by', 'TEXT');
}
