import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { RecentsStore } from '../src/recents.js';

function tempFile(): string {
  return join(tmpdir(), `recents-test-${randomUUID()}.json`);
}

const filePaths: string[] = [];

function makeStore(cap?: number): { store: RecentsStore; filePath: string } {
  const filePath = tempFile();
  filePaths.push(filePath);
  return { store: new RecentsStore(filePath, cap), filePath };
}

afterEach(() => {
  for (const fp of filePaths.splice(0)) {
    if (existsSync(fp)) rmSync(fp);
  }
});

describe('RecentsStore', () => {
  it('starts empty when file does not exist', () => {
    const { store } = makeStore();
    expect(store.list()).toEqual([]);
  });

  it('add() puts new entry at front', () => {
    const { store } = makeStore();
    store.add('/a');
    store.add('/b');
    const list = store.list();
    expect(list[0].path).toBe('/b');
    expect(list[1].path).toBe('/a');
  });

  it('add() dedupes and moves existing path to front with updated ts', () => {
    const { store } = makeStore();
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
    const { store } = makeStore(2);
    store.add('/a');
    store.add('/b');
    store.add('/c');
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0].path).toBe('/c');
    expect(list[1].path).toBe('/b');
  });

  it('persists to disk and loads on construction', () => {
    const filePath = tempFile();
    filePaths.push(filePath);
    const s1 = new RecentsStore(filePath, 10);
    s1.add('/persisted');
    s1.add('/second');

    const s2 = new RecentsStore(filePath, 10);
    const list = s2.list();
    expect(list[0].path).toBe('/second');
    expect(list[1].path).toBe('/persisted');
  });

  it('handles corrupt file gracefully (starts fresh)', () => {
    const filePath = tempFile();
    filePaths.push(filePath);
    mkdirSync(join(tmpdir()), { recursive: true });
    writeFileSync(filePath, '{ not valid json !!!', 'utf-8');

    const store = new RecentsStore(filePath, 10);
    expect(store.list()).toEqual([]);
  });
});
