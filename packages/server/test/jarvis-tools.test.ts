import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createJarvisTools, parseToolCalls } from '../src/jarvis.js';

type MockSupervisor = {
  spawnAgent: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  continueAgent?: ReturnType<typeof vi.fn>;
};

type MockRegistry = {
  get: ReturnType<typeof vi.fn>;
  tail: ReturnType<typeof vi.fn>;
  setSpawnedBy?: ReturnType<typeof vi.fn>;
};

type MockRecents = {
  list: ReturnType<typeof vi.fn>;
};

const makeMocks = (): {
  supervisor: MockSupervisor;
  registry: MockRegistry;
  recents: MockRecents;
  roots: string[];
} => ({
  supervisor: {
    spawnAgent: vi.fn(() => ({ agentId: 'agt_worker1' })),
    stop: vi.fn(),
    continueAgent: vi.fn(() => ({ ok: true })),
  },
  registry: {
    get: vi.fn((id: string) =>
      id === 'agt_worker1'
        ? { id, projectPath: '/p', createdAt: 1, firstPrompt: 'do work', turn: 1 }
        : undefined,
    ),
    tail: vi.fn(() => [
      { v: 1, agentId: 'agt_worker1', seq: 0, ts: 1, kind: 'text', payload: { text: 'hi' } },
    ]),
    setSpawnedBy: vi.fn(),
  },
  recents: {
    list: vi.fn(() => [{ path: '/recent1', ts: 1 }]),
  },
  roots: ['/root1', '/root2'],
});

let mocks: ReturnType<typeof makeMocks>;
beforeEach(() => {
  mocks = makeMocks();
});

describe('jarvis tools', () => {
  it('dispatchTask calls supervisor.spawnAgent with the right inputs and tags spawned_by=jarvis', async () => {
    const tools = createJarvisTools({
      supervisor: mocks.supervisor as never,
      registry: mocks.registry as never,
      recents: mocks.recents as never,
      roots: mocks.roots,
    });
    const result = await tools.dispatchTask({
      title: 'fix bug',
      description: 'fix the foo bug',
      projectPath: '/root1/p',
      model: 'claude-sonnet-4-6',
    });
    expect(result).toEqual({ agentId: 'agt_worker1' });
    expect(mocks.supervisor.spawnAgent).toHaveBeenCalledWith({
      prompt: expect.stringContaining('fix the foo bug'),
      projectPath: '/root1/p',
      model: 'claude-sonnet-4-6',
    });
    expect(mocks.registry.setSpawnedBy).toHaveBeenCalledWith('agt_worker1', 'jarvis');
  });

  it('dispatchTask rejects a projectPath outside configured roots', async () => {
    const tools = createJarvisTools({
      supervisor: mocks.supervisor as never,
      registry: mocks.registry as never,
      recents: mocks.recents as never,
      roots: mocks.roots,
    });
    const result = await tools.dispatchTask({
      title: 't',
      description: 'd',
      projectPath: '/etc/passwd',
    });
    expect(result).toEqual({ error: 'PROJECT_NOT_ALLOWED' });
    expect(mocks.supervisor.spawnAgent).not.toHaveBeenCalled();
  });

  it('getWorkerStatus returns agent meta and a tail summary', async () => {
    const tools = createJarvisTools({
      supervisor: mocks.supervisor as never,
      registry: mocks.registry as never,
      recents: mocks.recents as never,
      roots: mocks.roots,
    });
    const result = await tools.getWorkerStatus({ agentId: 'agt_worker1' });
    expect(result).toMatchObject({
      agent: { id: 'agt_worker1', projectPath: '/p' },
      recent: expect.any(Array),
    });
  });

  it('getWorkerStatus errors gracefully on unknown agent', async () => {
    const tools = createJarvisTools({
      supervisor: mocks.supervisor as never,
      registry: mocks.registry as never,
      recents: mocks.recents as never,
      roots: mocks.roots,
    });
    const result = await tools.getWorkerStatus({ agentId: 'agt_ghost' });
    expect(result).toEqual({ error: 'AGENT_NOT_FOUND' });
  });

  it('interruptWorker calls supervisor.stop', async () => {
    const tools = createJarvisTools({
      supervisor: mocks.supervisor as never,
      registry: mocks.registry as never,
      recents: mocks.recents as never,
      roots: mocks.roots,
    });
    const result = await tools.interruptWorker({ agentId: 'agt_worker1' });
    expect(mocks.supervisor.stop).toHaveBeenCalledWith('agt_worker1');
    expect(result).toEqual({ ok: true });
  });

  it('interruptWorker fails on unknown agent', async () => {
    const tools = createJarvisTools({
      supervisor: mocks.supervisor as never,
      registry: mocks.registry as never,
      recents: mocks.recents as never,
      roots: mocks.roots,
    });
    const result = await tools.interruptWorker({ agentId: 'agt_nobody' });
    expect(result).toEqual({ error: 'AGENT_NOT_FOUND' });
    expect(mocks.supervisor.stop).not.toHaveBeenCalled();
  });

  it('listProjects returns roots and recents', async () => {
    const tools = createJarvisTools({
      supervisor: mocks.supervisor as never,
      registry: mocks.registry as never,
      recents: mocks.recents as never,
      roots: mocks.roots,
    });
    const result = await tools.listProjects({});
    expect(result.roots).toEqual(['/root1', '/root2']);
    expect(result.recent).toEqual([{ path: '/recent1', ts: 1 }]);
  });

  it('speakToUser echoes the text and returns ok', async () => {
    const tools = createJarvisTools({
      supervisor: mocks.supervisor as never,
      registry: mocks.registry as never,
      recents: mocks.recents as never,
      roots: mocks.roots,
    });
    const result = await tools.speakToUser({ text: 'Right away, sir.' });
    expect(result).toEqual({ ok: true, spoken: 'Right away, sir.' });
  });
});

describe('parseToolCalls', () => {
  it('parses a single fenced JSON tool call', () => {
    const text = 'Right away, sir.\n```jarvis-tool\n{"tool":"listProjects","args":{}}\n```';
    const calls = parseToolCalls(text);
    expect(calls).toEqual([{ tool: 'listProjects', args: {} }]);
  });

  it('parses multiple tool calls in order', () => {
    const text = [
      'first',
      '```jarvis-tool',
      '{"tool":"speakToUser","args":{"text":"hi"}}',
      '```',
      'second',
      '```jarvis-tool',
      '{"tool":"listProjects","args":{}}',
      '```',
    ].join('\n');
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.tool).toBe('speakToUser');
    expect(calls[1]?.tool).toBe('listProjects');
  });

  it('skips fences with malformed JSON', () => {
    const text = '```jarvis-tool\n{not valid json}\n```\n```jarvis-tool\n{"tool":"listProjects","args":{}}\n```';
    const calls = parseToolCalls(text);
    expect(calls).toEqual([{ tool: 'listProjects', args: {} }]);
  });

  it('returns [] when no fences are present', () => {
    expect(parseToolCalls('plain text only')).toEqual([]);
  });

  it('ignores fences with unknown tool field shape', () => {
    const text = '```jarvis-tool\n{"foo":"bar"}\n```';
    expect(parseToolCalls(text)).toEqual([]);
  });
});
