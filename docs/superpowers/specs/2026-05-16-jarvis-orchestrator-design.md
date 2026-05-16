# JARVIS Orchestrator — Design Spec

**Date:** 2026-05-16
**Status:** Approved
**Project:** JaViSWo / Claude Cockpit
**Author:** nir + Claude Opus 4.7

---

## Overview

Add **JARVIS mode** to JaViSWo — a voice-first orchestrator layer that lets the user speak naturally while sub-agents do the technical work. The reference point is Avengers JARVIS: a conversational AI you talk to, who dispatches the real work behind the scenes and reports back in plain English.

The user's stated goal: a non-technical-feeling control surface for an actually-technical engineering tool. The user speaks; JARVIS decomposes intent into concrete coding tasks; worker agents (the existing cockpit) do the code; JARVIS narrates progress aloud.

## Architecture

Two-layer agent system. The user only ever talks to JARVIS.

```
User ──(voice)──► JARVIS (claude-haiku-4-5, conversational)
                      │
                      │ dispatchTask({title, description, projectPath, model})
                      ├──────────────────────────────────────► Worker (Sonnet/Opus)
                      │                                            │
                      │ ◄────── envelope stream (existing WS) ─────┤  (writes code)
                      │ ◄────── tool_use / text / result ──────────┤
                      │
                      │ summarize aloud (throttled)
User ◄──(speech)──────┘
```

Key separation:
- **JARVIS** owns voice I/O, intent parsing, and worker orchestration. He never writes code.
- **Workers** are the existing cockpit agents. They write code. They don't speak.

This separation is what makes the user feel like they're talking to one entity while many things happen in parallel.

## Components

### Frontend

| Component | Path | Responsibility |
|-----------|------|----------------|
| `<JarvisOverlay>` | `public/components/JarvisOverlay.jsx` | Full-screen pulsing-orb overlay with live transcript and worker tray. States: `idle` (hidden), `wake-detected`, `listening`, `processing`, `speaking`, `error`. |
| Wake loop | inside `<JarvisOverlay>` (M3.2) | Chrome `webkitSpeechRecognition` continuous-mode listener. On match `/\bjarvis\b/i`, opens overlay and starts MediaRecorder for the command. |
| Topbar toggle | `public/components/TopBar.jsx` | Add "🎙 JARVIS" button next to Settings. Toggles `jarvisMode` boolean in cockpit hook state. |
| Cockpit-hook | `public/components/cockpit-hook.jsx` | New state slice: `{ jarvisEnabled, jarvisState, jarvisTranscript, jarvisLastSpeech, jarvisWorkers }`. |

### Backend

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/server/src/jarvis.ts` (new) | M3.3 | JARVIS Haiku agent class. Long-lived. Owns the orchestrator session (one per cockpit, persisted in sqlite). Implements 5 tools. |
| `packages/server/src/http.ts` | M3.3-M3.5 | New endpoints: `POST /api/jarvis/say`, `GET /api/jarvis/state`. |
| `packages/server/src/db.ts` | M3.5 | Add `jarvis_sessions` table; add `spawned_by` column to `agents`. |
| `packages/server/src/supervisor.ts` | M3.3 | New method `interruptAgent(agentId): boolean` (already partially supported via `stop` — extend to surface a structured envelope). |

## Wake Loop

Browser-native, no extra deps:

```
JARVIS toggle ON
  │
  ▼
new webkitSpeechRecognition()
  .continuous = true
  .interimResults = true
  .lang = 'en-US'
  │
  ▼
on result event:
  scan transcript for /\bjarvis\b/i
  └─► YES: stop wake recognizer, dim cockpit, open overlay, start MediaRecorder
      │
      ▼
      record until 1.5s silence (analyser RMS < 0.02)
      │
      ▼
      POST audio to /api/voice/transcribe (existing mlx-whisper path)
      │
      ▼
      M3.2: display transcript in overlay
      M3.3+: POST to /api/jarvis/say { text } → JARVIS agent processes
```

**Safari/iPhone fallback:** `webkitSpeechRecognition` is Chrome-only. On unsupported browsers, the overlay still works via the existing push-to-talk mic button — wake word is degraded to "click the mic, then talk." JARVIS still functions; just hands-on instead of hands-free.

## Overlay UI

When `jarvisState !== 'idle'`:
- Cockpit dimmed to 8% opacity behind a `backdrop-filter: blur(20px)` layer.
- Centered: aurora orb (purple → cyan radial gradient, animated pulse synced to listening/speaking state).
- Below orb: live transcript text, large, monospace, fades in word-by-word.
- Below transcript: worker tray — small chips for each agent JARVIS has dispatched in this session, with status pulse.
- Bottom-right: "Esc to dismiss" hint.

Dismiss triggers:
- User says "thanks JARVIS" or "that's all"
- User presses Escape
- User clicks outside the orb
- JARVIS himself returns to idle after completing all dispatched work (configurable; default: stays open until manual dismiss)

## TTS Narration (M3.4)

JARVIS speaks via existing `SpeechSynthesisUtterance` path (Daniel/Bruce voice on macOS). Throttling rules to avoid chatter:

| Event | Speak? | Notes |
|-------|--------|-------|
| User wake + transcribe done | ✅ | "Yes, sir." or "Right away." (random from short ack list) |
| Worker dispatched | ✅ | "Working on it now." or "Dispatching to a worker." |
| Worker `tool_use` | ❌ | Silent — no per-tool play-by-play |
| Worker `result` (turn done) | ✅ | Summarize: file count, test status |
| Worker `exit` non-zero | ✅ | "Something went wrong, sir — [stderr summary]." |
| Worker `text` (final reply) | ❌ | JARVIS reads it and decides what to speak; he doesn't echo it verbatim |
| Throttle | — | Min 8s between speeches during a single worker's run |

JARVIS's own conversational replies (from his Haiku agent) all go through TTS.

## Course Correction (M3.4)

The user can redirect a running worker by interrupting JARVIS:

```
Worker `abc123` is running on task "redesign landing page"
  │
  │ User: "Hey JARVIS, actually use dark theme"
  │
  ▼
JARVIS receives transcript + context that abc123 is running
  │
  ▼
JARVIS speaks ack: "Right, switching to dark — stopping the current attempt."
  │
  ▼
JARVIS classifies (system-prompt task):
  ├─ Refinement → interruptAgent(abc123) → continueAgent(abc123, "Switch to dark theme, discard the light-theme work")
  │              Worker keeps prior context, fixes course.
  │
  └─ New direction → interruptAgent(abc123) → dispatchTask({new task})
                     Fresh agent, clean context.
```

Critical: JARVIS **always speaks acknowledgement before killing**. If he reads the redirect wrong, the user corrects mid-flight ("no JARVIS, start over").

## JARVIS Agent (M3.3)

A long-lived Haiku 4.5 session, persisted across server restarts. Spawned via the existing `claude` CLI subprocess infrastructure but with:

- `--model claude-haiku-4-5`
- `--append-system-prompt` with the JARVIS persona prompt (see below)
- Custom tool definitions loaded via `--mcp-config` or direct prompt injection (TBD — investigate during M3.3)

### JARVIS system prompt

```
You are JARVIS — an AI orchestrator for a software cockpit. The user speaks
to you naturally; you decompose their requests into concrete coding tasks
and delegate to worker agents. You never write code yourself.

PERSONA: Dry British butler. Concise. Formal-but-warm. Address the user
as "sir". Never apologize excessively. Never explain technical details
unless asked.

RULES:
1. When the user gives an instruction, classify:
   - Build/fix request → use dispatchTask
   - Question about a running worker → use getWorkerStatus, summarize aloud
   - Redirect on a running worker → use interruptWorker then continueAgent
     (refinement) or dispatchTask (new direction)
   - Conversational → answer briefly with speakToUser, no dispatch needed
2. Always speak before any tool call so the user hears acknowledgement
   first ("Right away, sir.", "Switching gears now.").
3. Summarize worker results in plain English. Don't read file paths or
   stack traces unless the user asks.
4. If you don't know which project the user means, ask.
5. Default to the user's currently selected model (provided in context).

You have 5 tools: dispatchTask, getWorkerStatus, interruptWorker,
listProjects, speakToUser.
```

### Tools

| Tool | Args | Effect |
|------|------|--------|
| `dispatchTask` | `{ title, description, projectPath, model? }` | Calls `supervisor.spawnAgent` with the description as the prompt. Returns `agentId`. |
| `getWorkerStatus` | `{ agentId }` | Reads `registry.get(agentId)` + tail of envelope log. Returns summary. |
| `interruptWorker` | `{ agentId }` | Calls `supervisor.stop(agentId)`. Returns success. |
| `listProjects` | `{}` | Returns `config.roots` and `recents.list()`. |
| `speakToUser` | `{ text }` | Returns `{ ok: true }`. The text becomes part of JARVIS's agent-text envelope, which the overlay picks up and pipes to SpeechSynthesis. |

## Persistence (M3.5)

```sql
CREATE TABLE jarvis_sessions (
  id          TEXT PRIMARY KEY,    -- one row, singleton
  agent_id    TEXT NOT NULL,        -- the Haiku agent's ID in the agents table
  created_at  INTEGER NOT NULL,
  last_active INTEGER NOT NULL
);

ALTER TABLE agents ADD COLUMN spawned_by TEXT;  -- 'user' | 'jarvis'
```

JARVIS's conversation persists like any other agent. On server restart, the cockpit checks for an existing `jarvis_sessions` row and re-attaches. Workers JARVIS dispatched are tagged so the UI can badge them.

## Cockpit Integration

- **Topbar toggle** — new button "🎙 JARVIS" next to Settings. Toggles `jarvisEnabled`. When enabled, wake loop starts.
- **Agent badging** — workers with `spawned_by='jarvis'` show a small JARVIS chip in their tab.
- **Model picker still applies** — JARVIS reads `selectedModel` from the cockpit hook and passes it to `dispatchTask`. Whatever you have set is what JARVIS's workers use.
- **Existing chat UI** — unchanged. You can still type into the composer manually. JARVIS just adds a parallel voice path.

## Open Questions

1. **MCP vs prompt-injection for tools** — Claude CLI supports MCP servers via `--mcp-config`. Should we run JARVIS's tools as a local MCP server, or inject the tool schemas into the system prompt and parse JSON tool calls from his text output? **Decision: investigate during M3.3 spike. MCP is cleaner; injection is simpler. Default to MCP if the CLI supports custom local MCP server registration via stdio.**
2. **Multi-worker narration** — if JARVIS has 3 workers running, how does he know which to narrate? **Default: the most-recently-active one. Configurable later.**
3. **Cross-device** — the iPhone client doesn't run wake-word (no webkitSpeechRecognition in iOS Safari for continuous mode). JARVIS state should still sync to iPhone via the existing envelope stream — user just can't trigger him from iPhone via voice. They can see his transcript and worker tray.

## Milestones

| Milestone | Scope | Estimated effort |
|-----------|-------|------------------|
| **M3.2** | Wake loop + overlay (no agent — just listen, transcribe, display). Topbar toggle. CSS. | Small (~200 LOC, one commit) |
| **M3.3** | JARVIS Haiku agent class. 5 tools. `/api/jarvis/say` endpoint. Persona prompt. | Medium (~500 LOC) |
| **M3.4** | TTS narration (throttled). Course correction logic. Worker event subscription in overlay. | Medium (~300 LOC) |
| **M3.5** | sqlite `jarvis_sessions` + `spawned_by` column. Worker badging. Cross-device sync. | Small (~150 LOC) |

Each milestone ships independently. M3.2 alone gives voice-controlled command entry; M3.3 makes JARVIS actually orchestrate; M3.4 makes him talk back; M3.5 makes him survive restarts.

## Out of Scope (future)

- Wake-word customization (always "JARVIS" for v1)
- Other personas ("Cortana", "Friday", etc.)
- Local TTS upgrade (Piper) — easy follow-up once base path works
- Picovoice wake-word for better latency / Safari support
- Multi-user JARVIS (shared orchestrator across LAN clients) — for v1, each client gets its own wake loop but they all talk to the same persisted JARVIS agent
- Visualizing JARVIS's decision tree (which workers are running, who's blocked on whom)
