import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { buildHttpApp } from './http.js';
import { AgentRegistry } from './registry.js';
import { attachWebSocket } from './ws.js';

const config = loadConfig();
const registry = new AgentRegistry({ tailCap: 500 });
const app = buildHttpApp(config);

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, ({ address, port }) => {
  console.log(`[cockpit] HTTP+WS listening on http://${address}:${port}`);
});

attachWebSocket(server as unknown as import('node:http').Server, registry);

export { registry };
