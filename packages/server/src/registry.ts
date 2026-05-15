import { randomBytes } from 'node:crypto';
import type { Envelope } from '@cockpit/shared';

export type AgentMeta = {
  id: string;
  projectPath: string;
  createdAt: number;
};

export type AgentHandle = AgentMeta & {
  nextSeq: () => number;
};

type RegistryOpts = { tailCap?: number };

type AgentEntry = {
  meta: AgentMeta;
  seq: number;
  tail: Envelope[];
};

export class AgentRegistry {
  private readonly agents = new Map<string, AgentEntry>();
  private readonly tailCap: number;

  constructor(opts: RegistryOpts = {}) {
    this.tailCap = opts.tailCap ?? 500;
  }

  create(input: { projectPath: string }): AgentHandle {
    const id = `agt_${randomBytes(8).toString('hex')}`;
    const meta: AgentMeta = { id, projectPath: input.projectPath, createdAt: Date.now() };
    const entry: AgentEntry = { meta, seq: 0, tail: [] };
    this.agents.set(id, entry);
    return { ...meta, nextSeq: () => entry.seq++ };
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

  get(agentId: string): AgentMeta | undefined {
    return this.agents.get(agentId)?.meta;
  }

  list(): AgentMeta[] {
    return [...this.agents.values()].map((e) => e.meta);
  }
}
