import { randomBytes } from 'node:crypto';
import type { Envelope } from '@cockpit/shared';

export type AgentMeta = {
  id: string;
  projectPath: string;
  createdAt: number;
  firstPrompt: string;
  turn: number;
};

export type AgentHandle = AgentMeta & {
  nextSeq: () => number;
};

type RegistryOpts = { tailCap?: number };

type AgentEntry = {
  meta: AgentMeta;
  seq: number;
  tail: Envelope[];
  sessionId?: string;
};

export class AgentRegistry {
  private readonly agents = new Map<string, AgentEntry>();
  private readonly tailCap: number;

  constructor(opts: RegistryOpts = {}) {
    this.tailCap = opts.tailCap ?? 500;
  }

  create(input: { projectPath: string }): AgentHandle {
    const id = `agt_${randomBytes(8).toString('hex')}`;
    const meta: AgentMeta = {
      id,
      projectPath: input.projectPath,
      createdAt: Date.now(),
      firstPrompt: '',
      turn: 1,
    };
    const entry: AgentEntry = { meta, seq: 0, tail: [] };
    this.agents.set(id, entry);
    return { ...meta, nextSeq: () => entry.seq++ };
  }

  setSessionId(agentId: string, sessionId: string): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;
    entry.sessionId = sessionId;
  }

  sessionIdFor(agentId: string): string | undefined {
    return this.agents.get(agentId)?.sessionId;
  }

  nextSeqFor(agentId: string): number {
    const entry = this.agents.get(agentId);
    if (!entry) return 0;
    return entry.seq++;
  }

  record(env: Envelope): void {
    const entry = this.agents.get(env.agentId);
    if (!entry) return;
    entry.tail.push(env);
    while (entry.tail.length > this.tailCap) entry.tail.shift();
  }

  tail(agentId: string, sinceSeq: number): Envelope[] {
    const entry = this.agents.get(agentId);
    if (!entry) return [];
    return entry.tail.filter((e) => e.seq > sinceSeq);
  }

  setFirstPrompt(agentId: string, prompt: string): void {
    const entry = this.agents.get(agentId);
    if (!entry || entry.meta.firstPrompt) return;
    entry.meta.firstPrompt = prompt;
  }

  getTurn(agentId: string): number {
    return this.agents.get(agentId)?.meta.turn ?? 1;
  }

  bumpTurn(agentId: string): number {
    const entry = this.agents.get(agentId);
    if (!entry) return 1;
    entry.meta.turn += 1;
    return entry.meta.turn;
  }

  get(agentId: string): AgentMeta | undefined {
    return this.agents.get(agentId)?.meta;
  }

  list(): AgentMeta[] {
    return [...this.agents.values()].map((e) => e.meta);
  }
}
