import { z } from 'zod';

export const EnvelopeKindEnum = z.enum([
  'system_init',
  'text',
  'partial_text',
  'thinking',
  'tool_use',
  'result',
  'stderr',
  'exit',
]);
export type EnvelopeKind = z.infer<typeof EnvelopeKindEnum>;

export const EnvelopeSchema = z.object({
  v: z.literal(1),
  agentId: z.string(),
  sessionId: z.string().optional(),
  parentToolUseId: z.string().optional(),
  seq: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
  kind: EnvelopeKindEnum,
  payload: z.unknown(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

// Client → server resume payload (used on WS (re)connect).
// sinceSeq = -1 means "send everything from the beginning of the tail buffer."
export const ResumeRequestSchema = z.object({
  resume: z.object({
    agentId: z.string(),
    sinceSeq: z.number().int().min(-1),
  }),
});
export type ResumeRequest = z.infer<typeof ResumeRequestSchema>;
