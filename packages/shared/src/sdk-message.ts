// Subset of @anthropic-ai/claude-agent-sdk SDKMessage union — only what M1 consumes.
// Full union lands in M2 when we start showing tool_use / parent_tool_use_id in the UI.

export type SDKUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type SDKSystemInitMessage = {
  type: 'system';
  subtype: 'init';
  session_id: string;
  model: string;
  cwd: string;
  tools?: string[];
  plugins?: string[];
};

export type SDKAssistantMessage = {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'thinking'; thinking: string }
      | { type: 'tool_use'; id: string; name: string; input: unknown }
    >;
    usage: SDKUsage;
  };
  parent_tool_use_id?: string;
};

export type SDKPartialAssistantMessage = {
  type: 'stream_event';
  event: {
    type: 'content_block_delta';
    delta: { type: 'text_delta'; text: string };
  };
  parent_tool_use_id?: string;
};

export type SDKResultMessage = {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution';
  usage: SDKUsage;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
};

export type SDKMessage =
  | SDKSystemInitMessage
  | SDKAssistantMessage
  | SDKPartialAssistantMessage
  | SDKResultMessage;
