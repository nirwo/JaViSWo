import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { buildHttpApp } from './http.js';

const config = loadConfig();
const app = buildHttpApp(config);

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, ({ address, port }) => {
  console.log(`[cockpit] HTTP listening on http://${address}:${port}`);
});
