import { serve } from '@hono/node-server';
import { createServer as createHttpsServer } from 'node:https';
import { homedir, networkInterfaces } from 'node:os';
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
import { ensureTlsCert, getCaRootPath, readTlsMaterial } from './tls.js';

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

const httpServer = serve(
  { fetch: app.fetch, hostname: config.host, port: config.port },
  ({ address, port }) => {
    console.log(`[cockpit] HTTP+WS listening on http://${address}:${port}`);
  },
);

// HTTPS — browsers require a secure context for mic + speech APIs over LAN
// IPs. We serve a parallel HTTPS listener on COCKPIT_HTTPS_PORT (default
// 8788). Disable with COCKPIT_HTTPS=false.
const httpsEnabled = (process.env.COCKPIT_HTTPS ?? 'true') !== 'false';
const httpsPort = Number(process.env.COCKPIT_HTTPS_PORT ?? 8788);
let httpsServer: import('node:https').Server | undefined;
if (httpsEnabled) {
  const tls = ensureTlsCert();
  if (tls) {
    const material = readTlsMaterial(tls);
    httpsServer = serve(
      {
        fetch: app.fetch,
        hostname: config.host,
        port: httpsPort,
        createServer: createHttpsServer,
        serverOptions: { key: material.key, cert: material.cert },
      },
      ({ port }) => {
        console.log(`[cockpit] HTTPS+WS listening on https://0.0.0.0:${port} — required for voice over LAN`);
        const ifs = networkInterfaces();
        for (const list of Object.values(ifs)) {
          if (!list) continue;
          for (const ni of list) {
            if (!ni.internal && ni.family === 'IPv4') {
              console.log(`[cockpit]   LAN voice URL: https://${ni.address}:${port}`);
            }
          }
        }
        // Surface the mkcert / nginx setup script so the user knows how
        // to upgrade from "self-signed warning" to "fully trusted".
        if (getCaRootPath()) {
          console.log(`[cockpit]   Trusted-CA cert in use. iPhone install: http://<lan-ip>:${config.port}/tls/ca.pem`);
        } else {
          console.log('[cockpit]   For trusted certs (no browser warning) run: scripts/setup-network.sh');
        }
      },
    ) as unknown as import('node:https').Server;
  } else {
    console.warn('[cockpit] HTTPS disabled — could not generate cert. Voice will only work on http://localhost.');
  }
}

const servers = httpsServer ? [httpServer, httpsServer] : [httpServer];
const ws = attachWebSocket(
  servers as unknown as import('node:http').Server[],
  registry,
);
broadcast = ws.broadcast;
clientCount = ws.clientCount;

// File watcher is lazy: it only watches the *active* project, not every
// configured root. The frontend triggers /api/files/watch when it picks a
// project, which calls setActiveProject() on the watcher.
initFileWatch(ws.broadcastAll);

function shutdown() {
  previewManager.shutdown();
  stopFileWatch();
  closeDb();
  try { httpServer.close(); } catch { /* already closed */ }
  if (httpsServer) try { httpsServer.close(); } catch { /* already closed */ }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
