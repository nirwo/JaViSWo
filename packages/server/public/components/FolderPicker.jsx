// FolderPicker — glass-morphism modal for picking a project
// Reads from /api/projects/recent and /api/projects/roots

const FolderPicker = () => {
  const { pickerOpen, closePicker, setDraftProject } = useCockpit();

  const [recent, setRecent] = React.useState([]);
  const [roots, setRoots] = React.useState([]);
  const [drillRoot, setDrillRoot] = React.useState(null); // {path, name} when drilled in
  const [folders, setFolders] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  // Load recent + roots whenever the modal opens
  React.useEffect(() => {
    if (!pickerOpen) return;
    console.warn('[picker] open=', pickerOpen);
    setDrillRoot(null);
    setFolders([]);
    setError(null);
    setLoading(true);
    Promise.all([
      fetch('/api/projects/recent').then(async r => {
        if (!r.ok) throw new Error(`recent ${r.status}`);
        return r.json();
      }),
      fetch('/api/projects/roots').then(async r => {
        if (!r.ok) throw new Error(`roots ${r.status}`);
        return r.json();
      }),
    ]).then(([recData, rootData]) => {
      setRecent(recData.recent ?? []);
      setRoots(rootData.roots ?? []);
    }).catch(e => {
      setError('Could not load projects: ' + e.message);
    }).finally(() => setLoading(false));
  }, [pickerOpen]);

  // Drill into a root
  const drillInto = React.useCallback(async (root) => {
    console.warn('[picker] drillInto', root);
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/projects/list?root=' + encodeURIComponent(root.path));
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        setError((body && body.error) ? body.error : `HTTP ${r.status}`);
        return;
      }
      const data = await r.json();
      setDrillRoot(root);
      setFolders(data.folders ?? []);
    } catch (e) {
      setError('Failed to list folder: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const pickProject = React.useCallback((proj) => {
    console.warn('[picker] pickProject', proj);
    setDraftProject({ path: proj.path, name: proj.name, hasDesignMd: proj.hasDesignMd ?? false });
    closePicker();
  }, [setDraftProject, closePicker]);

  // Keyboard: Esc closes
  React.useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e) => { if (e.key === 'Escape') closePicker(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pickerOpen, closePicker]);

  if (!pickerOpen) return null;

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(10,8,20,0.82)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={closePicker}
    >
      <div
        style={{
          width: '100%', maxWidth: 520,
          background: 'var(--bg-2)',
          border: '1px solid var(--hairline)',
          borderRadius: 16,
          boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(167,139,250,0.08)',
          overflow: 'hidden',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '16px 18px 12px',
          borderBottom: '1px solid var(--hairline)',
        }}>
          {drillRoot ? (
            <button
              className="icon-btn"
              style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, width: 'auto', padding: '0 8px', fontSize: 12 }}
              onClick={() => { setDrillRoot(null); setFolders([]); }}
              title="Back"
              aria-label="Back to root list"
            >
              <Icon name="chevronR" size={11} style={{ transform: 'rotate(180deg)', flexShrink: 0 }}/>
              <span style={{ fontFamily: 'var(--f-sans)', fontWeight: 500, color: 'var(--text-dim)' }}>Back</span>
            </button>
          ) : (
            <Icon name="folder" size={16} style={{ color: 'var(--violet-300)', flexShrink: 0 }}/>
          )}
          <span style={{
            fontFamily: 'var(--f-sans)', fontWeight: 600, fontSize: 14,
            color: 'var(--text)', flex: 1,
          }}>
            {drillRoot ? drillRoot.name : 'Pick a project'}
          </span>
          {drillRoot && (
            <span style={{
              fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--text-mute)',
              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {drillRoot.path}
            </span>
          )}
          <button className="icon-btn" onClick={closePicker} title="Close">
            <Icon name="x" size={13}/>
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && (
            <div style={{
              padding: '32px 18px', textAlign: 'center',
              color: 'var(--text-mute)', fontFamily: 'var(--f-mono)', fontSize: 12,
            }}>
              <span className="spinner" style={{ display: 'inline-block', marginRight: 8 }}/>
              Loading…
            </div>
          )}

          {error && !loading && (
            <div style={{
              padding: '16px 18px',
              color: 'var(--danger)', fontFamily: 'var(--f-mono)', fontSize: 11.5,
            }}>
              {error}
            </div>
          )}

          {!loading && !error && drillRoot && (
            <PickerSection label="Folders">
              {folders.length === 0 ? (
                <div style={{ padding: '12px 18px', color: 'var(--text-mute)', fontSize: 12 }}>
                  No folders found.
                </div>
              ) : folders.map(f => (
                <PickerRow
                  key={f.path}
                  icon="folder"
                  name={f.name}
                  meta={f.hasDesignMd ? 'has DESIGN.md' : null}
                  onClick={() => pickProject(f)}
                />
              ))}
            </PickerSection>
          )}

          {!loading && !error && !drillRoot && (
            <>
              {recent.length > 0 && (
                <PickerSection label="Recent">
                  {recent.map(p => (
                    <PickerRow
                      key={p.path}
                      icon="history"
                      name={p.name}
                      meta={p.path}
                      onClick={() => pickProject(p)}
                    />
                  ))}
                </PickerSection>
              )}

              {roots.length > 0 && (
                <PickerSection label="Browse">
                  {roots.map(r => (
                    <PickerRow
                      key={r.path}
                      icon="folder"
                      name={r.name}
                      meta={r.path}
                      chevron
                      onClick={() => drillInto(r)}
                    />
                  ))}
                </PickerSection>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const PickerSection = ({ label, children }) => (
  <div style={{ padding: '10px 0 4px' }}>
    <div style={{
      padding: '4px 18px 6px',
      fontFamily: 'var(--f-mono)', fontSize: 10,
      letterSpacing: '0.14em', color: 'var(--text-mute)',
      textTransform: 'uppercase',
    }}>
      {label}
    </div>
    {children}
  </div>
);

const PickerRow = ({ icon, name, meta, chevron, onClick }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex', alignItems: 'center', gap: 10,
      width: '100%', padding: '10px 18px',
      background: 'transparent', border: 'none', cursor: 'pointer',
      color: 'var(--text)', textAlign: 'left',
      minHeight: 44,
      transition: 'background 0.12s',
    }}
    onMouseEnter={e => e.currentTarget.style.background = 'rgba(167,139,250,0.07)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
  >
    <Icon name={icon} size={14} style={{ color: 'var(--violet-300)', flexShrink: 0 }}/>
    <span style={{
      fontFamily: 'var(--f-sans)', fontWeight: 500, fontSize: 13.5,
      flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {name}
    </span>
    {meta && (
      <span style={{
        fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--text-mute)',
        maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        {meta}
      </span>
    )}
    {chevron && <Icon name="chevronR" size={11} style={{ color: 'var(--text-mute)', flexShrink: 0 }}/>}
  </button>
);

window.FolderPicker = FolderPicker;
