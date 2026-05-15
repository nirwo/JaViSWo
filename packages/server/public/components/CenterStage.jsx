// JaViSWo — Center stage: chat thread, tool cards, diff viewer, composer
// M1.14: group consecutive same-name tool_use, GFM tables, wider bubbles, hide-tool-work

const useStreamedText = (text, speed = 18, start = true) => {
  const [out, setOut] = React.useState('');
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (!start) return;
    let i = 0;
    setOut(''); setDone(false);
    const t = setInterval(() => {
      i += Math.max(1, Math.floor(text.length / 200));
      if (i >= text.length) {
        setOut(text);
        setDone(true);
        clearInterval(t);
      } else {
        setOut(text.slice(0, i));
      }
    }, speed);
    return () => clearInterval(t);
  }, [text, speed, start]);
  return [out, done];
};

const ThinkingIndicator = ({ label = 'Thinking', detail = 'tracing call graph' }) => (
  <div className="thinking-indicator">
    <span className="thinking-orb"/>
    <span className="thinking-text">
      <span className="label">{label}</span>
      <span>·</span>
      <span>{detail}</span>
    </span>
  </div>
);

// Collapsed-by-default chip for a group of consecutive thinking messages.
const ThinkingGroup = ({ items, isLive, turn }) => {
  const [open, setOpen] = React.useState(false);
  const count = items.length;
  const latest = items[items.length - 1]?.text ?? '';
  const firstLine = latest.split('\n')[0];
  const preview = firstLine.slice(0, 160);
  const hasMore = latest.length > preview.length || latest !== firstLine;
  return (
    <div className="thought-chip" data-open={String(open)}>
      <button className="thought-chip-head" onClick={() => setOpen(o => !o)}>
        <span className="thought-chip-dot" data-live={String(isLive)}/>
        <span className="thought-chip-label">
          {isLive ? 'Reasoning' : 'Reasoned'} · {count} {count === 1 ? 'thought' : 'thoughts'}
        </span>
        {!open && (
          <span className="thought-chip-preview">{preview}{hasMore ? '…' : ''}</span>
        )}
        <Icon name={open ? 'chevron' : 'chevronR'} size={11} style={{ opacity: 0.5, marginLeft: 'auto' }}/>
      </button>
      {open && (
        <div className="thought-chip-body">
          {items.map((it, i) => (
            <div key={i} className="thought-step">
              <span className="thought-step-num">{i + 1}.</span>
              <span className="thought-step-text">{it.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Extract the most informative single-line summary from a tool's input object.
function summarizeToolInput(name, input) {
  if (input == null) return '';
  if (typeof input === 'string') return input.slice(0, 100);
  if (input.file_path) return String(input.file_path).split('/').slice(-2).join('/');
  if (input.path) return String(input.path).split('/').slice(-2).join('/');
  if (input.command) return String(input.command).slice(0, 100);
  if (input.pattern) return String(input.pattern).slice(0, 80);
  if (input.url) return String(input.url).slice(0, 100);
  if (input.query) return String(input.query).slice(0, 80);
  if (input.prompt) return String(input.prompt).slice(0, 80);
  if (input.description) return String(input.description).slice(0, 80);
  const parts = [];
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') parts.push(`${k}: ${v.slice(0, 40)}`);
  }
  return parts.slice(0, 2).join(' · ').slice(0, 120) || '(no args)';
}

function iconForTool(name) {
  const n = String(name).toLowerCase();
  if (n === 'read' || n === 'notebookread') return 'file';
  if (n === 'edit' || n === 'multiedit' || n === 'write' || n === 'notebookedit') return 'wand';
  if (n === 'bash' || n === 'killshell' || n === 'bashoutput') return 'terminal';
  if (n === 'glob' || n === 'grep') return 'search';
  if (n.startsWith('web')) return 'globe';
  if (n === 'task' || n === 'agent') return 'sparkles';
  if (n === 'todowrite') return 'check';
  return 'wand';
}

// Slim collapsible chip for non-edit tool calls.
const ToolChip = ({ name, input, status }) => {
  const [open, setOpen] = React.useState(false);
  const summary = summarizeToolInput(name, input);
  const isRun = status === 'running';
  const isErr = status === 'error';
  return (
    <div className="tool-chip" data-status={status} data-open={String(open)}>
      <button className="tool-chip-head" onClick={() => setOpen(o => !o)}>
        <Icon name={iconForTool(name)} size={12}/>
        <span className="tool-chip-name">{name}</span>
        <span className="tool-chip-arg">{summary}</span>
        <span className="tool-chip-status">
          {isRun
            ? <span className="spinner"/>
            : isErr
              ? <Icon name="warning" size={11}/>
              : <Icon name="check" size={11}/>}
        </span>
        <Icon name={open ? 'chevron' : 'chevronR'} size={10} style={{ opacity: 0.4, marginLeft: 4 }}/>
      </button>
      {open && (
        <div className="tool-chip-body">
          <pre>{typeof input === 'string' ? input : JSON.stringify(input, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

// Grouped chip for N consecutive tool_use calls with the same name.
const ToolGroupChip = ({ name, items }) => {
  const [open, setOpen] = React.useState(false);
  const n = items.length;
  const running = items.filter(i => i.status === 'running').length;
  const errored = items.filter(i => i.status === 'error').length;
  const ok = items.filter(i => i.status !== 'running' && i.status !== 'error').length;
  const previewSummary = summarizeToolInput(name, items[n - 1].input);

  return (
    <div
      className="tool-chip tool-chip-group"
      data-open={String(open)}
      data-status={running > 0 ? 'running' : errored > 0 ? 'error' : 'done'}
    >
      <button className="tool-chip-head" onClick={() => setOpen(o => !o)}>
        <Icon name={iconForTool(name) || 'wand'} size={12}/>
        <span className="tool-chip-name">{name}</span>
        <span className="tool-chip-arg">
          {n > 1
            ? <><b>{n}</b>&nbsp;calls&nbsp;·&nbsp;{previewSummary}</>
            : previewSummary}
        </span>
        <span className="tool-chip-status">
          {running > 0
            ? <span className="spinner"/>
            : errored > 0
              ? <><Icon name="warning" size={11}/>{errored} err</>
              : <><Icon name="check" size={11}/>{ok} ok</>}
        </span>
        <Icon name={open ? 'chevron' : 'chevronR'} size={10} style={{ opacity: 0.4, marginLeft: 4 }}/>
      </button>
      {open && (
        <div className="tool-chip-body">
          {items.map((it, i) => (
            <div key={i} className="tool-group-item">
              <span className="tool-group-num">{i + 1}.</span>
              <span className={`tool-group-status status-${it.status}`}>
                {it.status === 'running' ? '↻' : it.status === 'error' ? '⚠' : '✓'}
              </span>
              <pre className="tool-group-arg">
                {typeof it.input === 'string' ? it.input : JSON.stringify(it.input, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Merge consecutive 'thinking' messages and consecutive same-name tool_use from the same turn.
function groupMessages(messages) {
  const out = [];
  for (const m of messages) {
    const last = out[out.length - 1];

    // Group consecutive thinking
    if (m.kind === 'thinking' && last?.kind === 'thinking-group' && last.turn === m.turn) {
      last.items.push(m);
      last.totalChars += (m.text ?? '').length;
      continue;
    }
    if (m.kind === 'thinking') {
      out.push({ kind: 'thinking-group', turn: m.turn, items: [m], totalChars: (m.text ?? '').length });
      continue;
    }

    // Group consecutive tool_use of the SAME name + turn
    if (m.kind === 'tool_use' && last?.kind === 'tool-group' && last.turn === m.turn && last.name === m.name) {
      last.items.push(m);
      continue;
    }
    if (m.kind === 'tool_use') {
      out.push({ kind: 'tool-group', turn: m.turn, name: m.name, items: [m] });
      continue;
    }

    out.push(m);
  }
  return out;
}

const ToolCard = ({ name, args, status = 'running', result, success = true, defaultOpen = true }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  const isRun = status === 'running';
  return (
    <div className={`tool-card ${success ? 'success' : 'error'}`}>
      <div className="tool-head" onClick={() => setOpen(o => !o)}>
        <Icon name="wand" size={12}/>
        <span className="tool-name">{name}</span>
        <span className="tool-arg">({args})</span>
        <span className="tool-status">
          {isRun
            ? <><span className="spinner"/>running</>
            : success
              ? <><Icon name="check" size={11}/>ok</>
              : <><Icon name="warning" size={11}/>error</>}
        </span>
        <Icon name={open ? 'chevron' : 'chevronR'} size={11}/>
      </div>
      {open && result && (
        <div className="tool-body">
          {result}
        </div>
      )}
    </div>
  );
};

const DiffViewer = ({ file = 'src/agent/orchestrator.ts', lines, additions = 12, removals = 4 }) => {
  return (
    <div className="diff">
      <div className="diff-head">
        <span className="file"><Icon name="file" size={11}/> {file}</span>
        <span className="stats">
          <span className="add">+{additions}</span>
          <span className="rem">−{removals}</span>
        </span>
      </div>
      <div className="diff-body">
        {lines.map((l, i) => (
          <div key={i} className={`diff-line ${l.t}`}>
            <span className="ln">{l.a || ''}</span>
            <span className="ln">{l.b || ''}</span>
            <span className="code">{l.t === 'add' ? '+ ' : l.t === 'rem' ? '- ' : '  '}{l.code}</span>
          </div>
        ))}
      </div>
      <div className="diff-actions">
        <button className="btn primary"><Icon name="check" size={12}/> Apply</button>
        <button className="btn"><Icon name="eye" size={12}/> View full</button>
        <button className="btn ghost" style={{ marginLeft: 'auto' }}><Icon name="x" size={12}/> Discard</button>
      </div>
    </div>
  );
};

const PermissionCard = ({ onAllow, onDeny }) => (
  <div className="permission">
    <div className="permission-head">
      <span className="warn-dot"/>
      <Icon name="lock" size={11}/>
      Approval required
    </div>
    <div className="permission-body">
      The agent wants to run a shell command in <b>~/javiswo</b>. This will modify your filesystem.
    </div>
    <div className="permission-cmd">$ pnpm prisma migrate dev --name add_voice_sessions</div>
    <div className="permission-actions">
      <button className="btn primary" onClick={onAllow}>
        <Icon name="check" size={12}/> Allow once
        <span className="btn-kbd">↵</span>
      </button>
      <button className="btn" onClick={onAllow}>Allow always</button>
      <button className="btn danger" onClick={onDeny}>
        <Icon name="x" size={12}/> Deny
        <span className="btn-kbd">esc</span>
      </button>
    </div>
  </div>
);

const VoiceBar = ({ onStop, transcript }) => (
  <div className="voice-bar">
    <div className="voice-mic"><Icon name="mic" size={16}/></div>
    <div className="voice-waves">
      {Array.from({ length: 48 }).map((_, i) => (
        <span key={i} className="voice-wave" style={{
          animationDelay: `${(i * 0.04) % 0.6}s`,
          animationDuration: `${0.9 + (i % 5) * 0.12}s`,
        }}/>
      ))}
    </div>
    <div className="voice-transcript">
      {transcript.committed}
      <span className="partial"> {transcript.partial}</span>
    </div>
    <button className="voice-stop" onClick={onStop} title="Stop">
      <Icon name="x" size={12}/>
    </button>
  </div>
);

const SimpleDiffCard = ({ name, input, status }) => {
  const file = input.file_path ?? input.path ?? '?';
  const filename = String(file).split('/').slice(-2).join('/');
  let oldText = '';
  let newText = '';
  let edits = [];

  if (name === 'Edit') {
    oldText = input.old_string ?? '';
    newText = input.new_string ?? '';
  } else if (name === 'Write') {
    newText = input.content ?? '';
  } else if (name === 'MultiEdit' || name === 'NotebookEdit') {
    edits = input.edits ?? [];
  }

  const lines = [];
  if (name === 'MultiEdit' || name === 'NotebookEdit') {
    for (const e of edits.slice(0, 3)) {
      for (const l of (e.old_string ?? '').split('\n')) if (l) lines.push({ t: 'rem', code: l });
      for (const l of (e.new_string ?? '').split('\n')) if (l) lines.push({ t: 'add', code: l });
    }
  } else {
    for (const l of oldText.split('\n')) if (l) lines.push({ t: 'rem', code: l });
    for (const l of newText.split('\n')) if (l) lines.push({ t: 'add', code: l });
  }

  const additions = lines.filter(l => l.t === 'add').length;
  const removals  = lines.filter(l => l.t === 'rem').length;

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="file"><Icon name="file" size={11}/> {filename}</span>
        <span className="stats">
          <span className="add">+{additions}</span>
          <span className="rem">−{removals}</span>
          <span style={{ color: 'var(--text-mute)', marginLeft: 8 }}>{status}</span>
        </span>
      </div>
      <div className="diff-body">
        {lines.slice(0, 80).map((l, i) => (
          <div key={i} className={`diff-line ${l.t}`}>
            <span className="ln"></span>
            <span className="ln"></span>
            <span className="code">{l.t === 'add' ? '+ ' : '- '}{l.code}</span>
          </div>
        ))}
        {lines.length > 80 && (
          <div className="diff-line ctx">
            <span className="ln"></span>
            <span className="ln"></span>
            <span className="code">… +{lines.length - 80} more lines …</span>
          </div>
        )}
      </div>
    </div>
  );
};

const LiveVoiceBar = ({ levels, onStop }) => (
  <div className="voice-bar">
    <div className="voice-mic"><Icon name="mic" size={16}/></div>
    <div className="voice-waves">
      {(levels.length ? levels : Array(24).fill(0.1)).map((lv, i) => (
        <span key={i} className="voice-wave" style={{
          animation: 'none',
          height: Math.max(4, lv * 26) + 'px',
          opacity: 0.6 + lv * 0.4,
        }}/>
      ))}
    </div>
    <div className="voice-transcript" style={{ color: 'var(--cyan-300)' }}>recording…</div>
    <button className="voice-stop" onClick={onStop} title="Stop">
      <Icon name="x" size={12}/>
    </button>
  </div>
);

// Renders a single message block in the chat thread
const MessageBlock = ({ m, agent }) => {
  switch (m.kind) {
    case 'system_init': {
      // Only show the first system_init — skip subsequent ones from --resume turns
      const idx = agent.messages.indexOf(m);
      const isFirst = idx === 0 || !agent.messages.slice(0, idx).some(x => x.kind === 'system_init');
      if (!isFirst) return null;
      return (
        <div className="msg-meta" style={{ margin: '4px 0', color: 'var(--text-mute)', fontSize: 9.5 }}>
          <Icon name="sparkles" size={10}/> session {String(agent.sessionId || '').slice(0, 8)} · {m.model}
        </div>
      );
    }
    case 'turn-separator':
      return (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          margin: '16px 0 8px', opacity: 0.6,
        }}>
          <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, var(--hairline), transparent)' }}/>
          <span style={{
            fontFamily: 'var(--f-mono)', fontSize: 10,
            letterSpacing: '0.18em', color: 'var(--text-mute)',
          }}>
            TURN {m.turn}
          </span>
          <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, transparent, var(--hairline), transparent)' }}/>
        </div>
      );
    case 'user':
      return (
        <div className="msg user">
          <div className="msg-avatar">N</div>
          <div className="msg-body">
            <div className="msg-meta">
              <span className="who">you</span>
              <span>·</span>
              <span>turn {m.turn}</span>
            </div>
            <div className="msg-bubble">
              <Markdown text={m.text}/>
            </div>
          </div>
        </div>
      );
    case 'thinking':
      // Individual thinking messages are handled by thinking-group below;
      // this case is a fallback for messages not yet grouped (should not appear normally).
      return (
        <div className="msg agent">
          <div className="msg-avatar"><Icon name="sparkles" size={14} style={{ color: 'white' }}/></div>
          <div className="msg-body">
            <ThinkingIndicator label="thinking" detail={(m.text || '').split('\n')[0].slice(0, 80)}/>
          </div>
        </div>
      );
    case 'thinking-group': {
      const lastRaw = agent.messages[agent.messages.length - 1];
      const isLive = agent.status === 'running' &&
        lastRaw?.kind === 'thinking' &&
        lastRaw?.turn === m.turn;
      return <ThinkingGroup items={m.items} isLive={isLive} turn={m.turn}/>;
    }
    case 'tool_use': {
      const isEdit = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(m.name);
      if (isEdit && m.input) {
        return (
          <div className="msg agent">
            <div className="msg-avatar"><Icon name="sparkles" size={14} style={{ color: 'white' }}/></div>
            <div className="msg-body">
              <SimpleDiffCard name={m.name} input={m.input} status={m.status}/>
            </div>
          </div>
        );
      }
      return <ToolChip name={m.name} input={m.input} status={m.status}/>;
    }
    case 'tool-group': {
      // Single item — render as normal ToolChip for visual continuity
      if (m.items.length === 1) {
        const it = m.items[0];
        const isEdit = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(m.name);
        if (isEdit && it.input) {
          return (
            <div className="msg agent">
              <div className="msg-avatar"><Icon name="sparkles" size={14} style={{ color: 'white' }}/></div>
              <div className="msg-body">
                <SimpleDiffCard name={it.name} input={it.input} status={it.status}/>
              </div>
            </div>
          );
        }
        return <ToolChip name={it.name} input={it.input} status={it.status}/>;
      }
      // Edit tools — show each diff card individually (diffs are meaningful per-call)
      const isEdit = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(m.name);
      if (isEdit) {
        return (
          <div className="msg agent">
            <div className="msg-avatar"><Icon name="sparkles" size={14} style={{ color: 'white' }}/></div>
            <div className="msg-body" style={{ gap: 6 }}>
              {m.items.map((it, i) => (
                <SimpleDiffCard key={i} name={it.name} input={it.input} status={it.status}/>
              ))}
            </div>
          </div>
        );
      }
      // Everything else — one grouped chip representing all calls
      return <ToolGroupChip name={m.name} items={m.items}/>;
    }
    case 'agent-text':
      return (
        <div className="msg agent">
          <div className="msg-avatar"><Icon name="sparkles" size={14} style={{ color: 'white' }}/></div>
          <div className="msg-body">
            <div className="msg-bubble">
              <Markdown text={m.text}/>
            </div>
          </div>
        </div>
      );
    case 'result':
      return (
        <div className="msg-meta" style={{ margin: '4px 0', color: 'var(--text-mute)', fontSize: 9.5 }}>
          <Icon name="check" size={10}/> turn {m.turn} · {(m.usage?.input_tokens ?? 0) + (m.usage?.output_tokens ?? 0)} tk · ${(m.cost ?? 0).toFixed(4)} · {m.durationMs ?? 0}ms
        </div>
      );
    case 'exit':
      return (
        <div className="msg-meta" style={{ margin: '4px 0', fontSize: 9.5, color: m.code === 0 ? 'var(--text-mute)' : 'var(--danger)' }}>
          <Icon name={m.code === 0 ? 'check' : 'warning'} size={10}/> exit {m.code}
        </div>
      );
    case 'stderr':
      return (
        <div className="msg-meta" style={{
          margin: '3px 0', color: 'var(--danger)',
          fontFamily: 'var(--f-mono)', fontSize: 10,
        }}>
          stderr: {m.text}
        </div>
      );
    default:
      return null;
  }
};

// Empty state when no agent is selected
const EmptyState = () => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flex: 1, padding: 40,
  }}>
    <div style={{ textAlign: 'center', maxWidth: 380, opacity: 0.7 }}>
      <div style={{
        width: 80, height: 80, margin: '0 auto 20px',
        borderRadius: '50%',
        background: 'radial-gradient(circle at 35% 35%, #fff 0%, var(--violet-300) 20%, var(--violet-600) 55%, var(--bg-3) 90%)',
        boxShadow: '0 0 40px rgba(167,139,250,0.4)',
      }}/>
      <h2 style={{ fontSize: 18, color: 'var(--violet-200)', margin: '0 0 6px' }}>Awaiting instructions</h2>
      <p style={{ fontSize: 13, color: 'var(--text-mute)', margin: 0 }}>
        Pick a project, type a prompt, hit{' '}
        <kbd style={{
          fontFamily: 'var(--f-mono)', fontSize: 11,
          padding: '1px 6px', border: '1px solid var(--hairline)', borderRadius: 4,
        }}>↵</kbd>
      </p>
    </div>
  </div>
);

const ChatThread = () => {
  const { agents, currentAgentId } = useCockpit();
  const agent = currentAgentId ? agents.get(currentAgentId) : null;
  const scrollRef = React.useRef(null);

  // All hooks MUST run unconditionally and in the same order on every render
  // (React Rules of Hooks). Compute grouped messages even when there's no agent.
  const grouped = React.useMemo(
    () => groupMessages(agent?.messages ?? []),
    [agent?.messages],
  );

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [agent?.messages?.length]);

  if (!agent) {
    return (
      <div className="chat" ref={scrollRef}>
        <EmptyState/>
      </div>
    );
  }

  return (
    <div className="chat" ref={scrollRef}>
      {grouped.map((m, i) => <MessageBlock key={i} m={m} agent={agent}/>)}
      {agent.status === 'running' && grouped[grouped.length - 1]?.kind !== 'thinking-group' && (
        <ThinkingIndicator label="Reasoning" detail={`turn ${agent.turn} · ${agent.tokens} tk`}/>
      )}
    </div>
  );
};

const Composer = () => {
  const {
    spawn, continueAgent, agents, currentAgentId,
    draftProject, openPicker, wsStatus,
  } = useCockpit();

  const [val, setVal] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const [transcribing, setTranscribing] = React.useState(false);
  const [waveLevels, setWaveLevels] = React.useState([]);
  const recorderRef = React.useRef(null);
  const chunksRef = React.useRef([]);
  const analyserCtxRef = React.useRef(null);
  const rafRef = React.useRef(null);

  const agent = currentAgentId ? agents.get(currentAgentId) : null;
  const isRunning = agent?.status === 'running';
  const canSend = !submitting && !isRunning && val.trim().length > 0;

  const uploadAudioForTranscription = async (blob) => {
    setTranscribing(true);
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'voice.webm');
      const res = await fetch('/api/voice/transcribe', { method: 'POST', body: fd });
      const body = await res.json();
      if (body.ok && body.text) {
        setVal(v => v ? (v + ' ' + body.text) : body.text);
      } else {
        alert('Transcription failed: ' + JSON.stringify(body.error ?? 'unknown'));
      }
    } catch (err) {
      alert('Transcription request failed: ' + err.message);
    } finally {
      setTranscribing(false);
    }
  };

  const stopRecording = React.useCallback(() => {
    const r = recorderRef.current;
    if (!r || r.state === 'inactive') return;
    setRecording(false);
    r.stop();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setWaveLevels([]);
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserCtxRef.current = { audioCtx, analyser };
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const bins = Array.from(data).slice(0, 24).map(v => v / 255);
        setWaveLevels(bins);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        stream.getTracks().forEach(t => t.stop());
        audioCtx.close();
        setWaveLevels([]);
        const blob = new Blob(chunksRef.current, { type: mime });
        await uploadAudioForTranscription(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      alert('Microphone access denied. Allow microphone permission to use voice input.');
    }
  };

  const onMicClick = () => {
    if (recording) stopRecording();
    else startRecording();
  };

  const onSubmit = async () => {
    if (!canSend) return;
    const prompt = val.trim();
    setVal('');
    setSubmitting(true);
    try {
      if (agent && agent.status !== 'running') {
        await continueAgent(currentAgentId, prompt);
      } else if (!agent) {
        if (!draftProject) {
          openPicker();
          setVal(prompt);
          return;
        }
        await spawn(prompt);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const placeholder = isRunning
    ? 'Agent is thinking…'
    : draftProject
      ? (agent ? `Reply to ${agent.slug}` : `New agent in ${draftProject.name}`)
      : 'Pick a project, then type a prompt';

  return (
    <>
      {recording && <LiveVoiceBar levels={waveLevels} onStop={stopRecording}/>}
      {transcribing && (
        <div style={{
          padding: '8px 14px', fontSize: 11.5,
          color: 'var(--cyan-300)', fontFamily: 'var(--f-mono)',
        }}>
          · transcribing… ·
        </div>
      )}
      <div className="composer">
        <div className="composer-inner">
          <div className="composer-actions" style={{ paddingBottom: 4 }}>
            <button className="icon-btn" title="Pick project" onClick={openPicker}>
              <Icon name="folder" size={14}/>
            </button>
          </div>
          <textarea
            className="composer-input"
            placeholder={placeholder}
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
            }}
            rows={1}
            disabled={submitting || isRunning}
          />
          <div className="composer-actions" style={{ paddingBottom: 4 }}>
            <button
              className={`icon-btn mic ${recording ? 'active' : ''}`}
              onClick={onMicClick}
              title={recording ? 'Stop recording' : 'Push to talk'}
            >
              <Icon name="mic" size={14}/>
            </button>
            <button
              className="icon-btn primary"
              title="Send"
              onClick={onSubmit}
              disabled={!canSend}
            >
              <Icon name="send" size={14}/>
            </button>
          </div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 14px 10px',
          fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--text-mute)',
          letterSpacing: '0.06em',
        }}>
          <span style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <span><b style={{ color: 'var(--violet-300)' }}>claude-sonnet-4-6</b> · auto-context</span>
            <span style={{ display: 'flex', gap: 6 }}>
              {draftProject && <span className="tag cyan">project: {draftProject.name}</span>}
              {agent && <span className="tag">turn: {agent.turn}</span>}
              <span className={`tag ${wsStatus === 'open' ? 'green' : 'pink'}`}>ws: {wsStatus}</span>
            </span>
          </span>
          <span>↵ send · ⇧↵ newline</span>
        </div>
      </div>
    </>
  );
};

const CenterStage = ({ showPermission, onAllow, onDeny }) => {
  const { agents, currentAgentId, centerView, setCenterView } = useCockpit();
  const agent = currentAgentId ? agents.get(currentAgentId) : null;

  return (
    <main className="center">
      {agent && (
        <div className="center-tabs">
          <button
            className={`center-tab ${centerView === 'chat' ? 'active' : ''}`}
            onClick={() => setCenterView('chat')}
          >
            <Icon name="terminal" size={11}/> Chat
          </button>
          <button
            className={`center-tab ${centerView === 'graph' ? 'active' : ''}`}
            onClick={() => setCenterView('graph')}
          >
            <Icon name="git" size={11}/> Relations
          </button>
          <button
            className={`center-tab ${centerView === 'editor' ? 'active' : ''}`}
            onClick={() => setCenterView('editor')}
          >
            <Icon name="file" size={11}/> Editor
          </button>
          <button
            className={`center-tab ${centerView === 'preview' ? 'active' : ''}`}
            onClick={() => setCenterView('preview')}
          >
            <Icon name="globe" size={11}/> Preview
          </button>
          <span style={{ flex: 1 }}/>
          <span style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            color: 'var(--text-mute)',
            alignSelf: 'center',
          }}>
            {agent.slug} · turn {agent.turn}
          </span>
        </div>
      )}
      {centerView === 'chat' ? (
        <ChatThread/>
      ) : centerView === 'graph' ? (
        <RelationsGraph agent={agent}/>
      ) : centerView === 'preview' ? (
        <PreviewPane projectPath={agent?.projectPath}/>
      ) : (
        <CodeEditor/>
      )}
      <Composer/>
    </main>
  );
};

Object.assign(window, {
  CenterStage, ChatThread, MessageBlock, EmptyState,
  ThinkingIndicator, ThinkingGroup, ToolCard, ToolChip, ToolGroupChip, DiffViewer, PermissionCard, Composer,
  VoiceBar, LiveVoiceBar, SimpleDiffCard,
  useStreamedText, groupMessages, summarizeToolInput, iconForTool,
});
