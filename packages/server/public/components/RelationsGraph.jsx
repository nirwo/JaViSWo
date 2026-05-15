// RelationsGraph — DAG of parent → subagent dispatches for the active agent.
// Builds nodes from tool_use 'Task'/'Agent' envelopes; edges from parentToolUseId.
// Renders via Cytoscape (loaded from CDN as window.cytoscape).

function extractGraph(agent) {
  const nodes = new Map(); // id -> { id, label, kind, status, desc }
  const edges = [];        // { source, target }

  nodes.set('root', {
    id: 'root',
    label: agent.slug || 'agent',
    kind: 'root',
    status: agent.status,
    turn: agent.turn,
  });

  for (const m of agent.messages) {
    if (m.kind === 'tool_use' && (m.name === 'Task' || m.name === 'Agent')) {
      const subId = m.id;
      if (!subId) continue;
      const subType = m.input?.subagent_type ?? m.input?.subagent ?? m.name.toLowerCase();
      const parent = m.parentToolUseId ?? 'root';
      nodes.set(subId, {
        id: subId,
        label: subType,
        kind: 'subagent',
        status: m.status ?? 'done',
        desc: m.input?.description ?? m.input?.prompt?.slice(0, 60) ?? '',
      });
      edges.push({ source: parent, target: subId });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

const RelationsGraph = ({ agent }) => {
  const containerRef = React.useRef(null);
  const cyRef = React.useRef(null);

  const { nodes, edges } = React.useMemo(
    () => agent ? extractGraph(agent) : { nodes: [], edges: [] },
    // Re-derive when message count or agent id changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent?.messages?.length, agent?.id, agent?.status],
  );

  // Build/update Cytoscape instance
  React.useEffect(() => {
    if (!containerRef.current || typeof window.cytoscape !== 'function') return;
    if (!agent) return;

    const elements = [
      ...nodes.map(n => ({
        data: {
          id: n.id,
          label: n.label,
          kind: n.kind,
          status: n.status ?? 'done',
          desc: n.desc ?? '',
        },
      })),
      ...edges.map((e, i) => ({
        data: { id: `e${i}`, source: e.source, target: e.target },
      })),
    ];

    if (cyRef.current) {
      cyRef.current.elements().remove();
      cyRef.current.add(elements);
      cyRef.current
        .layout({ name: 'cose', animate: true, animationDuration: 400, idealEdgeLength: 80, padding: 24 })
        .run();
      return;
    }

    cyRef.current = window.cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#a78bfa',
            'label': 'data(label)',
            'color': '#f5f3ff',
            'font-family': 'JetBrains Mono, ui-monospace, monospace',
            'font-size': '11px',
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-margin-y': 6,
            'text-outline-color': '#0a0820',
            'text-outline-width': 2,
            'width': 36,
            'height': 36,
            'border-width': 2,
            'border-color': '#7c3aed',
          },
        },
        {
          selector: 'node[kind = "root"]',
          style: {
            'background-color': '#22d3ee',
            'border-color': '#06b6d4',
            'width': 50,
            'height': 50,
            'font-size': '13px',
          },
        },
        {
          selector: 'node[status = "running"]',
          style: {
            'border-color': '#22d3ee',
            'border-width': 3,
          },
        },
        {
          selector: 'node[status = "errored"]',
          style: {
            'background-color': '#f87171',
            'border-color': '#ef4444',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': 'rgba(167,139,250,0.4)',
            'target-arrow-color': 'rgba(167,139,250,0.7)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 1.0,
          },
        },
      ],
      layout: { name: 'cose', animate: true, animationDuration: 400, idealEdgeLength: 80, padding: 24 },
      wheelSensitivity: 0.2,
    });

    cyRef.current.on('tap', 'node', (evt) => {
      const id = evt.target.id();
      console.log('[graph] node clicked:', id);
    });
  }, [nodes, edges, agent?.id]);

  // Destroy Cytoscape on unmount
  React.useEffect(() => {
    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, []);

  if (!agent) {
    return (
      <div className="graph-empty">
        <div style={{
          textAlign: 'center',
          maxWidth: 320,
          opacity: 0.6,
          fontSize: 12,
          fontFamily: 'var(--f-mono)',
          color: 'var(--text-mute)',
        }}>
          No agent selected. The relations graph shows parent to subagent dispatches in real time as the agent works.
        </div>
      </div>
    );
  }

  if (nodes.length === 1 && edges.length === 0) {
    return (
      <div className="graph-empty">
        <div style={{
          textAlign: 'center',
          maxWidth: 360,
          opacity: 0.6,
          fontSize: 12,
          fontFamily: 'var(--f-mono)',
          color: 'var(--text-mute)',
          lineHeight: 1.6,
        }}>
          <div style={{ fontSize: 14, color: 'var(--violet-300)', marginBottom: 8 }}>{agent.slug}</div>
          No subagents dispatched yet. When this agent calls the <code>Task</code> tool to spawn a sub-agent, the relationship will appear here.
        </div>
      </div>
    );
  }

  return (
    <div className="graph-wrap">
      <div ref={containerRef} className="graph-canvas"/>
      <div className="graph-legend">
        <span><span className="graph-dot root"/>root</span>
        <span><span className="graph-dot sub"/>subagent</span>
        <span><span className="graph-dot run"/>running</span>
        <span><span className="graph-dot err"/>errored</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-mute)' }}>
          {nodes.length} node{nodes.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
};

window.RelationsGraph = RelationsGraph;
