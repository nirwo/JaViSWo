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
  const [clientCount, setClientCount] = React.useState(1);

  // TTS
  const [ttsEnabled, setTtsEnabled] = React.useState(
    () => localStorage.getItem('cockpit:tts') === '1',
  );
  const setTts = React.useCallback((v) => {
    setTtsEnabled(v);
    try { localStorage.setItem('cockpit:tts', v ? '1' : '0'); } catch {}
  }, []);

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

  // Refresh project file tree + git status
  const refreshProjectData = React.useCallback(async () => {
    if (!draftProject?.path) { setProjectTree(null); setProjectGit(null); return; }
    const root = encodeURIComponent(draftProject.path);
    try {
      const [treeR, gitR] = await Promise.all([
        fetch(`/api/files/tree?root=${root}&depth=3`).then(r => r.ok ? r.json() : null),
        fetch(`/api/git/status?root=${root}`).then(r => r.ok ? r.json() : null),
      ]);
      if (treeR?.tree) setProjectTree(treeR.tree);
      if (gitR) setProjectGit(gitR);
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
          ensureAgent(a.id, { slug, projectPath: a.projectPath, turn: a.turn ?? 1 });
        }
        setCurrentAgentId(prev => {
          if (prev) return prev;
          if (agentsFromServer.length === 0) return null;
          const mostRecent = [...agentsFromServer].sort((x, y) => y.createdAt - x.createdAt)[0];
          return mostRecent.id;
        });
      } catch {}
    })();
    return () => { alive = false; };
    // Mount-only intentionally
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actions
  const spawn = React.useCallback(async (prompt) => {
    if (!draftProject || !draftProject.path) {
      return { ok: false, reason: 'no_project' };
    }
    const slug = (prompt || '').slice(0, 30).trim() + ((prompt || '').length > 30 ? '…' : '');
    const r = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, projectPath: draftProject.path }),
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
  }, [draftProject, ensureAgent]);

  const continueAgent = React.useCallback(async (agentId, prompt) => {
    const a = agentsRef.current.get(agentId);
    if (!a) return { ok: false, reason: 'unknown_agent' };
    const r = await fetch(`/api/agents/${agentId}/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      return { ok: false, reason: 'http_error', detail: body };
    }
    return { ok: true };
  }, []);

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
    clientCount,
    ttsEnabled,
    setTts,
    hideToolWork,
    setHide,
    refreshProjectData,
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
