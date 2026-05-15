// JaViSWo — Center stage: chat thread, tool cards, diff viewer, composer

const useStreamedText = (text, speed = 18, start = true) => {
  const [out, setOut] = React.useState("");
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (!start) return;
    let i = 0;
    setOut(""); setDone(false);
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

const ThinkingIndicator = ({ label = "Thinking", detail = "tracing call graph" }) => (
  <div className="thinking-indicator">
    <span className="thinking-orb" />
    <span className="thinking-text">
      <span className="label">{label}</span>
      <span>·</span>
      <span>{detail}</span>
    </span>
  </div>
);

const ToolCard = ({ name, args, status = "running", result, success = true, defaultOpen = true }) => {
  const [open, setOpen] = React.useState(defaultOpen);
  const isRun = status === "running";
  return (
    <div className={`tool-card ${success ? "success" : "error"}`}>
      <div className="tool-head" onClick={() => setOpen(o => !o)}>
        <Icon name="wand" size={12} />
        <span className="tool-name">{name}</span>
        <span className="tool-arg">({args})</span>
        <span className="tool-status">
          {isRun
            ? <><span className="spinner"/>running</>
            : success
              ? <><Icon name="check" size={11}/>ok</>
              : <><Icon name="warning" size={11}/>error</>}
        </span>
        <Icon name={open ? "chevron" : "chevronR"} size={11} />
      </div>
      {open && result && (
        <div className="tool-body">
          {result}
        </div>
      )}
    </div>
  );
};

const DiffViewer = ({ file = "src/agent/orchestrator.ts", lines, additions = 12, removals = 4 }) => {
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
            <span className="ln">{l.a || ""}</span>
            <span className="ln">{l.b || ""}</span>
            <span className="code">{l.t === "add" ? "+ " : l.t === "rem" ? "- " : "  "}{l.code}</span>
          </div>
        ))}
      </div>
      <div className="diff-actions">
        <button className="btn primary"><Icon name="check" size={12}/> Apply</button>
        <button className="btn"><Icon name="eye" size={12}/> View full</button>
        <button className="btn ghost" style={{marginLeft:"auto"}}><Icon name="x" size={12}/> Discard</button>
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
      {Array.from({length: 48}).map((_, i) => (
        <span key={i} className="voice-wave" style={{
          animationDelay: `${(i * 0.04) % 0.6}s`,
          animationDuration: `${0.9 + (i % 5) * 0.12}s`,
        }} />
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

const Composer = ({ voice, onToggleVoice, onSend, onShowPermission }) => {
  const [val, setVal] = React.useState("");
  return (
    <>
      {voice && <VoiceBar onStop={onToggleVoice} transcript={{committed: "show me the diff for", partial: "the orchestrator file"}} />}
      <div className="composer">
        <div className="composer-inner">
          <div className="composer-actions" style={{paddingBottom: 4}}>
            <button className="icon-btn" title="Attach file"><Icon name="plus" size={14}/></button>
          </div>
          <textarea
            className="composer-input"
            placeholder="Message the agent — or press / for commands · ⌘K for palette"
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); setVal(""); onSend?.(); }
            }}
            rows={1}
          />
          <div className="composer-actions" style={{paddingBottom: 4}}>
            <button className={`icon-btn mic ${voice ? "active" : ""}`} onClick={onToggleVoice} title="Voice">
              <Icon name="mic" size={14}/>
            </button>
            <button className="icon-btn" title="Tools" onClick={onShowPermission}>
              <Icon name="terminal" size={14}/>
            </button>
            <button className="icon-btn primary" title="Send">
              <Icon name="send" size={14}/>
            </button>
          </div>
        </div>
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"0 14px 10px", fontFamily:"var(--f-mono)", fontSize:10, color:"var(--text-mute)",
          letterSpacing:"0.06em"
        }}>
          <span style={{display:"flex", gap:14, alignItems:"center"}}>
            <span><b style={{color:"var(--violet-300)"}}>claude-haiku-4-5</b> · auto-context</span>
            <span style={{display:"flex", gap:6}}>
              <span className="tag cyan">file: orchestrator.ts</span>
              <span className="tag">branch: feat/orb-ui</span>
            </span>
          </span>
          <span>↵ send · ⇧↵ newline</span>
        </div>
      </div>
    </>
  );
};

// Sample diff content
const DIFF_LINES = [
  { a: "42", b: "42", t: "ctx", code: "export class Orchestrator extends EventEmitter {" },
  { a: "43", b: "43", t: "ctx", code: "  private agents = new Map<string, Agent>();" },
  { a: "44", b: "",   t: "rem", code: "  private queue: Task[] = [];" },
  { a: "",   b: "44", t: "add", code: "  private queue = new PriorityQueue<Task>();" },
  { a: "",   b: "45", t: "add", code: "  private streams = new Map<string, ReadableStream>();" },
  { a: "45", b: "46", t: "ctx", code: "" },
  { a: "46", b: "47", t: "ctx", code: "  async dispatch(task: Task) {" },
  { a: "47", b: "",   t: "rem", code: "    this.queue.push(task);" },
  { a: "",   b: "48", t: "add", code: "    this.queue.enqueue(task, task.priority);" },
  { a: "",   b: "49", t: "add", code: "    this.emit('queued', { id: task.id, eta: this.eta() });" },
  { a: "48", b: "50", t: "ctx", code: "    return this.flush();" },
  { a: "49", b: "51", t: "ctx", code: "  }" },
];

const CenterStage = ({ showPermission, onAllow, onDeny, voice, onToggleVoice }) => {
  const [streamed, streamDone] = useStreamedText(
    "I'll refactor `Orchestrator` to use a priority queue and emit `queued` events with an ETA estimate. I'm reading `orchestrator.ts` and `stream.ts` to make sure nothing else relies on the array shape — proposed diff below.",
    16
  );

  return (
    <main className="center">
      <div className="chat">
        {/* User message */}
        <div className="msg user">
          <div className="msg-avatar">M</div>
          <div className="msg-body">
            <div className="msg-meta"><span className="who">you</span><span>·</span><span>14:23</span></div>
            <div className="msg-bubble">
              Refactor the <code>Orchestrator</code> queue to be priority-based, and emit a <code>queued</code> event with an ETA. Make sure existing callers still work.
            </div>
          </div>
        </div>

        {/* Agent: thinking → streaming */}
        <div className="msg agent">
          <div className="msg-avatar"><Icon name="sparkles" size={14} style={{color:"white"}}/></div>
          <div className="msg-body">
            <div className="msg-meta">
              <span className="who">javiswo</span><span>·</span><span>14:23</span>
              <span className="tag" style={{marginLeft:6}}>haiku-4.5</span>
            </div>

            <ThinkingIndicator label="Reasoning" detail="reading orchestrator.ts · 2 files · 412 tokens" />

            <ToolCard
              name="read_file"
              args="src/agent/orchestrator.ts"
              status="done"
              success
              result={<>
                <span className="ok">→ 4.2 KB · 187 lines · UTF-8</span><br/>
                exports: Orchestrator, OrchestratorEvent<br/>
                imports: EventEmitter, Task, Agent, PriorityQueue (unused)
              </>}
            />

            <ToolCard
              name="grep"
              args={`"this.queue.push|this.queue\\."`}
              status="done"
              success
              result={<>
                src/agent/orchestrator.ts:44 <span className="ok">3 matches</span><br/>
                src/server/api/dispatch.ts:91 <span className="ok">1 match</span><br/>
                tests/orchestrator.test.ts:18 <span className="warn">2 matches</span>
              </>}
            />

            <div className="msg-bubble">
              {streamed}{!streamDone && <span className="cursor"/>}
            </div>

            <DiffViewer
              file="src/agent/orchestrator.ts"
              lines={DIFF_LINES}
              additions={12}
              removals={4}
            />

            {showPermission && (
              <PermissionCard onAllow={onAllow} onDeny={onDeny} />
            )}

            <ToolCard
              name="run_tests"
              args="orchestrator.test.ts"
              status="running"
              result={<>
                <span className="ok">✓</span> dispatches single task<br/>
                <span className="ok">✓</span> respects priority order<br/>
                <span>↻</span> emits queued event with eta… <span className="dim">running</span>
              </>}
            />
          </div>
        </div>
      </div>

      <Composer
        voice={voice}
        onToggleVoice={onToggleVoice}
        onShowPermission={() => {}}
      />
    </main>
  );
};

Object.assign(window, { CenterStage, ThinkingIndicator, ToolCard, DiffViewer, PermissionCard, Composer, VoiceBar });
