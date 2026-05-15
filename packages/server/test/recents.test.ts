import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { RecentsStore } from '../src/recents.js';

function freshDb(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE recents (path TEXT PRIMARY KEY, ts INTEGER NOT NULL, seq INTEGER NOT NULL DEFAULT 0);`);
  return d;
}

function makeStore(cap?: number): RecentsStore {
  return new RecentsStore(freshDb(), cap);
}

describe('RecentsStore', () => {
  it('starts empty when db is fresh', () => {
    const store = makeStore();
    expect(store.list()).toEqual([]);
  });

  it('add() puts new entry at front', () => {
    const store = makeStore();
    store.add('/a');
    store.add('/b');
    const list = store.list();
    expect(list[0].path).toBe('/b');
    expect(list[1].path).toBe('/a');
  });

  it('add() dedupes and moves existing path to front with updated ts', () => {
    const store = makeStore();
    store.add('/a');
    const tsBefore = store.list()[0].ts;
    store.add('/b');
    store.add('/a');
    const list = store.list();
    expect(list[0].path).toBe('/a');
    expect(list[0].ts).toBeGreaterThanOrEqual(tsBefore);
    expect(list.filter((e) => e.path === '/a')).toHaveLength(1);
  });

  it('enforces cap (cap=2, add 3 entries, only 2 remain)', () => {
    const store = makeStore(2);
    store.add('/a');
    store.add('/b');
    store.add('/c');
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0].path).toBe('/c');
    expect(list[1].path).toBe('/b');
  });

  it('persists across RecentsStore instances on the same db', () => {
    const d = freshDb();
    const s1 = new RecentsStore(d, 10);
    s1.add('/persisted');
    s1.add('/second');

    // Re-instantiate on the same db handle (simulates server restart with shared db)
    const s2 = new RecentsStore(d, 10);
    const list = s2.list();
    expect(list[0].path).toBe('/second');
    expect(list[1].path).toBe('/persisted');
  });

  it('migrates legacy JSON file into the db and renames it', () => {
    const legacyPath = join(tmpdir(), `recents-legacy-${randomUUID()}.json`);
    mkdirSync(tmpdir(), { recursive: true });
    writeFileSync(
      legacyPath,
      JSON.stringify([
        { path: '/legacy-a', ts: 1000 },
        { path: '/legacy-b', ts: 2000 },
      ]),
      'utf-8',
    );

    const d = freshDb();
    const store = new RecentsStore(d, 10, legacyPath);
    const list = store.list();
    expect(list.map((e) => e.path)).toContain('/legacy-a');
    expect(list.map((e) => e.path)).toContain('/legacy-b');

    // Legacy file should have been renamed
    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(legacyPath + '.migrated')).toBe(true);
  });
});
