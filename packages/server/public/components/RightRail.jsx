// JaViSWo — Right rail: agent orb, task list, terminal, handoff

const AgentOrb = ({ state = "thinking", thought = "Refactoring queue to priority-based dispatch…" }) => {
  return (
    <div className="rail-section" style={{flex:"0 0 auto"}}>
      <div className="rail-head">
        <span>Agent</span>
        <span className="tag cyan"><Icon name="bolt" size={9}/>online</span>
      </div>
      <div className="orb-wrap">
        <div className="orb-stage">
          <div className="orb" />
          <OrbParticles count={7} />
        </div>
        <div className="orb-state">{state}</div>
        <div className="orb-thought">"{thought}"</div>
      </div>
    </div>
  );
};

const TASKS = [
  { id: 1, state: "done",  text: "Read orchestrator.ts & locate queue references", sub: "3 files · 412 tokens" },
  { id: 2, state: "done",  text: "Identify priority semantics from Task type",      sub: "0.4s" },
  { id: 3, state: "doing", text: "Generate refactor diff & test patches",           sub: "streaming · 1.2s" },
  { id: 4, state: "todo",  text: "Run orchestrator.test.ts & verify priority order" },
  { id: 5, state: "todo",  text: "Update dispatch.ts caller to await ETA"           },
  { id: 6, state: "todo",  text: "Open PR with description & rationale"             },
];

const TaskList = () => {
  return (
    <div className="rail-section" style={{flex:"0 1 auto", maxHeight: 290}}>
      <div className="rail-head">
        <span>Plan</span>
        <span className="count">2/6</span>
      </div>
      <div className="rail-body" style={{padding:"4px 6px 10px"}}>
        {TASKS.map(t => (
          <div key={t.id} className={`task ${t.state}`}>
            <span className="task-check">
              {t.state === "done" && <Icon name="check" size={10} stroke={2.5} style={{color:"white"}}/>}
            </span>
            <div style={{flex:1, minWidth:0}}>
              <div className="task-text">{t.text}</div>
              {t.sub && <div className="task-sub">{t.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const TerminalLog = () => {
  const lines = [
    { t: "prompt", text: "$ pnpm test orchestrator" },
    { t: "dim",    text: "  ↳ vitest run --reporter=verbose" },
    { t: "ok",     text: "✓ Orchestrator › dispatches single task (12ms)" },
    { t: "ok",     text: "✓ Orchestrator › respects priority order (8ms)" },
    { t: "dim",    text: "↻ Orchestrator › emits queued with eta…" },
    { t: "warn",   text: "  ⚠ deprecation: queue.push will be removed in v3" },
    { t: "ok",     text: "✓ Orchestrator › flushes batched tasks (24ms)" },
    { t: "",       text: "" },
    { t: "prompt", text: "$ pnpm typecheck" },
    { t: "ok",     text: "✓ 0 errors · 0 warnings · 1.4s" },
  ];
  return (
    <div className="rail-section" style={{flex:"1 1 auto", minHeight: 0}}>
      <div className="rail-head">
        <span style={{display:"flex", alignItems:"center", gap:8}}>
          <Icon name="terminal" size={12}/>
          Stream
        </span>
        <span style={{display:"flex", gap:8, alignItems:"center"}}>
          <span className="tag green">live</span>
          <span className="count">tail</span>
        </span>
      </div>
      <div className="terminal">
        {lines.map((l, i) => (
          <div key={i} className={l.t}>{l.text || "\u00A0"}</div>
        ))}
        <div><span className="prompt">$</span> <span className="cursor" style={{width:6, height:11, verticalAlign:"middle"}}/></div>
      </div>
    </div>
  );
};

const HandoffCard = () => (
  <div className="rail-section" style={{flex:"0 0 auto"}}>
    <div className="rail-head">
      <span>Devices</span>
      <span className="tag pink">paired</span>
    </div>
    <div className="handoff">
      <div className="handoff-viz">
        <div className="device computer">
          <div className="glyph"/>
          <span className="lbl">workstation</span>
        </div>
        <div style={{display:"flex", flexDirection:"column", gap:6, padding:"0 8px"}}>
          <div className="handoff-stream"/>
          <div className="handoff-stream" style={{animationDelay:"0.4s"}}/>
          <div className="handoff-stream" style={{animationDelay:"0.8s"}}/>
        </div>
        <div className="device phone">
          <div className="glyph"/>
          <span className="lbl">iphone 17</span>
        </div>
      </div>
      <div className="handoff-state">
        <span className="sync">synced</span>
        <span>latency 42ms · e2e</span>
      </div>
      <div style={{
        display:"flex", justifyContent:"space-between", alignItems:"center",
        fontFamily:"var(--f-mono)", fontSize:10.5, color:"var(--text-dim)",
        borderTop:"1px dashed var(--hairline)", paddingTop: 10
      }}>
        <span>session continues on phone</span>
        <button className="btn ghost" style={{height:24, fontSize:10.5, padding:"0 8px"}}>
          <Icon name="refresh" size={10}/> push
        </button>
      </div>
    </div>
  </div>
);

const RightRail = () => (
  <aside className="rail right hairline-l">
    <AgentOrb />
    <TaskList />
    <TerminalLog />
    <HandoffCard />
  </aside>
);

Object.assign(window, { RightRail, AgentOrb, TaskList, TerminalLog, HandoffCard });
