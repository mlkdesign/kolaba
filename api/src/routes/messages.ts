// Messages: one chat list, conversations between two profiles (optionally about a job), unread state, search.
// Realtime = adaptive polling of GET /v1/sync (see routes/sync.ts) — within the Workers Free limits.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, rateLimit, requireAuth, requireProfile } from '../lib/auth';
import { areContacts, loadCards, mediaColumns, mediaJSON, type MediaRow, notify } from '../lib/cards';
import { signedMediaURL } from './media';
import { clampLimit, decodeCursor, encodeCursor, fail, newId, now, pairKey } from '../lib/util';

const messages = new Hono<AppEnv>();
messages.use('*', requireAuth, requireProfile);

async function participant(env: Env, conversationId: string, profileId: string) {
  const row = await env.DB.prepare(`SELECT 1 AS ok FROM conversation_participants WHERE conversation_id = ? AND profile_id = ?`)
    .bind(conversationId, profileId).first();
  if (!row) fail(404, 'conversation_not_found');
}

async function messagesJSON(env: Env, rows: Record<string, any>[], viewer: string) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const attachments = await env.DB.prepare(`SELECT ma.message_id, ${mediaColumns} FROM message_attachments ma
      JOIN media m ON m.id = ma.media_id AND m.status = 'ready' WHERE ma.message_id IN (${ids.map(() => '?').join(',')})
      ORDER BY ma.position`).bind(...ids).all<MediaRow & { message_id: string }>();
  const byMessage = new Map<string, unknown[]>();
  for (const m of attachments.results) {
    const json = mediaJSON(env, m);
    if (m.provider === 'r2') json.url = await signedMediaURL(env, m.id);
    byMessage.set(m.message_id, [...(byMessage.get(m.message_id) ?? []), json]);
  }
  return rows.map((m) => ({
    id: m.id, conversationId: m.conversation_id, senderProfileId: m.sender_profile_id, isOutgoing: m.sender_profile_id === viewer,
    kind: m.kind, body: m.deleted_at ? '' : m.body, createdAt: m.created_at, editedAt: m.edited_at, deletedAt: m.deleted_at,
    attachments: m.deleted_at ? [] : byMessage.get(m.id) ?? [],
    isReadByOther: m.other_read_at != null ? m.other_read_at >= m.created_at : undefined,
  }));
}

/** The chat list for a profile: newest activity first, unread counts, last message, the partner's card. */
export async function conversationList(env: Env, profileId: string, limit: number, cursor: { t: number; id: string } | null, q = '') {
  const rows = await env.DB.prepare(`SELECT c.id, c.kind, c.related_job_id, COALESCE(c.last_message_at, c.created_at) AS activity_at,
        cp.muted, c.last_message_id,
        (SELECT other.profile_id FROM conversation_participants other WHERE other.conversation_id = c.id AND other.profile_id <> ?1 LIMIT 1) AS other_id,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_profile_id <> ?1 AND m.deleted_at IS NULL
           AND m.created_at > COALESCE(rs.last_read_at, 0)) AS unread_count,
        (SELECT title FROM jobs WHERE id = c.related_job_id) AS job_title
      FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id
      LEFT JOIN conversation_read_state rs ON rs.conversation_id = c.id AND rs.profile_id = ?1
      WHERE cp.profile_id = ?1 AND cp.hidden_at IS NULL AND (c.last_message_id IS NOT NULL OR c.created_at > ?4)
        AND (?2 IS NULL OR (COALESCE(c.last_message_at, c.created_at), c.id) < (?2, ?3))
      ORDER BY activity_at DESC, c.id DESC LIMIT ?5`)
    .bind(profileId, cursor?.t ?? null, cursor?.id ?? null, now() - 86_400_000, limit + 1).all<Record<string, any>>();
  const page = rows.results.slice(0, limit);
  const lastIds = page.map((r) => r.last_message_id).filter(Boolean);
  const [cards, lastRows] = await Promise.all([
    loadCards(env, page.map((r) => r.other_id)),
    lastIds.length
      ? env.DB.prepare(`SELECT m.*, (SELECT rs.last_read_at FROM conversation_read_state rs WHERE rs.conversation_id = m.conversation_id
            AND rs.profile_id <> m.sender_profile_id LIMIT 1) AS other_read_at FROM messages m
            WHERE m.id IN (${lastIds.map(() => '?').join(',')})`).bind(...lastIds).all<Record<string, any>>()
      : Promise.resolve({ results: [] as Record<string, any>[] }),
  ]);
  const last = new Map((await messagesJSON(env, lastRows.results, profileId)).map((m) => [m.conversationId, m]));
  let items = page.map((r) => ({
    id: r.id, kind: r.kind, relatedJobId: r.related_job_id || null, relatedJobTitle: r.job_title, activityAt: r.activity_at,
    muted: r.muted === 1, unreadCount: r.unread_count, partner: cards.get(r.other_id) ?? null, lastMessage: last.get(r.id) ?? null,
  }));
  if (q) items = items.filter((i) => `${i.partner?.displayName} ${i.partner?.username}`.toLowerCase().includes(q));
  const lastRow = rows.results.length > limit ? page[page.length - 1] : null;
  return { items, nextCursor: lastRow ? encodeCursor({ t: lastRow.activity_at, id: lastRow.id }) : null };
}

// GET /v1/conversations?cursor=
messages.get('/', async (c) => {
  const profile = actingProfile(c);
  return c.json(await conversationList(c.env, profile.id, clampLimit(c.req.query('limit'), 30, 50),
    decodeCursor<{ t: number; id: string }>(c.req.query('cursor'))));
});

// POST /v1/conversations {profileId, jobId?} — opens or returns the chat (respects "who can message me").
messages.post('/', async (c) => {
  const profile = actingProfile(c);
  const { profileId, jobId } = z.object({ profileId: z.string(), jobId: z.string().optional() }).parse(await c.req.json());
  if (profileId === profile.id) fail(422, 'self_chat');
  const other = await c.env.DB.prepare(`SELECT p.owner_user_id, p.status, COALESCE(s.who_can_message, 'everyone') AS who
      FROM profiles p LEFT JOIN profile_settings s ON s.profile_id = p.id WHERE p.id = ?`).bind(profileId)
    .first<{ owner_user_id: string; status: string; who: string }>();
  if (!other || other.status !== 'active') fail(404, 'profile_not_found');
  if (other!.owner_user_id === profile.ownerUserId) fail(422, 'same_account');
  if (jobId) {
    const job = await c.env.DB.prepare(`SELECT owner_profile_id FROM jobs WHERE id = ?`).bind(jobId).first<{ owner_profile_id: string }>();
    if (!job || ![profile.id, profileId].includes(job.owner_profile_id)) fail(404, 'job_not_found');
  }
  const key = pairKey(profile.id, profileId);
  const existing = await c.env.DB.prepare(`SELECT id FROM conversations WHERE pair_key = ? AND related_job_id = ?`)
    .bind(key, jobId ?? '').first<{ id: string }>();
  if (existing) {
    await c.env.DB.prepare(`UPDATE conversation_participants SET hidden_at = NULL WHERE conversation_id = ? AND profile_id = ?`)
      .bind(existing.id, profile.id).run();
    return c.json({ id: existing.id });
  }
  if (other!.who === 'nobody' || (other!.who === 'contacts' && !(await areContacts(c.env, profile.id, profileId)))) {
    fail(403, 'messaging_not_allowed');
  }
  const id = newId('cnv');
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO conversations (id, kind, pair_key, related_job_id, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(id, jobId ? 'job' : 'direct', key, jobId ?? '', now()),
      c.env.DB.prepare(`INSERT INTO conversation_participants (conversation_id, profile_id, joined_at) VALUES (?, ?, ?), (?, ?, ?)`)
        .bind(id, profile.id, now(), id, profileId, now()),
      c.env.DB.prepare(`INSERT INTO conversation_read_state (conversation_id, profile_id, last_read_at) VALUES (?, ?, ?), (?, ?, 0)`)
        .bind(id, profile.id, now(), id, profileId),
    ]);
  } catch (error) {
    if (!String(error).includes('UNIQUE')) throw error;
    const again = await c.env.DB.prepare(`SELECT id FROM conversations WHERE pair_key = ? AND related_job_id = ?`).bind(key, jobId ?? '')
      .first<{ id: string }>();
    return c.json({ id: again!.id });
  }
  return c.json({ id }, 201);
});

// GET /v1/conversations/:id/messages?before=&after= — newest page first; `after` returns only newer ones (polling).
messages.get('/:id/messages', async (c) => {
  const profile = actingProfile(c);
  const id = c.req.param('id');
  await participant(c.env, id, profile.id);
  const limit = clampLimit(c.req.query('limit'), 40, 100);
  const before = decodeCursor<{ t: number; id: string }>(c.req.query('before'));
  const after = Number(c.req.query('after') ?? 0);
  const rows = await c.env.DB.prepare(`SELECT m.*, (SELECT last_read_at FROM conversation_read_state WHERE conversation_id = m.conversation_id
        AND profile_id <> ?2 LIMIT 1) AS other_read_at FROM messages m
      WHERE m.conversation_id = ?1 AND (?3 IS NULL OR (m.created_at, m.id) < (?3, ?4)) AND m.created_at > ?5
      ORDER BY m.created_at DESC, m.id DESC LIMIT ?6`)
    .bind(id, profile.id, before?.t ?? null, before?.id ?? null, after, limit + 1).all<Record<string, any>>();
  const page = rows.results.slice(0, limit);
  const last = rows.results.length > limit ? page[page.length - 1] : null;
  const conv = await c.env.DB.prepare(`SELECT c.related_job_id, (SELECT title FROM jobs WHERE id = c.related_job_id) AS job_title,
      (SELECT profile_id FROM conversation_participants WHERE conversation_id = c.id AND profile_id <> ? LIMIT 1) AS other_id,
      (SELECT muted FROM conversation_participants WHERE conversation_id = c.id AND profile_id = ?) AS muted
      FROM conversations c WHERE c.id = ?`).bind(profile.id, profile.id, id).first<Record<string, any>>();
  const cards = await loadCards(c.env, [conv!.other_id]);
  return c.json({
    conversation: { id, relatedJobId: conv!.related_job_id || null, relatedJobTitle: conv!.job_title, muted: conv!.muted === 1,
                    partner: cards.get(conv!.other_id) ?? null },
    items: await messagesJSON(c.env, page, profile.id),
    nextCursor: last ? encodeCursor({ t: last.created_at, id: last.id }) : null,
  });
});

// POST /v1/conversations/:id/messages {body, mediaIds}
messages.post('/:id/messages', async (c) => {
  const profile = actingProfile(c);
  const id = c.req.param('id');
  await participant(c.env, id, profile.id);
  await rateLimit(c, 'RL_WRITE', `msg:${profile.ownerUserId}`);
  const body = z.object({ body: z.string().max(4000).default(''), mediaIds: z.array(z.string()).max(10).default([]) })
    .parse(await c.req.json());
  const text = body.body.trim();
  if (!text && !body.mediaIds.length) fail(422, 'empty_message');
  if (body.mediaIds.length) {
    const owned = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM media WHERE owner_profile_id = ? AND status = 'ready'
        AND id IN (${body.mediaIds.map(() => '?').join(',')})`).bind(profile.id, ...body.mediaIds).first<{ n: number }>();
    if (owned?.n !== new Set(body.mediaIds).size) fail(422, 'media_not_found');
  }
  const messageId = newId('msg');
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO messages (id, conversation_id, sender_profile_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(messageId, id, profile.id, text ? 'text' : 'media', text, t),
    ...[...new Set(body.mediaIds)].map((mid, i) =>
      c.env.DB.prepare(`INSERT INTO message_attachments (message_id, media_id, position) VALUES (?, ?, ?)`).bind(messageId, mid, i)),
    c.env.DB.prepare(`UPDATE conversations SET last_message_id = ?, last_message_at = ? WHERE id = ?`).bind(messageId, t, id),
    c.env.DB.prepare(`INSERT INTO conversation_read_state (conversation_id, profile_id, last_read_at, last_read_message_id) VALUES (?, ?, ?, ?)
      ON CONFLICT (conversation_id, profile_id) DO UPDATE SET last_read_at = excluded.last_read_at,
      last_read_message_id = excluded.last_read_message_id`).bind(id, profile.id, t, messageId),
    c.env.DB.prepare(`UPDATE conversation_participants SET hidden_at = NULL WHERE conversation_id = ?`).bind(id),
  ]);
  // One unread "new message" notification per chat for an unmuted partner.
  const others = await c.env.DB.prepare(`SELECT profile_id, muted FROM conversation_participants WHERE conversation_id = ? AND profile_id <> ?`)
    .bind(id, profile.id).all<{ profile_id: string; muted: number }>();
  for (const o of others.results) {
    if (o.muted) continue;
    const pending = await c.env.DB.prepare(`SELECT id FROM notifications WHERE recipient_profile_id = ? AND type = 'new_message'
        AND read_at IS NULL AND json_extract(payload, '$.conversationId') = ?`).bind(o.profile_id, id).first<{ id: string }>();
    if (pending) {
      await c.env.DB.prepare(`UPDATE notifications SET created_at = ?, actor_profile_id = ? WHERE id = ?`).bind(t, profile.id, pending.id).run();
    } else {
      await notify(c.env, o.profile_id, 'new_message', profile.id, { conversationId: id });
    }
  }
  const row = await c.env.DB.prepare(`SELECT m.*, NULL AS other_read_at FROM messages m WHERE id = ?`).bind(messageId).first<Record<string, any>>();
  return c.json((await messagesJSON(c.env, [row!], profile.id))[0], 201);
});

// POST /v1/conversations/:id/read — everything so far is read (and its notifications).
messages.post('/:id/read', async (c) => {
  const profile = actingProfile(c);
  const id = c.req.param('id');
  await participant(c.env, id, profile.id);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO conversation_read_state (conversation_id, profile_id, last_read_at) VALUES (?, ?, ?)
      ON CONFLICT (conversation_id, profile_id) DO UPDATE SET last_read_at = excluded.last_read_at`).bind(id, profile.id, now()),
    c.env.DB.prepare(`UPDATE notifications SET read_at = ? WHERE recipient_profile_id = ? AND type = 'new_message' AND read_at IS NULL
      AND json_extract(payload, '$.conversationId') = ?`).bind(now(), profile.id, id),
  ]);
  return c.json({ status: 'read' });
});

messages.post('/:id/mute', async (c) => {
  const profile = actingProfile(c);
  const { muted } = z.object({ muted: z.boolean() }).parse(await c.req.json());
  const res = await c.env.DB.prepare(`UPDATE conversation_participants SET muted = ? WHERE conversation_id = ? AND profile_id = ?`)
    .bind(Number(muted), c.req.param('id'), profile.id).run();
  if (!res.meta.changes) fail(404, 'conversation_not_found');
  return c.json({ muted });
});

// DELETE /v1/conversations/:id — removes it from this profile's list (back with the next message).
messages.delete('/:id', async (c) => {
  const profile = actingProfile(c);
  const res = await c.env.DB.prepare(`UPDATE conversation_participants SET hidden_at = ? WHERE conversation_id = ? AND profile_id = ?`)
    .bind(now(), c.req.param('id'), profile.id).run();
  if (!res.meta.changes) fail(404, 'conversation_not_found');
  return c.json({ status: 'hidden' });
});

export default messages;
