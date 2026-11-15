// Realtime: one Durable Object per profile holds that profile's WebSockets (Hibernation API — an idle socket costs
// nothing). The API publishes events to the hubs of a conversation's participants; D1 stays the source of truth, so a
// client that missed events simply re-reads over HTTP after reconnecting.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

type Attachment = { profileId: string; lastTyping?: number };

export class ChatHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/publish') {
      const text = await request.text();
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(text); } catch { /* closing */ }
      }
      return new Response(null, { status: 204 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const profileId = url.searchParams.get('profile') ?? '';
    // A profile keeps a handful of devices; the oldest sockets give way.
    const open = this.ctx.getWebSockets();
    for (const old of open.slice(0, Math.max(0, open.length - 7))) old.close(4000, 'replaced');
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ profileId } satisfies Attachment);
    pair[1].send(JSON.stringify({ type: 'hello', serverTime: Date.now() }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** Client → server: typing.start / typing.stop / delivered — each for a conversation the profile takes part in. */
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 512) return;
    let msg: { type?: string; conversationId?: string };
    try { msg = JSON.parse(raw); } catch { return; }
    const state = ws.deserializeAttachment() as Attachment | null;
    const conversationId = msg.conversationId;
    if (!state?.profileId || typeof conversationId !== 'string' || conversationId.length > 64) return;
    if (msg.type !== 'typing.start' && msg.type !== 'typing.stop' && msg.type !== 'delivered') return;
    if (msg.type === 'typing.start') {
      // At most one typing event a second per socket.
      if (state.lastTyping && Date.now() - state.lastTyping < 1000) return;
      ws.serializeAttachment({ ...state, lastTyping: Date.now() });
    }
    const rows = await this.env.DB.prepare(`SELECT profile_id FROM conversation_participants WHERE conversation_id = ?`)
      .bind(conversationId).all<{ profile_id: string }>();
    const members = rows.results.map((r) => r.profile_id);
    if (!members.includes(state.profileId)) return;
    const others = members.filter((id) => id !== state.profileId);
    if (msg.type === 'delivered') {
      const t = Date.now();
      await this.env.DB.prepare(`INSERT INTO conversation_read_state (conversation_id, profile_id, last_read_at, last_delivered_at)
          VALUES (?, ?, 0, ?) ON CONFLICT (conversation_id, profile_id) DO UPDATE SET last_delivered_at = excluded.last_delivered_at`)
        .bind(conversationId, state.profileId, t).run();
      await publish(this.env, others, { type: 'message.delivered', conversationId, profileId: state.profileId, deliveredAt: t });
      return;
    }
    // Typing is never stored.
    await publish(this.env, others, { type: msg.type, conversationId, profileId: state.profileId });
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket) {
    try { ws.close(1011); } catch { /* already closed */ }
  }
}

/** Sends one event to every socket of these profiles. Never throws: realtime is best effort, HTTP is the truth. */
export async function publish(env: Env, profileIds: string[], event: Record<string, unknown>): Promise<void> {
  if (!env.CHAT_HUB) return;
  const body = JSON.stringify(event);
  await Promise.all([...new Set(profileIds)].map(async (id) => {
    try {
      await env.CHAT_HUB!.get(env.CHAT_HUB!.idFromName(id)).fetch('https://hub/publish', { method: 'POST', body });
    } catch (error) {
      console.error('realtime publish failed', id, error);
    }
  }));
}
