// JaViSWo — Right rail: agent orb, task list, terminal, handoff

const RailSection = ({ id, label, count, headExtra, children, style, ...props }) => {
  const { isCollapsed, toggleSection } = useCockpit();
  const collapsed = isCollapsed(id);
  return (
    <div className={`rail-section${collapsed ? ' collapsed' : ''}`} style={style} {...props}>
      <div className="rail-head" onClick={() => toggleSection(id)} style={{ cursor: 'pointer' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Icon name={collapsed ? 'chevronR' : 'chevron'} size={10} style={{ opacity: 0.5 }}/>
          {label}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {count != null && <span className="count">{count}</span>}
          {headExtra}
        </span>
      </div>
      {!collapsed && children}
    </div>
  );
};

const AgentOrb = () => {
  const { agents, currentAgentId, latencyMs, wsStatus } = useCockpit();
  const agent = currentAgentId ? agents.get(currentAgentId) : null;

  const state = !agent             ? 'idle'
              : agent.status === 'running'   ? 'thinking'
              : agent.status === 'errored'   ? 'errored'
              : 'online';

  const thought = !agent
    ? 'Standing by for instructions…'
    : agent.status === 'running'
      ? (
          agent.messages.findLast?.(m => m.kind === 'thinking')?.text?.slice(0, 80)
          ?? `Processing turn ${agent.turn}…`
        )
    : agent.status === 'completed'
      ? `Turn ${agent.turn} complete · ${agent.tokens} tk`
    : agent.status === 'errored'
      ? 'Errored — review logs'
    : 'Idle';

  const tagClass = wsStatus === 'open' ? 'cyan' : 'pink';
  const tagLabel = wsStatus === 'open'
    ? `online · ${latencyMs ?? '…'}ms`
    : wsStatus;

  return (
    <RailSection
      id="right-agent"
      label="Agent"
      headExtra={
        <span className={`tag ${tagClass}`}>
          <Icon name="bolt" size={9}/>{tagLabel}
        </span>
      }
      style={{ flex: '0 0 auto' }}
    >
      <div className="orb-wrap">
        <div className="orb-stage">
          <div className="orb"/>
          <OrbParticles count={7}/>
        </div>
        <div className="orb-state">{state}</div>
        <div className="orb-thought">"{thought}"</div>
      </div>
    </RailSection>
  );
};

const TaskList = () => {
  const { agents, currentAgentId } = useCockpit();
  const a = currentAgentId ? agents.get(currentAgentId) : null;
  const todos = a?.todos ?? [];
  const doneCnt = todos.filter(t => t.status === 'completed').length;
  const countLabel = todos.length ? `${doneCnt}/${todos.length}` : '—';

  return (
    <RailSection
      id="right-plan"
      label="Plan"
      count={countLabel}
      style={{ flex: '0 1 auto', maxHeight: 290 }}
    >
      <div className="rail-body" style={{ padding: '4px 6px 10px' }}>
        {todos.length === 0 && (
          <div style={{ padding: '8px 12px', color: 'var(--text-mute)', fontSize: 11.5 }}>
            No plan yet · agent hasn't created todos
          </div>
        )}
        {todos.map((t, i) => {
          const state = t.status === 'completed' ? 'done'
            : t.status === 'in_progress' ? 'doing'
            : 'todo';
          return (
            <div key={i} className={`task ${state}`}>
              <span className="task-check">
                {state === 'done' && (
                  <Icon name="check" size={10} stroke={2.5} style={{ color: 'white' }}/>
                )}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="task-text">{t.subject ?? t.activeForm ?? '(untitled)'}</div>
                {t.activeForm && state === 'doing' && (
                  <div className="task-sub">{t.activeForm}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </RailSection>
  );
};

const TerminalLog = () => {
  const { agents, currentAgentId } = useCockpit();
  const a = currentAgentId ? agents.get(currentAgentId) : null;

  const lines = React.useMemo(() => {
    if (!a) return [];
    const out = [];
    for (const m of a.messages.slice(-30)) {
      if (m.kind === 'stderr') {
        out.push({ t: 'err', text: m.text });
      } else if (m.kind === 'exit') {
        out.push({ t: m.code === 0 ? 'ok' : 'err', text: `exit ${m.code}` });
      } else if (m.kind === 'tool_use') {
        const inputStr = typeof m.input === 'string'
          ? m.input
          : JSON.stringify(m.input).slice(0, 80);
        out.push({ t: 'prompt', text: `$ ${m.name}(${inputStr})` });
      } else if (m.kind === 'result') {
        const tkTotal = (m.usage?.input_tokens ?? 0) + (m.usage?.output_tokens ?? 0);
        out.push({
          t: 'ok',
          text: `✓ ${m.durationMs}ms · ${tkTotal} tk · $${(m.cost ?? 0).toFixed(4)}`,
        });
      }
    }
    return out;
  }, [a?.messages]);

  return (
    <RailSection
      id="right-stream"
      label={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="terminal" size={12}/>
          Stream
        </span>
      }
      headExtra={
        <>
          <span className={`tag ${a?.status === 'running' ? 'green' : ''}`}>
            {a?.status === 'running' ? 'live' : 'idle'}
          </span>
          <span className="count">{lines.length}</span>
        </>
      }
      style={{ flex: '1 1 auto', minHeight: 0 }}
    >
      <div className="terminal">
        {lines.length === 0 && <div className="dim">No activity yet</div>}
        {lines.map((l, i) => <div key={i} className={l.t}>{l.text}</div>)}
        {a?.status === 'running' && (
          <div>
            <span className="prompt">$</span>{' '}
            <span className="cursor" style={{ width: 6, height: 11, verticalAlign: 'middle' }}/>
          </div>
        )}
      </div>
    </RailSection>
  );
};

const HandoffCard = () => {
  const { latencyMs, clientCount, wsStatus } = useCockpit();
  const lanUrl = `http://${location.host}`;

  const copyLanUrl = async () => {
    try { await navigator.clipboard.writeText(lanUrl); } catch {}
  };

  return (
    <RailSection
      id="right-devices"
      label="Devices"
      headExtra={
        <span className={`tag ${clientCount > 1 ? 'pink' : ''}`}>
          {clientCount} {clientCount === 1 ? 'device' : 'devices'}
        </span>
      }
      style={{ flex: '0 0 auto' }}
    >
      <div className="handoff">
        <div className="handoff-viz">
          <div className="device computer">
            <div className="glyph"/>
            <span className="lbl">workstation</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 8px' }}>
            <div className="handoff-stream"/>
            <div className="handoff-stream" style={{ animationDelay: '0.4s' }}/>
            <div className="handoff-stream" style={{ animationDelay: '0.8s' }}/>
          </div>
          <div className="device phone">
            <div className="glyph"/>
            <span className="lbl">iphone</span>
          </div>
        </div>
        <div className="handoff-state">
          <span
            className="sync"
            style={{ color: wsStatus === 'open' ? 'var(--success)' : 'var(--danger)' }}
          >
            {wsStatus}
          </span>
          <span>latency {latencyMs ?? '…'}ms · {clientCount} {clientCount === 1 ? 'client' : 'clients'}</span>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--text-dim)',
          borderTop: '1px dashed var(--hairline)', paddingTop: 10,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
            {lanUrl}
          </span>
          <button
            className="btn ghost"
            style={{ height: 24, fontSize: 10.5, padding: '0 8px' }}
            onClick={copyLanUrl}
            title="Copy LAN URL"
          >
            <Icon name="copy" size={10}/> copy
          </button>
        </div>
      </div>
    </RailSection>
  );
};

const RightRail = () => (
  <aside className="rail right hairline-l">
    <AgentOrb />
    <TaskList />
    <TerminalLog />
    <HandoffCard />
  </aside>
);

Object.assign(window, { RightRail, AgentOrb, TaskList, TerminalLog, HandoffCard });
