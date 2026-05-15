// CodeEditor — Monaco editor wired to /api/files/{read,write}
// Loads Monaco lazily once on first use from CDN.

let monacoPromise = null;

function loadMonaco() {
  if (monacoPromise) return monacoPromise;
  monacoPromise = new Promise((resolve, reject) => {
    if (window.monaco) { resolve(window.monaco); return; }
    const loader = document.createElement('script');
    loader.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs/loader.js';
    loader.onload = () => {
      window.require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' } });
      window.require(['vs/editor/editor.main'], () => {
        window.monaco.editor.defineTheme('cockpit-aurora', {
          base: 'vs-dark',
          inherit: true,
          rules: [
            { token: 'comment',  foreground: '5b6470', fontStyle: 'italic' },
            { token: 'keyword',  foreground: 'a78bfa' },
            { token: 'string',   foreground: '67e8f9' },
            { token: 'number',   foreground: 'f472b6' },
            { token: 'type',     foreground: '22d3ee' },
            { token: 'function', foreground: 'c4b5fd' },
          ],
          colors: {
            'editor.background':                '#0a0820',
            'editor.foreground':                '#d4d8e0',
            'editor.lineHighlightBackground':   '#14102e44',
            'editor.selectionBackground':       '#7c3aed40',
            'editorCursor.foreground':          '#22d3ee',
            'editorWhitespace.foreground':      '#14102e',
            'editorIndentGuide.background':     '#1e1b4b',
            'editorLineNumber.foreground':      '#5b6470',
            'editorLineNumber.activeForeground':'#94a3b8',
          },
        });
        resolve(window.monaco);
      });
    };
    loader.onerror = reject;
    document.head.appendChild(loader);
  });
  return monacoPromise;
}

function languageForPath(path) {
  const ext = String(path).split('.').pop().toLowerCase();
  const map = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    json: 'json', md: 'markdown', html: 'html', css: 'css', scss: 'scss',
    yml: 'yaml', yaml: 'yaml', toml: 'plaintext', sh: 'shell', bash: 'shell',
    sql: 'sql', xml: 'xml', dockerfile: 'dockerfile',
  };
  return map[ext] || 'plaintext';
}

const CodeEditor = () => {
  const { editorFile, setEditorFile } = useCockpit();
  const containerRef = React.useRef(null);
  const monacoRef = React.useRef(null);
  const editorRef = React.useRef(null);
  const saveFileRef = React.useRef(null);
  const [monacoLoading, setMonacoLoading] = React.useState(true);
  const [originalMtime, setOriginalMtime] = React.useState(null);
  const [isDirty, setIsDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [externalChange, setExternalChange] = React.useState(null);

  // isDirty ref so save callback can read current value without stale closure
  const isDirtyRef = React.useRef(isDirty);
  React.useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
  const originalMtimeRef = React.useRef(originalMtime);
  React.useEffect(() => { originalMtimeRef.current = originalMtime; }, [originalMtime]);
  const externalChangeRef = React.useRef(externalChange);
  React.useEffect(() => { externalChangeRef.current = externalChange; }, [externalChange]);
  const editorFileRef = React.useRef(editorFile);
  React.useEffect(() => { editorFileRef.current = editorFile; }, [editorFile]);

  // Load Monaco once
  React.useEffect(() => {
    let alive = true;
    loadMonaco().then((m) => {
      if (!alive) return;
      monacoRef.current = m;
      setMonacoLoading(false);
    }).catch((err) => {
      console.error('[editor] Monaco load failed:', err);
    });
    return () => { alive = false; };
  }, []);

  const reloadFromDisk = React.useCallback(async () => {
    const file = editorFileRef.current;
    if (!file) return;
    try {
      const r = await fetch(`/api/files/read?path=${encodeURIComponent(file)}`);
      if (!r.ok) return;
      const body = await r.json();
      if (editorRef.current && body.encoding !== 'binary') {
        editorRef.current.setValue(body.content);
        setOriginalMtime(body.mtime);
        setIsDirty(false);
        setExternalChange(null);
      }
    } catch (err) {
      console.error('[editor] reloadFromDisk failed:', err);
    }
  }, []);

  // saveFile — stable ref so Monaco keybinding can call it
  const saveFile = React.useCallback(async () => {
    const file = editorFileRef.current;
    if (!file || !editorRef.current || saving) return;
    setSaving(true);
    try {
      const body = {
        path: file,
        content: editorRef.current.getValue(),
        ifMatchMtime: externalChangeRef.current ? undefined : originalMtimeRef.current,
      };
      const r = await fetch('/api/files/write', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (r.status === 409) {
        setExternalChange({ mtime: j.error?.serverMtime });
        alert('Conflict: file was changed outside the editor. Reload or force-save.');
        return;
      }
      if (!r.ok) {
        alert('Save failed: ' + JSON.stringify(j));
        return;
      }
      setOriginalMtime(j.mtime);
      setIsDirty(false);
      setExternalChange(null);
    } finally {
      setSaving(false);
    }
  }, [saving]);

  // Keep a stable ref to saveFile for the Monaco keybinding (registered once)
  React.useEffect(() => { saveFileRef.current = saveFile; }, [saveFile]);

  // Initialize Monaco editor instance once container + Monaco are ready
  React.useEffect(() => {
    if (monacoLoading || !containerRef.current) return;
    if (editorRef.current) return; // already initialized
    const m = monacoRef.current;
    editorRef.current = m.editor.create(containerRef.current, {
      value: '',
      language: 'plaintext',
      theme: 'cockpit-aurora',
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 12.5,
      lineHeight: 18,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      renderLineHighlight: 'all',
      automaticLayout: true,
    });
    editorRef.current.onDidChangeModelContent(() => {
      setIsDirty(true);
    });
    // ⌘S / Ctrl+S — calls saveFileRef so it always has the latest closure
    editorRef.current.addCommand(
      m.KeyMod.CtrlCmd | m.KeyCode.KeyS,
      () => { if (saveFileRef.current) saveFileRef.current(); },
    );
  }, [monacoLoading]);

  // Cleanup on unmount
  React.useEffect(() => () => {
    if (editorRef.current) {
      editorRef.current.dispose();
      editorRef.current = null;
    }
  }, []);

  // Load file content whenever the selected file changes
  React.useEffect(() => {
    if (monacoLoading || !editorFile || !editorRef.current) return;
    const m = monacoRef.current;
    setIsDirty(false);
    setExternalChange(null);
    fetch(`/api/files/read?path=${encodeURIComponent(editorFile)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((body) => {
        if (!editorRef.current) return;
        if (body.encoding === 'binary') {
          editorRef.current.setValue('// Binary or oversized file — cannot display in editor.');
          m.editor.setModelLanguage(editorRef.current.getModel(), 'plaintext');
          setOriginalMtime(body.mtime);
        } else {
          editorRef.current.setValue(body.content);
          m.editor.setModelLanguage(editorRef.current.getModel(), languageForPath(editorFile));
          setOriginalMtime(body.mtime);
        }
        setIsDirty(false);
      })
      .catch((err) => console.error('[editor] read failed', err));
  }, [monacoLoading, editorFile]);

  // Listen for file_changed broadcasts from the WS
  React.useEffect(() => {
    const handler = (e) => {
      const msg = e.detail;
      if (msg.type === 'file_changed' && msg.path === editorFileRef.current) {
        if (!isDirtyRef.current) {
          reloadFromDisk();
        } else {
          setExternalChange({ mtime: msg.ts });
        }
      }
    };
    window.addEventListener('cockpit:file_changed', handler);
    return () => window.removeEventListener('cockpit:file_changed', handler);
  }, [reloadFromDisk]);

  if (!editorFile) {
    return (
      <div className="editor-empty">
        <div style={{
          textAlign: 'center', maxWidth: 360, opacity: 0.6,
          fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--text-mute)',
          lineHeight: 1.6,
        }}>
          Click a file in the Workspace tree to open it here.<br/>
          <span style={{ color: 'var(--cyan-300)' }}>⌘S</span> to save · agent edits sync automatically.
        </div>
      </div>
    );
  }

  return (
    <div className="editor-wrap">
      <div className="editor-head">
        <span className="editor-path" title={editorFile}>{editorFile}</span>
        {isDirty && <span className="editor-dirty">●</span>}
        {externalChange && (
          <button className="editor-banner" onClick={reloadFromDisk}>
            Changed on disk — click to reload
          </button>
        )}
        <span style={{ flex: 1 }}/>
        <button
          className="editor-save"
          disabled={!isDirty || saving}
          onClick={saveFile}
          title="Save (⌘S)"
        >
          {saving ? 'Saving…' : isDirty ? 'Save' : 'Saved'}
        </button>
        <button
          className="editor-close"
          onClick={() => setEditorFile(null)}
          title="Close"
        >
          <Icon name="x" size={12}/>
        </button>
      </div>
      {monacoLoading ? (
        <div className="editor-empty">Loading Monaco…</div>
      ) : (
        <div ref={containerRef} className="editor-canvas"/>
      )}
    </div>
  );
};

window.CodeEditor = CodeEditor;
