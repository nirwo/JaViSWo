// cockpit-hook.jsx — live state for the JaViSWo cockpit

// AgentState shape — one per Claude agent the user has spawned:
//   { id, slug, projectPath, status, messages, tokens, cost, sessionId, turn }
//   status: 'idle' | 'running' | 'completed' | 'errored'
//
// Message block shapes:
//   { kind: 'user',          turn, text }
//   { kind: 'thinking',      turn, text }
//   { kind: 'tool_use',      turn, id, name, input, status: 'running'|'done'|'error', resultText? }
//   { kind: 'agent-text',    turn, text }    // aggregates partial_text deltas
//   { kind: 'result',        turn, usage, cost, durationMs }
//   { kind: 'exit',          turn, code }
//   { kind: 'stderr',        turn, text }
//   { kind: 'system_init',   turn, model, cwd }
//   { kind: 'turn-separator',turn }          // inserted at start of turns >= 2

const COCKPIT_STORAGE_KEY = 'cockpit:state:v1';

const MODEL_CHOICES = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-7',   label: 'Opus 4.7' },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5' },
];
window.MODEL_CHOICES = MODEL_CHOICES;

function loadPersistedSelection() {
  try {
    const raw = localStorage.getItem(COCKPIT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function savePersistedSelection(payload) {
  try { localStorage.setItem(COCKPIT_STORAGE_KEY, JSON.stringify(payload)); } catch {}
}

const CockpitContext = React.createContext(null);
window.CockpitContext = CockpitContext;

function useCockpit() {
  const ctx = React.useContext(CockpitContext);
  if (!ctx) throw new Error('useCockpit must be inside <CockpitProvider>');
  return ctx;
}
window.useCockpit = useCockpit;

function CockpitProvider({ children }) {
  const [agents, setAgents] = React.useState(() => new Map());
  const [currentAgentId, setCurrentAgentId] = React.useState(null);
  const [draftProject, setDraftProject] = React.useState(loadPersistedSelection());
  const [wsStatus, setWsStatus] = React.useState('connecting');
  const [latencyMs, setLatencyMs] = React.useState(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [editorFile, setEditorFile] = React.useState(null);  // absolute path or null
  const [centerView, setCenterView] = React.useState('chat'); // 'chat' | 'graph' | 'editor'
  const [collapsedSections, setCollapsedSections] = React.useState(() => {
    try {
      const raw = localStorage.getItem('cockpit:collapsed:v1');
      if (!raw) return new Set();
      return new Set(JSON.parse(raw));
    } catch { return new Set(); }
  });

  // Live project data
  const [projectTree, setProjectTree] = React.useState(null);
  const [projectGit, setProjectGit] = React.useState(null);
  const [projectDesign, setProjectDesign] = React.useState(null);
  const [clientCount, setClientCount] = React.useState(1);

  // Selected model — persisted to localStorage
  const [selectedModel, setSelectedModelState] = React.useState(
    () => localStorage.getItem('cockpit:model') || 'claude-sonnet-4-6',
  );
  const setSelectedModel = React.useCallback((m) => {
    setSelectedModelState(m);
    try { localStorage.setItem('cockpit:model', m); } catch {}
  }, []);

  // TTS
  const [ttsEnabled, setTtsEnabled] = React.useState(
    () => localStorage.getItem('cockpit:tts') === '1',
  );
  const setTts = React.useCallback((v) => {
    setTtsEnabled(v);
    try { localStorage.setItem('cockpit:tts', v ? '1' : '0'); } catch {}
  }, []);

  // JARVIS voice (M3.4) — defaults ON. Independent of `ttsEnabled` (which
  // governs worker-text TTS); this one controls speaking JARVIS's own
  // replies + the spawn/result/exit narration the worker-watcher posts.
  const [jarvisVoice, setJarvisVoiceState] = React.useState(
    () => localStorage.getItem('cockpit:jarvis-voice') !== '0',
  );
  const setJarvisVoice = React.useCallback((v) => {
    setJarvisVoiceState(v);
    try { localStorage.setItem('cockpit:jarvis-voice', v ? '1' : '0'); } catch {}
    if (!v) {
      // Cancel any in-flight utterance immediately so toggling off silences
      // JARVIS without waiting for the current sentence to finish.
      try { speechSynthesis.cancel(); } catch {}
    }
  }, []);

  // JARVIS mode — voice-first orchestrator overlay (M3.2)
  const [jarvisEnabled, setJarvisEnabledState] = React.useState(
    () => localStorage.getItem('cockpit:jarvis') === '1',
  );
  const [jarvisState, setJarvisState] = React.useState('idle');
  // 'idle' | 'wake' | 'listening' | 'processing' | 'done' | 'error'
  const [jarvisTranscript, setJarvisTranscript] = React.useState('');
  const [jarvisError, setJarvisError] = React.useState(null);
  // Diagnostic state — visible to the user via the floating status pill
  const [jarvisListenerStatus, setJarvisListenerStatus] = React.useState('off');
  // 'off' | 'starting' | 'ready' | 'paused' | 'no-support' | 'insecure' |
  // 'no-mic' | 'denied' | 'error'
  const [jarvisInterimText, setJarvisInterimText] = React.useState('');

  const setJarvisEnabled = React.useCallback((v) => {
    setJarvisEnabledState(v);
    if (!v) {
      setJarvisState('idle');
      setJarvisTranscript('');
      setJarvisError(null);
      setJarvisListenerStatus('off');
      setJarvisInterimText('');
    }
    try { localStorage.setItem('cockpit:jarvis', v ? '1' : '0'); } catch {}
  }, []);

  const dismissJarvis = React.useCallback(() => {
    setJarvisState('idle');
    setJarvisTranscript('');
    setJarvisError(null);
    setJarvisReply('');
    // Stop any in-flight TTS so dismiss is truly silent.
    try { speechSynthesis.cancel(); } catch {}
  }, []);

  // M3.3: JARVIS reply rendered in the overlay. We aggregate the text
  // envelopes from JARVIS's agent (excluding any fenced ```jarvis-tool blocks
  // — those are tool calls, not user-facing speech).
  const [jarvisAgentId, setJarvisAgentId] = React.useState(null);
  const [jarvisReply, setJarvisReply] = React.useState('');
  const [jarvisThinking, setJarvisThinking] = React.useState(false);

  // Hide tool work — collapses tool/thinking chips into micro-pills
  const [hideToolWork, setHideToolWork] = React.useState(
    () => localStorage.getItem('cockpit:hide-tool-work') === '1',
  );
  const setHide = React.useCallback((v) => {
    setHideToolWork(v);
    try { localStorage.setItem('cockpit:hide-tool-work', v ? '1' : '0'); } catch {}
  }, []);

  React.useEffect(() => {
    document.body.dataset.hideToolWork = hideToolWork ? 'true' : 'false';
  }, [hideToolWork]);

  const wsRef = React.useRef(null);
  const subscribedRef = React.useRef(new Set());
  const pingRef = React.useRef(null);
  // Keep a ref of current agents for use inside WS callbacks (avoids stale closure)
  const agentsRef = React.useRef(agents);
  React.useEffect(() => { agentsRef.current = agents; }, [agents]);

  // Refresh project file tree, git status, and DESIGN.md
  const refreshProjectData = React.useCallback(async () => {
    if (!draftProject?.path) {
      setProjectTree(null);
      setProjectGit(null);
      setProjectDesign(null);
      return;
    }
    const root = encodeURIComponent(draftProject.path);
    try {
      const [treeR, gitR, designR] = await Promise.all([
        fetch(`/api/files/tree?root=${root}&depth=3`).then(r => r.ok ? r.json() : null),
        fetch(`/api/git/status?root=${root}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/design?root=${root}`).then(r => r.ok ? r.json() : null),
      ]);
      if (treeR?.tree) setProjectTree(treeR.tree);
      if (gitR) setProjectGit(gitR);
      if (designR) setProjectDesign(designR);
    } catch {}
  }, [draftProject]);

  React.useEffect(() => { refreshProjectData(); }, [draftProject?.path]);

  // Refresh git status every 30s while the active agent is running
  React.useEffect(() => {
    const a = currentAgentId ? agents.get(currentAgentId) : null;
    if (!a || a.status !== 'running') return;
    const id = setInterval(refreshProjectData, 30_000);
    return () => clearInterval(id);
  }, [currentAgentId, agents, refreshProjectData]);

  // Periodically refresh client count
  React.useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch('/api/clients');
        if (r.ok) { const j = await r.json(); setClientCount(j.count ?? 1); }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  const updateAgent = React.useCallback((agentId, updater) => {
    setAgents(prev => {
      const cur = prev.get(agentId);
      if (!cur) return prev;
      const next = updater(cur);
      const out = new Map(prev);
      out.set(agentId, next);
      return out;
    });
  }, []);

  const ensureAgent = React.useCallback((agentId, init = {}) => {
    setAgents(prev => {
      if (prev.has(agentId)) return prev;
      const out = new Map(prev);
      out.set(agentId, {
        id: agentId,
        slug: init.slug ?? agentId.slice(0, 12),
        projectPath: init.projectPath ?? '',
        status: 'idle',
        messages: [],
        todos: [],
        tokens: 0,
        cost: 0,
        sessionId: null,
        turn: init.turn ?? 1,
        ...init,
      });
      return out;
    });
    // If WS is already open, subscribe right away so replay happens immediately.
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setTimeout(() => subscribe(agentId), 0);
    }
  }, [subscribe]);

  const subscribe = React.useCallback((agentId) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (subscribedRef.current.has(agentId)) return;
    ws.send(JSON.stringify({ resume: { agentId, sinceSeq: -1 } }));
    subscribedRef.current.add(agentId);
  }, []);

  const handleEnvelope = React.useCallback((env) => {
    if (!env || !env.agentId) return;
    updateAgent(env.agentId, (a) => {
      const t = a.turn;
      const msgs = a.messages;
      const last = msgs[msgs.length - 1];
      switch (env.kind) {
        case 'user_prompt': {
          const turn = env.payload?.turn ?? a.turn ?? 1;
          const isNewTurn = turn > 1 && turn !== a.turn;
          const newMessages = [...msgs];
          if (isNewTurn) {
            newMessages.push({ kind: 'turn-separator', turn });
          }
          newMessages.push({ kind: 'user', turn, text: env.payload?.text ?? '' });
          const currentSlug = a.slug && a.slug !== a.id.slice(0, 12)
            ? a.slug
            : ((env.payload?.text ?? '').slice(0, 30).trim() + ((env.payload?.text ?? '').length > 30 ? '…' : ''));
          return {
            ...a,
            turn: Math.max(a.turn, turn),
            messages: newMessages,
            slug: currentSlug,
          };
        }
        case 'system_init': {
          return {
            ...a,
            sessionId: env.sessionId ?? a.sessionId,
            status: 'running',
            messages: [...msgs, {
              kind: 'system_init', turn: t,
              model: env.payload?.model,
              cwd: env.payload?.cwd,
            }],
          };
        }
        case 'thinking': {
          return {
            ...a, status: 'running',
            messages: [...msgs, { kind: 'thinking', turn: t, text: env.payload?.thinking ?? '' }],
          };
        }
        case 'tool_use': {
          // Parse TodoWrite to track per-agent todos
          if (env.payload?.name === 'TodoWrite') {
            const todos = env.payload?.input?.todos;
            if (Array.isArray(todos)) {
              return {
                ...a, status: 'running', todos,
                messages: [...msgs, { kind: 'todo_update', turn: t, todos }],
              };
            }
          }
          return {
            ...a, status: 'running',
            messages: [...msgs, {
              kind: 'tool_use', turn: t,
              id: env.payload?.id,
              name: env.payload?.name ?? '?',
              input: env.payload?.input,
              status: 'running',
            }],
          };
        }
        case 'partial_text': {
          // Aggregate into a single growing agent-text message per turn
          if (last && last.kind === 'agent-text' && last.turn === t) {
            const upd = { ...last, text: (last.text ?? '') + (env.payload?.delta ?? '') };
            return { ...a, messages: [...msgs.slice(0, -1), upd] };
          }
          return {
            ...a, status: 'running',
            messages: [...msgs, { kind: 'agent-text', turn: t, text: env.payload?.delta ?? '' }],
          };
        }
        case 'text': {
          // TTS: speak final authoritative text if enabled
          if (ttsEnabled && env.payload?.text) {
            try {
              const u = new SpeechSynthesisUtterance(env.payload.text);
              u.rate = 0.95;
              u.pitch = 0.9;
              const voices = speechSynthesis.getVoices();
              const v = voices.find(x => /Daniel|Alex|Bruce|Arthur|Reed/i.test(x.name))
                ?? voices.find(x => x.lang.startsWith('en'));
              if (v) u.voice = v;
              speechSynthesis.speak(u);
            } catch {}
          }
          // Authoritative final text — replace any aggregated card
          if (last && last.kind === 'agent-text' && last.turn === t) {
            return { ...a, messages: [...msgs.slice(0, -1), { ...last, text: env.payload?.text ?? last.text }] };
          }
          return {
            ...a, status: 'running',
            messages: [...msgs, { kind: 'agent-text', turn: t, text: env.payload?.text ?? '' }],
          };
        }
        case 'result': {
          const p = env.payload ?? {};
          const usage = p.usage ?? {};
          const total = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
          return {
            ...a,
            tokens: a.tokens + total,
            cost: a.cost + (p.total_cost_usd ?? 0),
            status: 'completed',
            messages: [...msgs, {
              kind: 'result', turn: t, usage,
              cost: p.total_cost_usd ?? 0,
              durationMs: p.duration_ms ?? 0,
            }],
          };
        }
        case 'exit': {
          const code = env.payload?.code ?? 0;
          return {
            ...a,
            status: code === 0 ? 'completed' : 'errored',
            messages: [...msgs, { kind: 'exit', turn: t, code }],
          };
        }
        case 'stderr': {
          return {
            ...a,
            messages: [...msgs, { kind: 'stderr', turn: t, text: env.payload?.text ?? '' }],
          };
        }
        default:
          return a;
      }
    });
  }, [updateAgent]);

  // WS lifecycle — mount-once
  React.useEffect(() => {
    let alive = true;

    function connect() {
      if (!alive) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;
      setWsStatus('connecting');

      ws.onopen = () => {
        if (!alive) return;
        setWsStatus('open');
        // Re-subscribe to all known agents
        subscribedRef.current.clear();
        for (const id of agentsRef.current.keys()) {
          ws.send(JSON.stringify({ resume: { agentId: id, sinceSeq: -1 } }));
          subscribedRef.current.add(id);
        }
        // Ping interval
        if (pingRef.current) clearInterval(pingRef.current);
        pingRef.current = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        }, 5000);
      };

      ws.onmessage = (ev) => {
        if (!alive) return;
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg && msg.type === 'pong' && typeof msg.ts === 'number') {
          setLatencyMs(Date.now() - msg.ts);
          return;
        }
        if (msg && msg.type === 'file_changed' && typeof msg.path === 'string') {
          window.dispatchEvent(new CustomEvent('cockpit:file_changed', { detail: msg }));
          return;
        }
        handleEnvelope(msg);
      };

      ws.onclose = () => {
        if (!alive) return;
        setWsStatus('closed');
        if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
        setTimeout(connect, 1500);
      };

      ws.onerror = () => { /* close will follow */ };
    }

    connect();

    return () => {
      alive = false;
      if (pingRef.current) clearInterval(pingRef.current);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, []); // mount-once intentionally

  // Bootstrap agents from server on mount so cross-device clients see existing state
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/agents');
        if (!r.ok || !alive) return;
        const body = await r.json();
        const agentsFromServer = body.agents ?? [];
        for (const a of agentsFromServer) {
          const promptText = a.firstPrompt || '';
          const slug = promptText.slice(0, 30).trim() + (promptText.length > 30 ? '…' : '') || a.id.slice(0, 12);
          ensureAgent(a.id, {
            slug,
            projectPath: a.projectPath,
            turn: a.turn ?? 1,
            spawnedBy: a.spawnedBy ?? null,
          });
        }
        setCurrentAgentId(prev => {
          if (prev) return prev;
          if (agentsFromServer.length === 0) return null;
          // Don't auto-select JARVIS himself — he's an internal singleton.
          const userVisible = agentsFromServer.filter(x =>
            (x.firstPrompt || '') !== 'JARVIS orchestrator',
          );
          if (userVisible.length === 0) return null;
          const mostRecent = [...userVisible].sort((x, y) => y.createdAt - x.createdAt)[0];
          return mostRecent.id;
        });
      } catch {}
      // Discover the JARVIS agent so we can subscribe to his envelope stream.
      try {
        const r = await fetch('/api/jarvis/state');
        if (r.ok && alive) {
          const body = await r.json();
          if (body.agentId) setJarvisAgentId(body.agentId);
        }
      } catch {}
    })();
    return () => { alive = false; };
    // Mount-only intentionally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to JARVIS's envelope stream once we know his agentId — so his
  // text replies flow into jarvisReply for the overlay to render.
  React.useEffect(() => {
    if (!jarvisAgentId) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (subscribedRef.current.has(jarvisAgentId)) return;
    ws.send(JSON.stringify({ resume: { agentId: jarvisAgentId, sinceSeq: -1 } }));
    subscribedRef.current.add(jarvisAgentId);
  }, [jarvisAgentId, wsStatus]);

  // Filter JARVIS envelopes into the overlay state. We only care about
  // partial_text + text envelopes and result/exit for "thinking" → done.
  React.useEffect(() => {
    if (!jarvisAgentId) return;
    const a = agents.get(jarvisAgentId);
    if (!a) return;
    // Find the latest agent-text message for JARVIS's current turn.
    const lastText = [...a.messages].reverse().find(m =>
      m.kind === 'agent-text' && m.turn === a.turn,
    );
    if (lastText && lastText.text) {
      // Strip ```jarvis-tool fences from the user-facing reply.
      const visible = lastText.text.replace(/```jarvis-tool[\s\S]*?```/g, '').trim();
      setJarvisReply(visible);
    }
    setJarvisThinking(a.status === 'running');
  }, [agents, jarvisAgentId]);

  // M3.4 — TTS narration of JARVIS's own replies. Speaks whenever jarvisReply
  // changes meaningfully. We only utter the *new* tail (delta since last
  // spoken text) so the user doesn't re-hear the whole sentence as JARVIS
  // streams. A 60ms coalescing window prevents micro-stutter from tiny
  // partial-text deltas.
  const lastSpokenRef = React.useRef('');
  const lastSpeakAtRef = React.useRef(0);
  const speakTimerRef = React.useRef(null);
  React.useEffect(() => {
    if (!jarvisVoice) return undefined;
    if (!jarvisReply) return undefined;
    // Compute the delta — what's new since we last spoke.
    const prev = lastSpokenRef.current;
    let delta = '';
    if (jarvisReply.startsWith(prev)) {
      delta = jarvisReply.slice(prev.length).trim();
    } else {
      // Reply was rewritten (e.g. partial_text → text replace) — speak
      // only the trailing fragment we haven't heard yet, conservatively.
      delta = jarvisReply.trim();
    }
    if (!delta) return undefined;
    // Coalesce: if the last utterance fired <60ms ago, debounce by 60ms so
    // bursts of partial_text deltas become a single utterance.
    const now = Date.now();
    const since = now - lastSpeakAtRef.current;
    const fire = () => {
      try {
        const u = new SpeechSynthesisUtterance(delta);
        u.rate = 0.95;
        u.pitch = 0.9;
        const voices = speechSynthesis.getVoices();
        const v = voices.find(x => /Daniel|Bruce|Arthur|Reed/i.test(x.name))
          ?? voices.find(x => /Alex/i.test(x.name))
          ?? voices.find(x => x.lang.startsWith('en'));
        if (v) u.voice = v;
        speechSynthesis.speak(u);
        lastSpokenRef.current = jarvisReply;
        lastSpeakAtRef.current = Date.now();
      } catch {
        // SpeechSynthesis unavailable — silent failure is fine.
      }
    };
    if (since < 60) {
      if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
      speakTimerRef.current = setTimeout(fire, 60 - since);
      return () => {
        if (speakTimerRef.current) {
          clearTimeout(speakTimerRef.current);
          speakTimerRef.current = null;
        }
      };
    }
    fire();
    return undefined;
  }, [jarvisReply, jarvisVoice]);

  // Reset the last-spoken cursor whenever JARVIS starts a fresh reply (the
  // overlay clears jarvisReply on a new turn) so the next reply isn't
  // suppressed as a "no-op delta".
  React.useEffect(() => {
    if (jarvisReply === '') lastSpokenRef.current = '';
  }, [jarvisReply]);

  // M3.4 — Worker checkpoint watcher. For each JARVIS-spawned agent we POST
  // a brief "[WORKER_EVENT]" turn to JARVIS at three points: spawn (first
  // appearance), result (turn complete), exit (non-zero code). A per-worker
  // 8-second throttle prevents spam during a single worker's run.
  //
  // We suppress all narration during the first 3s after mount so the WS
  // replay of historical envelopes (which transitions old workers from
  // idle → running → completed in quick succession) doesn't re-narrate them.
  const lastWorkerEventAtRef = React.useRef(new Map()); // workerId → ts
  const seenWorkerStatusRef = React.useRef(new Map()); // workerId → prevStatus
  const postedSpawnRef = React.useRef(new Set()); // workerIds we've narrated spawn for
  const watcherSilentUntilRef = React.useRef(Date.now() + 3000);
  React.useEffect(() => {
    if (!jarvisVoice) return;
    if (!jarvisAgentId) return;
    const now = Date.now();
    const silent = now < watcherSilentUntilRef.current;
    const post = (workerId, kind, summary) => {
      if (silent) return; // bootstrap window — skip narration entirely
      const last = lastWorkerEventAtRef.current.get(workerId) ?? 0;
      if (now - last < 8000) return; // throttle
      lastWorkerEventAtRef.current.set(workerId, now);
      fetch('/api/jarvis/event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workerId, kind, summary }),
      }).catch(() => {});
    };
    for (const [id, a] of agents.entries()) {
      if (a.spawnedBy !== 'jarvis') continue;
      if (id === jarvisAgentId) continue; // JARVIS himself
      const prev = seenWorkerStatusRef.current.get(id);
      const cur = a.status;
      // Newly-discovered worker that just started — narrate spawn (once
      // per worker, only when it's actually running). On page reload we
      // pre-seed the seen-status map with whatever status the agent is in
      // before this watcher gets to compare, so we don't re-narrate spawn
      // for completed-on-load workers.
      if (!postedSpawnRef.current.has(id) && cur === 'running') {
        postedSpawnRef.current.add(id);
        post(id, 'spawn', `worker spawned on ${a.projectPath || 'unknown project'} — ${a.slug || id}`);
      } else if (prev === 'running' && cur === 'completed') {
        // Summarize: file count from todos? Use simple message — JARVIS reads
        // it and produces a natural-language line.
        post(id, 'result', `turn complete — ${a.slug || id}; tokens=${a.tokens}`);
      } else if (prev === 'running' && cur === 'errored') {
        // Pull last stderr text if any
        const lastErr = [...a.messages].reverse().find(m => m.kind === 'stderr');
        const tail = lastErr ? String(lastErr.text || '').slice(-200) : '';
        post(id, 'exit', `worker exited with non-zero status — ${tail}`);
      }
      seenWorkerStatusRef.current.set(id, cur);
    }
  }, [agents, jarvisVoice, jarvisAgentId]);

  // M3.4 — Poll for new JARVIS-spawned workers. JARVIS dispatchTask creates
  // a worker server-side; the client doesn't get notified until it subscribes
  // to that agentId. A lightweight 4s poll of /api/agents finds new workers
  // tagged spawned_by='jarvis' and registers them so the worker-watcher
  // above can react.
  React.useEffect(() => {
    if (!jarvisAgentId) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/agents');
        if (!r.ok || !alive) return;
        const body = await r.json();
        const list = body.agents ?? [];
        for (const a of list) {
          if (a.spawnedBy !== 'jarvis') continue;
          if (a.id === jarvisAgentId) continue;
          if (!agentsRef.current.has(a.id)) {
            const promptText = a.firstPrompt || '';
            const slug = promptText.slice(0, 30).trim() + (promptText.length > 30 ? '…' : '') || a.id.slice(0, 12);
            ensureAgent(a.id, {
              slug,
              projectPath: a.projectPath,
              turn: a.turn ?? 1,
              spawnedBy: 'jarvis',
              status: 'running',
            });
          }
        }
      } catch {
        // ignore — next tick retries
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [jarvisAgentId, ensureAgent]);

  const sayToJarvis = React.useCallback(async (text) => {
    if (!text || !text.trim()) return { ok: false, reason: 'empty' };
    setJarvisReply('');
    setJarvisThinking(true);
    // M3.4 — collect JARVIS-spawned workers that are still running so JARVIS
    // can decide whether the new instruction is a refinement (interrupt +
    // dispatch) or a new direction.
    const runningJarvisWorkers = [];
    for (const a of agentsRef.current.values()) {
      if (a.spawnedBy === 'jarvis' && a.status === 'running') {
        runningJarvisWorkers.push({
          id: a.id,
          slug: a.slug,
          lastPrompt: a.lastPrompt ?? '',
        });
      }
    }
    try {
      const r = await fetch('/api/jarvis/say', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, runningJarvisWorkers }),
      });
      if (!r.ok) {
        setJarvisThinking(false);
        const body = await r.json().catch(() => null);
        return { ok: false, reason: 'http_error', detail: body };
      }
      const body = await r.json();
      if (body.agentId && !jarvisAgentId) setJarvisAgentId(body.agentId);
      return { ok: true };
    } catch (err) {
      setJarvisThinking(false);
      return { ok: false, reason: 'network_error', detail: err.message };
    }
  }, [jarvisAgentId]);

  // Actions
  const spawn = React.useCallback(async (prompt) => {
    if (!draftProject || !draftProject.path) {
      return { ok: false, reason: 'no_project' };
    }
    const slug = (prompt || '').slice(0, 30).trim() + ((prompt || '').length > 30 ? '…' : '');
    const r = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, projectPath: draftProject.path, model: selectedModel }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      return { ok: false, reason: 'http_error', detail: body };
    }
    const body = await r.json();
    const id = body.agentId;
    ensureAgent(id, { slug, projectPath: draftProject.path });
    setCurrentAgentId(id);
    // Subscribe via the ref so we don't need a stale closure over subscribe
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && !subscribedRef.current.has(id)) {
      ws.send(JSON.stringify({ resume: { agentId: id, sinceSeq: -1 } }));
      subscribedRef.current.add(id);
    }
    return { ok: true, agentId: id };
  }, [draftProject, ensureAgent, selectedModel]);

  const continueAgent = React.useCallback(async (agentId, prompt) => {
    const a = agentsRef.current.get(agentId);
    if (!a) return { ok: false, reason: 'unknown_agent' };
    const r = await fetch(`/api/agents/${agentId}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, model: selectedModel }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      return { ok: false, reason: 'http_error', detail: body };
    }
    return { ok: true };
  }, [selectedModel]);

  const selectAgent = React.useCallback((id) => setCurrentAgentId(id), []);

  const closeAgent = React.useCallback((id) => {
    setAgents(prev => {
      if (!prev.has(id)) return prev;
      const out = new Map(prev);
      out.delete(id);
      return out;
    });
    subscribedRef.current.delete(id);
    setCurrentAgentId(prev => {
      if (prev !== id) return prev;
      const remaining = [...agentsRef.current.keys()].filter(x => x !== id);
      return remaining[0] ?? null;
    });
  }, []);

  const setDraftProjectAndPersist = React.useCallback((proj) => {
    setDraftProject(proj);
    if (proj) savePersistedSelection(proj);
  }, []);

  const openPicker = React.useCallback(() => setPickerOpen(true), []);
  const closePicker = React.useCallback(() => setPickerOpen(false), []);

  const openEditor = React.useCallback((path) => {
    setEditorFile(path);
    setCenterView('editor');
  }, []);

  const toggleSection = React.useCallback((id) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('cockpit:collapsed:v1', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const isCollapsed = React.useCallback((id) => collapsedSections.has(id), [collapsedSections]);

  const totalTokens = React.useMemo(() => {
    let s = 0;
    for (const a of agents.values()) s += a.tokens;
    return s;
  }, [agents]);

  const totalCost = React.useMemo(() => {
    let s = 0;
    for (const a of agents.values()) s += a.cost;
    return s;
  }, [agents]);

  const value = {
    agents,
    currentAgentId,
    draftProject,
    wsStatus,
    latencyMs,
    totalTokens,
    totalCost,
    pickerOpen,
    collapsedSections,
    projectTree,
    projectGit,
    projectDesign,
    clientCount,
    ttsEnabled,
    setTts,
    jarvisVoice,
    setJarvisVoice,
    hideToolWork,
    setHide,
    editorFile,
    setEditorFile,
    centerView,
    setCenterView,
    openEditor,
    refreshProjectData,
    selectedModel,
    setSelectedModel,
    jarvisEnabled,
    setJarvisEnabled,
    jarvisState,
    setJarvisState,
    jarvisTranscript,
    setJarvisTranscript,
    jarvisError,
    setJarvisError,
    dismissJarvis,
    jarvisListenerStatus,
    setJarvisListenerStatus,
    jarvisInterimText,
    setJarvisInterimText,
    jarvisAgentId,
    jarvisReply,
    jarvisThinking,
    sayToJarvis,
    spawn,
    continueAgent,
    selectAgent,
    closeAgent,
    setDraftProject: setDraftProjectAndPersist,
    openPicker,
    closePicker,
    toggleSection,
    isCollapsed,
  };

  return <CockpitContext.Provider value={value}>{children}</CockpitContext.Provider>;
}

window.CockpitProvider = CockpitProvider;
