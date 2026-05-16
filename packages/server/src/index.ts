import { serve } from '@hono/node-server';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { openDb, closeDb } from './db.js';
import { buildHttpApp } from './http.js';
import { AgentRegistry } from './registry.js';
import { RecentsStore } from './recents.js';
import { AgentSupervisor } from './supervisor.js';
import { attachWebSocket } from './ws.js';
import { initFileWatch, stopFileWatch } from './file-watch.js';
import { PreviewManager } from './preview.js';

const config = loadConfig();

const dbPath = join(homedir(), '.cockpit', 'state.db');
const db = openDb(dbPath);

// Any agent that was 'running' when the cockpit last died had its subprocess
// killed with it. Mark them idle so the UI can resume them.
db.exec(`UPDATE agents SET status = 'idle' WHERE status = 'running'`);

const registry = new AgentRegistry(db, { tailCap: 5000 });

let broadcast: (env: import('@cockpit/shared').Envelope) => void = () => {};
let clientCount: () => number = () => 0;
const supervisor = new AgentSupervisor(registry, (env) => broadcast(env));

const legacyRecentsPath = join(homedir(), '.cockpit', 'recents.json');
const recents = new RecentsStore(db, 10, legacyRecentsPath);

const previewManager = new PreviewManager();

const app = buildHttpApp(config, registry, supervisor, recents, () => clientCount(), previewManager);

const server = serve(
  { fetch: app.fetch, hostname: config.host, port: config.port },
  ({ address, port }) => {
    console.log(`[cockpit] HTTP+WS listening on http://${address}:${port}`);
  },
);

const ws = attachWebSocket(server as unknown as import('node:http').Server, registry);
broadcast = ws.broadcast;
clientCount = ws.clientCount;

// File watcher is lazy: it only watches the *active* project, not every
// configured root. The frontend triggers /api/files/watch when it picks a
// project, which calls setActiveProject() on the watcher.
initFileWatch(ws.broadcastAll);

process.on('SIGTERM', () => {
  previewManager.shutdown();
  stopFileWatch();
  closeDb();
  process.exit(0);
});
process.on('SIGINT', () => {
  previewManager.shutdown();
  stopFileWatch();
  closeDb();
  process.exit(0);
});
