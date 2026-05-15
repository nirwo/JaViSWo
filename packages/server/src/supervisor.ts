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

export type ContinueResult = { ok: boolean; reason?: string };

const DEFAULTS = {
  model: 'claude-sonnet-4-6',
  maxTurns: 30,
  maxBudgetUsd: 5,
  permissionMode: 'bypassPermissions' as const,
};

export class AgentSupervisor {
  private readonly procs = new Map<string, ReturnType<typeof spawn>>();
  private readonly sanitizedEnv: NodeJS.ProcessEnv;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly onEnvelope: (env: Envelope) => void,
  ) {
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
    this.sanitizedEnv = childEnv;
  }

  emitUserPrompt(agentId: string, prompt: string): void {
    this.registry.setFirstPrompt(agentId, prompt);
    const turn = this.registry.getTurn(agentId);
    const sessionId = this.registry.sessionIdFor(agentId);
    const env: Envelope = {
      v: 1,
      agentId,
      ...(sessionId ? { sessionId } : {}),
      seq: this.registry.nextSeqFor(agentId),
      ts: Date.now(),
      kind: 'user_prompt',
      payload: { text: prompt, turn },
    };
    this.registry.record(env);
    this.onEnvelope(env);
  }

  spawnAgent(input: SpawnAgentInput): SpawnResult {
    const handle = this.registry.create({ projectPath: input.projectPath });

    this.emitUserPrompt(handle.id, input.prompt);

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
      '--max-budget-usd',
      String(input.maxBudgetUsd ?? DEFAULTS.maxBudgetUsd),
      '--model',
      input.model ?? DEFAULTS.model,
      '--permission-mode',
      DEFAULTS.permissionMode,
      '--verbose',
    ];

    const child = spawn('claude', args, {
      cwd: input.projectPath,
      env: this.sanitizedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.procs.set(handle.id, child);

    this.wireChild(handle.id, child, {
      nextSeq: () => handle.nextSeq(),
      initialSessionId: '',
    });

    return { agentId: handle.id };
  }

  continueAgent(agentId: string, prompt: string): ContinueResult {
    const sessionId = this.registry.sessionIdFor(agentId);
    if (!sessionId) return { ok: false, reason: 'NO_SESSION' };
    const meta = this.registry.get(agentId);
    if (!meta) return { ok: false, reason: 'AGENT_NOT_FOUND' };

    this.registry.bumpTurn(agentId);
    this.emitUserPrompt(agentId, prompt);

    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--resume',
      sessionId,
      '--add-dir',
      meta.projectPath,
      '--max-turns',
      String(DEFAULTS.maxTurns),
      '--max-budget-usd',
      String(DEFAULTS.maxBudgetUsd),
      '--permission-mode',
      DEFAULTS.permissionMode,
      '--verbose',
    ];

    const child = spawn('claude', args, {
      cwd: meta.projectPath,
      env: this.sanitizedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Overwrite the previous (already-exited) entry — intentional.
    this.procs.set(agentId, child);

    this.wireChild(agentId, child, {
      nextSeq: () => this.registry.nextSeqFor(agentId),
      initialSessionId: sessionId,
    });

    return { ok: true };
  }

  private wireChild(
    agentId: string,
    child: ReturnType<typeof spawn>,
    opts: { nextSeq: () => number; initialSessionId: string },
  ): void {
    let sessionId = opts.initialSessionId;
    const parser = new NdjsonParser((err, line) =>
      console.warn(`[cockpit] parse error on ${agentId}:`, err, line.slice(0, 200)),
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
      agentId,
      ...(sessionId ? { sessionId } : {}),
      seq: opts.nextSeq(),
      ts: Date.now(),
      kind,
      payload,
    });

    if (!child.stdout || !child.stderr) {
      emit(mkSysEnvelope('stderr', { text: 'spawn error: stdio streams unavailable' }));
      emit(mkSysEnvelope('exit', { code: -1 }));
      return;
    }

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
          this.registry.setSessionId(agentId, sessionId);
        }
        for (const env of normalize(obj as SDKMessage, {
          agentId,
          sessionId,
          nextSeq: opts.nextSeq,
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

    // Flush parser before emitting exit so sequence numbers are
    // monotonically ordered (buffered stdout lines before the exit event).
    child.on('exit', (code) => {
      for (const obj of parser.flush()) {
        for (const env of normalize(obj as SDKMessage, {
          agentId,
          sessionId,
          nextSeq: opts.nextSeq,
          now: () => Date.now(),
        })) {
          emit(env);
        }
      }
      emit(mkSysEnvelope('exit', { code }));
      this.procs.delete(agentId);
    });

    // Handle spawn errors (binary not found, bad cwd, etc.) so
    // they surface as structured envelopes instead of crashing the server.
    child.on('error', (err) => {
      emit(mkSysEnvelope('stderr', { text: `spawn error: ${err.message}` }));
      emit(mkSysEnvelope('exit', { code: -1 }));
      this.procs.delete(agentId);
    });
  }

  stop(agentId: string): void {
    const child = this.procs.get(agentId);
    if (child) child.kill('SIGTERM');
  }
}
