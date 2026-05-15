// JaViSWo — Left rail: sessions, file tree, git status

const SESSIONS = [
  { id: "s1", title: "Refactor auth flow into hooks", state: "doing",  meta: "2m" },
  { id: "s2", title: "Add WebSocket reconnect logic",   state: "doing",  meta: "4m" },
  { id: "s3", title: "Migrate Postgres schema v2",      state: "idle",   meta: "12m" },
  { id: "s4", title: "Voice transcription pipeline",     state: "done",   meta: "1h" },
  { id: "s5", title: "Diff viewer keyboard nav",         state: "done",   meta: "3h" },
  { id: "s6", title: "Onboarding copy review",           state: "done",   meta: "yest" },
];

const FILE_TREE = [
  { depth: 0, name: "javiswo/", folder: true, open: true },
  { depth: 1, name: "src/",      folder: true, open: true },
  { depth: 2, name: "agent/",    folder: true, open: true },
  { depth: 3, name: "orchestrator.ts", state: "modified", added: "+42", active: true },
  { depth: 3, name: "permissions.ts", state: "modified", added: "+8" },
  { depth: 3, name: "stream.ts" },
  { depth: 2, name: "ui/",       folder: true, open: true },
  { depth: 3, name: "Composer.tsx", state: "added", added: "new" },
  { depth: 3, name: "Orb.tsx",      state: "added", added: "new" },
  { depth: 3, name: "Diff.tsx" },
  { depth: 2, name: "lib/",      folder: true, open: false },
  { depth: 1, name: "server/",   folder: true, open: false },
  { depth: 1, name: "tests/",    folder: true, open: false },
  { depth: 1, name: "package.json" },
  { depth: 1, name: "tsconfig.json" },
];

const LeftRail = () => {
  const [activeSession, setActiveSession] = React.useState("s1");
  return (
    <aside className="rail left hairline-r">
      {/* Sessions */}
      <div className="rail-section" style={{flex: "0 0 auto", maxHeight: 240}}>
        <div className="rail-head">
          <span>Sessions</span>
          <span style={{display:"flex", alignItems:"center", gap:8}}>
            <span className="count">6</span>
            <button className="icon-btn" style={{width:22, height:22}} title="New session">
              <Icon name="plus" size={12}/>
            </button>
          </span>
        </div>
        <div className="rail-body">
          {SESSIONS.map(s => (
            <div
              key={s.id}
              className={`session ${activeSession === s.id ? "active" : ""}`}
              onClick={() => setActiveSession(s.id)}
            >
              <span className={`session-pulse ${s.state === "doing" ? "" : s.state}`} />
              <span className="session-title">{s.title}</span>
              <span className="session-meta">{s.meta}</span>
            </div>
          ))}
        </div>
      </div>

      {/* File tree */}
      <div className="rail-section" style={{flex: "1 1 auto", minHeight: 200}}>
        <div className="rail-head">
          <span>Workspace</span>
          <span style={{display:"flex", alignItems:"center", gap:8}}>
            <span className="tag">main</span>
            <button className="icon-btn" style={{width:22, height:22}} title="Search">
              <Icon name="search" size={12}/>
            </button>
          </span>
        </div>
        <div className="rail-body">
          <div className="tree">
            {FILE_TREE.map((node, i) => (
              <div
                key={i}
                className={`tree-row ${node.state || ""} ${node.active ? "active" : ""}`}
                style={{ paddingLeft: 6 + node.depth * 12 }}
              >
                {node.folder ? (
                  <Icon name={node.open ? "chevron" : "chevronR"} size={10} />
                ) : <span style={{width: 10}} />}
                <Icon name={node.folder ? "folder" : "file"} size={11} />
                <span>{node.name}</span>
                {node.added && <span className="badge">{node.added}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Git status */}
      <div className="rail-section" style={{flex: "0 0 auto"}}>
        <div className="rail-head">
          <span>Git</span>
          <span style={{display:"flex", alignItems:"center", gap:6}}>
            <span className="tag cyan"><Icon name="branch" size={9}/>feat/orb-ui</span>
          </span>
        </div>
        <div className="git-stat">
          <div className="git-cell added">
            <span className="num">+247</span>
            <span className="lbl">added</span>
          </div>
          <div className="git-cell removed">
            <span className="num">−83</span>
            <span className="lbl">removed</span>
          </div>
          <div className="git-cell modified">
            <span className="num">6</span>
            <span className="lbl">modified</span>
          </div>
          <div className="git-cell untracked">
            <span className="num">2</span>
            <span className="lbl">new</span>
          </div>
        </div>
        <div style={{display:"flex", gap:6, padding:"4px 10px 12px"}}>
          <button className="btn" style={{flex:1, height:28, fontSize:11.5}}>
            <Icon name="git" size={11}/> Commit
          </button>
          <button className="btn ghost" style={{height:28, fontSize:11.5}} title="Push">
            <Icon name="upload" size={11}/>
          </button>
        </div>
      </div>
    </aside>
  );
};

Object.assign(window, { LeftRail });
