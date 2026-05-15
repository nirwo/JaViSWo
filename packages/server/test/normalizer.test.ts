import { describe, it, expect } from 'vitest';
import { normalize } from '../src/normalizer.js';
import type { SDKMessage } from '@cockpit/shared';

const ctx = { agentId: 'agt_1', sessionId: 'sess_x', nextSeq: () => 0, now: () => 1000 };

describe('normalize', () => {
  it('maps system init to system_init envelope', () => {
    const msg: SDKMessage = {
      type: 'system',
      subtype: 'init',
      session_id: 'sess_x',
      model: 'claude-sonnet-4-6',
      cwd: '/tmp',
    };
    const out = normalize(msg, ctx);
    expect(out).toEqual([
      {
        v: 1,
        agentId: 'agt_1',
        sessionId: 'sess_x',
        seq: 0,
        ts: 1000,
        kind: 'system_init',
        payload: { model: 'claude-sonnet-4-6', cwd: '/tmp', tools: undefined, plugins: undefined },
      },
    ]);
  });

  it('maps assistant text content to text envelope', () => {
    const msg: SDKMessage = {
      type: 'assistant',
      message: {
        id: 'msg_a',
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
        usage: { input_tokens: 10, output_tokens: 2 },
      },
    };
    const out = normalize(msg, ctx);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('text');
    expect(out[0]?.payload).toEqual({ text: 'hello' });
  });

  it('maps assistant thinking content to thinking envelope', () => {
    const msg: SDKMessage = {
      type: 'assistant',
      message: {
        id: 'msg_a',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'pondering' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    };
    const out = normalize(msg, ctx);
    expect(out[0]?.kind).toBe('thinking');
    expect(out[0]?.payload).toEqual({ thinking: 'pondering' });
  });

  it('maps assistant tool_use content to tool_use envelope', () => {
    const msg: SDKMessage = {
      type: 'assistant',
      message: {
        id: 'msg_a',
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: '/x' } }],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    };
    const out = normalize(msg, ctx);
    expect(out[0]?.kind).toBe('tool_use');
    expect(out[0]?.payload).toEqual({ id: 'tu_1', name: 'Read', input: { path: '/x' } });
  });

  it('maps partial assistant text delta to partial_text envelope', () => {
    const msg: SDKMessage = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
    };
    const out = normalize(msg, ctx);
    expect(out[0]?.kind).toBe('partial_text');
    expect(out[0]?.payload).toEqual({ delta: 'lo' });
  });

  it('maps result to result envelope', () => {
    const msg: SDKMessage = {
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 100, output_tokens: 50 },
      total_cost_usd: 0.01,
      duration_ms: 1234,
    };
    const out = normalize(msg, ctx);
    expect(out[0]?.kind).toBe('result');
    expect(out[0]?.payload).toMatchObject({
      subtype: 'success',
      usage: { input_tokens: 100, output_tokens: 50 },
      total_cost_usd: 0.01,
    });
  });

  it('propagates parent_tool_use_id when present (subagent traffic)', () => {
    const msg: SDKMessage = {
      type: 'assistant',
      message: {
        id: 'msg_a',
        role: 'assistant',
        content: [{ type: 'text', text: 'inside subagent' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      parent_tool_use_id: 'tu_parent',
    };
    const out = normalize(msg, ctx);
    expect(out[0]?.parentToolUseId).toBe('tu_parent');
  });

  it('returns empty array for an unknown message shape (forward-compat)', () => {
    const msg = { type: 'something_new', whatever: 1 } as unknown as SDKMessage;
    expect(normalize(msg, ctx)).toEqual([]);
  });
});
