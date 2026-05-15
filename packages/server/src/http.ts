import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import type { CockpitConfig } from './config.js';
import type { AgentRegistry } from './registry.js';
import type { AgentSupervisor } from './supervisor.js';

const SpawnInputSchema = z.object({
  prompt: z.string().min(1),
  projectPath: z.string().min(1),
  model: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  maxBudgetUsd: z.number().positive().optional(),
});

export function buildHttpApp(
  config: CockpitConfig,
  registry: AgentRegistry,
  supervisor: AgentSupervisor,
): Hono {
  const app = new Hono();

  app.get('/api/health', (c) =>
    c.json({ ok: true, ts: Date.now(), version: '0.0.1-M1' }),
  );

  app.get('/api/agents', (c) => c.json({ agents: registry.list() }));

  app.post('/api/agents', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = SpawnInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues } }, 400);
    }
    const { agentId } = supervisor.spawnAgent(parsed.data);
    return c.json({ agentId }, 201);
  });

  app.use('/*', serveStatic({ root: config.publicDir }));

  return app;
}
