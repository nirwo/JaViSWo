---
title: Claude Cockpit — multi-agent Claude Code web UI
date: 2026-05-15
status: draft (awaiting user review)
project: claude-cockpit (greenfield, /Users/nirwolff/AI Development/claude-cockpit/)
authors: Nir + Claude (brainstorming session 2026-05-15)
related: depends on @anthropic-ai/claude-agent-sdk + Claude Code CLI v2.1.63+
---

# Goal

A self-hosted web cockpit running on Nir's Mac that wraps the Claude Code CLI into a multi-pane, multi-agent UI accessible from any LAN device (iPhone, iPad, Mac). The cockpit lets Nir:

1. **Run 3–5 Claude Code agents in parallel**, each in its own git worktree, each visible side-by-side.
2. **Watch live token streams, tool calls, and subagent dispatches** for every active agent.
3. **See a relations graph** of parent → subagent dispatches in real time.
4. **Live-preview** the running project for each agent (Vite dev server iframed per worktree).
5. **Render Artifacts-style HTML/JSX previews** in a sandboxed iframe.
6. **Inline-edit files** in each worktree with a Monaco editor pane.
7. **Browse computer project folders** (whitelisted roots) to pick which folder an agent runs in.
8. **Monitor token usage, cost, and rate-limit headroom** in a persistent status bar.
9. **Track background jobs** (long-running tasks spawned by agents).
10. **Respect a project's `DESIGN.md`** — agents auto-load it; Artifacts auto-lint against it.
11. **Send new prompts to running agents from the couch (iPhone) over Tailscale.**

# Non-goals

- Replacing Claude Code itself. The cockpit *wraps* the `claude` binary; it does not reimplement the agent loop.
- Multi-user accounts. Single user (Nir); LAN-trusted; no app-level auth in v1 (Tailscale handles trust).
- Cloud hosting. Cockpit runs on Nir's Mac only.
- Public internet exposure. Bind defaults to LAN; documented Tailscale recommendation.
- Light-mode theme. Dark-only in v1; light deferred to post-v1.
- Custom AI calls beyond what the CLI exposes. No direct Anthropic SDK use; all model calls go through `claude`.

# Approach (locked)

**Approach B — Wrap Claude Code CLI subprocesses.**

- Backend: Node.js 22+ TypeScript service that spawns `claude -p "<prompt>" --output-format stream-json --include-partial-messages --include-hook-events --bg --worktree <slug> --add-dir <projectPath>` per agent.
- Each subprocess auto-loads the user's full `~/.claude/` config (plugins, skills, MCPs, hooks).
- The NDJSON stream emitted by `claude --output-format stream-json` matches the `SDKMessage` union from `@anthropic-ai/claude-agent-sdk` and is the cockpit's single source of truth.
- Frontend: React 18 + Vite + Zustand + React Query, served by the same Node process.
- Communication: HTTP (Hono) for control plane, WebSocket (`ws`) for streaming events.
- Persistence: `better-sqlite3` for agent registry, message tail, projects, worktrees.

Why this and not SDK-direct or Overstory-fork:

- The CLI's `--bg`, `--worktree`, `--resume`, `agents`, `attach`, `logs` flags already provide the orchestration primitives we need. We do not reimplement them.
- Each subprocess inherits Nir's installed plugins (ralph-loop, financial-analysis, sentry, supabase, etc.). The cockpit is *his* Claude Code, multiplexed.
- Process isolation: one crashing agent does not crash the cockpit.
- Less to maintain. No second config surface.

# System architecture

```
  Browser clients (iPhone Safari, Mac Chrome, iPad)
            │  HTTP + WebSocket (over Tailnet, recommended)
            ▼
  ┌─────────────────────────────────────────────┐
  │ Cockpit server  (Node 22+, TS, single proc) │
  │ binds 0.0.0.0:8787 by default               │
  │ /Users/nirwolff/AI Development/claude-cockpit/
  └─────────────────────────────────────────────┘
            │
   ┌────────┼────────────┬────────────┐
   ▼        ▼            ▼            ▼
  spawn    spawn        spawn        read/write
  claude   claude       claude       whitelisted roots
  --bg     --bg         --bg         (~/AI Development, ~/Projects)
  --wt a   --wt b       --wt c
```

## Server modules (single Node process)

- **HTTP gateway (Hono)**
  - `GET  /api/projects?root=…`         — list folders under whitelisted roots
  - `POST /api/agents`                  — spawn `{ projectPath, prompt, model?, slug? }`
  - `GET  /api/agents`                  — list active + recent
  - `POST /api/agents/:id/stop`         — sigterm subprocess
  - `POST /api/agents/:id/resume`       — `claude --resume <sessionId>`
  - `POST /api/agents/:id/prompt`       — append a user message to a running agent
  - `GET  /api/worktrees`               — list per-project
  - `POST /api/worktrees/:id/clean`     — `git worktree remove --force`
  - `GET  /api/files/*`                 — read (scoped to active worktrees + project root)
  - `PUT  /api/files/*`                 — write (same scoping; explicit allowlist)
  - `GET  /api/design/:projectId`       — parse + lint DESIGN.md
  - `POST /api/design/:projectId/init`  — generate starter DESIGN.md from template
- **WebSocket gateway (ws)**
  - One connection per browser; per-agent subscription topics + a global topic.
  - Resume protocol: client sends `{resume: {agentId, since_seq}}` on (re)connect; server tails last 500 events per agent from sqlite.
- **Agent supervisor**
  - `child_process.spawn` pool; line-buffered NDJSON parser; envelope normalizer.
  - Tracks subprocess `pid`, `sessionId`, cumulative `usage`, `lastSeenAt`.
  - Soft cap: 5 concurrent streaming agents (configurable). Beyond cap, queue.
- **Vite-preview proxy**
  - One `vite dev` spawned on demand per worktree (port auto-picked).
  - Exposed at `/preview/<agentId>/` via http-proxy-middleware; HMR over WS pass-through.
- **File-watch / diff service**
  - `chokidar` on each active worktree; emits `file-changed` envelopes.
  - Computes unified diff against `cockpit/<slug>` base commit on demand.
- **Persistence (better-sqlite3)**
  - Tables: `agents`, `messages`, `worktrees`, `projects`, `audit_log`.
  - WAL mode. Survives server restart; on boot, list known sessions and reattach via `claude logs <sessionId> --follow`.

## Frontend modules

- **React 18 + Vite + TypeScript**, served by Node in prod from `/dist`.
- **State**: Zustand stores keyed by `agentId`; one slice per pane.
- **HTTP**: React Query.
- **Streaming**: native `WebSocket`, reconnect with exponential backoff (1s, 2s, 4s, max 30s), resume payload includes `since_seq`.
- **Routing**: TanStack Router (file-based, type-safe). Routes: `/` (cockpit), `/agent/:id`, `/preview/:id/*` (proxied), `/design/:projectId`.
- **Editor**: Monaco (`@monaco-editor/react`).
- **Graph**: Cytoscape.js for the relations DAG.
- **Markdown / DESIGN.md**: react-markdown + DOMPurify; `@google/design.md` for parse + lint.
- **Artifact iframe**: `<iframe sandbox="allow-scripts" srcdoc="…">` with DOMPurify pre-pass.

# Agent lifecycle

```
[draft] → [provisioning] → [spawning] → [running] ─┬→ [paused] → [running]
                                                    ├→ [completed]
                                                    ├→ [errored]
                                                    └→ [archived]
```

- **provisioning**: `git worktree add <projectRoot>/.cockpit/<slug>` on branch `cockpit/<slug>` from current HEAD.
- **spawning**: spawn `claude -p "<prompt>" --output-format stream-json --include-partial-messages --include-hook-events --bg --worktree <slug> --add-dir <projectPath> --max-turns 30 --max-budget-usd 5 --permission-mode bypassPermissions`. Capture `sessionId` from first `system_init` message.
- **running**: NDJSON streamed; envelopes fanned out to subscribed clients.
- **paused**: `kill -STOP <pid>`. Resumed via `kill -CONT <pid>`. (Background mode survives even server crashes.)
- **completed**: `SDKResultMessage` arrives; subprocess exits 0. Status latched.
- **errored**: subprocess exits non-zero, or rate-limit hit, or budget exceeded.
- **archived**: worktree retained. Optional explicit "clean" removes worktree + branch.

## Resumption

- Server crash recovery: on boot, query sqlite for non-terminal `agents`; for each, run `claude attach <sessionId>` (or `claude logs <sessionId> --follow --output-format stream-json`) to reattach the NDJSON stream.
- "Resume archived" action: `claude --resume <sessionId>` reopens a finished session for continuation.

## Concurrency & rate-limit

- Soft cap: 5 simultaneously streaming. Configurable in `~/.cockpit/config.json`.
- Beyond cap: spawn is queued; user sees "queued" status in agent list.
- `SDKRateLimitEvent` from *any* agent globally pauses new spawns until `reset_at`.
- Status bar shows tokens-remaining and reset countdown.

# Data model & event stream

## Source events (NDJSON from `claude --output-format stream-json`)

Matches the `@anthropic-ai/claude-agent-sdk` `SDKMessage` union:

- `SDKSystemMessage` (`subtype: "init"`) — session_id, model, plugins[], tools[], cwd
- `SDKAssistantMessage` — content blocks (text, tool_use, thinking), `message.usage`
- `SDKUserMessage` — tool_result blocks
- `SDKPartialAssistantMessage` — text deltas (live typing)
- `SDKToolUseSummaryMessage` — post-completion summaries
- `SDKHookStartedMessage`, `SDKHookProgressMessage` — user hook events
- `SDKTaskStartedMessage`, `SDKTaskNotificationMessage` — background tasks
- `SDKRateLimitEvent` — global throttle signal
- `SDKPermissionDeniedMessage` — tool blocked
- `SDKResultMessage` — totals: usage, modelUsage, total_cost_usd, duration_ms

Subagent linkage:
- `tool_use` content block where `name === "Task" || name === "Agent"` → graph edge from parent agent → new subagent.
- Every message inside a subagent carries `parent_tool_use_id` matching that block's `id`.

## Server-side WebSocket envelope (v1)

```typescript
type Envelope = {
  v: 1;
  agentId: string;          // server-issued, stable
  sessionId: string;        // claude session_id
  parentToolUseId?: string; // for subagent traffic
  seq: number;              // monotonic per agent
  ts: number;               // ms epoch
  kind:
    | "system_init" | "text" | "partial_text" | "thinking"
    | "tool_use" | "tool_result" | "tool_use_summary"
    | "hook_started" | "hook_progress"
    | "task_started" | "task_progress"
    | "rate_limit" | "permission_denied"
    | "result" | "stderr" | "exit";
  payload: unknown;         // type-narrowed by kind via discriminated union
};
```

## Pane → event mapping

| Pane | Event source |
|------|--------------|
| A · Agent list | `system_init` + `result` + `exit` + cumulative usage |
| B · Stream | `text` + `partial_text` + `thinking` + `tool_use` + `tool_result` |
| C · Relations graph | `tool_use(name in {Task, Agent})` + child `parentToolUseId` |
| D · Live preview | chokidar file-change → reload `/preview/<agentId>/` iframe |
| E · Inline editor | on-demand `GET/PUT /api/files/*` (not from stream) |
| F · Artifacts | `tool_result` for artifact-producing tools → sandboxed iframe |
| G · Background jobs | `task_started` + `task_progress` |
| Status bar | `result.usage` (cumulative) + `rate_limit` (global) + `total_cost_usd` |

## Frontend state

- Zustand stores: `useAgentsStore`, `useStreamStore` (keyed by agentId), `useProjectStore`, `useDesignStore`.
- Replay on reconnect: `{resume: {agentId, since_seq}}` → server tails events since `seq` from sqlite (cap 500 per agent).
- Idempotency: every envelope has monotonic `seq` per agent; client dedupes.

# UI layout

## Breakpoints

- **≥1280px** (Mac, iPad landscape): full grid — agent rail (A+C stacked) | stream (B) | preview/artifact/diff (D+F) on row 1; editor (E) spans row 2; jobs bar (G) at the foot; top status bar persistent.
- **768–1279px** (iPad portrait, small Mac windows): agent rail collapses into a drawer; B and D side-by-side; E full-width below.
- **<768px** (iPhone): single active pane fills the screen; sticky bottom tab bar `Stream | Diff | Preview | Graph`; sticky prompt input above tabs.

## Keyboard (desktop)

- `⌘K` command palette
- `⌘N` new agent
- `⌘1`…`⌘9` jump to agent N
- `⌘\` toggle preview pane
- `⌘Enter` send prompt to focused agent
- `Esc` close modal / overlay

## Theme

- Bloomberg-style dark: `#0a0d12` bg, `#0e1218` panel, `#1a1f2a` divider, `#d4d8e0` primary text, `#94a3b8` secondary, `#5b6470` muted.
- Cyan accent `#5eead4`. Status colors aligned with the Investor app: BUY-cyan, HOLD-slate, WATCH-amber `#fbbf24`, SELL-pink `#fb7185`, NO_DATA-muted.
- Type: JetBrains Mono for numbers / tickers / stream / code; system-ui for UI chrome.

## Folder picker

- Modal opened from the `+ Agent` button.
- Whitelisted roots from `~/.cockpit/config.json` (defaults: `~/AI Development/`, `~/Projects/`).
- Tree view; drill-in; breadcrumb; recently-used pinned at top.
- DESIGN.md detection badge on each folder.

# DESIGN.md integration

Per-project file detected at `<projectRoot>/DESIGN.md`. Format: Google Labs Code DESIGN.md (YAML frontmatter + markdown body). Library: `@google/design.md` (Apache-2.0).

## Lifecycle

1. **Detection** — folder picker scans for `DESIGN.md`; shows badge if present.
2. **Initialization** — if absent, "Initialize" CTA opens a template gallery (Heritage, Generic Dark, etc.) → writes `DESIGN.md`.
3. **Parsing** — `/api/design/:projectId` runs `parse()` + `lint()`; returns tokens + diagnostics.
4. **Injection** — every agent spawned in a project with DESIGN.md gets:
   - `--append-system-prompt "Project follows DESIGN.md (at @DESIGN.md). Use these tokens. Do not invent colors or type styles outside the system. Run @google/design.md/linter on any HTML/JSX you generate before marking the task complete."`
   - The agent's `Read` tool can load the file on demand (no large prompt bloat).
5. **Validation** — every Artifact pane render runs `lint()` on the emitted HTML; badge displays `✓ matches tokens` or `⚠ N violations` with a hover-list.
6. **Evolution** — "Update DESIGN.md" pane action spawns a small Sonnet agent (with the `frontend-design` skill loaded) to propose token diffs; user approves diff.
7. **Export** — UI button runs `npx @google/design.md export --format <json-tailwind|css-tailwind|dtcg> DESIGN.md` and offers download.

## UI surfaces touched

- Agent list (A): project chip shows `DESIGN ✓` if file present and lint clean; `DESIGN ⚠` on warnings.
- Editor (E): special-case `DESIGN.md` — inline token chip swatches in YAML; `lint()` on save with red squigglies for `broken-ref`; one-click "Run spec checker".
- Artifacts (F): every artifact auto-linted against active project's DESIGN.md.
- Status bar: `🎨 <name> · N colors · M type styles · K errors` when a project is active.
- Folder picker: "Initialize DESIGN.md" CTA on projects without one.

# Security & filesystem boundaries

## Trust zones

```
Tailnet device  →  Cockpit server (Node, your user, API key in env)
                →  Agent worktree (claude subprocess, read/write here)
                →  Artifact iframe (allow-scripts only, null origin, DOMPurify)
```

## Protections

- Bind override flag `--host` (default `0.0.0.0`; recommend Tailnet IP in config).
- Path-traversal guard on every file API: resolve path; verify prefix matches an active worktree or whitelisted root; reject otherwise.
- Anthropic API key only in Node env (`ANTHROPIC_API_KEY`); never serialized to client.
- Artifact iframe: `sandbox="allow-scripts"` only — NEVER combined with `allow-same-origin`. `srcdoc` from a DOMPurify-sanitized string. CSP `frame-src 'self'`.
- Mermaid renders with `securityLevel: 'sandbox'` + DOMPurify post-pass.
- `npm audit` in CI on every build; fail on high/critical (per global rule).
- Per-agent default caps: `--max-budget-usd 5`, `--max-turns 30`. Overridable per spawn.

## Accepted risks (documented)

- No app-level auth. Tailnet-level trust. Compromised Tailnet → attacker can run agents.
- Whitelisted folder browsing exposed to anyone reachable on the port.
- Agent has `Bash` tool in its worktree — same blast radius as Nir's daily Claude Code.

## Audit log

Every spawn, every `/api/files` read/write logged to sqlite `audit_log`: timestamp, remote IP, agentId, action, path, bytes. Surfaced via `claude-cockpit logs` CLI subcommand.

# Error handling matrix

| Failure | Detection | Response |
|---------|-----------|----------|
| Subprocess crash | `child.on('exit', code !== 0)` | mark `errored`; emit `exit` envelope; preserve worktree |
| NDJSON parse error | try/catch per line | log to audit; skip line; continue stream |
| WebSocket disconnect | server pong timeout / client `close` event | client auto-reconnect with `{resume: {agentId, since_seq}}` |
| Rate limit hit | `rate_limit` envelope | global pause on new spawns until `reset_at`; amber status bar |
| `permission_denied` | envelope kind | surface in pane B with "Retry with different permission" CTA |
| Budget exceeded | cumulative usage > cap | sigterm subprocess; mark `archived`; status badge "budget" |
| File API error | try/catch + zod schema validation | 4xx `{ error: { code, message } }` |
| Vite preview crash | child exit event | restart once; on second failure, render fallback card with stderr tail |
| Worktree lock | git stderr "already exists" or .git/index.lock | queue spawn; surface toast; auto-retry after 2s |
| Sqlite I/O error | better-sqlite3 throws | warn; fall back to in-memory; persist again on next successful write |
| DESIGN.md parse error | `@google/design.md` throws | show editor with diagnostic; do not block agent spawn |

# Testing strategy

## Unit (vitest)

- NDJSON line parser: complete lines, partial lines spanning chunks, malformed JSON, empty lines, UTF-8 boundaries
- Envelope normalizer: each `SDKMessage` variant → correct `kind` + `payload`
- Path-traversal guard: `..`, symlinks, absolute paths, drive letters, percent-encoding
- Worktree slug → path mapping
- Replay-from-seq dedupe on the client store
- DESIGN.md lint integration

## Integration (vitest)

- Spawn real `claude -p "say hi"` against a test env; assert `system_init` + `result` arrive normalized
- Spawn 3 agents in 3 worktrees against a sample project; verify isolation (file A only changes in worktree A)
- Trigger a `Task` tool call; verify `parent_tool_use_id` linkage in subsequent envelopes
- Server restart: kill, reboot, verify reattach to running `--bg` session

## E2E (Playwright)

- New-agent flow: open cockpit → click `+ Agent` → pick project → enter prompt → see stream
- Folder picker: whitelisted root only; attempting `../etc` rejected
- Token bar updates as agent runs
- Mobile breakpoint at 375×667: single-pane view + bottom tabs
- WebSocket reconnect: kill server, restart, verify client replays from `since_seq`

## Concurrency stress

- 5 agents × 10 minutes each, varied prompts; count dropped/duplicated envelopes; target zero.

## Coverage gates (per global rule)

- 80% line / 75% branch on new code.
- `npm audit` + path-traversal property tests in CI.

# Phased internal milestones (within 4–6 week v1)

| Milestone | Week | Scope | Demo |
|-----------|------|-------|------|
| **M1** | 1 | Hono server + ws + spawn one `claude` subprocess + envelope normalizer + raw HTML client + LAN bind | Open in iPhone Safari, type prompt, see live stream |
| **M2** | 2 | Multi-agent + git worktree per agent + folder picker + agent list pane (A) + status bar (tokens + rate-limit) + sqlite persistence | 3 agents in 3 worktrees side-by-side |
| **M3** | 3 | Diff view + Artifact iframe (DOMPurify + srcdoc) + Vite preview per worktree at `/preview/:id/*` + DESIGN.md detect/parse/lint | Edit a file, see preview reload; render an artifact, see lint badge |
| **M4** | 4 | Relations graph (Cytoscape from `parent_tool_use_id`) + Monaco editor pane (E) + DESIGN.md editor special-case | Agent dispatches subagents, watch graph build; edit DESIGN.md with token chips |
| **M5** | 5 | Background jobs pane (G) + mobile breakpoints (`<768px`) + resume-on-restart + audit log | Kill server, restart, agents reattach; cockpit on iPhone with bottom tabs |
| **M6** | 6 | Keyboard shortcuts (⌘K palette, ⌘N, ⌘1-9) + onboarding script (`start-cockpit.sh`) + concurrency stress + CodeRabbit/ultrareview hardening pass | Ship to self |

Each milestone is independently usable; cumulative.

# Defaults & config

`~/.cockpit/config.json`:

```jsonc
{
  "host": "0.0.0.0",                   // override to Tailnet IP for stricter binding
  "port": 8787,
  "roots": ["~/AI Development", "~/Projects"],
  "concurrencyCap": 5,
  "agentDefaults": {
    "model": "claude-sonnet-4-6",
    "maxTurns": 30,
    "maxBudgetUsd": 5,
    "permissionMode": "bypassPermissions"
  },
  "preview": {
    "viteCommand": "npm run dev",
    "portRangeStart": 9100
  }
}
```

Config loaded at boot; not mutable via API (security).

`~/.cockpit/state.db` (sqlite). WAL mode.

Process management: a `start-cockpit.sh` launcher script + optional `launchd` plist (mirroring the `bot/com.financehome.botlistener.plist` pattern from the Investor project).

# Repository layout (proposed)

```
claude-cockpit/
├── README.md
├── package.json                # workspaces: server, web, shared
├── tsconfig.base.json
├── start-cockpit.sh
├── docs/superpowers/
│   ├── specs/
│   │   └── 2026-05-15-claude-cockpit-design.md   ← this file
│   └── plans/
│       └── 2026-05-15-claude-cockpit.md          ← writing-plans output
├── packages/
│   ├── shared/                 # envelope types, zod schemas
│   ├── server/                 # Node + Hono + ws + supervisor
│   │   ├── src/
│   │   │   ├── http/           # Hono routes
│   │   │   ├── ws/             # WebSocket gateway
│   │   │   ├── supervisor/     # subprocess + parser + normalizer
│   │   │   ├── preview/        # vite spawn + proxy
│   │   │   ├── files/          # path-guarded fs API
│   │   │   ├── design-md/      # @google/design.md wrapper
│   │   │   ├── persistence/    # better-sqlite3 + migrations
│   │   │   └── index.ts
│   │   └── test/
│   └── web/                    # React + Vite + Zustand
│       ├── src/
│       │   ├── routes/
│       │   ├── panes/          # A..G + StatusBar + FolderPicker
│       │   ├── stores/         # Zustand
│       │   ├── api/            # React Query hooks
│       │   ├── ws/             # client + reconnect + replay
│       │   ├── artifacts/      # sandboxed iframe + DOMPurify
│       │   ├── design-md/      # token chip viewer + editor
│       │   └── main.tsx
│       └── test/
└── e2e/                        # Playwright
```

# Dependencies (curated; pinned exact per global rule)

Server:
- `hono` (HTTP framework)
- `ws` (WebSocket)
- `better-sqlite3` (persistence; native build)
- `chokidar` (file watch)
- `http-proxy-middleware` (Vite preview proxy)
- `zod` (input validation)
- `@google/design.md` (DESIGN.md parse/lint/export)
- `pino` (structured logging per global rule)

Web:
- `react`, `react-dom` 18.x
- `vite` 5.x + `@vitejs/plugin-react`
- `zustand`, `@tanstack/react-query`
- `@tanstack/react-router`
- `@monaco-editor/react`
- `cytoscape`, `cytoscape-cose-bilkent`
- `react-markdown`, `dompurify`, `mermaid`
- `@codesandbox/sandpack-react` (only on Artifact pane when JSX detected)

Dev:
- `typescript` 5.x, `vitest`, `@playwright/test`
- `eslint`, `prettier` (per global formatting rule)

# Open questions (resolve during planning)

1. **Plugin trust** — should an agent spawned in project X be able to load *any* of Nir's `~/.claude/` plugins, or should the cockpit support per-project allowlists? (v1: all; v2: allowlist.)
2. **Multi-project simultaneity** — can two concurrent agents target different projects? (v1: yes; UI must scope folder picker per agent.)
3. **Artifact source detection** — which tool names produce Artifact-style payloads? (Start with: `FrontendDesign`, anything emitting full HTML in `tool_result` content; refine in M3.)
4. **`--max-budget-usd` interaction with subscription credits** — verify behavior under the new Agent SDK monthly credit pool (effective 2026-06-15) during M2.

# References

- [Anthropic Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [TS SDK types (`SDKMessage` union, `Usage`)](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Subagents & `parent_tool_use_id`](https://code.claude.com/docs/en/agent-sdk/subagents)
- [Cost tracking guide](https://code.claude.com/docs/en/agent-sdk/guides/cost-tracking)
- [CLI reference (`--print`, `--output-format`, `--bg`, `--worktree`, `--resume`, `agents`, `attach`, `logs`)](https://code.claude.com/docs/en/cli-reference)
- [DESIGN.md format spec (Google Labs Code)](https://github.com/google-labs-code/design.md)
- [`@google/design.md` npm package](https://www.npmjs.com/package/@google/design.md)
- [Sandpack docs](https://sandpack.codesandbox.io/docs)
- [Reverse-engineering Claude Artifacts (Reid Barber)](https://www.reidbarber.com/blog/reverse-engineering-claude-artifacts) — confirms iframe `allow-scripts` + null-origin pattern
- [Vite HMR over iframe](https://vite.dev/guide/api-hmr)
- [Overstory (prior art)](https://github.com/jayminwest/overstory)
