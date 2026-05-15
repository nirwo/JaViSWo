import chokidar from 'chokidar';
import type { CockpitConfig } from './config.js';

export function startFileWatch(
  config: CockpitConfig,
  broadcastAll: (msg: unknown) => void,
): ReturnType<typeof chokidar.watch> {
  const watcher = chokidar.watch(config.roots, {
    ignored: [
      /(^|[/\\])\../,
      /node_modules/,
      /\.cockpit/,
      /dist/,
      /build/,
    ],
    ignoreInitial: true,
    persistent: true,
    depth: 8,
  });

  watcher.on('change', (path) => {
    try {
      broadcastAll({ type: 'file_changed', path, ts: Date.now() });
    } catch {
      // swallow — client may have disconnected mid-send
    }
  });

  return watcher;
}
