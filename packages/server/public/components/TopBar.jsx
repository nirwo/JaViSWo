// JaViSWo — Top bar (brand, multi-agent tabs, branch, tokens)

const TopBar = () => {
  const {
    agents, currentAgentId, selectAgent, closeAgent,
    totalTokens, totalCost, draftProject, openPicker,
  } = useCockpit();

  const list = [...agents.values()];

  const onNew = () => {
    // Deselect — user is starting a new agent from the composer
    selectAgent(null);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark"/>
        <span className="brand-name"><b>JaViSWo</b> <span>· agent console</span></span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, overflow: 'hidden' }}>
        <div className="tabs">
          {list.length === 0 && (
            <span className="muted" style={{ fontSize: 11.5, padding: '0 6px', color: 'var(--text-mute)' }}>
              no agents yet
            </span>
          )}
          {list.map(a => {
            const dotClass = a.status === 'running' ? 'thinking'
                           : a.status === 'errored'  ? 'error'
                           : a.status === 'idle'     ? 'idle'
                           : '';
            return (
              <button
                key={a.id}
                className={`tab ${currentAgentId === a.id ? 'active' : ''}`}
                onClick={() => selectAgent(a.id)}
              >
                <span className={`dot ${dotClass}`}/>
                <span>{a.slug}</span>
                <span
                  className="close"
                  onClick={(e) => { e.stopPropagation(); closeAgent(a.id); }}
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <Icon name="x" size={10}/>
                </span>
              </button>
            );
          })}
          <button className="tab-add" title="New agent session" onClick={onNew}>
            <Icon name="plus" size={12}/>
          </button>
        </div>

        <button
          className="branch"
          onClick={openPicker}
          title={draftProject ? draftProject.path : 'Pick a project'}
          style={{ cursor: 'pointer', background: 'none', border: 'none' }}
        >
          <span className="gitdot"/>
          <Icon name="folder" size={11}/>
          {draftProject ? draftProject.name : 'no project'}
          <Icon name="chevron" size={10} style={{ opacity: 0.5 }}/>
        </button>
      </div>

      <div className="topbar-right">
        <div className="token-meter" title="Total tokens across active session">
          <Icon name="layers" size={11} style={{ color: 'var(--violet-300)' }}/>
          <span>{totalTokens.toLocaleString()} <span style={{ color: 'var(--text-mute)' }}>tokens</span></span>
        </div>
        <div className="token-meter" title="Cost across active session">
          <Icon name="bolt" size={11} style={{ color: 'var(--cyan-300)' }}/>
          <span>${totalCost.toFixed(4)}</span>
        </div>
        <button className="icon-btn" title="History"><Icon name="history" size={15}/></button>
        <button className="icon-btn" title="Settings"><Icon name="settings" size={15}/></button>
        <div className="avatar">NW</div>
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
