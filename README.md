# Claude Cockpit

A self-hosted multi-pane web UI that wraps the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) so you can run several `claude` agents in parallel and watch them side-by-side from any device on your network.

**JaViSWo** is what happens when you stop juggling four terminals to run four Claude Code sessions and instead point a browser at a single cockpit on your Mac. Each conversation is a tab; each tool call streams live; thinking blocks collapse into one chip; partial-text deltas aggregate into a single growing bubble. Type a prompt on your laptop, walk to the couch and continue on your iPhone — the conversation syncs across every connected device. Voice in (local MLX-Whisper), TTS out. Wraps the `claude` CLI rather than the SDK, so every subprocess inherits your `~/.claude/` plugins, skills, MCP servers, and hooks for free. Built for power users who already live in Claude Code and want one place to watch everything happen.

> **Heads up — no built-in auth.** The server binds `0.0.0.0:8787` by default and exposes spawn/file/transcribe endpoints with no authentication. Run it on a trusted LAN or, recommended, expose it only over [Tailscale](https://tailscale.com). Do **not** port-forward to the public internet.

## Status

This repo tracks milestone **M1.15** — a working single-process server with multi-agent spawn, live streaming, cross-device sync, and voice input. Features described in `docs/superpowers/specs/2026-05-15-claude-cockpit-design.md` beyond M1 (Vite preview proxy, Monaco editor, relations graph, DESIGN.md linting, sqlite-backed persistence) are **not implemented yet**.

## What works today

- Spawn multiple `claude` subprocesses, each rooted in a different project folder
- Stream tokens, tool calls, and thinking blocks to the browser over WebSocket
- Send follow-up turns to a running agent from any connected device
- Cross-device sync — open the same agent on your iPhone and Mac, see the same conversation
- Whitelisted project picker (`COCKPIT_ROOTS`) — agents can only touch folders you allow
- Voice input — local Whisper (mlx_whisper / whisper-cpp) with OpenAI fallback
- Read-only file tree + git status per agent worktree

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 22+ | Uses native fetch and `import.meta.dirname` |
| Claude Code CLI | 2.1.63+ | `claude` must be on `PATH`; you must be logged in (`claude login`) |
| npm | 10+ | Ships with Node 22 |
| `ffmpeg` | optional | Needed only for voice input WebM → WAV conversion |
| `mlx_whisper` or `whisper-cpp` | optional | Local voice transcription; falls back to OpenAI if missing |

## Install & run

```bash
git clone https://github.com/nirwo/JaViSWo.git
cd JaViSWo
npm install
./start-cockpit.sh
```

The launcher prints both the localhost URL and your Mac's LAN IP. Open either from any device on the same network (or Tailnet).

```
[cockpit] starting on 0.0.0.0:8787
[cockpit] Mac LAN IP:  100.64.0.12
[cockpit] open http://localhost:8787 or the LAN IP above from any device
```

## Configuration

All configuration is environment variables — no config file required.

| Variable | Default | Description |
| --- | --- | --- |
| `COCKPIT_HOST` | `0.0.0.0` | Bind address. Set to `127.0.0.1` to restrict to localhost only. |
| `COCKPIT_PORT` | `8787` | HTTP + WebSocket port. |
| `COCKPIT_ROOTS` | `~/AI Development:~/Projects` | Colon-separated list of folders the project picker is allowed to browse. Non-existent paths are silently dropped. |
| `OPENAI_API_KEY` | _(unset)_ | Optional. Enables OpenAI Whisper fallback when no local transcription backend is available. |

Example — restrict to one project tree and bind to Tailscale only:

```bash
COCKPIT_HOST=100.64.0.12 \
COCKPIT_ROOTS=~/code \
./start-cockpit.sh
```

## How it works

```
  Browser (iPhone / Mac / iPad)
            │  HTTP + WebSocket
            ▼
  ┌───────────────────────────────┐
  │ Cockpit server (Node, single  │
  │ process, Hono + ws)           │
  └───────────────────────────────┘
            │ child_process.spawn
   ┌────────┼─────────┐
   ▼        ▼         ▼
 claude   claude    claude     ← one subprocess per agent
 --output-format stream-json
```

Each agent is a `claude` subprocess. The cockpit parses its NDJSON stream into typed envelopes (`packages/shared/src/envelope.ts`) and rebroadcasts them to every connected WebSocket client. Because the cockpit doesn't call Anthropic directly, every subprocess inherits your local `~/.claude/` configuration — plugins, skills, MCP servers, hooks.

Source layout:

```
packages/
├── server/   # Hono HTTP API + ws WebSocket gateway + static frontend
│   └── src/  # config, supervisor, registry, parser, http, ws, transcribe, …
└── shared/   # Envelope + SDKMessage types shared with the browser
```

## Project scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the server in watch mode (alias for `--workspace @cockpit/server run dev`) |
| `npm run build` | Type-check + compile all workspaces |
| `npm test` | Run vitest across workspaces |
| `npm run lint` | ESLint on all `packages/` |
| `npm run format` | Prettier-format all `packages/` |

## API surface (M1.15)

- `GET  /api/health` — health probe
- `GET  /api/agents` — list active + recent agents (used for cross-device bootstrap)
- `POST /api/agents` — spawn a new agent: `{ projectPath, prompt, model?, maxTurns?, maxBudgetUsd? }`
- `POST /api/agents/:id/turn` — append a user message to a running agent
- `GET  /api/projects/roots` — list configured roots
- `GET  /api/files/tree?root=…&depth=…` — read-only directory tree
- `POST /api/transcribe` — multipart audio upload → text
- `WS /` — subscribe to live envelope stream; client may send `{ resume: { agentId, since_seq } }`

## Troubleshooting

- **"command not found: claude"** — install the Claude Code CLI and run `claude login`. Verify with `which claude`.
- **Empty project picker** — set `COCKPIT_ROOTS` to a folder that exists on your machine.
- **Connection refused from another device** — confirm `COCKPIT_HOST=0.0.0.0` (the default) and that your firewall allows inbound `8787`.
- **Voice input falls back to OpenAI unexpectedly** — install `mlx-whisper` (Apple Silicon) or `whisper-cpp` (Homebrew: `brew install whisper-cpp`) for local transcription.
- **Stale agent after server restart** — agent state is in-memory only at M1; restart clears it. Persistent registry is on the M2 roadmap.

## Roadmap

See `docs/superpowers/specs/2026-05-15-claude-cockpit-design.md` for the full design. Near-term milestones beyond M1.15:

- M2 — sqlite-backed registry, message tail beyond the in-memory 500-event cap
- M3 — Vite preview proxy (live iframe per worktree)
- M4 — Monaco inline file editor, file-watch diffs
- M5 — relations graph for parent → subagent dispatches
- M6 — DESIGN.md auto-loading + lint integration

## License

MIT — see [`LICENSE`](LICENSE).
