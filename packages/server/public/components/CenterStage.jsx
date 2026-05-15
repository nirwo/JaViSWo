// JaViSWo — Center stage: chat thread, tool cards, diff viewer, composer

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

// Renders a single message block in the chat thread
const MessageBlock = ({ m, agent }) => {
  switch (m.kind) {
    case 'system_init':
      return (
        <div className="msg-meta" style={{ margin: '6px 0', color: 'var(--text-mute)' }}>
          <Icon name="sparkles" size={11}/> session {String(agent.sessionId || '').slice(0, 8)} · {m.model} · {m.cwd}
        </div>
      );
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
            <div className="msg-bubble">{m.text}</div>
          </div>
        </div>
      );
    case 'thinking':
      return (
        <div className="msg agent">
          <div className="msg-avatar"><Icon name="sparkles" size={14} style={{ color: 'white' }}/></div>
          <div className="msg-body">
            <ThinkingIndicator label="thinking" detail={(m.text || '').slice(0, 80)}/>
          </div>
        </div>
      );
    case 'tool_use': {
      const inputStr = typeof m.input === 'string' ? m.input : JSON.stringify(m.input ?? {});
      return (
        <div className="msg agent">
          <div className="msg-avatar"><Icon name="sparkles" size={14} style={{ color: 'white' }}/></div>
          <div className="msg-body">
            <ToolCard
              name={m.name}
              args={inputStr}
              status={m.status}
              success={m.status !== 'error'}
              defaultOpen={false}
            />
          </div>
        </div>
      );
    }
    case 'agent-text':
      return (
        <div className="msg agent">
          <div className="msg-avatar"><Icon name="sparkles" size={14} style={{ color: 'white' }}/></div>
          <div className="msg-body">
            <div className="msg-bubble">{m.text}</div>
          </div>
        </div>
      );
    case 'result':
      return (
        <div className="msg-meta" style={{ margin: '6px 0', color: 'var(--text-mute)' }}>
          <Icon name="check" size={11}/> turn {m.turn} done · {(m.usage?.input_tokens ?? 0) + (m.usage?.output_tokens ?? 0)} tk · ${(m.cost ?? 0).toFixed(4)} · {m.durationMs ?? 0}ms
        </div>
      );
    case 'exit':
      return (
        <div className="msg-meta" style={{ margin: '6px 0', color: m.code === 0 ? 'var(--text-mute)' : 'var(--danger)' }}>
          <Icon name={m.code === 0 ? 'check' : 'warning'} size={11}/> exit {m.code}
        </div>
      );
    case 'stderr':
      return (
        <div className="msg-meta" style={{
          margin: '4px 0', color: 'var(--danger)',
          fontFamily: 'var(--f-mono)', fontSize: 10.5,
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
      {agent.messages.map((m, i) => <MessageBlock key={i} m={m} agent={agent}/>)}
      {agent.status === 'running' && (
        <ThinkingIndicator label="Reasoning" detail={`turn ${agent.turn} · ${agent.tokens} tk`}/>
      )}
    </div>
  );
};

const Composer = ({ voice, onToggleVoice }) => {
  const {
    spawn, continueAgent, agents, currentAgentId,
    draftProject, openPicker, wsStatus,
  } = useCockpit();

  const [val, setVal] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const agent = currentAgentId ? agents.get(currentAgentId) : null;
  const isRunning = agent?.status === 'running';
  const canSend = !submitting && !isRunning && val.trim().length > 0;

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
      {voice && (
        <VoiceBar
          onStop={onToggleVoice}
          transcript={{ committed: 'show me the diff for', partial: 'the orchestrator file' }}
        />
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
              className={`icon-btn mic ${voice ? 'active' : ''}`}
              onClick={onToggleVoice}
              title="Voice"
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

const CenterStage = ({ showPermission, onAllow, onDeny, voice, onToggleVoice }) => {
  return (
    <main className="center">
      <ChatThread/>
      <Composer
        voice={voice}
        onToggleVoice={onToggleVoice}
      />
    </main>
  );
};

Object.assign(window, {
  CenterStage, ChatThread, MessageBlock, EmptyState,
  ThinkingIndicator, ToolCard, DiffViewer, PermissionCard, Composer, VoiceBar,
  useStreamedText,
});
