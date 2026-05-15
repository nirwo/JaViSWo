import { homedir } from 'node:os';
import { join, relative } from 'node:path';

export type CockpitConfig = {
  host: string;
  port: number;
  publicDir: string;
};

export function loadConfig(): CockpitConfig {
  // serveStatic resolves root relative to process.cwd(), so we must supply
  // a relative path — not the absolute dirname-based path.
  const absPublic = join(import.meta.dirname, '..', 'public');
  return {
    host: process.env.COCKPIT_HOST ?? '0.0.0.0',
    port: Number(process.env.COCKPIT_PORT ?? 8787),
    publicDir: relative(process.cwd(), absPublic),
  };
}

export const configPath = join(homedir(), '.cockpit', 'config.json');
