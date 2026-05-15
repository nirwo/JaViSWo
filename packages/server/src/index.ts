import { serve } from '@hono/node-server';
import { loadConfig, recentsPath } from './config.js';
import { buildHttpApp } from './http.js';
import { AgentRegistry } from './registry.js';
import { RecentsStore } from './recents.js';
import { AgentSupervisor } from './supervisor.js';
import { attachWebSocket } from './ws.js';

const config = loadConfig();
const registry = new AgentRegistry({ tailCap: 500 });

let broadcast: (env: import('@cockpit/shared').Envelope) => void = () => {};
const supervisor = new AgentSupervisor(registry, (env) => broadcast(env));
const recents = new RecentsStore(recentsPath);

const app = buildHttpApp(config, registry, supervisor, recents);

const server = serve(
  { fetch: app.fetch, hostname: config.host, port: config.port },
  ({ address, port }) => {
    console.log(`[cockpit] HTTP+WS listening on http://${address}:${port}`);
  },
);

const ws = attachWebSocket(server as unknown as import('node:http').Server, registry);
broadcast = ws.broadcast;
