// JARVIS orchestrator agent — M3.3.
//
// Architecture decision (open question from spec): we use PROMPT INJECTION
// instead of an MCP server. Reasons:
//
//   1. The existing supervisor already drives `claude -p` subprocesses with
//      stream-json output and parses NDJSON envelopes. JARVIS reuses that
//      exact pipeline — one process per turn, --resume <sessionId> for
//      continuity — and shows up in `/api/agents` like any worker.
//   2. The frontend already subscribes to envelope streams for any agentId,
//      so the JARVIS overlay can show his words by subscribing to the
//      jarvis agent. Zero new WS surface.
//   3. MCP would need a separate stdio server, double the lifecycle handling,
//      and tool calls would not appear in the envelope stream (the CLI emits
//      MCP traffic via a different pathway).
//
// JARVIS's CLI is launched with `--tools ""` (all built-in tools disabled)
// and a system prompt that defines our 5 tools as JSON code blocks. He emits
// tool calls as fenced ```jarvis-tool blocks; this module parses them out of
// his `text` envelopes, executes them, and feeds the results back as the
// next-turn user message.
//
// Singleton lifecycle: exactly one JARVIS process exists at a time. On
// construction the class checks the jarvis_sessions table; if a row exists,
// the persisted agent + sessionId are reused so his memory survives server
// restarts. Workers JARVIS dispatches are tagged spawned_by='jarvis' in the
// registry so the UI can badge them.

import type BetterSqlite3 from 'better-sqlite3';
import type { Envelope } from '@cockpit/shared';
import type { AgentRegistry } from './registry.js';
import type { RecentsStore } from './recents.js';
import type { AgentSupervisor } from './supervisor.js';

export const JARVIS_SINGLETON_ID = 'jarvis';
export const JARVIS_MODEL = 'claude-haiku-4-5';

const JARVIS_SYSTEM_PROMPT = `You are JARVIS — an AI orchestrator for a software cockpit. The user speaks
to you naturally; you decompose their requests into concrete coding tasks
and delegate to worker agents. You never write code yourself.

PERSONA: Dry British butler. Concise. Formal-but-warm. Address the user
as "sir". Never apologize excessively. Never explain technical details
unless asked.

RULES:
1. When the user gives an instruction, classify:
   - Build/fix request → use dispatchTask
   - Question about a running worker → use getWorkerStatus, summarize aloud
   - Redirect on a running worker → see COURSE CORRECTION below
   - Conversational → answer briefly with speakToUser, no dispatch needed
2. Always speak acknowledgement BEFORE any tool call so the user hears
   "Right, switching now, sir." first, not silence then a thunk.
3. Summarize worker results in plain English. Don't read file paths or
   stack traces unless the user asks.
4. If you don't know which project the user means, ask.
5. Default to the user's currently selected model (provided in context).

COURSE CORRECTION:
When the user gives an instruction while a worker is running (the cockpit
prepends a "Currently running:" preamble listing each running worker's id
and last task), classify the new instruction:
- Refinement of the same task ("use X instead", "also do Y"):
    call interruptWorker(id) then immediately dispatchTask with
    description='[original task summary] but with this adjustment:
    [new instruction]'. The worker's prior progress is lost; the new
    dispatch should mention what to keep.
- New direction entirely ("forget this, do X"):
    call interruptWorker(id) then dispatchTask({new task}).
Always speak acknowledgement before any tool call so the user hears
"Right, switching now, sir." first.

WORKER EVENTS:
When the cockpit sends you a [WORKER_EVENT] preamble (a single worker
just spawned, finished, or exited), produce a brief one-line spoken
summary for the user — nothing more, no tool calls unless the user is
asking. Use natural English: "Working on it now, sir.", "Done, sir —
3 files updated.", "Something went wrong, sir — [stderr tail]."

TOOL CALLING PROTOCOL — READ CAREFULLY:
You have NO built-in tools available (no Bash, no Read, no Edit, no MCP
servers). The ONLY way to take action in the cockpit is to emit a fenced
code block tagged "jarvis-tool" containing a JSON object of shape
{"tool": "<name>", "args": {...}}. The cockpit parses these fences out
of your text reply and executes them.

EXAMPLE — when the user says "list my projects" you reply:

Right away, sir.

\`\`\`jarvis-tool
{"tool": "listProjects", "args": {}}
\`\`\`

After the cockpit runs your tool calls it sends a follow-up turn whose
text begins with [TOOL_RESULTS] followed by a JSON array. Read those
results and then speak the answer naturally to the user — no more tool
call needed unless you need additional info or want to dispatch work.

You may emit multiple tool calls in a single reply; they execute in
order and the results come back together.

DO NOT pretend you ran a tool by describing imagined results — the user
will not have any data until you actually emit the fenced JSON.

You have 5 tools:

- dispatchTask({title, description, projectPath, model?}) → {agentId} | {error}
  Spawn a worker agent on a project to do the described work.

- getWorkerStatus({agentId}) → {agent, recent} | {error}
  Get the latest state and a tail of envelopes for an already-running worker.

- interruptWorker({agentId}) → {ok: true} | {error}
  Send SIGTERM to a worker. Use before redirecting.

- listProjects({}) → {roots, recent}
  Returns the configured project root paths and recently-opened folders.

- speakToUser({text}) → {ok: true, spoken}
  Mark a phrase as something the user should hear aloud. The overlay's TTS
  picks it up. Use sparingly — your normal text reply is already spoken.
`;

// ─── Tool definitions ──────────────────────────────────────────────────────

export type DispatchTaskArgs = {
  title: string;
  description: string;
  projectPath: string;
  model?: string;
};

export type DispatchTaskResult =
  | { agentId: string }
  | { error: string };

export type GetWorkerStatusArgs = { agentId: string };
export type GetWorkerStatusResult =
  | {
      agent: { id: string; projectPath: string; turn: number; sessionId?: string };
      recent: Array<{ kind: string; ts: number; payload: unknown }>;
    }
  | { error: string };

export type InterruptWorkerArgs = { agentId: string };
export type InterruptWorkerResult = { ok: true } | { error: string };

export type ListProjectsArgs = Record<string, never>;
export type ListProjectsResult = {
  roots: string[];
  recent: Array<{ path: string; ts: number }>;
};

export type SpeakToUserArgs = { text: string };
export type SpeakToUserResult = { ok: true; spoken: string };

type SupervisorLike = Pick<AgentSupervisor, 'spawnAgent' | 'stop'>;
type RegistryLike = Pick<AgentRegistry, 'get' | 'tail' | 'setSpawnedBy'>;
type RecentsLike = Pick<RecentsStore, 'list'>;

export type JarvisToolDeps = {
  supervisor: SupervisorLike;
  registry: RegistryLike;
  recents: RecentsLike;
  roots: string[];
};

export type JarvisTools = {
  dispatchTask: (args: DispatchTaskArgs) => Promise<DispatchTaskResult>;
  getWorkerStatus: (args: GetWorkerStatusArgs) => Promise<GetWorkerStatusResult>;
  interruptWorker: (args: InterruptWorkerArgs) => Promise<InterruptWorkerResult>;
  listProjects: (args: ListProjectsArgs) => Promise<ListProjectsResult>;
  speakToUser: (args: SpeakToUserArgs) => Promise<SpeakToUserResult>;
};

function isPathInsideAnyRoot(p: string, roots: string[]): boolean {
  // Defense-in-depth: a path must be exactly one of the configured roots OR a
  // descendant. We normalize via simple prefix check after enforcing absolute
  // path and rejecting any traversal sequences. JARVIS receives projectPath
  // from his own LLM output, so we cannot trust it.
  if (!p || typeof p !== 'string') return false;
  if (!p.startsWith('/')) return false;
  if (p.includes('/..') || p.endsWith('/..')) return false;
  return roots.some((root) => p === root || p.startsWith(root + '/'));
}

export function createJarvisTools(deps: JarvisToolDeps): JarvisTools {
  return {
    async dispatchTask(args) {
      if (!isPathInsideAnyRoot(args.projectPath, deps.roots)) {
        return { error: 'PROJECT_NOT_ALLOWED' };
      }
      const fullPrompt = args.title
        ? `${args.title}\n\n${args.description}`
        : args.description;
      const result = deps.supervisor.spawnAgent({
        prompt: fullPrompt,
        projectPath: args.projectPath,
        ...(args.model ? { model: args.model } : {}),
      });
      deps.registry.setSpawnedBy(result.agentId, 'jarvis');
      return { agentId: result.agentId };
    },

    async getWorkerStatus(args) {
      const meta = deps.registry.get(args.agentId);
      if (!meta) return { error: 'AGENT_NOT_FOUND' };
      const tail = deps.registry.tail(args.agentId, -1);
      // Keep the tail compact for JARVIS — only the last ~20 envelopes and
      // strip out hi-frequency partial_text deltas (those would balloon his
      // context with no useful info).
      const compact = tail
        .filter((env) => env.kind !== 'partial_text')
        .slice(-20)
        .map((env) => ({ kind: env.kind, ts: env.ts, payload: env.payload }));
      return {
        agent: {
          id: meta.id,
          projectPath: meta.projectPath,
          turn: meta.turn,
          ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
        },
        recent: compact,
      };
    },

    async interruptWorker(args) {
      const meta = deps.registry.get(args.agentId);
      if (!meta) return { error: 'AGENT_NOT_FOUND' };
      deps.supervisor.stop(args.agentId);
      return { ok: true };
    },

    async listProjects() {
      const recent = deps.recents.list();
      return {
        roots: [...deps.roots],
        recent: recent.map((r) => ({ path: r.path, ts: r.ts })),
      };
    },

    async speakToUser(args) {
      return { ok: true, spoken: args.text };
    },
  };
}

// ─── Tool-call parser ──────────────────────────────────────────────────────

export type ParsedToolCall = {
  tool: string;
  args: Record<string, unknown>;
};

const TOOL_FENCE_RE = /```jarvis-tool\s*\n([\s\S]*?)\n```/g;

export function parseToolCalls(text: string): ParsedToolCall[] {
  const out: ParsedToolCall[] = [];
  if (!text || typeof text !== 'string') return out;
  const matches = text.matchAll(TOOL_FENCE_RE);
  for (const m of matches) {
    const body = m[1];
    if (!body) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(body);
    } catch {
      continue;
    }
    if (
      obj &&
      typeof obj === 'object' &&
      'tool' in obj &&
      typeof (obj as { tool: unknown }).tool === 'string'
    ) {
      const tool = (obj as { tool: string }).tool;
      const rawArgs = (obj as { args?: unknown }).args;
      const args =
        rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
          ? (rawArgs as Record<string, unknown>)
          : {};
      out.push({ tool, args });
    }
  }
  return out;
}

// ─── JarvisAgent class ─────────────────────────────────────────────────────

export type JarvisAgentDeps = {
  db: BetterSqlite3.Database;
  registry: AgentRegistry;
  supervisor: AgentSupervisor;
  recents: RecentsStore;
  roots: string[];
  // Subscribe-to-this-agent's-envelopes hook. The agent calls this once on
  // construction and unsubscribes via the returned disposer when shutting
  // down. Each envelope is delivered as soon as the supervisor emits it.
  subscribeEnvelopes: (agentId: string, handler: (env: Envelope) => void) => () => void;
};

type ToolDispatch = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export class JarvisAgent {
  readonly agentId: string;
  private readonly tools: JarvisTools;
  private readonly dispatch: ToolDispatch;
  private readonly unsubscribe: () => void;
  // Promise that resolves when the current turn (a single `claude -p`) ends
  // with a `result` envelope from the subprocess. say() awaits this.
  private currentTurnPromise: Promise<void> | null = null;
  private resolveCurrentTurn: (() => void) | null = null;
  // Buffer for text envelopes produced during the current turn — we parse
  // tool calls only after the turn ends so partial fences don't trip us up.
  private currentTurnText: string[] = [];
  // Guard against re-entrant say() calls — we serialize.
  private sayQueue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: JarvisAgentDeps) {
    this.tools = createJarvisTools({
      supervisor: deps.supervisor,
      registry: deps.registry,
      recents: deps.recents,
      roots: deps.roots,
    });

    const toolMap: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {
      dispatchTask: (a) => this.tools.dispatchTask(a as DispatchTaskArgs),
      getWorkerStatus: (a) => this.tools.getWorkerStatus(a as GetWorkerStatusArgs),
      interruptWorker: (a) => this.tools.interruptWorker(a as InterruptWorkerArgs),
      listProjects: (a) => this.tools.listProjects(a as ListProjectsArgs),
      speakToUser: (a) => this.tools.speakToUser(a as SpeakToUserArgs),
    };
    this.dispatch = async (name, args) => {
      const fn = toolMap[name];
      if (!fn) return { error: `UNKNOWN_TOOL:${name}` };
      try {
        return await fn(args);
      } catch (err) {
        return { error: `TOOL_FAILED:${(err as Error).message}` };
      }
    };

    // Resolve or create the persisted JARVIS agent row.
    this.agentId = ensureJarvisAgentRow(deps.db, deps.registry);

    // Subscribe to our own envelope stream — used to detect when each
    // turn finishes (result envelope) and to capture text for tool parsing.
    this.unsubscribe = deps.subscribeEnvelopes(this.agentId, (env) => this.onEnvelope(env));
  }

  /**
   * Send a user turn to JARVIS. Resolves once his current turn finishes
   * (a `result` envelope is observed). Tool calls embedded in his reply
   * are executed and their results are fed back as a follow-up turn,
   * recursively, until JARVIS replies with no tool calls.
   *
   * Optionally pass `runningWorkers` so the user turn is prefixed with a
   * "Currently running:" preamble — JARVIS uses this to decide whether
   * the new instruction is a refinement of an in-flight task (in which
   * case he should interruptWorker first).
   */
  async say(text: string, runningWorkers?: RunningWorkerContext[]): Promise<void> {
    // Serialize concurrent callers — only one turn in flight at a time.
    const prev = this.sayQueue;
    let release: () => void = () => {};
    this.sayQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await prev.catch(() => {});
      const decorated = decorateWithRunningWorkers(text, runningWorkers);
      await this.sayInternal(decorated);
    } finally {
      // Bump last_active on every successful round-trip.
      try {
        this.deps.db
          .prepare(`UPDATE jarvis_sessions SET last_active = ? WHERE id = ?`)
          .run(Date.now(), JARVIS_SINGLETON_ID);
      } catch {
        // Ignore — best effort.
      }
      release();
    }
  }

  private async sayInternal(text: string): Promise<void> {
    let userInput = text;
    // Bounded follow-up loop — prevent runaway tool loops.
    for (let hop = 0; hop < 6; hop++) {
      this.currentTurnText = [];
      this.currentTurnPromise = new Promise<void>((resolve) => {
        this.resolveCurrentTurn = resolve;
      });
      const sessionId = this.deps.registry.sessionIdFor(this.agentId);
      const isFirstTurn = !sessionId;
      this.deps.supervisor.runJarvisTurn({
        agentId: this.agentId,
        prompt: userInput,
        model: JARVIS_MODEL,
        systemPrompt: JARVIS_SYSTEM_PROMPT,
        resumeSessionId: sessionId,
        isFirstTurn,
      });
      await this.currentTurnPromise;
      const fullText = this.currentTurnText.join('');
      const calls = parseToolCalls(fullText);
      if (calls.length === 0) return;
      const results: Array<{ tool: string; result: unknown }> = [];
      for (const c of calls) {
        const result = await this.dispatch(c.tool, c.args);
        results.push({ tool: c.tool, result });
      }
      userInput = `[TOOL_RESULTS]\n${JSON.stringify(results, null, 2)}`;
    }
  }

  private onEnvelope(env: Envelope): void {
    if (env.kind === 'text') {
      const p = env.payload as { text?: string } | null;
      if (p?.text) this.currentTurnText.push(p.text);
    } else if (env.kind === 'result' || env.kind === 'exit') {
      const resolver = this.resolveCurrentTurn;
      this.resolveCurrentTurn = null;
      if (resolver) resolver();
    }
  }

  /**
   * Notify JARVIS that a worker checkpoint happened (spawn, result, exit).
   * Ingested as a regular user turn whose text is a [WORKER_EVENT] block;
   * JARVIS produces a one-line spoken summary the overlay can TTS.
   *
   * The 8-second throttle that prevents spam during a single worker's run
   * lives client-side — the server fires every event it receives. Keeping
   * the throttle on the client avoids a stateful per-worker timer on the
   * server and lets the user disable narration with a single localStorage
   * flag without round-tripping.
   */
  async notifyWorkerEvent(event: {
    workerId: string;
    kind: 'spawn' | 'result' | 'exit' | string;
    summary: string;
  }): Promise<void> {
    const text = formatWorkerEvent(event);
    await this.say(text);
  }

  shutdown(): void {
    this.unsubscribe();
  }
}

// ─── Helpers: prompt decoration ────────────────────────────────────────────

export type RunningWorkerContext = {
  id: string;
  slug?: string;
  lastPrompt?: string;
};

export function decorateWithRunningWorkers(
  text: string,
  runningWorkers?: RunningWorkerContext[],
): string {
  if (!runningWorkers || runningWorkers.length === 0) return text;
  const lines = runningWorkers.map((w) => {
    const label = w.slug ? ` (${w.slug})` : '';
    const task = w.lastPrompt ? ` on task: ${truncate(w.lastPrompt, 200)}` : '';
    return `  - ${w.id}${label}${task}`;
  });
  return [
    '[CONTEXT]',
    'Currently running workers (you spawned these — consider course-correction rules):',
    ...lines,
    '',
    text,
  ].join('\n');
}

export function formatWorkerEvent(event: {
  workerId: string;
  kind: string;
  summary: string;
}): string {
  return [
    `[WORKER_EVENT] kind=${event.kind} worker=${event.workerId}`,
    event.summary,
  ].join('\n');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ─── Persistence helper ────────────────────────────────────────────────────

/**
 * Returns the JARVIS agent's row ID, creating it if necessary. Idempotent:
 * if a jarvis_sessions row already exists, its agent_id is returned so the
 * persisted Claude CLI session is reused on server restart.
 */
export function ensureJarvisAgentRow(
  db: BetterSqlite3.Database,
  registry: AgentRegistry,
): string {
  const existing = db
    .prepare(`SELECT agent_id FROM jarvis_sessions WHERE id = ?`)
    .get(JARVIS_SINGLETON_ID) as { agent_id: string } | undefined;
  if (existing) {
    // Validate the agent still exists in the agents table (could have been
    // deleted manually). If gone, recreate.
    const meta = registry.get(existing.agent_id);
    if (meta) return existing.agent_id;
    db.prepare(`DELETE FROM jarvis_sessions WHERE id = ?`).run(JARVIS_SINGLETON_ID);
  }

  // Create a fresh agent and persist the singleton row.
  const handle = registry.create({ projectPath: process.cwd() });
  registry.setSpawnedBy(handle.id, 'user'); // JARVIS himself is user-owned
  // Set a friendly firstPrompt for the UI.
  db.prepare(`UPDATE agents SET firstPrompt = ? WHERE id = ?`).run(
    'JARVIS orchestrator',
    handle.id,
  );
  const now = Date.now();
  db.prepare(
    `INSERT INTO jarvis_sessions (id, agent_id, created_at, last_active) VALUES (?, ?, ?, ?)`,
  ).run(JARVIS_SINGLETON_ID, handle.id, now, now);
  return handle.id;
}
