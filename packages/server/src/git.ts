import { execFileSync } from 'node:child_process';

function exec(cmd: string, args: string[], cwd: string): string {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return ''; }
}

export function gitBranch(cwd: string): string | null {
  const out = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return out || null;
}

export type GitStatus = {
  branch: string | null;
  added: number;
  modified: number;
  removed: number;
  untracked: number;
  files: Array<{ path: string; code: string }>;
};

export function gitStatus(cwd: string): GitStatus | null {
  const branch = gitBranch(cwd);
  if (branch === null) return null;
  const raw = exec('git', ['status', '--porcelain=v1'], cwd);
  let added = 0;
  let modified = 0;
  let removed = 0;
  let untracked = 0;
  const files: GitStatus['files'] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const code = line.slice(0, 2);
    const path = line.slice(3);
    files.push({ path, code });
    if (code.includes('A')) added++;
    else if (code.includes('M')) modified++;
    else if (code.includes('D')) removed++;
    else if (code === '??') untracked++;
  }
  return { branch, added, modified, removed, untracked, files };
}
