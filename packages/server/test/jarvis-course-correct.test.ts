// M3.4 — JARVIS course-correction integration test.
//
// Verifies the end-to-end loop for mid-flight worker redirection: while a
// JARVIS-spawned worker is running, the user gives a refinement instruction;
// JARVIS must call interruptWorker on the running worker and then dispatch
// a new task that references the adjustment.
//
// Strategy: drive a real JarvisAgent through a faked supervisor + registry.
// When say() is called, the fake supervisor's runJarvisTurn synthesises the
// text envelopes JARVIS "would have produced" (acknowledgement + two fenced
// tool calls) so the agent's tool-dispatcher fires interruptWorker then
// dispatchTask in order. We assert those side effects on the supervisor
// mock, plus that the running-worker context made it into the prompt.

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Envelope } from '@cockpit/shared';
import { JarvisAgent } from '../src/jarvis.js';
import { AgentRegistry } from '../src/registry.js';

function freshDb(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE agents (
      id            TEXT PRIMARY KEY,
      projectPath   TEXT NOT NULL,
      createdAt     INTEGER NOT NULL,
      firstPrompt   TEXT NOT NULL DEFAULT '',
      turn          INTEGER NOT NULL DEFAULT 1,
      sessionId     TEXT,
      seqCounter    INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'idle',
      spawned_by    TEXT
    );
    CREATE TABLE envelopes (
      agentId         TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      seq             INTEGER NOT NULL,
      ts              INTEGER NOT NULL,
      kind            TEXT NOT NULL,
      parentToolUseId TEXT,
      sessionId       TEXT,
      payload         TEXT NOT NULL,
      PRIMARY KEY (agentId, seq)
    );
    CREATE TABLE recents (path TEXT PRIMARY KEY, ts INTEGER NOT NULL);
    CREATE TABLE jarvis_sessions (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      last_active INTEGER NOT NULL
    );
  `);
  return d;
}

type Subscriber = (env: Envelope) => void;

// Drives a JarvisAgent with a fake supervisor whose runJarvisTurn pushes a
// scripted sequence of text envelopes into the agent's subscriber. The
// `scripts` array is read by reference so the caller can rewrite an entry
// after harness construction (useful when a script needs to reference an
// id that doesn't exist until the harness has been built).
function buildHarness(scripts: string[]): {
  agent: JarvisAgent;
  supervisor: {
    spawnAgent: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    runJarvisTurn: ReturnType<typeof vi.fn>;
    capturedPrompts: string[];
  };
  registry: AgentRegistry;
  seededWorkerId: string;
  dispose: () => void;
} {
  const db = freshDb();
  const registry = new AgentRegistry(db, { tailCap: 100 });
  const subs = new Set<Subscriber>();
  const subscribeEnvelopes = (_agentId: string, h: Subscriber): (() => void) => {
    subs.add(h);
    return () => subs.delete(h);
  };

  let turnIndex = 0;
  const capturedPrompts: string[] = [];
  const supervisor = {
    spawnAgent: vi.fn((input: { projectPath: string }) => {
      const handle = registry.create({ projectPath: input.projectPath });
      return { agentId: handle.id };
    }),
    stop: vi.fn(),
    runJarvisTurn: vi.fn((args: { agentId: string; prompt: string }) => {
      capturedPrompts.push(args.prompt);
      const script = scripts[turnIndex] ?? '';
      turnIndex++;
      queueMicrotask(() => {
        const txtEnv: Envelope = {
          v: 1,
          agentId: args.agentId,
          seq: registry.nextSeqFor(args.agentId),
          ts: Date.now(),
          kind: 'text',
          payload: { text: script },
        };
        for (const s of subs) s(txtEnv);
        const resEnv: Envelope = {
          v: 1,
          agentId: args.agentId,
          seq: registry.nextSeqFor(args.agentId),
          ts: Date.now(),
          kind: 'result',
          payload: {},
        };
        for (const s of subs) s(resEnv);
      });
    }),
  };

  // Seed a pre-existing worker that JARVIS will be asked to interrupt.
  const worker = registry.create({ projectPath: '/root1/p' });
  registry.setSpawnedBy(worker.id, 'jarvis');
  registry.setFirstPrompt(worker.id, 'redesign the landing page');

  const agent = new JarvisAgent({
    db,
    registry,
    supervisor: supervisor as never,
    recents: { list: () => [] } as never,
    roots: ['/root1'],
    subscribeEnvelopes,
  });

  return {
    agent,
    supervisor: { ...supervisor, capturedPrompts },
    registry,
    seededWorkerId: worker.id,
    dispose: () => {
      agent.shutdown();
      db.close();
    },
  };
}

let harness: ReturnType<typeof buildHarness> | null = null;
afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe('JARVIS course correction (M3.4)', () => {
  it('a refinement turn calls interruptWorker(running) then dispatchTask with the adjustment', async () => {
    // Build with a placeholder script; we patch it in place once we have the
    // seeded worker id (the harness's supervisor captured the array by ref).
    const scripts: string[] = ['', 'Done, sir — the new worker is on it.'];
    harness = buildHarness(scripts);
    const wid = harness.seededWorkerId;

    scripts[0] = [
      'Right, switching to dark now, sir.',
      '',
      '```jarvis-tool',
      JSON.stringify({ tool: 'interruptWorker', args: { agentId: wid } }),
      '```',
      '```jarvis-tool',
      JSON.stringify({
        tool: 'dispatchTask',
        args: {
          title: 'Redesign landing page (dark)',
          description:
            'redesign the landing page but with this adjustment: use a dark theme instead of light',
          projectPath: '/root1/p',
        },
      }),
      '```',
    ].join('\n');

    await harness.agent.say('actually use dark theme instead', [
      { id: wid, slug: 'landing', lastPrompt: 'redesign the landing page' },
    ]);

    // interruptWorker called on the existing worker
    expect(harness.supervisor.stop).toHaveBeenCalledWith(wid);
    // dispatchTask spawned a new worker with the adjustment in the description
    expect(harness.supervisor.spawnAgent).toHaveBeenCalledTimes(1);
    const spawnArgs = harness.supervisor.spawnAgent.mock.calls[0]?.[0] as {
      prompt: string;
      projectPath: string;
    };
    expect(spawnArgs.projectPath).toBe('/root1/p');
    expect(spawnArgs.prompt).toMatch(/dark theme/);
    expect(spawnArgs.prompt).toMatch(/adjustment/i);

    // The user prompt fed to JARVIS must include a "Currently running"
    // preamble so JARVIS knows which worker to interrupt.
    expect(harness.supervisor.capturedPrompts[0]).toMatch(/Currently running/i);
    expect(harness.supervisor.capturedPrompts[0]).toContain(wid);
  });

  it('omits the running-workers preamble when no workers are running', async () => {
    harness = buildHarness(['Right away, sir.']);
    await harness.agent.say('list my projects');
    expect(harness.supervisor.capturedPrompts[0]).not.toMatch(/Currently running/i);
    expect(harness.supervisor.capturedPrompts[0]).toContain('list my projects');
  });

  it('notifyWorkerEvent posts a worker checkpoint as a JARVIS turn', async () => {
    harness = buildHarness(['Done, sir — files updated.']);
    await harness.agent.notifyWorkerEvent({
      workerId: 'agt_fake',
      kind: 'result',
      summary: 'modified 3 files, all tests passed',
    });
    expect(harness.supervisor.runJarvisTurn).toHaveBeenCalledTimes(1);
    const prompt = harness.supervisor.capturedPrompts[0]!;
    expect(prompt).toMatch(/\[WORKER_EVENT\]/);
    expect(prompt).toContain('agt_fake');
    expect(prompt).toContain('modified 3 files');
  });
});
