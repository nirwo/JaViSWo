import chokidar, { type FSWatcher } from 'chokidar';

// Per-project lazy watcher. We DO NOT recursively watch every configured root
// at boot — on a developer machine that's tens of thousands of files and trips
// EMFILE on macOS (~256 fd default). Instead the cockpit registers a watch
// when a project is actively opened (via `setActiveProject`), and tears it
// down when the project changes or the server shuts down.

let active: { path: string; watcher: FSWatcher } | null = null;
let broadcast: ((msg: unknown) => void) | null = null;

const IGNORED = [
  /(^|[/\\])\../, /node_modules/, /\.cockpit/, /\.superpowers/,
  /dist/, /build/, /\.next/, /\.turbo/, /\.cache/,
];

export function initFileWatch(broadcastAll: (msg: unknown) => void): void {
  broadcast = broadcastAll;
}

export function setActiveProject(projectPath: string | null): void {
  if (active?.path === projectPath) return;
  if (active) {
    void active.watcher.close();
    active = null;
  }
  if (!projectPath) return;
  try {
    const watcher = chokidar.watch(projectPath, {
      ignored: IGNORED,
      ignoreInitial: true,
      persistent: true,
      depth: 4,         // bounded
      followSymlinks: false,
      usePolling: false,
    });
    watcher.on('change', (path) => {
      if (broadcast) {
        try { broadcast({ type: 'file_changed', path, ts: Date.now() }); } catch {}
      }
    });
    watcher.on('error', () => { /* swallow — fd exhaustion etc. */ });
    active = { path: projectPath, watcher };
  } catch {
    // If chokidar fails to start at all, just skip file-watch.
  }
}

export function stopFileWatch(): void {
  if (active) {
    void active.watcher.close();
    active = null;
  }
}
