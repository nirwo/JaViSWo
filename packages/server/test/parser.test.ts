import { describe, it, expect } from 'vitest';
import { NdjsonParser } from '../src/parser.js';

describe('NdjsonParser', () => {
  it('emits a single object for one complete line', () => {
    const p = new NdjsonParser();
    expect(p.feed('{"a":1}\n')).toEqual([{ a: 1 }]);
  });

  it('buffers a partial line until newline arrives', () => {
    const p = new NdjsonParser();
    expect(p.feed('{"a":')).toEqual([]);
    expect(p.feed('1}\n')).toEqual([{ a: 1 }]);
  });

  it('emits multiple objects from one chunk', () => {
    const p = new NdjsonParser();
    expect(p.feed('{"a":1}\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('skips blank lines silently', () => {
    const p = new NdjsonParser();
    expect(p.feed('\n{"a":1}\n\n')).toEqual([{ a: 1 }]);
  });

  it('returns parse errors via the onError callback (not thrown)', () => {
    const errors: unknown[] = [];
    const p = new NdjsonParser((e) => errors.push(e));
    expect(p.feed('{bad}\n{"a":1}\n')).toEqual([{ a: 1 }]);
    expect(errors).toHaveLength(1);
  });

  it('handles trailing chunk without newline on flush()', () => {
    const p = new NdjsonParser();
    p.feed('{"a":1}');
    expect(p.flush()).toEqual([{ a: 1 }]);
  });

  it('handles a chunk split across multi-byte UTF-8 boundary', () => {
    const p = new NdjsonParser();
    // Split JUST BEFORE the é (2-byte UTF-8) so each fragment is itself valid UTF-8.
    // Node's `child.stdout.setEncoding('utf-8')` handles mid-codepoint splits at the stream
    // level — we just need the parser to buffer string fragments and reassemble on newline.
    const fullLine = Buffer.from('{"s":"é"}\n', 'utf-8');
    expect(p.feed(fullLine.subarray(0, 6).toString('utf-8'))).toEqual([]);
    expect(p.feed(fullLine.subarray(6).toString('utf-8'))).toEqual([{ s: 'é' }]);
  });
});
