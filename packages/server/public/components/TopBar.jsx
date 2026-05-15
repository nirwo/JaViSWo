// JaViSWo — Top bar (brand, multi-agent tabs, branch, tokens)

const TopBar = () => {
  const [activeTab, setActiveTab] = React.useState(0);
  const tabs = [
    { name: "orchestrator refactor", state: "thinking" },
    { name: "ws reconnect", state: "active" },
    { name: "schema migration", state: "idle" },
  ];
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"/>
        <span className="brand-name"><b>JaViSWo</b> <span>· agent console</span></span>
      </div>

      <div style={{display:"flex", alignItems:"center", gap:14, minWidth:0, overflow:"hidden"}}>
        <div className="tabs">
          {tabs.map((t, i) => (
            <button
              key={i}
              className={`tab ${activeTab === i ? "active" : ""}`}
              onClick={() => setActiveTab(i)}
            >
              <span className={`dot ${t.state === "thinking" ? "thinking" : t.state === "idle" ? "idle" : ""}`}/>
              <span>{t.name}</span>
              <Icon name="x" size={10} className="close"/>
            </button>
          ))}
          <button className="tab-add" title="New agent session"><Icon name="plus" size={12}/></button>
        </div>

        <div className="branch">
          <span className="gitdot"/>
          <Icon name="branch" size={11}/>
          feat/orb-ui
          <Icon name="chevron" size={10} style={{opacity:0.5}}/>
        </div>
      </div>

      <div className="topbar-right">
        <div className="token-meter" title="Context window">
          <Icon name="layers" size={11} style={{color:"var(--violet-300)"}}/>
          <span>84,212 <span style={{color:"var(--text-mute)"}}>/ 200k</span></span>
          <div className="bar"><div className="bar-fill"/></div>
        </div>
        <div className="token-meter" title="Cost this session">
          <Icon name="bolt" size={11} style={{color:"var(--cyan-300)"}}/>
          <span>$0.42 <span style={{color:"var(--text-mute)"}}>· 14m</span></span>
        </div>
        <button className="icon-btn" title="History"><Icon name="history" size={15}/></button>
        <button className="icon-btn" title="Settings"><Icon name="settings" size={15}/></button>
        <div className="avatar">MW</div>
      </div>
    </header>
  );
};

const BootSequence = () => {
  const [gone, setGone] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setGone(true), 2800);
    return () => clearTimeout(t);
  }, []);
  if (gone) return null;
  return (
    <div className="boot">
      <div className="boot-inner">
        <div className="boot-orb"/>
        <div className="boot-name">Ja<b>Vi</b>S<b>Wo</b></div>
        <div className="boot-log">
          agent core initialized
          <span className="ok">✓</span>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { TopBar, BootSequence });
