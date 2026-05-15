import { homedir } from 'node:os';
import { join } from 'node:path';

export type CockpitConfig = {
  host: string;
  port: number;
  publicDir: string;
};

export function loadConfig(): CockpitConfig {
  return {
    host: process.env.COCKPIT_HOST ?? '0.0.0.0',
    port: Number(process.env.COCKPIT_PORT ?? 8787),
    publicDir: join(import.meta.dirname, '..', 'public'),
  };
}

export const configPath = join(homedir(), '.cockpit', 'config.json');
