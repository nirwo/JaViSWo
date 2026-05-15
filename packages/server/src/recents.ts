import type BetterSqlite3 from 'better-sqlite3';
import { existsSync, readFileSync, renameSync } from 'node:fs';

export type RecentEntry = { path: string; ts: number };

export class RecentsStore {
  // Monotonic counter ensures stable insertion order even within the same ms.
  // Loaded from DB on construction so it survives server restarts.
  private seq: number;

  private readonly stmts: {
    insertOrReplace: BetterSqlite3.Statement;
    list: BetterSqlite3.Statement;
    count: BetterSqlite3.Statement;
    deleteOldest: BetterSqlite3.Statement;
    maxSeq: BetterSqlite3.Statement;
  };

  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly cap = 10,
    legacyJsonPath?: string,
  ) {
    this.stmts = {
      insertOrReplace: db.prepare(
        `INSERT INTO recents (path, ts, seq) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET ts = excluded.ts, seq = excluded.seq`,
      ),
      list: db.prepare(`SELECT path, ts FROM recents ORDER BY seq DESC LIMIT ?`),
      count: db.prepare(`SELECT COUNT(*) AS n FROM recents`),
      deleteOldest: db.prepare(
        `DELETE FROM recents WHERE path IN (SELECT path FROM recents ORDER BY seq ASC LIMIT ?)`,
      ),
      maxSeq: db.prepare(`SELECT COALESCE(MAX(seq), 0) AS n FROM recents`),
    };
    const { n } = this.stmts.maxSeq.get() as { n: number };
    this.seq = n;
    if (legacyJsonPath) this.migrateLegacyJson(legacyJsonPath);
  }

  private migrateLegacyJson(p: string): void {
    if (!existsSync(p)) return;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf-8'));
      if (Array.isArray(raw)) {
        for (const r of raw) {
          if (r?.path && typeof r.ts === 'number') {
            this.seq += 1;
            this.stmts.insertOrReplace.run(r.path, r.ts, this.seq);
          }
        }
      }
      renameSync(p, p + '.migrated');
    } catch {
      // Corrupt legacy file — skip migration.
    }
  }

  list(): RecentEntry[] {
    return this.stmts.list.all(this.cap) as RecentEntry[];
  }

  add(path: string): void {
    this.seq += 1;
    this.stmts.insertOrReplace.run(path, Date.now(), this.seq);
    const { n } = this.stmts.count.get() as { n: number };
    if (n > this.cap) {
      this.stmts.deleteOldest.run(n - this.cap);
    }
  }
}
