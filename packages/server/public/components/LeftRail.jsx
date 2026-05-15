// JaViSWo — Left rail: sessions, file tree, git status

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
        onClick={() => isDir && setOpen(o => !o)}
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

const LeftRail = () => {
  const {
    agents, currentAgentId, selectAgent,
    projectTree, projectGit, draftProject, refreshProjectData,
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
        <div style={{ display: 'flex', gap: 6, padding: '4px 10px 12px' }}>
          <button
            className="btn"
            style={{ flex: 1, height: 28, fontSize: 11.5 }}
            disabled
            title="Commit (M2)"
          >
            <Icon name="git" size={11}/> Commit
          </button>
        </div>
      </RailSection>
    </aside>
  );
};

Object.assign(window, { LeftRail, FileTreeView, TreeNode, GitCell });
