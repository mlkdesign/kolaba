// Messages: one chat list, conversations between two profiles (optionally about a job), unread state, search.
// Realtime = adaptive polling of GET /v1/sync (see routes/sync.ts) — within the Workers Free limits.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { actingProfile, rateLimit, requireAuth, requireProfile } from '../lib/auth';
import { areContacts, loadCards, mediaColumns, mediaJSON, type MediaRow, notify } from '../lib/cards';
import { signedMediaURL, signedVoiceURL } from './media';
import { blockedBetweenUsers } from '../lib/moderation';
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
  const marks = ids.map(() => '?').join(',');
  const [attachments, reactions, voices] = await Promise.all([
    env.DB.prepare(`SELECT ma.message_id, ${mediaColumns} FROM message_attachments ma
      JOIN media m ON m.id = ma.media_id AND m.status = 'ready' AND m.review_status NOT IN ('rejected', 'removed')
      WHERE ma.message_id IN (${marks}) ORDER BY ma.position`).bind(...ids).all<MediaRow & { message_id: string }>(),
    env.DB.prepare(`SELECT message_id, COUNT(*) AS n, SUM(profile_id = ?) AS mine FROM message_reactions
      WHERE message_id IN (${marks}) AND kind = 'like' GROUP BY message_id`).bind(viewer, ...ids).all<{ message_id: string; n: number; mine: number }>(),
    env.DB.prepare(`SELECT message_id, mime, bytes, duration, waveform FROM message_voice WHERE message_id IN (${marks})`)
      .bind(...ids).all<{ message_id: string; mime: string; bytes: number; duration: number; waveform: string }>(),
  ]);
  const likes = new Map(reactions.results.map((r) => [r.message_id, r]));
  const voiceBy = new Map<string, Record<string, unknown>>();
  for (const v of voices.results) {
    voiceBy.set(v.message_id, { url: await signedVoiceURL(env, v.message_id), mime: v.mime, bytes: v.bytes, duration: v.duration,
                                waveform: JSON.parse(v.waveform || '[]') });
  }
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
    voice: m.deleted_at ? null : voiceBy.get(m.id) ?? null,
    likesCount: likes.get(m.id)?.n ?? 0,
    isLikedByMe: (likes.get(m.id)?.mine ?? 0) > 0,
    clientId: m.sender_profile_id === viewer ? m.client_id ?? null : null,
    isReadByOther: m.other_read_at != null ? m.other_read_at >= m.created_at : undefined,
  }));
}

/** The chat list for a profile: newest activity first, unread counts, last message, the partner's card. */
export async function conversationList(env: Env, profileId: string, limit: number, cursor: { t: number; id: string } | null, q = '') {
  const rows = await env.DB.prepare(`SELECT c.id, c.kind, c.related_job_id, COALESCE(c.last_message_at, c.created_at) AS activity_at,
        cp.muted, c.last_message_id,
        (SELECT other.profile_id FROM conversation_participants other WHERE other.conversation_id = c.id AND other.profile_id <> ?1 LIMIT 1) AS other_id,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_profile_id <> ?1 AND m.deleted_at IS NULL
           AND m.created_at > MAX(COALESCE(rs.last_read_at, 0), COALESCE(cp.cleared_at, 0))) AS unread_count,
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
  if (await blockedBetweenUsers(c.env, profile.ownerUserId, other!.owner_user_id)) fail(403, 'blocked');
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
  // Anti-spam: an account opens at most NEW_CONVERSATIONS_PER_DAY new conversations a day.
  const opened = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE created_at > ? AND created_by_profile_id IN
      (SELECT id FROM profiles WHERE owner_user_id = ?)`).bind(now() - 86_400_000, profile.ownerUserId).first<{ n: number }>();
  if ((opened?.n ?? 0) >= Number(c.env.NEW_CONVERSATIONS_PER_DAY ?? 25)) fail(429, 'too_many_new_conversations');
  const id = newId('cnv');
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO conversations (id, kind, pair_key, related_job_id, created_at, created_by_profile_id) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, jobId ? 'job' : 'direct', key, jobId ?? '', now(), profile.id),
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
        AND m.created_at > COALESCE((SELECT cleared_at FROM conversation_participants WHERE conversation_id = ?1 AND profile_id = ?2), 0)
      ORDER BY m.created_at DESC, m.id DESC LIMIT ?6`)
    .bind(id, profile.id, before?.t ?? null, before?.id ?? null, after, limit + 1).all<Record<string, any>>();
  const page = rows.results.slice(0, limit);
  const last = rows.results.length > limit ? page[page.length - 1] : null;
  const conv = await c.env.DB.prepare(`SELECT c.related_job_id, (SELECT title FROM jobs WHERE id = c.related_job_id) AS job_title,
      (SELECT profile_id FROM conversation_participants WHERE conversation_id = c.id AND profile_id <> ? LIMIT 1) AS other_id,
      (SELECT muted FROM conversation_participants WHERE conversation_id = c.id AND profile_id = ?) AS muted
      FROM conversations c WHERE c.id = ?`).bind(profile.id, profile.id, id).first<Record<string, any>>();
  const cards = await loadCards(c.env, [conv!.other_id]);
  const block = await blockState(c.env, profile.ownerUserId, conv!.other_id);
  return c.json({
    conversation: { id, relatedJobId: conv!.related_job_id || null, relatedJobTitle: conv!.job_title, muted: conv!.muted === 1,
                    partner: cards.get(conv!.other_id) ?? null, blockedByMe: block.byMe, blockedByThem: block.byThem },
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
  const body = z.object({ body: z.string().max(4000).default(''), mediaIds: z.array(z.string()).max(10).default([]),
                          clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional() })
    .parse(await c.req.json());
  const text = body.body.trim();
  if (!text && !body.mediaIds.length) fail(422, 'empty_message');
  // A retry of a message that already arrived returns that message (never a second copy).
  if (body.clientId) {
    const existing = await c.env.DB.prepare(`SELECT m.*, NULL AS other_read_at FROM messages m WHERE conversation_id = ? AND sender_profile_id = ?
        AND client_id = ?`).bind(id, profile.id, body.clientId).first<Record<string, any>>();
    if (existing) return c.json((await messagesJSON(c.env, [existing], profile.id))[0], 200);
  }
  await checkCanSend(c.env, id, profile);
  if (body.mediaIds.length) {
    const owned = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM media WHERE owner_profile_id = ? AND status = 'ready'
        AND id IN (${body.mediaIds.map(() => '?').join(',')})`).bind(profile.id, ...body.mediaIds).first<{ n: number }>();
    if (owned?.n !== new Set(body.mediaIds).size) fail(422, 'media_not_found');
  }
  const messageId = newId('msg');
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO messages (id, conversation_id, sender_profile_id, kind, body, created_at, client_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(messageId, id, profile.id, text ? 'text' : 'media', text, t, body.clientId ?? null),
    ...[...new Set(body.mediaIds)].map((mid, i) =>
      c.env.DB.prepare(`INSERT INTO message_attachments (message_id, media_id, position) VALUES (?, ?, ?)`).bind(messageId, mid, i)),
    c.env.DB.prepare(`UPDATE conversations SET last_message_id = ?, last_message_at = ? WHERE id = ?`).bind(messageId, t, id),
    c.env.DB.prepare(`INSERT INTO conversation_read_state (conversation_id, profile_id, last_read_at, last_read_message_id) VALUES (?, ?, ?, ?)
      ON CONFLICT (conversation_id, profile_id) DO UPDATE SET last_read_at = excluded.last_read_at,
      last_read_message_id = excluded.last_read_message_id`).bind(id, profile.id, t, messageId),
    c.env.DB.prepare(`UPDATE conversation_participants SET hidden_at = NULL WHERE conversation_id = ?`).bind(id),
  ]);
  await afterSend(c.env, id, profile.id, messageId, t);
  const row = await c.env.DB.prepare(`SELECT m.*, NULL AS other_read_at FROM messages m WHERE id = ?`).bind(messageId).first<Record<string, any>>();
  return c.json((await messagesJSON(c.env, [row!], profile.id))[0], 201);
});

/** Who blocked whom between the viewer's account and a profile's account. */
async function blockState(env: Env, viewerUserId: string, otherProfileId: string) {
  const owner = await env.DB.prepare(`SELECT owner_user_id FROM profiles WHERE id = ?`).bind(otherProfileId).first<{ owner_user_id: string }>();
  if (!owner) return { byMe: false, byThem: false, otherUserId: null as string | null };
  const rows = await env.DB.prepare(`SELECT blocker_user_id FROM blocks WHERE (blocker_user_id = ?1 AND blocked_user_id = ?2)
      OR (blocker_user_id = ?2 AND blocked_user_id = ?1)`).bind(viewerUserId, owner.owner_user_id).all<{ blocker_user_id: string }>();
  return { byMe: rows.results.some((r) => r.blocker_user_id === viewerUserId),
           byThem: rows.results.some((r) => r.blocker_user_id === owner.owner_user_id), otherUserId: owner.owner_user_id };
}

/** Sending is refused between blocked accounts, and to a stranger who hasn't answered after MESSAGES_BEFORE_REPLY
 *  messages (new-contact anti-spam). Confirmed contacts are never limited this way. */
async function checkCanSend(env: Env, conversationId: string, profile: { id: string; ownerUserId: string }) {
  const other = await env.DB.prepare(`SELECT profile_id FROM conversation_participants WHERE conversation_id = ? AND profile_id <> ? LIMIT 1`)
    .bind(conversationId, profile.id).first<{ profile_id: string }>();
  if (!other) fail(404, 'conversation_not_found');
  const block = await blockState(env, profile.ownerUserId, other!.profile_id);
  if (block.byMe) fail(403, 'blocked_by_you');
  if (block.byThem) fail(403, 'blocked');
  if (await areContacts(env, profile.id, other!.profile_id)) return;
  const counts = await env.DB.prepare(`SELECT SUM(sender_profile_id = ?1) AS mine, SUM(sender_profile_id <> ?1) AS theirs
      FROM messages WHERE conversation_id = ?2 AND deleted_at IS NULL`).bind(profile.id, conversationId).first<{ mine: number; theirs: number }>();
  const limit = Number(env.MESSAGES_BEFORE_REPLY ?? 5);
  if ((counts?.theirs ?? 0) === 0 && (counts?.mine ?? 0) >= limit) fail(429, 'awaiting_reply');
}

/** After a message: one unread notification per chat for each unmuted partner. */
async function afterSend(env: Env, id: string, senderId: string, messageId: string, t: number) {
  void messageId;
  // One unread "new message" notification per chat for an unmuted partner.
  const others = await env.DB.prepare(`SELECT profile_id, muted FROM conversation_participants WHERE conversation_id = ? AND profile_id <> ?`)
    .bind(id, senderId).all<{ profile_id: string; muted: number }>();
  for (const o of others.results) {
    if (o.muted) continue;
    const pending = await env.DB.prepare(`SELECT id FROM notifications WHERE recipient_profile_id = ? AND type = 'new_message'
        AND read_at IS NULL AND json_extract(payload, '$.conversationId') = ?`).bind(o.profile_id, id).first<{ id: string }>();
    if (pending) {
      await env.DB.prepare(`UPDATE notifications SET created_at = ?, actor_profile_id = ? WHERE id = ?`).bind(t, senderId, pending.id).run();
    } else {
      await notify(env, o.profile_id, 'new_message', senderId, { conversationId: id });
    }
  }
}

/** The message, if the profile takes part in its conversation (and hasn't cleared it away). */
async function visibleMessage(env: Env, conversationId: string, messageId: string, profileId: string) {
  await participant(env, conversationId, profileId);
  const row = await env.DB.prepare(`SELECT m.id FROM messages m WHERE m.id = ? AND m.conversation_id = ? AND m.deleted_at IS NULL
      AND m.created_at > COALESCE((SELECT cleared_at FROM conversation_participants WHERE conversation_id = ? AND profile_id = ?), 0)`)
    .bind(messageId, conversationId, conversationId, profileId).first();
  if (!row) fail(404, 'message_not_found');
}

// PUT / DELETE /v1/conversations/:id/messages/:messageId/like — a message's like (one per profile; idempotent).
messages.put('/:id/messages/:messageId/like', async (c) => {
  const profile = actingProfile(c);
  await rateLimit(c, 'RL_WRITE', `react:${profile.ownerUserId}`);
  await visibleMessage(c.env, c.req.param('id'), c.req.param('messageId'), profile.id);
  await c.env.DB.prepare(`INSERT OR IGNORE INTO message_reactions (message_id, profile_id, kind, created_at) VALUES (?, ?, 'like', ?)`)
    .bind(c.req.param('messageId'), profile.id, now()).run();
  return c.json(await likeState(c.env, c.req.param('messageId'), profile.id));
});

messages.delete('/:id/messages/:messageId/like', async (c) => {
  const profile = actingProfile(c);
  await visibleMessage(c.env, c.req.param('id'), c.req.param('messageId'), profile.id);
  await c.env.DB.prepare(`DELETE FROM message_reactions WHERE message_id = ? AND profile_id = ? AND kind = 'like'`)
    .bind(c.req.param('messageId'), profile.id).run();
  return c.json(await likeState(c.env, c.req.param('messageId'), profile.id));
});

async function likeState(env: Env, messageId: string, profileId: string) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(profile_id = ?) AS mine FROM message_reactions WHERE message_id = ? AND kind = 'like'`)
    .bind(profileId, messageId).first<{ n: number; mine: number | null }>();
  return { messageId, likesCount: row?.n ?? 0, isLikedByMe: (row?.mine ?? 0) > 0 };
}

const VOICE_TYPES: Record<string, string> = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac' };

// POST /v1/conversations/:id/voice — multipart: file (AAC / M4A), duration (s), waveform (JSON), clientId. Stored
// privately in R2; participants get signed URLs only.
messages.post('/:id/voice', async (c) => {
  const profile = actingProfile(c);
  const id = c.req.param('id');
  await participant(c.env, id, profile.id);
  await rateLimit(c, 'RL_WRITE', `msg:${profile.ownerUserId}`);
  if (!c.env.MEDIA) fail(503, 'storage_unavailable');
  const maxBytes = Number(c.env.MAX_VOICE_KB ?? 3072) * 1024;
  const declared = Number(c.req.header('Content-Length') ?? 0);
  if (declared > maxBytes + 16 * 1024) fail(413, 'file_too_large');
  const form = await c.req.formData().catch(() => fail(400, 'invalid_form'));
  const file = form.get('file');
  if (!(file instanceof File)) fail(400, 'file_required');
  const audio = file as File;
  const mime = (audio.type || '').toLowerCase();
  const ext = VOICE_TYPES[mime] ?? fail(415, 'invalid_mime_type');
  if (audio.size === 0 || audio.size > maxBytes) fail(413, 'file_too_large');
  const duration = Number(form.get('duration'));
  if (!Number.isFinite(duration) || duration <= 0 || duration > Number(c.env.MAX_VOICE_SECONDS ?? 300)) fail(422, 'invalid_duration');
  const clientId = String(form.get('clientId') ?? '');
  if (clientId && !/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) fail(422, 'invalid_client_id');
  let waveform: number[] = [];
  try {
    waveform = z.array(z.number().min(0).max(1)).max(64).parse(JSON.parse(String(form.get('waveform') ?? '[]')));
  } catch { waveform = []; }
  if (clientId) {
    const existing = await c.env.DB.prepare(`SELECT m.*, NULL AS other_read_at FROM messages m WHERE conversation_id = ? AND sender_profile_id = ?
        AND client_id = ?`).bind(id, profile.id, clientId).first<Record<string, any>>();
    if (existing) return c.json((await messagesJSON(c.env, [existing], profile.id))[0], 200);
  }
  await checkCanSend(c.env, id, profile);
  const bytes = new Uint8Array(await audio.arrayBuffer());
  // MPEG-4 audio ("ftyp") or raw ADTS AAC (0xFFF sync word) — never anything else under an audio name.
  const ascii = String.fromCharCode(...bytes.slice(4, 8));
  if (!(ascii === 'ftyp' || (bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0))) fail(415, 'invalid_file');
  const messageId = newId('msg');
  const key = `voice/${id}/${messageId}.${ext}`;
  await c.env.MEDIA!.put(key, bytes, { httpMetadata: { contentType: ext === 'aac' ? 'audio/aac' : 'audio/mp4' } });
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO messages (id, conversation_id, sender_profile_id, kind, body, created_at, client_id) VALUES (?, ?, ?, 'media', '', ?, ?)`)
      .bind(messageId, id, profile.id, t, clientId || null),
    c.env.DB.prepare(`INSERT INTO message_voice (message_id, storage_key, mime, bytes, duration, waveform, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(messageId, key, ext === 'aac' ? 'audio/aac' : 'audio/mp4', bytes.length, duration, JSON.stringify(waveform), t),
    c.env.DB.prepare(`UPDATE conversations SET last_message_id = ?, last_message_at = ? WHERE id = ?`).bind(messageId, t, id),
    c.env.DB.prepare(`INSERT INTO conversation_read_state (conversation_id, profile_id, last_read_at, last_read_message_id) VALUES (?, ?, ?, ?)
      ON CONFLICT (conversation_id, profile_id) DO UPDATE SET last_read_at = excluded.last_read_at,
      last_read_message_id = excluded.last_read_message_id`).bind(id, profile.id, t, messageId),
    c.env.DB.prepare(`UPDATE conversation_participants SET hidden_at = NULL WHERE conversation_id = ?`).bind(id),
  ]);
  await afterSend(c.env, id, profile.id, messageId, t);
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

// DELETE /v1/conversations/:id — "Delete chat" for this profile only: off its list and its history cleared for it
// (cleared_at); the other participant keeps the conversation and every message. A new message brings the chat back,
// starting from that message.
messages.delete('/:id', async (c) => {
  const profile = actingProfile(c);
  const t = now();
  const res = await c.env.DB.prepare(`UPDATE conversation_participants SET hidden_at = ?, cleared_at = ? WHERE conversation_id = ? AND profile_id = ?`)
    .bind(t, t, c.req.param('id'), profile.id).run();
  if (!res.meta.changes) fail(404, 'conversation_not_found');
  return c.json({ status: 'hidden' });
});

export default messages;
