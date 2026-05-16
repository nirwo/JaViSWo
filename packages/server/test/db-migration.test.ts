import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, closeDb } from '../src/db.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cockpit-db-'));
});

afterEach(() => {
  closeDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('db migrations', () => {
  it('creates the jarvis_sessions table on first open', () => {
    const db = openDb(join(dir, 'state.db'));
    const row = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='jarvis_sessions'`,
      )
      .get();
    expect(row).toBeDefined();
  });

  it('jarvis_sessions has the required columns', () => {
    const db = openDb(join(dir, 'state.db'));
    const cols = db
      .prepare(`PRAGMA table_info(jarvis_sessions)`)
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(['agent_id', 'created_at', 'id', 'last_active']);
  });

  it('adds spawned_by column to agents', () => {
    const db = openDb(join(dir, 'state.db'));
    const cols = db.prepare(`PRAGMA table_info(agents)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('spawned_by');
  });

  it('migration is idempotent — opening twice does not throw', () => {
    const path = join(dir, 'state.db');
    const db1 = openDb(path);
    // Force-close and re-open on the SAME path; openDb caches, so we close first.
    closeDb();
    const db2 = openDb(path);
    expect(db2).toBeDefined();
    // Both DBs are usable references; just check the second open also has the
    // new schema (the test passes if no throw happened during the re-open).
    const row = db2
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='jarvis_sessions'`,
      )
      .get();
    expect(row).toBeDefined();
    // Reference db1 so the linter doesn't complain about an unused binding.
    expect(db1).toBeDefined();
  });

  it('can insert and read back a jarvis_sessions row', () => {
    const db = openDb(join(dir, 'state.db'));
    db.prepare(
      `INSERT INTO agents (id, projectPath, createdAt) VALUES ('agt_x', '/p', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO jarvis_sessions (id, agent_id, created_at, last_active) VALUES (?, ?, ?, ?)`,
    ).run('jarvis', 'agt_x', 100, 200);
    const row = db
      .prepare(`SELECT id, agent_id, created_at, last_active FROM jarvis_sessions`)
      .get() as { id: string; agent_id: string; created_at: number; last_active: number };
    expect(row.id).toBe('jarvis');
    expect(row.agent_id).toBe('agt_x');
    expect(row.last_active).toBe(200);
  });

  it('agents.spawned_by defaults to null and is settable', () => {
    const db = openDb(join(dir, 'state.db'));
    db.prepare(
      `INSERT INTO agents (id, projectPath, createdAt) VALUES ('agt_a', '/p', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO agents (id, projectPath, createdAt, spawned_by) VALUES ('agt_b', '/p', 1, 'jarvis')`,
    ).run();
    const rows = db.prepare(`SELECT id, spawned_by FROM agents ORDER BY id`).all() as Array<{
      id: string;
      spawned_by: string | null;
    }>;
    expect(rows.find((r) => r.id === 'agt_a')?.spawned_by).toBeNull();
    expect(rows.find((r) => r.id === 'agt_b')?.spawned_by).toBe('jarvis');
  });
});
