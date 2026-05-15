import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type RecentEntry = { path: string; ts: number };

export class RecentsStore {
  private entries: RecentEntry[] = [];

  constructor(
    private readonly filePath: string,
    private readonly cap = 10,
  ) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.entries = parsed.filter(
          (e): e is RecentEntry =>
            e && typeof e.path === 'string' && typeof e.ts === 'number',
        );
      }
    } catch {
      // Corrupt file — start fresh.
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[cockpit] failed to save recents:', err);
    }
  }

  list(): RecentEntry[] {
    return [...this.entries];
  }

  add(path: string): void {
    const now = Date.now();
    this.entries = [{ path, ts: now }, ...this.entries.filter((e) => e.path !== path)];
    if (this.entries.length > this.cap) this.entries.length = this.cap;
    this.save();
  }
}
