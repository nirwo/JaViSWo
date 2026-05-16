import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import type { CockpitConfig } from './config.js';
import type { AgentRegistry } from './registry.js';
import type { RecentsStore } from './recents.js';
import type { AgentSupervisor } from './supervisor.js';
import { readTree } from './files.js';
import { gitBranch, gitStatus } from './git.js';
import { transcribe } from './transcribe.js';
import { loadDesignMd } from './design-md.js';
import type { PreviewManager } from './preview.js';
import { getCaRootPath } from './tls.js';

const READ_MAX_BYTES = 1_000_000;

const FilesTreeQuery = z.object({
  root: z.string().min(1),
  depth: z.coerce.number().int().min(1).max(6).default(3),
});

const FileReadQuery = z.object({
  path: z.string().min(1),
});

const FileWriteBody = z.object({
  path: z.string().min(1),
  content: z.string(),
  ifMatchMtime: z.number().optional(),
});

const SpawnInputSchema = z.object({
  prompt: z.string().min(1),
  projectPath: z.string().min(1),
  model: z.string().optional(),
  maxTurns: z.number().int().positive().optional(),
  maxBudgetUsd: z.number().positive().optional(),
});

const TurnInputSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
});

const GitCommitBody = z.object({
  root: z.string().min(1),
  message: z.string().min(1),
});

export function buildHttpApp(
  config: CockpitConfig,
  registry: AgentRegistry,
  supervisor: AgentSupervisor,
  recents: RecentsStore,
  getClientCount: () => number = () => 0,
  previewManager?: PreviewManager,
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

  app.post('/api/agents/:agentId/turn', async (c) => {
    const agentId = c.req.param('agentId');
    if (!registry.get(agentId)) {
      return c.json({ error: { code: 'AGENT_NOT_FOUND' } }, 404);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = TurnInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues } }, 400);
    }
    const result = supervisor.continueAgent(agentId, parsed.data.prompt, parsed.data.model);
    if (!result.ok) {
      return c.json({ error: { code: result.reason ?? 'CONTINUE_FAILED' } }, 409);
    }
    return c.json({ agentId, ok: true }, 202);
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

  // Helper: path traversal guard — root must be one of the configured roots or a subpath
  function isRootAllowed(root: string): boolean {
    return config.roots.some((r) => root === r || root.startsWith(r + '/'));
  }

  // Strict path guard for file read/write — blocks dangerous dirs anywhere in the path
  function isPathAllowed(absPath: string): boolean {
    const r = resolve(absPath);
    if (r.includes('/.git/') || r.endsWith('/.git')) return false;
    if (r.includes('/node_modules/')) return false;
    if (r.includes('/.cockpit/')) return false;
    return config.roots.some((root) => r === root || r.startsWith(root + '/'));
  }

  app.get('/api/files/read', (c) => {
    const parsed = FileReadQuery.safeParse({ path: c.req.query('path') });
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR' } }, 400);
    const p = resolve(parsed.data.path);
    if (!isPathAllowed(p)) return c.json({ error: { code: 'PATH_NOT_ALLOWED' } }, 403);
    if (!existsSync(p)) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    try {
      const st = statSync(p);
      if (!st.isFile()) return c.json({ error: { code: 'NOT_A_FILE' } }, 400);
      if (st.size > READ_MAX_BYTES) {
        return c.json({ content: '', mtime: st.mtimeMs, size: st.size, encoding: 'binary' });
      }
      const buf = readFileSync(p);
      const sample = buf.subarray(0, Math.min(buf.length, 4096));
      const isBinary = sample.includes(0);
      if (isBinary) {
        return c.json({ content: '', mtime: st.mtimeMs, size: st.size, encoding: 'binary' });
      }
      return c.json({
        content: buf.toString('utf-8'),
        mtime: st.mtimeMs,
        size: st.size,
        encoding: 'utf-8' as const,
      });
    } catch (err) {
      return c.json({ error: { code: 'READ_FAIL', detail: String((err as Error).message) } }, 500);
    }
  });

  app.put('/api/files/write', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = FileWriteBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues } }, 400);
    }
    const p = resolve(parsed.data.path);
    if (!isPathAllowed(p)) return c.json({ error: { code: 'PATH_NOT_ALLOWED' } }, 403);
    if (!existsSync(p)) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    try {
      const st = statSync(p);
      if (typeof parsed.data.ifMatchMtime === 'number' && Math.abs(st.mtimeMs - parsed.data.ifMatchMtime) > 1) {
        return c.json({ error: { code: 'CONFLICT', serverMtime: st.mtimeMs } }, 409);
      }
      writeFileSync(p, parsed.data.content, 'utf-8');
      const after = statSync(p);
      return c.json({ ok: true, mtime: after.mtimeMs });
    } catch (err) {
      return c.json({ error: { code: 'WRITE_FAIL', detail: String((err as Error).message) } }, 500);
    }
  });

  app.get('/api/files/tree', (c) => {
    const parsed = FilesTreeQuery.safeParse({
      root: c.req.query('root'),
      depth: c.req.query('depth'),
    });
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR' } }, 400);
    }
    const { root, depth } = parsed.data;
    if (!isRootAllowed(root)) {
      return c.json({ error: { code: 'ROOT_NOT_ALLOWED' } }, 403);
    }
    try {
      const tree = readTree(root, depth);
      return c.json({ tree });
    } catch (err) {
      return c.json({ error: { code: 'READ_FAIL', detail: String((err as Error).message) } }, 500);
    }
  });

  app.get('/api/git/branch', (c) => {
    const root = c.req.query('root') ?? '';
    if (!isRootAllowed(root)) {
      return c.json({ error: { code: 'ROOT_NOT_ALLOWED' } }, 403);
    }
    return c.json({ branch: gitBranch(root) });
  });

  app.get('/api/git/status', (c) => {
    const root = c.req.query('root') ?? '';
    if (!isRootAllowed(root)) {
      return c.json({ error: { code: 'ROOT_NOT_ALLOWED' } }, 403);
    }
    const status = gitStatus(root);
    return c.json(
      status ?? { branch: null, added: 0, modified: 0, removed: 0, untracked: 0, files: [] },
    );
  });

  app.post('/api/git/commit', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = GitCommitBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues } }, 400);
    }
    const root = resolve(parsed.data.root);
    if (!isRootAllowed(root)) return c.json({ error: { code: 'ROOT_NOT_ALLOWED' } }, 403);
    try {
      execFileSync('git', ['add', '-A'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      const out = execFileSync(
        'git',
        ['commit', '-m', parsed.data.message],
        { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      return c.json({ ok: true, output: out.toString('utf-8') });
    } catch (err) {
      const e = err as { message?: string; stderr?: Buffer; stdout?: Buffer };
      return c.json(
        {
          ok: false,
          error: {
            code: 'COMMIT_FAILED',
            detail: e.message ?? 'unknown',
            stderr: e.stderr?.toString('utf-8') ?? '',
            stdout: e.stdout?.toString('utf-8') ?? '',
          },
        },
        500,
      );
    }
  });

  app.get('/api/design', (c) => {
    const root = c.req.query('root') ?? '';
    if (!root) return c.json({ error: { code: 'NO_ROOT' } }, 400);
    if (!isRootAllowed(root)) return c.json({ error: { code: 'ROOT_NOT_ALLOWED' } }, 403);
    return c.json(loadDesignMd(root));
  });

  app.get('/api/clients', (c) => {
    return c.json({ count: getClientCount() });
  });

  // Serve the mkcert root CA so iPhone / other Macs on the LAN can install
  // it via Safari → tap link → "Install Profile" → Settings → General →
  // VPN & Device Management. After install, every cert signed by this CA
  // (i.e., every JaViSWo server cert) is trusted on that device.
  app.get('/tls/ca.pem', (c) => {
    const caPath = getCaRootPath();
    if (!caPath) {
      return c.json(
        {
          error: {
            code: 'NO_LOCAL_CA',
            message: 'mkcert is not installed on this server. Run scripts/setup-network.sh first.',
          },
        },
        404,
      );
    }
    try {
      const body = readFileSync(caPath);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/x-x509-ca-cert',
          'Content-Disposition': 'attachment; filename="javiswo-rootCA.pem"',
        },
      });
    } catch (err) {
      return c.json(
        { error: { code: 'CA_READ_FAIL', detail: (err as Error).message } },
        500,
      );
    }
  });

  app.post('/api/voice/transcribe', async (c) => {
    const fd = await c.req.formData().catch(() => null);
    if (!fd) return c.json({ ok: false, error: { code: 'NO_FORM' } }, 400);
    const file = fd.get('audio') as File | null;
    if (!file) return c.json({ ok: false, error: { code: 'NO_AUDIO' } }, 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await transcribe(bytes, file.type || 'audio/webm');
    return c.json(result, result.ok ? 200 : 503);
  });

  // ── Preview API ──────────────────────────────────────────────────────────────

  const PreviewPathBody = z.object({
    projectPath: z.string().min(1),
  });

  app.post('/api/preview/start', async (c) => {
    if (!previewManager) return c.json({ error: { code: 'PREVIEW_DISABLED' } }, 503);
    const body = await c.req.json().catch(() => null);
    const parsed = PreviewPathBody.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR' } }, 400);
    const root = parsed.data.projectPath;
    if (!isRootAllowed(root)) return c.json({ error: { code: 'ROOT_NOT_ALLOWED' } }, 403);
    const status = await previewManager.start(root);
    return c.json(status);
  });

  app.post('/api/preview/stop', async (c) => {
    if (!previewManager) return c.json({ error: { code: 'PREVIEW_DISABLED' } }, 503);
    const body = await c.req.json().catch(() => null);
    const parsed = PreviewPathBody.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR' } }, 400);
    const status = previewManager.stopByPath(parsed.data.projectPath);
    if (!status) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
    return c.json(status);
  });

  app.get('/api/preview/status', (c) => {
    const root = c.req.query('projectPath') ?? '';
    if (!root || !previewManager) return c.json({ status: null });
    return c.json({ status: previewManager.getByPath(root) });
  });

  app.get('/api/preview/log', (c) => {
    const slug = c.req.query('slug') ?? '';
    if (!slug || !previewManager) return c.json({ lines: [] });
    return c.json({ lines: previewManager.getLog(slug) });
  });

  // ── Preview HTTP proxy ────────────────────────────────────────────────────────
  // NOTE: WebSocket HMR is NOT proxied through this handler — only HTTP traffic
  // is forwarded. Dev-server hot-reload events will not reach the iframed app.
  // Users can use the iframe reload button to pick up changes manually.

  app.get('/preview/:slug', (c) => {
    // Redirect /preview/<slug> → /preview/<slug>/ so relative paths resolve correctly
    return c.redirect(c.req.path + '/');
  });

  app.all('/preview/:slug/*', async (c) => {
    if (!previewManager) return c.text('Preview not available', 503);
    const slug = c.req.param('slug');
    const target = previewManager.resolveProxy(slug);
    if (!target) return c.text('Preview not running', 503);

    // Strip the /preview/<slug> prefix to get the upstream path
    const prefix = `/preview/${slug}`;
    const rest = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) || '/' : '/';
    const qs = c.req.url.includes('?') ? '?' + c.req.url.split('?').slice(1).join('?') : '';
    const targetUrl = `http://${target.host}:${target.port}${rest}${qs}`;

    try {
      const headers = new Headers();
      c.req.raw.headers.forEach((v, k) => {
        if (k === 'host') return; // strip — upstream sees its own host
        headers.set(k, v);
      });
      const init: RequestInit = {
        method: c.req.method,
        headers,
        redirect: 'manual',
      };
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
        init.body = await c.req.raw.arrayBuffer();
      }
      const res = await fetch(targetUrl, init);
      const resHeaders = new Headers(res.headers);
      // fetch already decodes content-encoding; remove the header to avoid double-decode
      resHeaders.delete('content-encoding');
      return new Response(res.body, { status: res.status, headers: resHeaders });
    } catch (err) {
      return c.text('Proxy error: ' + (err as Error).message, 502);
    }
  });

  app.use('/*', serveStatic({ root: config.publicDir }));

  return app;
}
