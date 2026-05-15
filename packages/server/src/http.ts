import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { CockpitConfig } from './config.js';

export function buildHttpApp(config: CockpitConfig): Hono {
  const app = new Hono();

  app.get('/api/health', (c) =>
    c.json({ ok: true, ts: Date.now(), version: '0.0.1-M1' }),
  );

  app.use('/*', serveStatic({ root: config.publicDir }));

  return app;
}
