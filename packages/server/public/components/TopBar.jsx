// JaViSWo — Top bar (brand, multi-agent tabs, branch, tokens)

const HistoryDropdown = ({ agents, currentAgentId, onPick, onClose }) => (
  <div className="topbar-popover" role="menu">
    <div style={{
      padding: '8px 12px',
      fontFamily: 'var(--f-mono)', fontSize: 10,
      letterSpacing: '0.14em', textTransform: 'uppercase',
      color: 'var(--text-mute)', borderBottom: '1px solid var(--hairline)',
    }}>
      History · {agents.size}
    </div>
    {agents.size === 0 && (
      <div style={{ padding: 14, color: 'var(--text-mute)', fontSize: 12 }}>
        No conversations yet
      </div>
    )}
    {[...agents.values()].map(a => (
      <button
        key={a.id}
        role="menuitem"
        onClick={() => { onPick(a.id); onClose(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', padding: '8px 12px',
          background: a.id === currentAgentId ? 'rgba(94,234,212,0.08)' : 'transparent',
          border: 'none', cursor: 'pointer', color: 'var(--text)',
          font: 'inherit', fontSize: 12.5, textAlign: 'left',
        }}
        onMouseEnter={e => {
          if (a.id !== currentAgentId) e.currentTarget.style.background = 'rgba(167,139,250,0.06)';
        }}
        onMouseLeave={e => {
          if (a.id !== currentAgentId) e.currentTarget.style.background = 'transparent';
        }}
      >
        <span className={`session-pulse ${a.status === 'running' ? '' : a.status === 'errored' ? 'error' : 'done'}`}/>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.slug}
        </span>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--text-mute)' }}>
          {a.tokens} tk
        </span>
      </button>
    ))}
  </div>
);

const TopBar = () => {
  const {
    agents, currentAgentId, selectAgent, closeAgent,
    totalTokens, totalCost, draftProject, openPicker, projectDesign,
    jarvisEnabled, setJarvisEnabled,
  } = useCockpit();

  const [historyOpen, setHistoryOpen] = React.useState(false);
  const historyAnchorRef = React.useRef(null);

  React.useEffect(() => {
    if (!historyOpen) return;
    const close = (e) => {
      if (historyAnchorRef.current && !historyAnchorRef.current.contains(e.target)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [historyOpen]);

  // Hide the JARVIS singleton from the agent tab strip — he lives in the
  // overlay, not the normal chat workflow. Identified by his synthetic
  // firstPrompt slug 'JARVIS orchestrator'.
  const list = [...agents.values()].filter(a => a.slug !== 'JARVIS orchestrato…' && a.slug !== 'JARVIS orchestrator');

  const onNew = () => {
    // Deselect — user is starting a new agent from the composer
    selectAgent(null);
  };

  // ⌘1-9 / Ctrl+1-9 shortcuts to jump between agent tabs
  React.useEffect(() => {
    const handler = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (!(e.metaKey || e.ctrlKey)) return;
      const n = parseInt(e.key, 10);
      if (!isNaN(n) && n >= 1 && n <= 9) {
        const target = list[n - 1];
        if (target) {
          e.preventDefault();
          selectAgent(target.id);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [list, selectAgent]);

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
          {list.map((a, i) => {
            const dotClass = a.status === 'running' ? 'thinking'
                           : a.status === 'errored'  ? 'error'
                           : a.status === 'idle'     ? 'idle'
                           : '';
            return (
              <button
                key={a.id}
                className={`tab ${currentAgentId === a.id ? 'active' : ''}`}
                onClick={() => selectAgent(a.id)}
                title={`Switch to ${a.slug}${i < 9 ? ` (⌘${i + 1})` : ''}${a.spawnedBy === 'jarvis' ? ' (dispatched by JARVIS)' : ''}`}
              >
                <span className={`dot ${dotClass}`}/>
                {a.spawnedBy === 'jarvis' && (
                  <span
                    aria-label="dispatched by JARVIS"
                    title="dispatched by JARVIS"
                    style={{
                      fontSize: 10,
                      padding: '1px 4px',
                      borderRadius: 4,
                      background: 'rgba(167,139,250,0.18)',
                      color: 'var(--violet-300, #c4b5fd)',
                      fontFamily: 'var(--f-mono)',
                      letterSpacing: '0.04em',
                    }}
                  >
                    JARVIS
                  </span>
                )}
                <span>{a.slug}</span>
                {i < 9 && <span className="tab-kbd">{i + 1}</span>}
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

        {projectDesign?.exists && (
          <button
            className="branch"
            title={`DESIGN.md · ${projectDesign.colors.length} colors · ${projectDesign.typography.length} type styles`}
            style={{ borderColor: 'rgba(167,139,250,0.4)', cursor: 'default' }}
          >
            <span style={{ fontSize: 12 }}>🎨</span>
            <span>{projectDesign.name ?? 'DESIGN.md'}</span>
            <span style={{ color: 'var(--text-mute)', fontSize: 10 }}>
              {projectDesign.colors.length}c · {projectDesign.typography.length}t
            </span>
          </button>
        )}
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
        <div style={{ position: 'relative' }} ref={historyAnchorRef}>
          <button
            className="icon-btn"
            title="History"
            onClick={() => setHistoryOpen(o => !o)}
          >
            <Icon name="history" size={15}/>
          </button>
          {historyOpen && (
            <HistoryDropdown
              agents={agents}
              currentAgentId={currentAgentId}
              onPick={selectAgent}
              onClose={() => setHistoryOpen(false)}
            />
          )}
        </div>
        <button
          className={`icon-btn jarvis-toggle ${jarvisEnabled ? 'active' : ''}`}
          title={jarvisEnabled ? 'JARVIS listening — click to disable' : 'Enable JARVIS (voice orchestrator)'}
          onClick={() => setJarvisEnabled(!jarvisEnabled)}
        >
          <Icon name="mic" size={15}/>
        </button>
        <button
          className="icon-btn"
          title="Settings"
          onClick={() => {
            document.body.classList.add('twk-flash');
            setTimeout(() => document.body.classList.remove('twk-flash'), 1200);
            const panel = document.querySelector('.twk-panel');
            if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }}
        >
          <Icon name="settings" size={15}/>
        </button>
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
