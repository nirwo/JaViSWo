import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../src/registry.js';
import type { Envelope } from '@cockpit/shared';

const e = (agentId: string, seq: number, kind: Envelope['kind'] = 'text'): Envelope => ({
  v: 1, agentId, seq, ts: seq * 100, kind, payload: { text: `m${seq}` },
});

let reg: AgentRegistry;
beforeEach(() => { reg = new AgentRegistry({ tailCap: 4 }); });

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

  it('records envelopes into a per-agent tail buffer up to tailCap', () => {
    const a = reg.create({ projectPath: '/p' });
    reg.record(e(a.id, 0));
    reg.record(e(a.id, 1));
    reg.record(e(a.id, 2));
    reg.record(e(a.id, 3));
    reg.record(e(a.id, 4));
    const tail = reg.tail(a.id, -1);
    expect(tail.map((x) => x.seq)).toEqual([1, 2, 3, 4]); // tailCap=4 drops seq=0
  });

  it('tail(agentId, sinceSeq) returns envelopes with seq > sinceSeq', () => {
    const a = reg.create({ projectPath: '/p' });
    [0, 1, 2, 3].forEach((s) => reg.record(e(a.id, s)));
    expect(reg.tail(a.id, 1).map((x) => x.seq)).toEqual([2, 3]);
  });

  it('list() returns all known agents in creation order', () => {
    const a = reg.create({ projectPath: '/p1' });
    const b = reg.create({ projectPath: '/p2' });
    expect(reg.list().map((x) => x.id)).toEqual([a.id, b.id]);
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
    // handle's nextSeq() and registry's nextSeqFor() share the same entry.seq counter
    expect(a.nextSeq()).toBe(0);
    expect(a.nextSeq()).toBe(1);
    expect(reg.nextSeqFor(a.id)).toBe(2);
    expect(reg.nextSeqFor(a.id)).toBe(3);
    expect(a.nextSeq()).toBe(4);
  });
});
