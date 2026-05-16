import { existsSync, readdirSync, statSync } from 'node:fs';
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

// Skip these top-level $HOME folders when auto-discovering — they're never
// where someone keeps code, and scanning them is slow or wrong.
const HOME_SKIP = new Set([
  'Library', 'Applications', 'Public', 'Documents', 'Downloads',
  'Music', 'Pictures', 'Movies', 'Desktop', 'Trash', '.Trash',
]);

// Auto-discover any top-level $HOME folder that contains at least one git
// repo. Catches `~/AI Development`, `~/Source`, `~/Workspace`, etc. without
// hard-coding personal paths in the repo. Single-level scan, bounded.
function autoDiscoverRoots(): string[] {
  const home = homedir();
  let entries;
  try { entries = readdirSync(home, { withFileTypes: true }); }
  catch { return []; }
  const found: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.')) continue;
    if (HOME_SKIP.has(e.name)) continue;
    const dirPath = join(home, e.name);
    // Heuristic: dir contains at least one subdir with a `.git` folder.
    // Bounded scan: first 40 entries.
    let subs;
    try { subs = readdirSync(dirPath, { withFileTypes: true }); }
    catch { continue; }
    let hasRepo = false;
    for (const sub of subs.slice(0, 40)) {
      if (sub.isDirectory() && existsSync(join(dirPath, sub.name, '.git'))) {
        hasRepo = true;
        break;
      }
    }
    if (hasRepo) found.push(dirPath);
  }
  return found;
}

function loadRoots(): string[] {
  const fromEnv = (process.env.COCKPIT_ROOTS ?? '')
    .split(':')
    .map((s) => s.trim())
    .filter(Boolean);
  // Generic defaults — the most common "where I keep code" paths.
  const defaults = ['~/code', '~/projects', '~/src', '~/dev', '~/workspace'];
  // Explicit roots first, then generic defaults, then auto-discovery filling
  // in anything else under $HOME that looks like a code folder.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const r of fromEnv) {
    const abs = resolve(expandHome(r));
    if (!seen.has(abs) && isDir(abs)) { seen.add(abs); ordered.push(abs); }
  }
  for (const d of defaults) {
    const abs = resolve(expandHome(d));
    if (!seen.has(abs) && isDir(abs)) { seen.add(abs); ordered.push(abs); }
  }
  if (ordered.length === 0) {
    for (const abs of autoDiscoverRoots()) {
      if (!seen.has(abs)) { seen.add(abs); ordered.push(abs); }
    }
  }
  return ordered;
}

export function loadConfig(): CockpitConfig {
  // serveStatic resolves root relative to process.cwd(), so we must supply
  // a relative path — not the absolute dirname-based path.
  const absPublic = join(import.meta.dirname, '..', 'public');
  return {
    host: process.env.COCKPIT_HOST ?? '0.0.0.0',
    // 9787/9788 default — chosen to avoid collisions with common dev
    // servers and the user's other Docker projects (e.g. financehome-ocr
    // claims 8787). Override via COCKPIT_PORT / COCKPIT_HTTPS_PORT.
    port: Number(process.env.COCKPIT_PORT ?? 9787),
    publicDir: relative(process.cwd(), absPublic),
    roots: loadRoots(),
  };
}

export const configPath = join(homedir(), '.cockpit', 'config.json');
export const recentsPath = join(homedir(), '.cockpit', 'recents.json');
