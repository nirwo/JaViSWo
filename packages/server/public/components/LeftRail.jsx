// JaViSWo — Left rail: sessions, file tree, git status, DESIGN.md badge

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

const GitCell = ({ label, value, className }) => (
  <div className={`git-cell ${className}`}>
    <span className="num">
      {className === 'added' ? '+' : className === 'removed' ? '−' : ''}
      {value}
    </span>
    <span className="lbl">{label}</span>
  </div>
);

const TreeNode = ({ node, depth, statusMap, basePath }) => {
  const { openEditor } = useCockpit();
  const [open, setOpen] = React.useState(depth < 2);
  const relPath = node.path.startsWith(basePath)
    ? node.path.slice(basePath.length).replace(/^\/+/, '')
    : node.path;
  const statusCode = statusMap.get(relPath);
  const cls = statusCode?.includes('A') ? 'added'
    : statusCode?.includes('M') ? 'modified'
    : '';
  const isDir = node.type === 'dir';
  return (
    <>
      <div
        className={`tree-row ${cls}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => {
          if (isDir) {
            setOpen(o => !o);
          } else {
            openEditor(node.path);
          }
        }}
      >
        {isDir
          ? <Icon name={open ? 'chevron' : 'chevronR'} size={10}/>
          : <span style={{ width: 10 }}/>}
        <Icon name={isDir ? 'folder' : 'file'} size={11}/>
        <span>{node.name}{node.hasDesignMd ? ' 🎨' : ''}</span>
        {statusCode && <span className="badge">{statusCode.trim()}</span>}
      </div>
      {isDir && open && node.children?.map((c) => (
        <TreeNode
          key={c.path}
          node={c}
          depth={depth + 1}
          statusMap={statusMap}
          basePath={basePath}
        />
      ))}
    </>
  );
};

const FileTreeView = ({ node, status }) => {
  if (!node) return null;
  const statusMap = new Map((status?.files ?? []).map(f => [f.path, f.code]));
  return <TreeNode node={node} depth={0} statusMap={statusMap} basePath={node.path}/>;
};

const DesignMdSummary = ({ design }) => {
  const [open, setOpen] = React.useState(false);
  const errCount = design.lint.filter(l => l.severity === 'error').length;
  const warnCount = design.lint.filter(l => l.severity === 'warning').length;
  return (
    <div style={{
      margin: '4px 6px 8px',
      padding: '6px 10px',
      borderRadius: 8,
      background: 'rgba(167,139,250,0.06)',
      border: '1px solid rgba(167,139,250,0.2)',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text)',
          font: 'inherit',
          textAlign: 'left',
          padding: 0,
        }}
      >
        <span style={{ fontSize: 14 }}>🎨</span>
        <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--violet-200)' }}>
          {design.name ?? 'DESIGN.md'}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          color: errCount > 0 ? 'var(--danger)' : warnCount > 0 ? 'var(--warning)' : 'var(--text-mute)',
        }}>
          {errCount > 0 ? `${errCount} err` : warnCount > 0 ? `${warnCount} warn` : 'ok'}
        </span>
        <Icon name={open ? 'chevron' : 'chevronR'} size={10} style={{ opacity: 0.5 }}/>
      </button>
      {open && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--hairline)' }}>
          {design.colors.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{
                fontSize: 9,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--text-mute)',
                marginBottom: 4,
              }}>
                Colors · {design.colors.length}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {design.colors.slice(0, 12).map(c => (
                  <span
                    key={c.name}
                    title={`${c.name}: ${c.value}`}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: c.value,
                      border: '1px solid rgba(255,255,255,0.1)',
                      boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.1)',
                      display: 'inline-block',
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          {design.typography.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{
                fontSize: 9,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--text-mute)',
                marginBottom: 4,
              }}>
                Type · {design.typography.length}
              </div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.6 }}>
                {design.typography.slice(0, 4).map(t => (
                  <div key={t.name}>
                    {t.name}: <span style={{ color: 'var(--cyan-300)' }}>{t.fontSize ?? '?'}</span>
                    {t.fontFamily ? ` · ${t.fontFamily}` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
          {design.lint.filter(l => l.severity !== 'info').length > 0 && (
            <div style={{ marginTop: 6, padding: 6, background: 'rgba(0,0,0,0.3)', borderRadius: 4 }}>
              {design.lint.filter(l => l.severity !== 'info').map((l, i) => (
                <div key={i} style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 9,
                  color: l.severity === 'error' ? 'var(--danger)' : 'var(--warning)',
                  marginBottom: 2,
                }}>
                  {l.severity === 'error' ? '✗' : '⚠'} {l.rule}: {l.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const CommitForm = ({ project, status, onCommitted }) => {
  const [msg, setMsg] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const hasChanges =
    (status?.added ?? 0) + (status?.modified ?? 0) +
    (status?.removed ?? 0) + (status?.untracked ?? 0) > 0;
  const disabled = busy || !project?.path || !hasChanges || msg.trim().length === 0;

  const doCommit = async () => {
    if (disabled) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: project.path, message: msg.trim() }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok || body?.ok === false) {
        setErr(body?.error?.stderr || body?.error?.detail || `HTTP ${r.status}`);
      } else {
        setMsg('');
        if (onCommitted) onCommitted();
      }
    } catch (e) {
      setErr(e.message || 'commit failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 10px 12px' }}>
      <input
        className="commit-input"
        type="text"
        placeholder={hasChanges ? 'Commit message…' : 'Nothing to commit'}
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !disabled) doCommit(); }}
        disabled={!hasChanges || busy}
      />
      <button
        className="btn"
        style={{ height: 28, fontSize: 11.5 }}
        disabled={disabled}
        onClick={doCommit}
        title={!hasChanges ? 'No staged changes' : 'git add -A && git commit'}
      >
        <Icon name="git" size={11}/> {busy ? 'Committing…' : 'Commit all'}
      </button>
      {err && (
        <div style={{
          fontFamily: 'var(--f-mono)', fontSize: 10,
          color: 'var(--danger)', whiteSpace: 'pre-wrap',
          padding: '4px 6px', background: 'rgba(244,63,94,0.06)',
          border: '1px solid rgba(244,63,94,0.2)', borderRadius: 4,
        }}>{err}</div>
      )}
    </div>
  );
};

const LeftRail = () => {
  const {
    agents, currentAgentId, selectAgent,
    projectTree, projectGit, projectDesign, draftProject, refreshProjectData,
  } = useCockpit();

  const sessions = [...agents.values()].map(a => ({
    id: a.id,
    title: a.slug,
    state: a.status === 'running' ? 'doing'
      : a.status === 'errored' ? 'error'
      : a.status === 'completed' ? 'done'
      : 'idle',
    meta: a.tokens > 0 ? `${a.tokens.toLocaleString()} tk` : '—',
  }));

  return (
    <aside className="rail left hairline-r">
      <RailSection
        id="left-sessions"
        label="Sessions"
        count={String(sessions.length)}
        headExtra={
          <button
            className="icon-btn"
            style={{ width: 22, height: 22 }}
            title="New session"
            onClick={e => { e.stopPropagation(); selectAgent(null); }}
          >
            <Icon name="plus" size={12}/>
          </button>
        }
        style={{ flex: '0 0 auto', maxHeight: 240 }}
      >
        <div className="rail-body">
          {sessions.length === 0 && (
            <div style={{ padding: '12px 14px', color: 'var(--text-mute)', fontSize: 11.5 }}>
              No sessions yet
            </div>
          )}
          {sessions.map(s => (
            <div
              key={s.id}
              className={`session ${currentAgentId === s.id ? 'active' : ''}`}
              onClick={() => selectAgent(s.id)}
            >
              <span className={`session-pulse ${s.state === 'doing' ? '' : s.state}`}/>
              <span className="session-title">{s.title}</span>
              <span className="session-meta">{s.meta}</span>
            </div>
          ))}
        </div>
      </RailSection>

      <RailSection
        id="left-files"
        label="Workspace"
        headExtra={
          <>
            {projectGit?.branch && <span className="tag">{projectGit.branch}</span>}
            <button
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              title="Refresh"
              onClick={e => { e.stopPropagation(); refreshProjectData(); }}
            >
              <Icon name="refresh" size={12}/>
            </button>
          </>
        }
        style={{ flex: '1 1 auto', minHeight: 200 }}
      >
        <div className="rail-body">
          {projectDesign?.exists && <DesignMdSummary design={projectDesign}/>}
          {!draftProject && (
            <div style={{ padding: '12px 14px', color: 'var(--text-mute)', fontSize: 11.5 }}>
              No project selected
            </div>
          )}
          {draftProject && !projectTree && (
            <div style={{ padding: '12px 14px', color: 'var(--text-mute)', fontSize: 11.5 }}>
              Loading…
            </div>
          )}
          {projectTree && <FileTreeView node={projectTree} status={projectGit}/>}
        </div>
      </RailSection>

      <RailSection
        id="left-git"
        label="Git"
        headExtra={
          projectGit?.branch && (
            <span className="tag cyan">
              <Icon name="branch" size={9}/>{projectGit.branch}
            </span>
          )
        }
        style={{ flex: '0 0 auto' }}
      >
        <div className="git-stat">
          <GitCell label="added"    value={projectGit?.added    ?? 0} className="added"/>
          <GitCell label="removed"  value={projectGit?.removed  ?? 0} className="removed"/>
          <GitCell label="modified" value={projectGit?.modified ?? 0} className="modified"/>
          <GitCell label="new"      value={projectGit?.untracked ?? 0} className="untracked"/>
        </div>
        <CommitForm
          project={draftProject}
          status={projectGit}
          onCommitted={refreshProjectData}
        />
      </RailSection>
    </aside>
  );
};

Object.assign(window, { LeftRail, FileTreeView, TreeNode, GitCell, DesignMdSummary, CommitForm });
