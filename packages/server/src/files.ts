import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type FileNode = {
  path: string;
  name: string;
  type: 'file' | 'dir';
  hasDesignMd?: boolean;
  children?: FileNode[];
};

const IGNORED_DIRS = new Set([
  '.git', '.cockpit', '.superpowers', 'node_modules', 'dist', 'build', '.next',
  '.turbo', '.cache', '.vscode', '.idea',
]);

export function readTree(root: string, depth: number): FileNode {
  const r = resolve(root);
  return walk(r, depth);
}

function walk(absPath: string, depth: number): FileNode {
  const name = absPath.split('/').filter(Boolean).pop() ?? absPath;
  let st;
  try { st = statSync(absPath); } catch { return { path: absPath, name, type: 'file' }; }
  if (!st.isDirectory()) return { path: absPath, name, type: 'file' };
  const node: FileNode = {
    path: absPath,
    name,
    type: 'dir',
    hasDesignMd: existsSync(join(absPath, 'DESIGN.md')),
  };
  if (depth <= 0) return node;
  let entries: import('node:fs').Dirent[];
  try { entries = readdirSync(absPath, { withFileTypes: true }); } catch { return node; }
  const children: FileNode[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.env') continue;
    if (e.isDirectory() && IGNORED_DIRS.has(e.name)) continue;
    if (e.isDirectory()) children.push(walk(join(absPath, e.name), depth - 1));
    else children.push({ path: join(absPath, e.name), name: e.name, type: 'file' });
  }
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children = children;
  return node;
}
