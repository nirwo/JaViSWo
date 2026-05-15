import type { Envelope, EnvelopeKind, SDKMessage } from '@cockpit/shared';

export type NormalizeContext = {
  agentId: string;
  sessionId: string;
  nextSeq: () => number;
  now: () => number;
};

export function normalize(msg: SDKMessage, ctx: NormalizeContext): Envelope[] {
  const base = (kind: EnvelopeKind, payload: unknown, parentToolUseId?: string): Envelope => ({
    v: 1,
    agentId: ctx.agentId,
    sessionId: ctx.sessionId,
    parentToolUseId,
    seq: ctx.nextSeq(),
    ts: ctx.now(),
    kind,
    payload,
  });

  if ('type' in msg && msg.type === 'system' && msg.subtype === 'init') {
    return [
      base('system_init', {
        model: msg.model,
        cwd: msg.cwd,
        tools: msg.tools,
        plugins: msg.plugins,
      }),
    ];
  }

  if ('type' in msg && msg.type === 'assistant') {
    const parent = msg.parent_tool_use_id;
    return msg.message.content.flatMap((block) => {
      if (block.type === 'text') return [base('text', { text: block.text }, parent)];
      if (block.type === 'thinking')
        return [base('thinking', { thinking: block.thinking }, parent)];
      if (block.type === 'tool_use')
        return [
          base('tool_use', { id: block.id, name: block.name, input: block.input }, parent),
        ];
      return [];
    });
  }

  if ('type' in msg && msg.type === 'stream_event') {
    const e = msg.event;
    if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
      return [base('partial_text', { delta: e.delta.text }, msg.parent_tool_use_id)];
    }
    return [];
  }

  if ('type' in msg && msg.type === 'result') {
    return [
      base('result', {
        subtype: msg.subtype,
        usage: msg.usage,
        total_cost_usd: msg.total_cost_usd,
        duration_ms: msg.duration_ms,
      }),
    ];
  }

  return [];
}
