// PreviewPane — M3 live preview via HTTP proxy (npm dev/start, Django, static).
// NOTE: WebSocket HMR is NOT proxied. Auto-reload from the dev server will not
// fire inside the iframe. Use the manual reload button (⟳) to pick up changes.

const PreviewPane = ({ projectPath }) => {
  const [status, setStatus] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [iframeKey, setIframeKey] = React.useState(0);

  // Poll status periodically while a preview is starting/running
  React.useEffect(() => {
    if (!projectPath) { setStatus(null); return; }
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/preview/status?projectPath=' + encodeURIComponent(projectPath));
        if (!r.ok || !alive) return;
        const body = await r.json();
        setStatus(body.status);
      } catch {
        // network error — ignore, will retry
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(id); };
  }, [projectPath]);

  const start = async () => {
    if (!projectPath) return;
    setBusy(true);
    try {
      const r = await fetch('/api/preview/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      });
      const body = await r.json();
      setStatus(body);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!projectPath) return;
    setBusy(true);
    try {
      await fetch('/api/preview/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      });
      setStatus(s => s ? { ...s, status: 'stopped' } : null);
    } finally {
      setBusy(false);
    }
  };

  const reloadIframe = () => setIframeKey(k => k + 1);

  if (!projectPath) {
    return (
      <div className="preview-empty">
        <div style={{ textAlign: 'center', maxWidth: 360, opacity: 0.6, fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mute)' }}>
          Pick a project to enable live preview.
        </div>
      </div>
    );
  }

  const isRunning = status?.status === 'running' || status?.status === 'starting';
  const previewUrl = status?.slug && isRunning ? `/preview/${status.slug}/` : null;

  return (
    <div className="preview-wrap">
      <div className="preview-head">
        <span className="preview-type">
          <Icon name="globe" size={11}/>
          {status?.type ?? 'detecting…'}
        </span>
        {status?.command && (
          <span className="preview-cmd" title={status.command}>$ {status.command}</span>
        )}
        <span style={{ flex: 1 }}/>
        {status?.port && <span className="preview-port">:{status.port}</span>}
        {!isRunning && (
          <button className="editor-save" onClick={start} disabled={busy}>
            &#9658; Start preview
          </button>
        )}
        {isRunning && (
          <>
            <button
              className="editor-close"
              onClick={reloadIframe}
              title="Reload iframe (HMR not proxied — use this to pick up changes)"
            >
              <Icon name="refresh" size={12}/>
            </button>
            <button
              className="editor-save"
              onClick={stop}
              disabled={busy}
              style={{ background: 'rgba(248,113,113,0.12)', color: 'var(--danger)', borderColor: 'rgba(248,113,113,0.3)' }}
            >
              &#9632; Stop
            </button>
          </>
        )}
      </div>
      {status?.error && (
        <div className="preview-error">
          <Icon name="warning" size={12}/> {status.error}
        </div>
      )}
      {!isRunning && !status?.error && (
        <div className="preview-empty">
          <div style={{ textAlign: 'center', maxWidth: 380, opacity: 0.7 }}>
            <div style={{ fontSize: 14, color: 'var(--violet-200)', marginBottom: 8 }}>Preview not running</div>
            <div style={{ fontSize: 12, color: 'var(--text-mute)', fontFamily: 'var(--f-mono)', lineHeight: 1.6 }}>
              Click <b>&#9658; Start preview</b> above. The cockpit will detect your project type
              and spawn its dev server.
            </div>
          </div>
        </div>
      )}
      {isRunning && previewUrl && (
        <iframe
          key={iframeKey}
          src={previewUrl}
          className="preview-iframe"
          title="Live preview"
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        />
      )}
    </div>
  );
};

window.PreviewPane = PreviewPane;
