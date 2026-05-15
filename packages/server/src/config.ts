import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

export type CockpitConfig = {
  host: string;
  port: number;
  publicDir: string;
  roots: string[];
};

function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function isDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function loadRoots(): string[] {
  const fromEnv = (process.env.COCKPIT_ROOTS ?? '')
    .split(':')
    .map((s) => s.trim())
    .filter(Boolean);
  // Generic defaults — the most common "where I keep code" paths. Each is
  // included only if it actually exists on disk. Override with COCKPIT_ROOTS.
  const defaults = ['~/code', '~/projects', '~/src', '~/dev', '~/workspace'];
  const ordered = [...fromEnv, ...defaults.filter((d) => !fromEnv.includes(d))];
  return ordered.map(expandHome).map((p) => resolve(p)).filter(isDir);
}

export function loadConfig(): CockpitConfig {
  // serveStatic resolves root relative to process.cwd(), so we must supply
  // a relative path — not the absolute dirname-based path.
  const absPublic = join(import.meta.dirname, '..', 'public');
  return {
    host: process.env.COCKPIT_HOST ?? '0.0.0.0',
    port: Number(process.env.COCKPIT_PORT ?? 8787),
    publicDir: relative(process.cwd(), absPublic),
    roots: loadRoots(),
  };
}

export const configPath = join(homedir(), '.cockpit', 'config.json');
export const recentsPath = join(homedir(), '.cockpit', 'recents.json');
