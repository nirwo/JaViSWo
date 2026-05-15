import { randomBytes } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import type { Envelope } from '@cockpit/shared';

export type AgentMeta = {
  id: string;
  projectPath: string;
  createdAt: number;
  firstPrompt: string;
  turn: number;
  sessionId?: string;
};

export type AgentHandle = AgentMeta & {
  nextSeq: () => number;
};

type RegistryOpts = { tailCap?: number };

export class AgentRegistry {
  private readonly tailCap: number;
  private readonly stmts: {
    insertAgent: BetterSqlite3.Statement;
    insertEnvelope: BetterSqlite3.Statement;
    selectTail: BetterSqlite3.Statement;
    selectAgent: BetterSqlite3.Statement;
    selectAllAgents: BetterSqlite3.Statement;
    updateSessionId: BetterSqlite3.Statement;
    updateFirstPrompt: BetterSqlite3.Statement;
    bumpSeq: BetterSqlite3.Statement;
    bumpTurn: BetterSqlite3.Statement;
    getTurn: BetterSqlite3.Statement;
    getSessionId: BetterSqlite3.Statement;
    setStatus: BetterSqlite3.Statement;
    deleteAgent: BetterSqlite3.Statement;
  };

  constructor(
    private readonly db: BetterSqlite3.Database,
    opts: RegistryOpts = {},
  ) {
    this.tailCap = opts.tailCap ?? 5000;
    this.stmts = {
      insertAgent: db.prepare(
        `INSERT INTO agents (id, projectPath, createdAt, firstPrompt, turn) VALUES (?, ?, ?, '', 1)`,
      ),
      insertEnvelope: db.prepare(
        `INSERT INTO envelopes (agentId, seq, ts, kind, parentToolUseId, sessionId, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ),
      selectTail: db.prepare(
        `SELECT agentId, seq, ts, kind, parentToolUseId, sessionId, payload FROM envelopes WHERE agentId = ? AND seq > ? ORDER BY seq LIMIT ?`,
      ),
      selectAgent: db.prepare(
        `SELECT id, projectPath, createdAt, firstPrompt, turn, sessionId FROM agents WHERE id = ?`,
      ),
      selectAllAgents: db.prepare(
        `SELECT id, projectPath, createdAt, firstPrompt, turn, sessionId FROM agents ORDER BY createdAt DESC`,
      ),
      updateSessionId: db.prepare(`UPDATE agents SET sessionId = ? WHERE id = ?`),
      updateFirstPrompt: db.prepare(
        `UPDATE agents SET firstPrompt = ? WHERE id = ? AND firstPrompt = ''`,
      ),
      // RETURNING gives us the new seqCounter atomically; subtract 1 to get
      // the seq that was just allocated (pre-increment semantics).
      bumpSeq: db.prepare(
        `UPDATE agents SET seqCounter = seqCounter + 1 WHERE id = ? RETURNING seqCounter - 1 AS seq`,
      ),
      bumpTurn: db.prepare(
        `UPDATE agents SET turn = turn + 1 WHERE id = ? RETURNING turn`,
      ),
      getTurn: db.prepare(`SELECT turn FROM agents WHERE id = ?`),
      getSessionId: db.prepare(`SELECT sessionId FROM agents WHERE id = ?`),
      setStatus: db.prepare(`UPDATE agents SET status = ? WHERE id = ?`),
      deleteAgent: db.prepare(`DELETE FROM agents WHERE id = ?`),
    };
  }

  create(input: { projectPath: string }): AgentHandle {
    const id = `agt_${randomBytes(8).toString('hex')}`;
    const createdAt = Date.now();
    this.stmts.insertAgent.run(id, input.projectPath, createdAt);
    return {
      id,
      projectPath: input.projectPath,
      createdAt,
      firstPrompt: '',
      turn: 1,
      nextSeq: () => this.nextSeqFor(id),
    };
  }

  nextSeqFor(agentId: string): number {
    const row = this.stmts.bumpSeq.get(agentId) as { seq: number } | undefined;
    return row ? row.seq : 0;
  }

  record(env: Envelope): void {
    try {
      this.stmts.insertEnvelope.run(
        env.agentId,
        env.seq,
        env.ts,
        env.kind,
        env.parentToolUseId ?? null,
        env.sessionId ?? null,
        JSON.stringify(env.payload),
      );
    } catch {
      // Unknown agentId or duplicate seq → silent noop (matches old behavior).
    }
  }

  tail(agentId: string, sinceSeq: number): Envelope[] {
    const rows = this.stmts.selectTail.all(agentId, sinceSeq, this.tailCap) as Array<{
      agentId: string;
      seq: number;
      ts: number;
      kind: string;
      parentToolUseId: string | null;
      sessionId: string | null;
      payload: string;
    }>;
    return rows.map(
      (r): Envelope => ({
        v: 1,
        agentId: r.agentId,
        seq: r.seq,
        ts: r.ts,
        kind: r.kind as Envelope['kind'],
        parentToolUseId: r.parentToolUseId ?? undefined,
        sessionId: r.sessionId ?? undefined,
        payload: JSON.parse(r.payload),
      }),
    );
  }

  get(agentId: string): AgentMeta | undefined {
    const row = this.stmts.selectAgent.get(agentId) as AgentMeta | undefined;
    if (!row) return undefined;
    return { ...row, sessionId: row.sessionId ?? undefined };
  }

  list(): AgentMeta[] {
    const rows = this.stmts.selectAllAgents.all() as AgentMeta[];
    return rows.map((r) => ({ ...r, sessionId: r.sessionId ?? undefined }));
  }

  setSessionId(agentId: string, sessionId: string): void {
    this.stmts.updateSessionId.run(sessionId, agentId);
  }

  setFirstPrompt(agentId: string, prompt: string): void {
    this.stmts.updateFirstPrompt.run(prompt, agentId);
  }

  getTurn(agentId: string): number {
    const row = this.stmts.getTurn.get(agentId) as { turn: number } | undefined;
    return row?.turn ?? 1;
  }

  bumpTurn(agentId: string): number {
    const row = this.stmts.bumpTurn.get(agentId) as { turn: number } | undefined;
    return row?.turn ?? 1;
  }

  sessionIdFor(agentId: string): string | undefined {
    const row = this.stmts.getSessionId.get(agentId) as
      | { sessionId: string | null }
      | undefined;
    return row?.sessionId ?? undefined;
  }

  setStatus(agentId: string, status: string): void {
    this.stmts.setStatus.run(status, agentId);
  }

  deleteAgent(agentId: string): void {
    this.stmts.deleteAgent.run(agentId);
  }
}
