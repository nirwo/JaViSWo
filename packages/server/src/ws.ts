import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import { ResumeRequestSchema, type Envelope } from '@cockpit/shared';
import type { AgentRegistry } from './registry.js';

type Subscription = { agentId: string; sinceSeq: number };

export function attachWebSocket(httpServer: HttpServer, registry: AgentRegistry) {
  const wss = new WebSocketServer({ noServer: true });
  const subs = new Map<WebSocket, Subscription[]>();

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    subs.set(ws, []);
    ws.on('error', () => {
      subs.delete(ws);
    });
    ws.on('message', (raw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString('utf-8'));
      } catch {
        return;
      }
      // Ping/pong — echo ts back so client can compute roundtrip latency.
      if (
        payload &&
        typeof payload === 'object' &&
        'type' in payload &&
        (payload as { type: unknown }).type === 'ping'
      ) {
        const ts = (payload as { ts?: unknown }).ts;
        if (typeof ts === 'number') {
          ws.send(JSON.stringify({ type: 'pong', ts }));
        }
        return;
      }
      const parsed = ResumeRequestSchema.safeParse(payload);
      if (!parsed.success) return;
      const { agentId, sinceSeq } = parsed.data.resume;
      const list = subs.get(ws) ?? [];
      list.push({ agentId, sinceSeq });
      subs.set(ws, list);
      if (ws.readyState !== WebSocket.OPEN) return;
      // Replay tail since sinceSeq.
      for (const e of registry.tail(agentId, sinceSeq)) {
        ws.send(JSON.stringify(e));
      }
    });
    ws.on('close', () => subs.delete(ws));
  });

  function broadcast(env: Envelope) {
    for (const [ws, list] of subs.entries()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (list.some((s) => s.agentId === env.agentId)) {
        ws.send(JSON.stringify(env));
      }
    }
  }

  function broadcastAll(message: unknown): void {
    const json = JSON.stringify(message);
    for (const ws of subs.keys()) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(json); } catch { /* ignore — client may have closed */ }
      }
    }
  }

  function clientCount(): number {
    let count = 0;
    for (const ws of subs.keys()) {
      if (ws.readyState === WebSocket.OPEN) count++;
    }
    return count;
  }

  return { broadcast, broadcastAll, clientCount };
}
