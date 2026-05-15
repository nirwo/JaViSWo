import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import type { CockpitConfig } from './config.js';
import type { AgentRegistry } from './registry.js';
import type { RecentsStore } from './recents.js';
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
  recents: RecentsStore,
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
    recents.add(parsed.data.projectPath);
    return c.json({ agentId }, 201);
  });

  app.get('/api/projects/roots', (c) => {
    return c.json({
      roots: config.roots.map((path) => ({
        path,
        name: path.split('/').filter(Boolean).pop() ?? path,
      })),
    });
  });

  app.get('/api/projects/list', (c) => {
    const rootParam = c.req.query('root');
    if (!rootParam || !isAbsolute(rootParam)) {
      return c.json(
        { error: { code: 'BAD_ROOT', message: 'root query param must be an absolute path' } },
        400,
      );
    }
    const resolved = resolve(rootParam);
    // Path-traversal guard: requested root MUST be exactly one of the configured roots.
    if (!config.roots.includes(resolved)) {
      return c.json(
        { error: { code: 'ROOT_NOT_ALLOWED', message: 'root is not in the whitelist' } },
        403,
      );
    }
    const folders: Array<{ path: string; name: string; hasDesignMd: boolean }> = [];
    try {
      for (const entry of readdirSync(resolved, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue; // hide dotfolders
        const folderPath = join(resolved, entry.name);
        let hasDesignMd = false;
        try {
          hasDesignMd = existsSync(join(folderPath, 'DESIGN.md'));
        } catch {
          // ignore — treat as absent
        }
        folders.push({ path: folderPath, name: entry.name, hasDesignMd });
      }
    } catch (err) {
      return c.json(
        { error: { code: 'READ_FAIL', message: String((err as Error).message) } },
        500,
      );
    }
    folders.sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ root: resolved, folders });
  });

  app.get('/api/projects/recent', (c) => {
    const entries = recents.list().map((e) => {
      let hasDesignMd = false;
      try {
        hasDesignMd = existsSync(join(e.path, 'DESIGN.md'));
      } catch {
        // ignore
      }
      const name = e.path.split('/').filter(Boolean).pop() ?? e.path;
      return { path: e.path, ts: e.ts, name, hasDesignMd };
    });
    return c.json({ recent: entries });
  });

  app.use('/*', serveStatic({ root: config.publicDir }));

  return app;
}
