import { spawn } from 'node:child_process';
import type { Envelope, SDKMessage } from '@cockpit/shared';
import { NdjsonParser } from './parser.js';
import { normalize } from './normalizer.js';
import type { AgentRegistry } from './registry.js';

export type SpawnAgentInput = {
  prompt: string;
  projectPath: string;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
};

export type SpawnResult = { agentId: string };

const DEFAULTS = {
  model: 'claude-sonnet-4-6',
  maxTurns: 30,
  maxBudgetUsd: 5,
  permissionMode: 'bypassPermissions' as const,
};

export class AgentSupervisor {
  private readonly procs = new Map<string, ReturnType<typeof spawn>>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly onEnvelope: (env: Envelope) => void,
  ) {}

  spawnAgent(input: SpawnAgentInput): SpawnResult {
    const handle = this.registry.create({ projectPath: input.projectPath });

    const args = [
      '-p',
      input.prompt,
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--add-dir',
      input.projectPath,
      '--max-turns',
      String(input.maxTurns ?? DEFAULTS.maxTurns),
      '--model',
      input.model ?? DEFAULTS.model,
      '--permission-mode',
      DEFAULTS.permissionMode,
      '--verbose',
    ];

    // Strip npm lifecycle variables and sanitize PATH so the claude binary
    // uses its own bundled Node.js runtime rather than the system node that
    // npm injects via PATH prepends (node_modules/.bin).  When npm run dev
    // starts the server it prepends workspace .bin dirs (including the user's
    // global /Users/<name>/node_modules/.bin) to PATH; those dirs can contain
    // a stale @anthropic-ai/claude-code that breaks the spawned CLI process.
    const childPath = (process.env.PATH ?? '')
      .split(':')
      .filter((p) => !p.includes('node_modules/.bin'))
      .join(':');

    const childEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('npm_')),
    );
    childEnv.PATH = childPath;

    const child = spawn('claude', args, {
      cwd: input.projectPath,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.procs.set(handle.id, child);

    let sessionId = '';
    const parser = new NdjsonParser((err, line) =>
      console.warn(`[cockpit] parse error on ${handle.id}:`, err, line.slice(0, 200)),
    );

    const emit = (env: Envelope) => {
      this.registry.record(env);
      this.onEnvelope(env);
    };

    // Helper for system-generated envelopes (stderr, exit, spawn error).
    // Omits sessionId when it hasn't been established yet to avoid ambiguous
    // empty-string values on the wire — sessionId is optional in the schema.
    const mkSysEnvelope = (kind: 'stderr' | 'exit', payload: unknown): Envelope => ({
      v: 1,
      agentId: handle.id,
      ...(sessionId ? { sessionId } : {}),
      seq: handle.nextSeq(),
      ts: Date.now(),
      kind,
      payload,
    });

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      const objs = parser.feed(chunk);
      for (const obj of objs) {
        if (
          typeof obj === 'object' &&
          obj !== null &&
          'type' in obj &&
          (obj as { type: string }).type === 'system' &&
          (obj as { subtype?: string }).subtype === 'init' &&
          'session_id' in obj &&
          typeof (obj as { session_id: unknown }).session_id === 'string'
        ) {
          sessionId = (obj as unknown as { session_id: string }).session_id;
        }
        for (const env of normalize(obj as SDKMessage, {
          agentId: handle.id,
          sessionId,
          nextSeq: handle.nextSeq,
          now: () => Date.now(),
        })) {
          emit(env);
        }
      }
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      emit(mkSysEnvelope('stderr', { text: chunk }));
    });

    // Issue 2 fix: flush parser before emitting exit so sequence numbers are
    // monotonically ordered (buffered stdout lines before the exit event).
    child.on('exit', (code) => {
      for (const obj of parser.flush()) {
        for (const env of normalize(obj as SDKMessage, {
          agentId: handle.id,
          sessionId,
          nextSeq: handle.nextSeq,
          now: () => Date.now(),
        })) {
          emit(env);
        }
      }
      emit(mkSysEnvelope('exit', { code }));
      this.procs.delete(handle.id);
    });

    // Issue 1 fix: handle spawn errors (binary not found, bad cwd, etc.) so
    // they surface as structured envelopes instead of crashing the server.
    child.on('error', (err) => {
      emit(mkSysEnvelope('stderr', { text: `spawn error: ${err.message}` }));
      emit(mkSysEnvelope('exit', { code: -1 }));
      this.procs.delete(handle.id);
    });

    return { agentId: handle.id };
  }

  stop(agentId: string): void {
    const child = this.procs.get(agentId);
    if (child) child.kill('SIGTERM');
  }
}
