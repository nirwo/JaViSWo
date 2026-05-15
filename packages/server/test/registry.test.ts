import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import type { Envelope } from '@cockpit/shared';

const e = (agentId: string, seq: number, kind: Envelope['kind'] = 'text'): Envelope => ({
  v: 1, agentId, seq, ts: seq * 100, kind, payload: { text: `m${seq}` },
});

function freshDb(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE agents (
      id            TEXT PRIMARY KEY,
      projectPath   TEXT NOT NULL,
      createdAt     INTEGER NOT NULL,
      firstPrompt   TEXT NOT NULL DEFAULT '',
      turn          INTEGER NOT NULL DEFAULT 1,
      sessionId     TEXT,
      seqCounter    INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'idle'
    );
    CREATE TABLE envelopes (
      agentId         TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      seq             INTEGER NOT NULL,
      ts              INTEGER NOT NULL,
      kind            TEXT NOT NULL,
      parentToolUseId TEXT,
      sessionId       TEXT,
      payload         TEXT NOT NULL,
      PRIMARY KEY (agentId, seq)
    );
    CREATE TABLE recents (path TEXT PRIMARY KEY, ts INTEGER NOT NULL);
  `);
  return d;
}

let reg: AgentRegistry;
beforeEach(() => { reg = new AgentRegistry(freshDb(), { tailCap: 4 }); });

describe('AgentRegistry', () => {
  it('assigns unique monotonic agent IDs', () => {
    const a = reg.create({ projectPath: '/p' });
    const b = reg.create({ projectPath: '/p' });
    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(/^agt_/);
  });

  it('emits monotonic per-agent seq from nextSeq()', () => {
    const a = reg.create({ projectPath: '/p' });
    expect(a.nextSeq()).toBe(0);
    expect(a.nextSeq()).toBe(1);
    expect(a.nextSeq()).toBe(2);
  });

  it('records envelopes; tail() returns oldest N when limited by tailCap', () => {
    const a = reg.create({ projectPath: '/p' });
    reg.record(e(a.id, 0));
    reg.record(e(a.id, 1));
    reg.record(e(a.id, 2));
    reg.record(e(a.id, 3));
    reg.record(e(a.id, 4));
    const tail = reg.tail(a.id, -1);
    // sqlite ORDER BY seq LIMIT 4 returns the FIRST (oldest) 4 from sinceSeq+1.
    // All 5 are stored; tailCap=4 is a read-time cap, not a write eviction cap.
    expect(tail.map((x) => x.seq)).toEqual([0, 1, 2, 3]);
  });

  it('tail(agentId, sinceSeq) returns envelopes with seq > sinceSeq', () => {
    const a = reg.create({ projectPath: '/p' });
    [0, 1, 2, 3].forEach((s) => reg.record(e(a.id, s)));
    expect(reg.tail(a.id, 1).map((x) => x.seq)).toEqual([2, 3]);
  });

  it('list() returns all known agents', () => {
    const a = reg.create({ projectPath: '/p1' });
    const b = reg.create({ projectPath: '/p2' });
    const ids = reg.list().map((x) => x.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).toHaveLength(2);
  });

  it('get(unknownId) returns undefined; record(unknownId) is a noop', () => {
    expect(reg.get('agt_fake')).toBeUndefined();
    expect(() => reg.record(e('agt_fake', 0))).not.toThrow();
  });

  it('setSessionId / sessionIdFor store and retrieve a session ID; unknown agentId returns undefined', () => {
    const a = reg.create({ projectPath: '/p' });
    expect(reg.sessionIdFor(a.id)).toBeUndefined();
    reg.setSessionId(a.id, 'sess_abc123');
    expect(reg.sessionIdFor(a.id)).toBe('sess_abc123');
    // unknown agentId is safe
    reg.setSessionId('agt_ghost', 'sess_noop'); // should not throw
    expect(reg.sessionIdFor('agt_ghost')).toBeUndefined();
  });

  it('nextSeqFor continues the same counter as the handle nextSeq', () => {
    const a = reg.create({ projectPath: '/p' });
    // handle's nextSeq() and registry's nextSeqFor() share the same DB counter
    expect(a.nextSeq()).toBe(0);
    expect(a.nextSeq()).toBe(1);
    expect(reg.nextSeqFor(a.id)).toBe(2);
    expect(reg.nextSeqFor(a.id)).toBe(3);
    expect(a.nextSeq()).toBe(4);
  });

  it('persists agents and envelopes across registry instances (the M2 promise)', () => {
    const d = freshDb();
    let reg2 = new AgentRegistry(d);
    const a = reg2.create({ projectPath: '/p' });
    reg2.record({ v: 1, agentId: a.id, seq: 0, ts: 100, kind: 'text', payload: { text: 'hi' } });
    // Recreate the registry on the SAME db handle (simulating server restart)
    reg2 = new AgentRegistry(d);
    expect(reg2.get(a.id)?.projectPath).toBe('/p');
    expect(reg2.tail(a.id, -1).map((env) => env.payload)).toEqual([{ text: 'hi' }]);
  });
});
