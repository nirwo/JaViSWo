# Claude Cockpit — M1 (backend skeleton + single agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Node/TypeScript monorepo, spawn a single `claude -p ... --output-format stream-json` subprocess from a Hono server, normalize its NDJSON output into typed envelopes, fan them out over a WebSocket to a minimal raw-HTML client, and bind to `0.0.0.0:8787` so an iPhone on the same Tailnet can reach it.

**Architecture:** Monorepo with three workspaces (`shared`, `server`, `web`). M1 only touches `shared` + `server`; React lands in M2's plan. The server is a single Node 22 process: Hono for HTTP, `ws` for WebSocket, `child_process.spawn` for the agent. No database yet (M5 adds sqlite). State lives in-memory and dies on restart — intentional, keeps M1 small.

**Tech Stack:** Node 22 + TypeScript 5.x · Hono · ws · zod · vitest · tsx (dev runner) · `@anthropic-ai/claude-agent-sdk` (types only — we don't call it directly) · the user's `claude` CLI binary on PATH.

**Prerequisites before starting:**
- `node --version` ≥ 22
- `claude --version` succeeds (Claude Code CLI ≥ 2.1.63)
- `claude -p "say hi" --output-format stream-json` produces NDJSON (smoke test the CLI before coding the supervisor)

---

## File Structure (locked at planning time)

```
claude-cockpit/
├── package.json                     # workspaces root
├── tsconfig.base.json
├── .nvmrc                            # 22
├── .prettierrc
├── eslint.config.js
├── start-cockpit.sh                  # launcher
├── README.md                         # quickstart
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # re-exports
│   │       ├── envelope.ts           # Envelope type + zod schema
│   │       └── sdk-message.ts        # SDKMessage subset (M1 subset only)
│   └── server/
│       ├── package.json
│       ├── tsconfig.json
│       ├── public/
│       │   └── index.html            # minimal raw-HTML client
│       └── src/
│           ├── index.ts              # entrypoint, binds server
│           ├── http.ts               # Hono app + routes
│           ├── ws.ts                 # WebSocket gateway
│           ├── supervisor.ts         # spawn + register agents
│           ├── parser.ts             # NDJSON line parser
│           ├── normalizer.ts         # SDKMessage → Envelope
│           ├── registry.ts           # in-memory agent registry + seq
│           └── config.ts             # ports, host, paths
└── packages/server/test/
    ├── parser.test.ts
    ├── normalizer.test.ts
    └── registry.test.ts
```

**Why this shape:** every file has one responsibility. Parser, normalizer, registry are pure functions/classes — trivially unit-tested. Supervisor is the only place that touches `child_process`. WS gateway is the only place that talks to browsers. HTTP is the only place that mounts routes. Each file under 200 lines.

---

## Task 1: Scaffold monorepo root

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.nvmrc`
- Create: `.prettierrc`
- Create: `eslint.config.js`
- Create: `README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "claude-cockpit",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "npm --workspace @cockpit/server run dev",
    "build": "npm --workspaces run build",
    "test": "npm --workspaces run test --if-present",
    "lint": "eslint packages",
    "format": "prettier --write packages"
  },
  "devDependencies": {
    "@types/node": "22.7.4",
    "eslint": "9.12.0",
    "prettier": "3.3.3",
    "tsx": "4.19.1",
    "typescript": "5.6.2",
    "vitest": "2.1.2"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 3: Create `.nvmrc`**

```
22
```

- [ ] **Step 4: Create `.prettierrc`**

```json
{ "singleQuote": true, "trailingComma": "all", "printWidth": 100 }
```

- [ ] **Step 5: Create `eslint.config.js`**

```js
import tseslint from 'typescript-eslint';
export default tseslint.config({
  files: ['packages/**/*.ts'],
  languageOptions: { parserOptions: { project: ['packages/*/tsconfig.json'] } },
  rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
});
```

- [ ] **Step 6: Create `README.md`**

```markdown
# Claude Cockpit

Multi-pane web UI wrapping the Claude Code CLI. Run several `claude` agents in parallel, watch them side-by-side from any device on your Tailnet.

## Quickstart (M1)

```bash
npm install
./start-cockpit.sh
# Open http://<your-mac-ip>:8787 from any device on your network
```

Requires: Node 22+, Claude Code CLI 2.1.63+.

Spec: `docs/superpowers/specs/2026-05-15-claude-cockpit-design.md`
```

- [ ] **Step 7: Install root devDependencies and verify**

Run: `npm install`
Expected: `node_modules/` created, no peer-dep errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.base.json .nvmrc .prettierrc eslint.config.js README.md
git commit -m "chore: scaffold monorepo root (Node 22, workspaces, TS strict)"
```

---

## Task 2: Create `shared` package — envelope types + zod schemas

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/envelope.ts`
- Create: `packages/shared/src/sdk-message.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@cockpit/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "3.23.8"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/shared/src/sdk-message.ts`** — minimum SDKMessage subset M1 needs

```typescript
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
```

- [ ] **Step 4: Create `packages/shared/src/envelope.ts`** — wire-format the cockpit owns

```typescript
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
// since_seq = -1 means "send everything from the beginning of the tail buffer."
export const ResumeRequestSchema = z.object({
  resume: z.object({
    agentId: z.string(),
    since_seq: z.number().int().min(-1),
  }),
});
export type ResumeRequest = z.infer<typeof ResumeRequestSchema>;
```

- [ ] **Step 5: Create `packages/shared/src/index.ts`**

```typescript
export * from './envelope.js';
export * from './sdk-message.js';
```

- [ ] **Step 6: Verify the package type-checks**

Run: `npm --workspace @cockpit/shared run build`
Expected: `packages/shared/dist/` produced, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): envelope schema + SDKMessage M1 subset"
```

---

## Task 3: Create `server` package skeleton — Hono "hello"

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/config.ts`
- Create: `packages/server/src/http.ts`
- Create: `packages/server/src/index.ts`

- [ ] **Step 1: Create `packages/server/package.json`**

```json
{
  "name": "@cockpit/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@cockpit/shared": "0.0.1",
    "@hono/node-server": "1.13.2",
    "hono": "4.6.3",
    "ws": "8.18.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/ws": "8.5.12"
  }
}
```

- [ ] **Step 2: Create `packages/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"],
  "references": [{ "path": "../shared" }]
}
```

- [ ] **Step 3: Create `packages/server/src/config.ts`**

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';

export type CockpitConfig = {
  host: string;
  port: number;
  publicDir: string;
};

export function loadConfig(): CockpitConfig {
  return {
    host: process.env.COCKPIT_HOST ?? '0.0.0.0',
    port: Number(process.env.COCKPIT_PORT ?? 8787),
    publicDir: join(import.meta.dirname, '..', 'public'),
  };
}

export const configPath = join(homedir(), '.cockpit', 'config.json');
```

- [ ] **Step 4: Create `packages/server/src/http.ts`**

```typescript
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { CockpitConfig } from './config.js';

export function buildHttpApp(config: CockpitConfig): Hono {
  const app = new Hono();

  app.get('/api/health', (c) =>
    c.json({ ok: true, ts: Date.now(), version: '0.0.1-M1' }),
  );

  app.use('/*', serveStatic({ root: config.publicDir }));

  return app;
}
```

- [ ] **Step 5: Create `packages/server/src/index.ts`**

```typescript
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { buildHttpApp } from './http.js';

const config = loadConfig();
const app = buildHttpApp(config);

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, ({ address, port }) => {
  console.log(`[cockpit] HTTP listening on http://${address}:${port}`);
});
```

- [ ] **Step 6: Install + verify health endpoint**

Run: `npm install` (from repo root)
Run: `npm --workspace @cockpit/server run dev`
Run (in another shell): `curl http://localhost:8787/api/health`
Expected: `{"ok":true,"ts":...,"version":"0.0.1-M1"}`
Stop the dev server (Ctrl-C).

- [ ] **Step 7: Commit**

```bash
git add packages/server
git commit -m "feat(server): Hono skeleton with /api/health + static file serving"
```

---

## Task 4: NDJSON line parser (TDD)

**Files:**
- Create: `packages/server/src/parser.ts`
- Create: `packages/server/test/parser.test.ts`

The parser is a small stateful class: feed it chunks (which may split lines anywhere), get back complete JSON-decoded objects.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/parser.test.ts`:

```typescript
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
    // The character é encodes to 0xC3 0xA9 in UTF-8
    const fullLine = Buffer.from('{"s":"é"}\n', 'utf-8');
    expect(p.feed(fullLine.subarray(0, 7).toString('utf-8'))).toEqual([]);
    expect(p.feed(fullLine.subarray(7).toString('utf-8'))).toEqual([{ s: 'é' }]);
  });
});
```

- [ ] **Step 2: Run tests, expect failures**

Run: `npm --workspace @cockpit/server run test`
Expected: All 7 tests fail with "NdjsonParser is not a constructor" or similar.

- [ ] **Step 3: Implement `packages/server/src/parser.ts`**

```typescript
export type ParseErrorHandler = (err: unknown, line: string) => void;

export class NdjsonParser {
  private buf = '';
  constructor(private readonly onError: ParseErrorHandler = () => {}) {}

  feed(chunk: string): unknown[] {
    this.buf += chunk;
    const out: unknown[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line.length === 0) continue;
      try {
        out.push(JSON.parse(line));
      } catch (err) {
        this.onError(err, line);
      }
    }
    return out;
  }

  /** Drain any trailing partial line (call when the stream closes). */
  flush(): unknown[] {
    const tail = this.buf.trim();
    this.buf = '';
    if (tail.length === 0) return [];
    try {
      return [JSON.parse(tail)];
    } catch (err) {
      this.onError(err, tail);
      return [];
    }
  }
}
```

- [ ] **Step 4: Run tests, expect all pass**

Run: `npm --workspace @cockpit/server run test`
Expected: 7 / 7 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/parser.ts packages/server/test/parser.test.ts
git commit -m "feat(server): NDJSON line parser w/ partial-chunk + utf-8 + error tolerance"
```

---

## Task 5: SDKMessage → Envelope normalizer (TDD)

**Files:**
- Create: `packages/server/src/normalizer.ts`
- Create: `packages/server/test/normalizer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/normalizer.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests, expect failures**

Run: `npm --workspace @cockpit/server run test`
Expected: All 8 tests fail with "normalize is not defined".

- [ ] **Step 3: Implement `packages/server/src/normalizer.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests, expect all pass**

Run: `npm --workspace @cockpit/server run test`
Expected: 8 / 8 pass for normalizer; parser tests still pass too.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/normalizer.ts packages/server/test/normalizer.test.ts
git commit -m "feat(server): SDKMessage→Envelope normalizer for system_init/text/thinking/tool_use/partial/result"
```

---

## Task 6: Agent registry (TDD)

**Files:**
- Create: `packages/server/src/registry.ts`
- Create: `packages/server/test/registry.test.ts`

The registry assigns stable IDs, maintains monotonic `seq` per agent, and lets WS subscribers fetch a tail buffer for replay-on-reconnect. In-memory only for M1 (sqlite arrives in M5).

- [ ] **Step 1: Write the failing tests**

Create `packages/server/test/registry.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run tests, expect failures**

Run: `npm --workspace @cockpit/server run test -- registry`
Expected: 6 tests fail with "AgentRegistry is not a constructor".

- [ ] **Step 3: Implement `packages/server/src/registry.ts`**

```typescript
import { randomBytes } from 'node:crypto';
import type { Envelope } from '@cockpit/shared';

export type AgentMeta = {
  id: string;
  projectPath: string;
  createdAt: number;
};

export type AgentHandle = AgentMeta & {
  nextSeq: () => number;
};

type RegistryOpts = { tailCap?: number };

type AgentEntry = {
  meta: AgentMeta;
  seq: number;
  tail: Envelope[];
};

export class AgentRegistry {
  private readonly agents = new Map<string, AgentEntry>();
  private readonly tailCap: number;

  constructor(opts: RegistryOpts = {}) {
    this.tailCap = opts.tailCap ?? 500;
  }

  create(input: { projectPath: string }): AgentHandle {
    const id = `agt_${randomBytes(8).toString('hex')}`;
    const meta: AgentMeta = { id, projectPath: input.projectPath, createdAt: Date.now() };
    const entry: AgentEntry = { meta, seq: 0, tail: [] };
    this.agents.set(id, entry);
    return { ...meta, nextSeq: () => entry.seq++ };
  }

  record(env: Envelope): void {
    const entry = this.agents.get(env.agentId);
    if (!entry) return;
    entry.tail.push(env);
    while (entry.tail.length > this.tailCap) entry.tail.shift();
  }

  tail(agentId: string, sinceSeq: number): Envelope[] {
    const entry = this.agents.get(agentId);
    if (!entry) return [];
    return entry.tail.filter((e) => e.seq > sinceSeq);
  }

  get(agentId: string): AgentMeta | undefined {
    return this.agents.get(agentId)?.meta;
  }

  list(): AgentMeta[] {
    return [...this.agents.values()].map((e) => e.meta);
  }
}
```

- [ ] **Step 4: Run tests, expect all pass**

Run: `npm --workspace @cockpit/server run test`
Expected: 6 / 6 registry tests pass; parser + normalizer still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/registry.ts packages/server/test/registry.test.ts
git commit -m "feat(server): in-memory agent registry w/ monotonic seq + replay tail buffer"
```

---

## Task 7: WebSocket gateway

**Files:**
- Create: `packages/server/src/ws.ts`
- Modify: `packages/server/src/index.ts` (mount the WS server)

The WS gateway exposes a single `/ws` endpoint. Clients send `{resume: {agentId, since_seq}}` on connect to subscribe + replay. Server broadcasts envelopes to every subscriber of that agent.

- [ ] **Step 1: Create `packages/server/src/ws.ts`**

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import { ResumeRequestSchema, type Envelope } from '@cockpit/shared';
import type { AgentRegistry } from './registry.js';

type Subscription = { agentId: string; sinceSeq: number };

export function attachWebSocket(httpServer: HttpServer, registry: AgentRegistry) {
  const wss = new WebSocketServer({ noServer: true });
  const subs = new Map<WebSocket, Subscription[]>();

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    subs.set(ws, []);
    ws.on('message', (raw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString('utf-8'));
      } catch {
        return;
      }
      const parsed = ResumeRequestSchema.safeParse(payload);
      if (!parsed.success) return;
      const { agentId, since_seq } = parsed.data.resume;
      const list = subs.get(ws) ?? [];
      list.push({ agentId, sinceSeq: since_seq });
      subs.set(ws, list);
      // Replay tail since since_seq.
      for (const e of registry.tail(agentId, since_seq)) {
        ws.send(JSON.stringify(e));
      }
    });
    ws.on('close', () => subs.delete(ws));
  });

  function broadcast(env: Envelope) {
    for (const [ws, list] of subs.entries()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (list.some((s) => s.agentId === env.agentId)) {
        ws.send(JSON.stringify(env));
      }
    }
  }

  return { broadcast };
}
```

- [ ] **Step 2: Modify `packages/server/src/index.ts`** to mount the WS gateway

Replace the file contents:

```typescript
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { buildHttpApp } from './http.js';
import { AgentRegistry } from './registry.js';
import { attachWebSocket } from './ws.js';

const config = loadConfig();
const registry = new AgentRegistry({ tailCap: 500 });
const app = buildHttpApp(config);

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, ({ address, port }) => {
  console.log(`[cockpit] HTTP+WS listening on http://${address}:${port}`);
});

attachWebSocket(server as unknown as import('node:http').Server, registry);

export { registry };
```

- [ ] **Step 3: Manually verify the WS handshake**

Run: `npm --workspace @cockpit/server run dev`
Run (other shell): `npx wscat -c ws://localhost:8787/ws` (install wscat globally if needed: `npm i -g wscat`)
Type into wscat: `{"resume":{"agentId":"agt_dontexist","since_seq":0}}`
Expected: no error, no response (unknown agent → empty replay), connection stays open. Ctrl-C wscat. Ctrl-C the dev server.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/ws.ts packages/server/src/index.ts
git commit -m "feat(server): WebSocket gateway with resume-since-seq subscription protocol"
```

---

## Task 8: Agent supervisor — spawn `claude -p` and stream envelopes

**Files:**
- Create: `packages/server/src/supervisor.ts`
- Modify: `packages/server/src/http.ts` (add `POST /api/agents`)
- Modify: `packages/server/src/index.ts` (wire supervisor → broadcast)

- [ ] **Step 1: Create `packages/server/src/supervisor.ts`**

```typescript
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
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
  private readonly procs = new Map<string, ChildProcessWithoutNullStreams>();

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
      '--include-hook-events',
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
      '--verbose', // ensures stream-json output even outside --bg
    ];

    const child = spawn('claude', args, {
      cwd: input.projectPath,
      env: process.env,
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

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      const objs = parser.feed(chunk);
      for (const obj of objs) {
        if (
          typeof obj === 'object' &&
          obj !== null &&
          'type' in obj &&
          (obj as { type: string }).type === 'system' &&
          (obj as { subtype?: string }).subtype === 'init'
        ) {
          sessionId = (obj as { session_id: string }).session_id;
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
      emit({
        v: 1,
        agentId: handle.id,
        sessionId,
        seq: handle.nextSeq(),
        ts: Date.now(),
        kind: 'stderr',
        payload: { text: chunk },
      });
    });

    child.on('exit', (code) => {
      emit({
        v: 1,
        agentId: handle.id,
        sessionId,
        seq: handle.nextSeq(),
        ts: Date.now(),
        kind: 'exit',
        payload: { code },
      });
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
      this.procs.delete(handle.id);
    });

    return { agentId: handle.id };
  }

  stop(agentId: string): void {
    const child = this.procs.get(agentId);
    if (child) child.kill('SIGTERM');
  }
}
```

- [ ] **Step 2: Modify `packages/server/src/http.ts`** — add `POST /api/agents`

Replace contents:

```typescript
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import type { CockpitConfig } from './config.js';
import type { AgentRegistry } from './registry.js';
import type { AgentSupervisor } from './supervisor.js';

const SpawnInputSchema = z.object({
  prompt: z.string().min(1),
  projectPath: z.string().min(1),
  model: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  maxBudgetUsd: z.number().positive().optional(),
});

export function buildHttpApp(
  config: CockpitConfig,
  registry: AgentRegistry,
  supervisor: AgentSupervisor,
): Hono {
  const app = new Hono();

  app.get('/api/health', (c) =>
    c.json({ ok: true, ts: Date.now(), version: '0.0.1-M1' }),
  );

  app.get('/api/agents', (c) => c.json({ agents: registry.list() }));

  app.post('/api/agents', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SpawnInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues } }, 400);
    }
    const { agentId } = supervisor.spawnAgent(parsed.data);
    return c.json({ agentId }, 201);
  });

  app.use('/*', serveStatic({ root: config.publicDir }));

  return app;
}
```

- [ ] **Step 3: Modify `packages/server/src/index.ts`** — wire supervisor

Replace contents:

```typescript
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { buildHttpApp } from './http.js';
import { AgentRegistry } from './registry.js';
import { AgentSupervisor } from './supervisor.js';
import { attachWebSocket } from './ws.js';

const config = loadConfig();
const registry = new AgentRegistry({ tailCap: 500 });

let broadcast: (env: import('@cockpit/shared').Envelope) => void = () => {};
const supervisor = new AgentSupervisor(registry, (env) => broadcast(env));

const app = buildHttpApp(config, registry, supervisor);

const server = serve(
  { fetch: app.fetch, hostname: config.host, port: config.port },
  ({ address, port }) => {
    console.log(`[cockpit] HTTP+WS listening on http://${address}:${port}`);
  },
);

const ws = attachWebSocket(server as unknown as import('node:http').Server, registry);
broadcast = ws.broadcast;
```

- [ ] **Step 4: Live smoke-test against the real `claude` binary**

Run: `npm --workspace @cockpit/server run dev`
Run (other shell):
```bash
curl -X POST http://localhost:8787/api/agents \
  -H 'content-type: application/json' \
  -d '{"prompt":"Say hi in five words.","projectPath":"'$HOME'/AI Development/claude-cockpit"}'
```
Expected: `{"agentId":"agt_..."}`. The dev-server stdout shows `[cockpit] HTTP+WS listening...` followed by no errors. Within a few seconds the `claude` subprocess finishes and emits a `result` envelope.

- [ ] **Step 5: Verify envelopes via wscat**

In another shell:
```bash
wscat -c ws://localhost:8787/ws
# In wscat, paste (replace agt_xxx with the id from the curl above):
{"resume":{"agentId":"agt_xxx","since_seq":-1}}
```
Expected: A sequence of envelopes streams back — `system_init`, then `text`/`partial_text`, then `result`, then `exit`.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/supervisor.ts packages/server/src/http.ts packages/server/src/index.ts
git commit -m "feat(server): agent supervisor — spawn claude CLI, parse NDJSON, broadcast envelopes"
```

---

## Task 9: Minimal raw-HTML client (no innerHTML, all textContent)

**Files:**
- Create: `packages/server/public/index.html`

No React in M1 — just a single HTML file with vanilla JS that talks to the existing HTTP + WS endpoints. This is the "first iPhone visit works" demo. Crucially: **all agent-emitted text reaches the DOM via `textContent`, never `innerHTML`** — the agent can emit anything, so we never interpret its bytes as HTML. (Carries the spec's Artifacts sandbox principle into M1's tiny client.)

- [ ] **Step 1: Create `packages/server/public/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Cockpit M1</title>
    <style>
      :root {
        --bg: #0a0d12;
        --panel: #0e1218;
        --border: #1a1f2a;
        --text: #d4d8e0;
        --muted: #94a3b8;
        --accent: #5eead4;
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, sans-serif; }
      header { padding: 12px 16px; background: var(--panel); border-bottom: 1px solid var(--border); }
      h1 { font-size: 14px; margin: 0; color: var(--accent); }
      main { display: grid; grid-template-rows: auto 1fr; height: calc(100vh - 50px); }
      form { display: flex; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
      input, textarea, button { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; }
      textarea { flex: 1; resize: none; min-height: 60px; }
      button { background: var(--accent); color: var(--bg); border: none; cursor: pointer; font-weight: 600; }
      button:disabled { opacity: 0.5; cursor: wait; }
      #stream { padding: 12px 16px; overflow: auto; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px; }
      .row { padding: 4px 0; border-bottom: 1px dotted var(--border); white-space: pre-wrap; word-break: break-word; }
      .kind { color: var(--muted); margin-right: 8px; }
      .text { color: var(--text); }
      .partial_text { color: var(--accent); }
      .thinking { color: var(--accent); opacity: 0.7; }
      .tool_use { color: #fbbf24; }
      .stderr { color: #fb7185; }
      .exit, .result { color: var(--muted); font-style: italic; }
    </style>
  </head>
  <body>
    <header><h1>⌘ Cockpit · M1</h1></header>
    <main>
      <form id="spawn">
        <input id="project" placeholder="/abs/path/to/project" required style="flex: 1;" />
        <textarea id="prompt" placeholder="Prompt for the agent…" required></textarea>
        <button type="submit">Send</button>
      </form>
      <div id="stream"></div>
    </main>
    <script>
      const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      const stream = document.getElementById('stream');
      const form = document.getElementById('spawn');
      const projectInput = document.getElementById('project');
      const promptInput = document.getElementById('prompt');
      const sendBtn = form.querySelector('button');

      let ws;
      function connect() {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => append('system', 'WS connected');
        ws.onclose = () => { append('system', 'WS closed, retry in 2s'); setTimeout(connect, 2000); };
        ws.onerror = () => append('stderr', 'WS error');
        ws.onmessage = (ev) => {
          let env;
          try { env = JSON.parse(ev.data); } catch { return; }
          renderEnvelope(env);
        };
      }
      connect();

      // Build the row with createElement + textContent — NEVER innerHTML.
      // Agent output is fully untrusted; treating it as plain text is the only safe move.
      function append(kind, text) {
        const row = document.createElement('div');
        row.className = `row ${kind}`;
        const kindSpan = document.createElement('span');
        kindSpan.className = 'kind';
        kindSpan.textContent = `[${kind}]`;
        const bodySpan = document.createElement('span');
        bodySpan.textContent = String(text ?? '');
        row.append(kindSpan, bodySpan);
        stream.appendChild(row);
        stream.scrollTop = stream.scrollHeight;
      }

      function renderEnvelope(env) {
        const p = env.payload ?? {};
        let text = '';
        if (env.kind === 'system_init') text = `model=${p.model} cwd=${p.cwd}`;
        else if (env.kind === 'text') text = p.text;
        else if (env.kind === 'partial_text') text = p.delta;
        else if (env.kind === 'thinking') text = `${p.thinking}`;
        else if (env.kind === 'tool_use') text = `${p.name}(${JSON.stringify(p.input)})`;
        else if (env.kind === 'result') text = `cost=$${p.total_cost_usd ?? 0} dur=${p.duration_ms ?? 0}ms`;
        else if (env.kind === 'stderr') text = p.text;
        else if (env.kind === 'exit') text = `exit code ${p.code}`;
        else text = JSON.stringify(p);
        append(env.kind, text);
      }

      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        sendBtn.disabled = true;
        const projectPath = projectInput.value.trim();
        const prompt = promptInput.value.trim();
        try {
          const r = await fetch('/api/agents', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectPath, prompt }),
          });
          const body = await r.json();
          if (!r.ok) { append('stderr', JSON.stringify(body)); return; }
          const agentId = body.agentId;
          append('system', `agent ${agentId} spawned`);
          ws.send(JSON.stringify({ resume: { agentId, since_seq: -1 } }));
        } finally {
          sendBtn.disabled = false;
        }
      });
    </script>
  </body>
</html>
```

- [ ] **Step 2: Manual end-to-end via Mac browser**

Run: `npm --workspace @cockpit/server run dev`
Open `http://localhost:8787` in Chrome.
- Enter `projectPath`: the absolute path of an existing folder (`/Users/nirwolff/AI Development/claude-cockpit`).
- Enter `prompt`: `Say hi in five words.`
- Click Send.

Expected: WS rows appear in real time — `[system_init]`, possibly `[partial_text]`/`[text]` blocks, ending with `[result]` and `[exit code 0]`.

- [ ] **Step 3: Manual end-to-end via iPhone Safari**

Find your Mac's LAN IP: `ipconfig getifaddr en0` (or check System Settings → Network).
On iPhone: open Safari → `http://<your-mac-ip>:8787`.
Enter project + prompt, click Send.
Expected: identical streaming behavior on the phone.

If iPhone can't connect: confirm Mac firewall allows incoming on port 8787 (System Settings → Network → Firewall → Options → allow `node`).

- [ ] **Step 4: Commit**

```bash
git add packages/server/public/index.html
git commit -m "feat(web): minimal raw-HTML client — spawn agents, stream envelopes via WS (textContent only, no innerHTML)"
```

---

## Task 10: `start-cockpit.sh` launcher

**Files:**
- Create: `start-cockpit.sh`

- [ ] **Step 1: Create `start-cockpit.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[cockpit] installing dependencies…"
  npm install
fi

echo "[cockpit] starting on ${COCKPIT_HOST:-0.0.0.0}:${COCKPIT_PORT:-8787}"
echo "[cockpit] Mac LAN IP:  $(ipconfig getifaddr en0 2>/dev/null || echo unknown)"
echo "[cockpit] open http://localhost:${COCKPIT_PORT:-8787} or the LAN IP above from any device"

exec npm --workspace @cockpit/server run dev
```

- [ ] **Step 2: Make executable + smoke test**

Run:
```bash
chmod +x start-cockpit.sh
./start-cockpit.sh
```
Expected: identical startup to `npm run dev` but with the LAN IP printed. Ctrl-C to stop.

- [ ] **Step 3: Commit**

```bash
git add start-cockpit.sh
git commit -m "chore: start-cockpit.sh launcher (auto-install + LAN IP echo)"
```

---

## Task 11: Self-verification checklist

This is a non-coding task — exercise the M1 demo end-to-end and verify each acceptance criterion before marking M1 done.

- [ ] **Step 1: All automated tests pass**

Run: `npm test`
Expected: parser (7), normalizer (8), registry (6) — 21 tests total green.

- [ ] **Step 2: Lint is clean**

Run: `npm run lint`
Expected: no errors. Fix any inline. Commit fixes if any.

- [ ] **Step 3: Cold-start works**

```bash
rm -rf node_modules packages/*/node_modules
./start-cockpit.sh
```
Expected: install succeeds; server listens on 0.0.0.0:8787.

- [ ] **Step 4: Demo path — spawn from Mac browser**

Open `http://localhost:8787`. Enter a real project path. Send `What is 2+2? Answer in one word.` Expect a `result` envelope arrives with `cost=$X dur=Yms` and a `[text]` row containing `Four` or similar. The agent finishes; an `[exit code 0]` row appears.

- [ ] **Step 5: Demo path — spawn from iPhone over LAN**

Same on iPhone Safari at `http://<mac-ip>:8787`. Identical result.

- [ ] **Step 6: Demo path — two simultaneous agents**

In two browser tabs, send two different prompts ~1 second apart, both to the same project path. Each tab streams only its own agent (subscribed via `resume` after the POST returns).

- [ ] **Step 7: Smoke crash isolation**

In a third tab, send a prompt to a non-existent project path (e.g. `/tmp/does-not-exist-xyz`). The `claude` subprocess will exit non-zero quickly; the cockpit must remain responsive and the other two agents must keep running. The third tab shows `[stderr] …` and `[exit code N]`.

- [ ] **Step 8: Final commit if any inline fixes**

```bash
git status
# If anything changed during verification, commit:
git add -p
git commit -m "fix(m1): verification-pass tweaks"
```

- [ ] **Step 9: Tag the milestone**

```bash
git tag -a m1 -m "M1: backend skeleton + single-agent streaming + LAN bind"
```

---

## What M1 explicitly does NOT do (deferred to later milestones)

- Worktrees (M2)
- Folder picker (M2)
- Multi-agent UI shell with the panes from the spec (M2 onwards)
- DESIGN.md detection / injection (M3)
- Vite preview iframe (M3)
- Relations graph (M4)
- Monaco editor pane (M4)
- Mobile bottom-tab layout (M5)
- sqlite persistence / resume on restart (M5)
- Audit log (M5)
- Keyboard shortcuts (M6)

If any of these "leaks into M1" during execution, stop and ask whether to move it to its own milestone plan instead of expanding M1's scope.

---

## Spec coverage for M1 (self-review)

| Spec requirement | Task covering it |
|------------------|------------------|
| Hono HTTP gateway with `/api/health`, `/api/agents` | Tasks 3, 8 |
| WebSocket gateway, `{resume: {agentId, since_seq}}` protocol | Task 7 |
| NDJSON parser tolerating partial chunks + UTF-8 splits | Task 4 |
| `SDKMessage → Envelope` normalizer (M1 subset) | Task 5 |
| Agent supervisor spawning `claude -p ... stream-json` w/ documented flag set | Task 8 |
| Monotonic per-agent `seq` + replay tail | Task 6 |
| Minimal client that reaches the iPhone | Task 9 |
| LAN bind `0.0.0.0:8787` | Task 3 (config), Task 10 (launcher) |
| Demo: open in browser, type prompt, see stream | Task 11 |

All M1 spec items covered.
