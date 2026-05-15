import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export type PreviewType = 'npm-dev' | 'npm-start' | 'django' | 'static' | 'unknown';

export type PreviewStatus = {
  projectPath: string;
  slug: string;
  type: PreviewType;
  status: 'idle' | 'starting' | 'running' | 'errored' | 'stopped';
  port: number | null;
  command?: string;
  startedAt?: number;
  error?: string;
};

type ManagedPreview = {
  status: PreviewStatus;
  proc?: ChildProcess;
  // Last 50 stderr/stdout lines (ring buffer) for debugging
  log: string[];
};

function projectSlug(projectPath: string): string {
  return createHash('sha1').update(projectPath).digest('hex').slice(0, 12);
}

type DetectResult =
  | { type: 'unknown' }
  | { type: PreviewType; cmd: string[] };

function detectType(projectPath: string): DetectResult {
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> };
      if (pkg.scripts?.dev) return { type: 'npm-dev', cmd: ['npm', 'run', 'dev'] };
      if (pkg.scripts?.start) return { type: 'npm-start', cmd: ['npm', 'start'] };
    } catch {
      // fall through
    }
  }
  if (existsSync(join(projectPath, 'manage.py'))) {
    return { type: 'django', cmd: ['python3', 'manage.py', 'runserver'] };
  }
  if (existsSync(join(projectPath, 'index.html'))) {
    return { type: 'static', cmd: ['npx', '--yes', 'serve@latest', '-L'] };
  }
  return { type: 'unknown' };
}

const PORT_RANGE_START = 9100;
const PORT_RANGE_END = 9199;
const usedPorts = new Set<number>();

async function findFreePort(): Promise<number> {
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (usedPorts.has(p)) continue;
    if (await isPortFree(p)) {
      usedPorts.add(p);
      return p;
    }
  }
  throw new Error('No free port in preview range');
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const net = require('node:net') as typeof import('node:net');
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
}

export class PreviewManager {
  private readonly previews = new Map<string, ManagedPreview>();

  async start(projectPath: string): Promise<PreviewStatus> {
    const slug = projectSlug(projectPath);
    const existing = this.previews.get(slug);
    if (
      existing &&
      (existing.status.status === 'running' || existing.status.status === 'starting')
    ) {
      return existing.status;
    }

    const det = detectType(projectPath);
    if (det.type === 'unknown') {
      const status: PreviewStatus = {
        projectPath,
        slug,
        type: 'unknown',
        status: 'errored',
        port: null,
        error:
          'No dev server detected (no package.json scripts.dev/start, no manage.py, no index.html)',
      };
      this.previews.set(slug, { status, log: [] });
      return status;
    }

    let port: number;
    try {
      port = await findFreePort();
    } catch {
      const status: PreviewStatus = {
        projectPath,
        slug,
        type: det.type,
        status: 'errored',
        port: null,
        error: 'No free port in range 9100-9199',
      };
      this.previews.set(slug, { status, log: [] });
      return status;
    }

    // Build the final args array with port injected per server type
    let spawnArgs: string[];
    if (det.type === 'django') {
      spawnArgs = ['manage.py', 'runserver', `127.0.0.1:${port}`];
    } else if (det.type === 'static') {
      spawnArgs = ['--yes', 'serve@latest', '-L', '-l', String(port)];
    } else {
      // npm-dev / npm-start: port comes from the PORT env var
      spawnArgs = det.cmd.slice(1);
    }

    const env: Record<string, string> = {};
    // Copy parent env, skipping undefined values
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    env['PORT'] = String(port);
    env['BROWSER'] = 'none';
    env['FORCE_COLOR'] = '0';
    // Strip workspace .bin from PATH so the spawned process uses its own project deps
    if (env['PATH']) {
      env['PATH'] = env['PATH']
        .split(':')
        .filter((p) => !p.includes('node_modules/.bin'))
        .join(':');
    }

    const log: string[] = [];
    const status: PreviewStatus = {
      projectPath,
      slug,
      type: det.type,
      status: 'starting',
      port,
      command: `${det.cmd[0] as string} ${spawnArgs.join(' ')}`,
      startedAt: Date.now(),
    };

    const spawnOpts: SpawnOptionsWithoutStdio = {
      cwd: projectPath,
      env,
    };
    const executable = det.cmd[0] as string;
    const proc: ChildProcess = spawn(executable, spawnArgs, spawnOpts);

    const onLog = (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').split('\n').filter(Boolean);
      for (const l of lines) {
        log.push(l);
        if (log.length > 50) log.shift();
      }
    };
    proc.stdout?.on('data', onLog);
    proc.stderr?.on('data', onLog);

    proc.on('error', (err: Error) => {
      status.status = 'errored';
      status.error = String(err.message);
    });

    proc.on('exit', (code: number | null) => {
      usedPorts.delete(port);
      const cur = this.previews.get(slug);
      if (cur) {
        cur.status.status = code === 0 ? 'stopped' : 'errored';
        if (code !== 0 && !cur.status.error) {
          cur.status.error = `Exited with code ${String(code)}`;
        }
        cur.proc = undefined;
      }
    });

    this.previews.set(slug, { status, proc, log });

    // Mark running after a 2 s grace period — dev servers don't expose a universal "ready" signal.
    // Users can iframe-refresh manually if the app is not yet up.
    setTimeout(() => {
      const cur = this.previews.get(slug);
      if (cur && cur.status.status === 'starting') cur.status.status = 'running';
    }, 2000);

    return status;
  }

  stop(slug: string): PreviewStatus | null {
    const cur = this.previews.get(slug);
    if (!cur) return null;
    if (cur.proc && !cur.proc.killed) {
      cur.proc.kill('SIGTERM');
      // SIGKILL fallback if still alive after 2 s
      setTimeout(() => {
        if (cur.proc && !cur.proc.killed) cur.proc.kill('SIGKILL');
      }, 2000);
    }
    cur.status.status = 'stopped';
    if (cur.status.port !== null) usedPorts.delete(cur.status.port);
    return cur.status;
  }

  stopByPath(projectPath: string): PreviewStatus | null {
    return this.stop(projectSlug(projectPath));
  }

  getBySlug(slug: string): PreviewStatus | null {
    return this.previews.get(slug)?.status ?? null;
  }

  getByPath(projectPath: string): PreviewStatus | null {
    return this.getBySlug(projectSlug(projectPath));
  }

  list(): PreviewStatus[] {
    return [...this.previews.values()].map((p) => p.status);
  }

  /** Resolve the target host:port for a proxied preview request. */
  resolveProxy(slug: string): { host: string; port: number } | null {
    const cur = this.previews.get(slug);
    if (!cur || cur.status.port == null) return null;
    if (cur.status.status !== 'running' && cur.status.status !== 'starting') return null;
    return { host: '127.0.0.1', port: cur.status.port };
  }

  getLog(slug: string): string[] {
    return this.previews.get(slug)?.log ?? [];
  }

  shutdown(): void {
    for (const slug of [...this.previews.keys()]) this.stop(slug);
  }

  static slugFor(projectPath: string): string {
    return projectSlug(projectPath);
  }
}
